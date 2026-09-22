import type { GeradorId } from "../../application/ports";

/**
 * Armazenamento de evidências no R2 privado (PRD-SDD §19.8, §25). Guarda o objeto binário e
 * expõe a sanitização de nome de arquivo que `src/infrastructure/d1/evidence.ts` reusa para os
 * metadados exibidos em tela — o nome enviado pelo usuário NUNCA é a chave do objeto nem é
 * confiado sem tratamento (RF-12, §25.1).
 *
 * Ordem de gravação (§25.2, obrigatória): calcular SHA-256 → gravar no R2 → só então o chamador
 * grava metadados no D1. Se a gravação no D1 falhar, `guardarEvidenciaComCompensacao` remove o
 * objeto órfão do R2 e propaga isso na mensagem de erro (este módulo não usa `console.*`, como o
 * resto do código-base — nenhum logger está configurado).
 *
 * `BucketEvidencias` é um subconjunto mínimo de `R2Bucket` (só put/get/delete) para que os testes
 * usem um duplo em memória simples, sem depender de wrangler. Um `R2Bucket` real satisfaz esta
 * interface estruturalmente.
 */

// --- Tipos aceitos e limite de tamanho (RF-12, §25.2) ---------------------------------------

const TIPOS_MIME_EVIDENCIA_ACEITOS = ["application/pdf", "image/jpeg", "image/png"] as const;

/** Um dos três tipos de arquivo aceitos como evidência. */
export type TipoMimeEvidencia = (typeof TIPOS_MIME_EVIDENCIA_ACEITOS)[number];

/** Confirma, em tempo de execução, se um `Content-Type` recebido é um dos aceitos. */
export function isTipoMimeEvidencia(valor: string): valor is TipoMimeEvidencia {
  return (TIPOS_MIME_EVIDENCIA_ACEITOS as readonly string[]).includes(valor);
}

/** Extensões de nome de arquivo aceitas para cada MIME — checagem cruzada, não só o MIME declarado. */
const EXTENSOES_POR_MIME: Readonly<Record<TipoMimeEvidencia, readonly string[]>> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
};

/** Limite de tamanho por arquivo de evidência (RF-12): 10 MB. */
export const LIMITE_BYTES_EVIDENCIA = 10 * 1024 * 1024;

/** Erro de validação de upload — tipo não aceito ou tamanho acima do limite. Nunca `ErroDominio` (camada HTTP): esta é a infraestrutura, quem chama traduz para o formato de resposta. */
export class EvidenciaRejeitadaError extends Error {
  readonly codigo: "EVIDENCE_TYPE_NOT_ALLOWED" | "EVIDENCE_TOO_LARGE";

  constructor(codigo: "EVIDENCE_TYPE_NOT_ALLOWED" | "EVIDENCE_TOO_LARGE", mensagem: string) {
    super(mensagem);
    this.name = "EvidenciaRejeitadaError";
    this.codigo = codigo;
  }
}

function normalizarContentType(valor: string): string {
  return (valor.split(";")[0] ?? "").trim().toLowerCase();
}

function extensaoDoNome(nomeSanitizado: string): string {
  const indice = nomeSanitizado.lastIndexOf(".");
  return indice === -1 ? "" : nomeSanitizado.slice(indice).toLowerCase();
}

function extensaoPermitidaParaTipo(nomeSanitizado: string, contentType: TipoMimeEvidencia): boolean {
  return EXTENSOES_POR_MIME[contentType].includes(extensaoDoNome(nomeSanitizado));
}

// --- Sanitização de nome de arquivo (exposta: nunca usar o nome do usuário como chave) -------

/** Caracteres de controle ASCII, e marcas Unicode invisíveis/de direção usadas para disfarçar extensão (ex.: RLO, U+202E). */
const CARACTERES_INVISIVEIS_OU_ENGANOSOS = /[\u0000-\u001F\u007F​-‏‪-‮⁠-⁤﻿]/gu;
/** Fora deste alfabeto (letras ASCII, dígitos, ponto, hífen, sublinhado, espaço), o caractere vira `_`. */
const CARACTERES_FORA_DO_ALFABETO_SEGURO = /[^a-zA-Z0-9._\- ]/g;
const TAMANHO_MAXIMO_NOME_ARQUIVO = 150;
const NOME_ARQUIVO_PADRAO = "arquivo";

/**
 * Sanitiza um nome de arquivo enviado pelo usuário para uso como metadado de exibição — nunca
 * como parte confiável da chave R2 (a chave usa um `uuid` separado, ver `montarChaveEvidencia`).
 * Remove qualquer componente de caminho (`/` ou `\`), caracteres de controle e Unicode
 * enganoso/invisível (normaliza NFKC antes), restringe a um alfabeto seguro, colapsa pontos
 * repetidos (evita `..`), corta pontos/hífens/underscores nas bordas e limita o comprimento.
 * Nunca lança; nome vazio ou só-lixo vira `"arquivo"`.
 */
export function sanitizarNomeArquivo(nomeOriginal: string): string {
  const ultimoSegmento = nomeOriginal.split(/[\\/]/).pop() ?? "";
  const normalizado = ultimoSegmento.normalize("NFKC");
  const semInvisiveis = normalizado.replace(CARACTERES_INVISIVEIS_OU_ENGANOSOS, "");
  const somenteAlfabetoSeguro = semInvisiveis.replace(CARACTERES_FORA_DO_ALFABETO_SEGURO, "_");
  const semPontosRepetidos = somenteAlfabetoSeguro.replace(/\.{2,}/g, ".");
  const semBordasSoltas = semPontosRepetidos.replace(/^[._\- ]+/, "").replace(/[._\- ]+$/, "");
  const limitado = semBordasSoltas.slice(0, TAMANHO_MAXIMO_NOME_ARQUIVO);
  return limitado.length > 0 ? limitado : NOME_ARQUIVO_PADRAO;
}

/** Chave R2 fixada (§25.1): `evidence/{protocol-id}/{event-id}/{uuid}-{safe-filename}`. */
export function montarChaveEvidencia(
  protocoloId: string,
  eventoId: string,
  uuid: string,
  nomeArquivoSanitizado: string,
): string {
  return `evidence/${protocoloId}/${eventoId}/${uuid}-${nomeArquivoSanitizado}`;
}

// --- Leitura do stream com limite conferido durante a leitura, não só pelo cabeçalho ---------

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Lê um stream acumulando bytes, mas aborta assim que o total ultrapassa `limiteBytes` — nunca
 * espera o stream terminar antes de checar. É isso que protege contra um `Content-Length`
 * mentiroso (pequeno) escondendo um corpo real muito maior: mesmo sem cabeçalho nenhum, o corte
 * acontece durante a leitura, não depois dela.
 */
async function lerComLimite(stream: ReadableStream<Uint8Array>, limiteBytes: number): Promise<Uint8Array> {
  const leitor = stream.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      total += value.byteLength;
      if (total > limiteBytes) {
        await leitor.cancel("limite de tamanho de evidência excedido");
        throw new EvidenciaRejeitadaError(
          "EVIDENCE_TOO_LARGE",
          `Arquivo excede o limite de ${limiteBytes} bytes (detectado durante a leitura, não só pelo cabeçalho).`,
        );
      }
      pedacos.push(value);
    }
  } finally {
    leitor.releaseLock();
  }

  const resultado = new Uint8Array(total);
  let deslocamento = 0;
  for (const pedaco of pedacos) {
    resultado.set(pedaco, deslocamento);
    deslocamento += pedaco.byteLength;
  }
  return resultado;
}

// --- Bucket mínimo (real R2Bucket satisfaz isto estruturalmente; testes usam um duplo simples) --

/** Objeto de evidência lido de volta do bucket. */
export interface ObjetoEvidenciaLido {
  arrayBuffer(): Promise<ArrayBuffer>;
  readonly httpMetadata?: { readonly contentType?: string };
  readonly customMetadata?: Readonly<Record<string, string>>;
}

/** Subconjunto de `R2Bucket` que este módulo usa — nunca o tipo completo, para manter os testes livres de wrangler. */
export interface BucketEvidencias {
  put(
    chave: string,
    valor: Uint8Array,
    opcoes?: {
      readonly httpMetadata?: { readonly contentType?: string };
      readonly customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  get(chave: string): Promise<ObjetoEvidenciaLido | null>;
  delete(chave: string): Promise<unknown>;
}

// --- Guardar e recuperar -----------------------------------------------------------------------

/** Entrada para gravar uma nova evidência — `tamanhoDeclaradoBytes` vem do `Content-Length` da requisição e NUNCA é a única checagem (ver `lerComLimite`). */
export interface EntradaEvidencia {
  readonly protocoloId: string;
  readonly eventoId: string;
  readonly nomeArquivoOriginal: string;
  readonly contentType: string;
  readonly tamanhoDeclaradoBytes: number | null;
  readonly conteudo: ReadableStream<Uint8Array>;
}

/** Resultado de uma gravação bem-sucedida no R2 — o suficiente para o chamador persistir os metadados em `evidence_objects`. */
export interface EvidenciaArmazenada {
  readonly chave: string;
  readonly nomeArquivoSanitizado: string;
  readonly contentType: TipoMimeEvidencia;
  readonly tamanhoBytes: number;
  readonly sha256: string;
}

/**
 * Valida tipo (MIME + extensão), tamanho (antes e durante a leitura), calcula o SHA-256 do
 * conteúdo e grava o objeto no R2 com metadata mínima. Lança `EvidenciaRejeitadaError` para
 * qualquer rejeição — nunca grava nada no bucket quando rejeita.
 */
export async function guardarEvidencia(
  bucket: BucketEvidencias,
  entrada: EntradaEvidencia,
  ids: GeradorId,
): Promise<EvidenciaArmazenada> {
  const contentType = normalizarContentType(entrada.contentType);
  if (!isTipoMimeEvidencia(contentType)) {
    throw new EvidenciaRejeitadaError(
      "EVIDENCE_TYPE_NOT_ALLOWED",
      `Tipo de arquivo não aceito: "${entrada.contentType}". Aceitos: PDF, JPEG ou PNG.`,
    );
  }

  const nomeArquivoSanitizado = sanitizarNomeArquivo(entrada.nomeArquivoOriginal);
  if (!extensaoPermitidaParaTipo(nomeArquivoSanitizado, contentType)) {
    throw new EvidenciaRejeitadaError(
      "EVIDENCE_TYPE_NOT_ALLOWED",
      `Extensão do arquivo não corresponde ao tipo declarado (${contentType}).`,
    );
  }

  if (entrada.tamanhoDeclaradoBytes !== null && entrada.tamanhoDeclaradoBytes > LIMITE_BYTES_EVIDENCIA) {
    throw new EvidenciaRejeitadaError(
      "EVIDENCE_TOO_LARGE",
      `Arquivo declara ${entrada.tamanhoDeclaradoBytes} bytes, acima do limite de ${LIMITE_BYTES_EVIDENCIA} bytes.`,
    );
  }

  const bytes = await lerComLimite(entrada.conteudo, LIMITE_BYTES_EVIDENCIA);
  const sha256 = await sha256Hex(bytes);
  const chave = montarChaveEvidencia(entrada.protocoloId, entrada.eventoId, ids.novo(), nomeArquivoSanitizado);

  await bucket.put(chave, bytes, {
    httpMetadata: { contentType },
    customMetadata: {
      sha256,
      originalFilename: nomeArquivoSanitizado,
      protocolId: entrada.protocoloId,
      eventId: entrada.eventoId,
    },
  });

  return { chave, nomeArquivoSanitizado, contentType, tamanhoBytes: bytes.byteLength, sha256 };
}

/** Conteúdo de evidência lido de volta do R2, pronto para servir via download assinado (§25.3). */
export interface EvidenciaRecuperada {
  readonly conteudo: ArrayBuffer;
  readonly contentType: string | null;
  readonly customMetadata: Readonly<Record<string, string>>;
}

/** Recupera o objeto pela chave R2. `null` quando não existe — nunca lança para "não encontrado". */
export async function recuperarEvidencia(bucket: BucketEvidencias, chave: string): Promise<EvidenciaRecuperada | null> {
  const objeto = await bucket.get(chave);
  if (objeto === null) return null;
  return {
    conteudo: await objeto.arrayBuffer(),
    contentType: objeto.httpMetadata?.contentType ?? null,
    customMetadata: objeto.customMetadata ?? {},
  };
}

// --- Compensação de objeto órfão quando a gravação dos metadados no D1 falha (§25.2) ----------

/** Erro final propagado quando os metadados não puderam ser gravados — a mensagem já diz se o objeto órfão foi removido do R2. */
export class GravacaoMetadadosEvidenciaFalhouError extends Error {
  readonly chave: string;
  readonly limpezaR2Concluida: boolean;

  constructor(chave: string, limpezaR2Concluida: boolean, causa: unknown) {
    super(
      limpezaR2Concluida
        ? `Metadados da evidência (chave R2 "${chave}") falharam ao gravar; objeto órfão removido do R2.`
        : `Metadados da evidência (chave R2 "${chave}") falharam ao gravar; FALHA TAMBÉM ao remover o objeto órfão do R2 — requer limpeza manual.`,
      { cause: causa },
    );
    this.name = "GravacaoMetadadosEvidenciaFalhouError";
    this.chave = chave;
    this.limpezaR2Concluida = limpezaR2Concluida;
  }
}

/**
 * Grava o objeto no R2 e só então chama `persistirMetadados` (tipicamente
 * `RepositorioEvidenciasD1.gravar`, ver `../d1/evidence.ts`). Se `persistirMetadados` falhar,
 * remove o objeto órfão do R2 antes de propagar — a mensagem de `GravacaoMetadadosEvidenciaFalhouError`
 * registra se a limpeza deu certo, já que este código-base não tem logger configurado.
 */
export async function guardarEvidenciaComCompensacao<T>(
  bucket: BucketEvidencias,
  entrada: EntradaEvidencia,
  ids: GeradorId,
  persistirMetadados: (armazenada: EvidenciaArmazenada) => Promise<T>,
): Promise<T> {
  const armazenada = await guardarEvidencia(bucket, entrada, ids);
  try {
    return await persistirMetadados(armazenada);
  } catch (causa) {
    let limpezaR2Concluida: boolean;
    try {
      await bucket.delete(armazenada.chave);
      limpezaR2Concluida = true;
    } catch {
      limpezaR2Concluida = false;
    }
    throw new GravacaoMetadadosEvidenciaFalhouError(armazenada.chave, limpezaR2Concluida, causa);
  }
}
