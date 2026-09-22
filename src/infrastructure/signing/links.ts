import type { GeradorId } from "../../application/ports";

/**
 * Token HMAC de finalidade única para links temporários (PRD-SDD §23.4 "links de revisão",
 * §25.3 "download só via link assinado, de curta duração"). Mesmo mecanismo de assinatura de
 * `src/infrastructure/auth/session.ts` (HMAC-SHA256 via WebCrypto, `LINK_SIGNING_KEY`), mas para
 * um recurso e uma finalidade específicos em vez de uma sessão de papel — por isso os dois
 * módulos não compartilham código além da técnica (as funções base64url/HMAC de `session.ts` não
 * são exportadas por aquele arquivo, e este módulo está fora do escopo de tarefa que poderia
 * alterá-lo; duplicar ~15 linhas de codec é o preço de manter os dois módulos independentes).
 *
 * `finalidade` é sempre um PARÂMETRO do payload, nunca uma constante do módulo — a Fase 4 (MCP,
 * `minhas_pendencias`) reusa exatamente estas mesmas `assinarLink`/`verificarLink` para os links
 * de revisão com finalidade `"review"`, e esta fase usa `"evidence"` para o download de
 * evidência; nenhum dos dois lê o token do outro (`verificarLink` recusa finalidade divergente).
 */

const FINALIDADES_LINK_VALORES = ["review", "evidence"] as const;

/** Para que serve o link assinado — cada finalidade só abre o recurso e a tela correspondentes. */
export type FinalidadeLinkAssinado = (typeof FINALIDADES_LINK_VALORES)[number];

/** Confirma, em tempo de execução, se um texto arbitrário é uma `FinalidadeLinkAssinado` válida. */
export function isFinalidadeLinkAssinado(valor: string): valor is FinalidadeLinkAssinado {
  return (FINALIDADES_LINK_VALORES as readonly string[]).includes(valor);
}

/** Duração padrão de um link assinado: curta, como pede §25.3 ("token HMAC de curta duração"). */
export const DURACAO_PADRAO_LINK_MS = 15 * 60 * 1000;

/** Conteúdo decodificado e verificado de um token de link assinado. */
export interface PayloadLinkAssinado {
  readonly finalidade: FinalidadeLinkAssinado;
  /** Identificador do recurso ao qual o link dá acesso: número de protocolo (`"review"`) ou id de evidência (`"evidence"`). A finalidade já diz qual é — não precisa de dois campos separados. */
  readonly recursoId: string;
  readonly expiraEmUtc: string;
  readonly nonce: string;
  readonly area?: "SECRETARIA" | "FINANCEIRO";
}

function codificarBase64Url(bytes: Uint8Array): string {
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodificarBase64Url(texto: string): Uint8Array<ArrayBuffer> | null {
  try {
    const normalizado = texto.replace(/-/g, "+").replace(/_/g, "/");
    const comPreenchimento = normalizado.padEnd(
      normalizado.length + ((4 - (normalizado.length % 4)) % 4),
      "=",
    );
    const binario = atob(comPreenchimento);
    return Uint8Array.from(binario, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function importarChave(chaveSecreta: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(chaveSecreta),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** O que assinar: a finalidade e o recurso ao qual o link dará acesso. */
export interface DadosParaAssinarLink {
  readonly finalidade: FinalidadeLinkAssinado;
  readonly recursoId: string;
  readonly area?: "SECRETARIA" | "FINANCEIRO";
}

/** Token pronto para ir numa URL (`?token=...`) e o payload que ele carrega, para quem for montar o link completo. */
export interface LinkAssinado {
  readonly token: string;
  readonly payload: PayloadLinkAssinado;
}

/**
 * Assina um novo link de finalidade única para `dados.recursoId`, válido a partir de `agoraUtc`
 * pela duração informada (padrão `DURACAO_PADRAO_LINK_MS`). `ids.novo()` gera o nonce — não
 * precisa ser imprevisível além do que um UUID já é, só distinguir tokens emitidos no mesmo
 * instante.
 */
export async function assinarLink(
  dados: DadosParaAssinarLink,
  chaveSecreta: string,
  agoraUtc: string,
  ids: GeradorId,
  duracaoMs: number = DURACAO_PADRAO_LINK_MS,
): Promise<LinkAssinado> {
  const expiraEmUtc = new Date(new Date(agoraUtc).getTime() + duracaoMs).toISOString();
  const payload: PayloadLinkAssinado = {
    finalidade: dados.finalidade,
    recursoId: dados.recursoId,
    expiraEmUtc,
    nonce: ids.novo(),
    ...(dados.area ? { area: dados.area } : {}),
  };
  const payloadB64 = codificarBase64Url(new TextEncoder().encode(JSON.stringify(payload)));

  const chave = await importarChave(chaveSecreta);
  const assinaturaBytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(payloadB64)),
  );
  const assinaturaB64 = codificarBase64Url(assinaturaBytes);

  return { token: `${payloadB64}.${assinaturaB64}`, payload };
}

/** O que `verificarLink` exige que o token bata, além de assinatura e expiração — a finalidade e o recurso que a rota está de fato servindo. */
export interface VerificacaoLinkEntrada {
  readonly finalidadeEsperada: FinalidadeLinkAssinado;
  readonly recursoIdEsperado: string;
  readonly areaEsperada?: "SECRETARIA" | "FINANCEIRO";
}

/**
 * Verifica um token de link assinado: assinatura (`crypto.subtle.verify`, tempo constante),
 * formato do payload, finalidade, recurso e expiração. Devolve `null` para qualquer falha —
 * nunca lança, nunca loga o token recebido. Recusa tanto token de outra finalidade quanto token
 * válido para outro recurso da mesma finalidade (ex.: token de evidência A usado para baixar a
 * evidência B).
 */
export async function verificarLink(
  token: string,
  chaveSecreta: string,
  agoraUtc: string,
  entrada: VerificacaoLinkEntrada,
): Promise<PayloadLinkAssinado | null> {
  const separador = token.indexOf(".");
  if (separador <= 0 || separador === token.length - 1) return null;

  const payloadB64 = token.slice(0, separador);
  const assinaturaB64 = token.slice(separador + 1);

  const assinaturaBytes = decodificarBase64Url(assinaturaB64);
  if (assinaturaBytes === null) return null;

  const chave = await importarChave(chaveSecreta);
  const valido = await crypto.subtle.verify(
    "HMAC",
    chave,
    assinaturaBytes,
    new TextEncoder().encode(payloadB64),
  );
  if (!valido) return null;

  const payloadBytes = decodificarBase64Url(payloadB64);
  if (payloadBytes === null) return null;

  let payload: PayloadLinkAssinado;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as PayloadLinkAssinado;
  } catch {
    return null;
  }

  if (
    typeof payload.finalidade !== "string" ||
    !isFinalidadeLinkAssinado(payload.finalidade) ||
    typeof payload.recursoId !== "string" ||
    typeof payload.expiraEmUtc !== "string" ||
    typeof payload.nonce !== "string"
  ) {
    return null;
  }

  if (payload.finalidade !== entrada.finalidadeEsperada) return null;
  if (payload.recursoId !== entrada.recursoIdEsperado) return null;
  if (payload.area !== undefined && payload.area !== "SECRETARIA" && payload.area !== "FINANCEIRO") return null;
  if (entrada.areaEsperada !== undefined && payload.area !== entrada.areaEsperada) return null;

  const expiraEmMs = Date.parse(payload.expiraEmUtc);
  const agoraEmMs = Date.parse(agoraUtc);
  if (Number.isNaN(expiraEmMs) || Number.isNaN(agoraEmMs) || agoraEmMs > expiraEmMs) {
    return null;
  }

  return payload;
}
