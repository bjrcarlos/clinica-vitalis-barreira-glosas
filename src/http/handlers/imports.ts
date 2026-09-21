import type { ManipuladorRota } from "../routes";
import { ErroDominio, lerCorpoJson } from "../routes";
import {
  esquemaImportarGuiasEntrada,
  esquemaImportarGuiasResposta,
  type ImportarGuiasEntrada,
  type ImportarGuiasResposta,
} from "../contracts";
import { parseCsv, type LinhaRejeitada } from "../../domain/parse-csv";
import { normalizarGuia } from "../../domain/normalize";
import type { GuiaBruta } from "../../domain/guide";
import { validarGuia as validarGuiaMotor } from "../../rules/engine";
import { registrarGuia } from "../../application/register-guide";
import type { PapelSessao } from "../../infrastructure/auth/session";
import { criarRepositoriosD1 } from "../../infrastructure/d1/repositories";
import { GeradorIdCrypto } from "../../infrastructure/id";
import { RelogioReal } from "../../infrastructure/clock";
import { carregarRegrasAtivas, semAutoDuplicidade } from "./create-protocol";

/**
 * POST /api/imports — RF-01, papel SECRETARIA. Recebe CSV (texto) ou JSON já estruturado
 * (`formato`), reaproveita `parseCsv` (Fase 1) e `registrarGuia`/`validarGuia` (aplicação) por
 * linha, e devolve o resumo (linhas aceitas, rejeitadas com motivo, duplicadas dentro do
 * arquivo, e quais já existem na base por `id_guia`).
 *
 * O contrato fixado (`esquemaImportarGuiasEntrada`/`Resposta`, `src/http/contracts.ts`) não
 * tem um segundo passo de confirmação — a resposta desta chamada JÁ É o resumo, e persistir é
 * o efeito de chamar esta rota (a pré-visualização, quando existir, é responsabilidade da UI
 * antes de montar esta requisição). Suposição declarada: sem campo de confirmação no schema
 * fixado, "confirmar" é o próprio ato de chamar `POST /api/imports`.
 *
 * Idempotência: `registrarGuia` já é idempotente por `id_guia` de origem (Fase 1) — reimportar
 * o mesmo arquivo devolve os protocolos existentes em `protocolos_ja_existentes`, nunca cria
 * duplicata. O hash do conteúdo é calculado e gravado no evento `IMPORTACAO` de cada linha
 * (auditoria — RF-01 "registrar ator, arquivo, hash e horário"), mas não é uma segunda chave
 * de idempotência: `id_guia` sozinho já garante "reimportar não duplica".
 */

async function sha256Hex(texto: string): Promise<string> {
  const bytes = new TextEncoder().encode(texto);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

interface LinhaParaProcessar {
  readonly numeroLinha: number;
  readonly idGuia: string;
  readonly guiaBruta: GuiaBruta;
}

/**
 * Aceita uma linha quando tem `id_guia` não vazio e ainda não apareceu antes NESTE arquivo —
 * "duplicadas dentro do arquivo" (RF-01) vira rejeição da segunda ocorrência em diante, com
 * motivo explícito; a primeira ocorrência segue para registro normalmente.
 *
 * `numeroDaPrimeiraLinhaDeDados + índice` aproxima o número da linha física: `parseCsv`
 * (Fase 1) só devolve o número de linha real para as rejeitadas por ele, não para as aceitas
 * em `linhas`. Para um CSV sem campo com quebra de linha entre aspas a aproximação é exata;
 * com esse recurso (raro em `guias.csv`) o número exibido pode divergir da linha física —
 * cosmético, não afeta idempotência nem quais linhas são de fato registradas.
 */
function selecionarLinhas(
  linhasBrutas: readonly GuiaBruta[],
  numeroDaPrimeiraLinhaDeDados: number,
): { readonly paraProcessar: readonly LinhaParaProcessar[]; readonly rejeitadas: LinhaRejeitada[] } {
  const rejeitadas: LinhaRejeitada[] = [];
  const paraProcessar: LinhaParaProcessar[] = [];
  const vistos = new Map<string, number>();

  linhasBrutas.forEach((guiaBruta, indice) => {
    const numeroLinha = numeroDaPrimeiraLinhaDeDados + indice;
    const idGuia = (guiaBruta.id_guia ?? "").trim();
    if (idGuia === "") {
      rejeitadas.push({ numero_linha: numeroLinha, motivo: "id_guia ausente." });
      return;
    }
    const linhaAnterior = vistos.get(idGuia);
    if (linhaAnterior !== undefined) {
      rejeitadas.push({
        numero_linha: numeroLinha,
        motivo: `id_guia duplicado dentro do arquivo (já aparece na linha ${linhaAnterior}).`,
      });
      return;
    }
    vistos.set(idGuia, numeroLinha);
    paraProcessar.push({ numeroLinha, idGuia, guiaBruta });
  });

  return { paraProcessar, rejeitadas };
}

/** Núcleo testável, sem `Request`/`Response`. */
export async function importarGuias(
  db: D1Database,
  papel: PapelSessao,
  corpoBruto: unknown,
): Promise<ImportarGuiasResposta> {
  if (papel !== "SECRETARIA") {
    throw new ErroDominio("ROLE_NOT_ALLOWED", "Somente a Secretaria pode importar guias.");
  }

  const entrada: ImportarGuiasEntrada = esquemaImportarGuiasEntrada.parse(corpoBruto);

  const { linhasBrutas, rejeitadasDoParser, numeroDaPrimeiraLinhaDeDados, hash } =
    entrada.formato === "csv"
      ? {
          ...parseCsvComoLinhas(entrada.conteudo_csv),
          hash: await sha256Hex(entrada.conteudo_csv),
        }
      : {
          linhasBrutas: entrada.linhas,
          rejeitadasDoParser: [] as LinhaRejeitada[],
          numeroDaPrimeiraLinhaDeDados: 1,
          hash: await sha256Hex(JSON.stringify(entrada.linhas)),
        };

  const { paraProcessar, rejeitadas } = selecionarLinhas(linhasBrutas, numeroDaPrimeiraLinhaDeDados);
  rejeitadas.unshift(...rejeitadasDoParser);

  const regras = await carregarRegrasAtivas(db);
  const ids = new GeradorIdCrypto();
  const relogio = new RelogioReal();
  const repos = criarRepositoriosD1(db, ids, relogio);

  const protocolosCriados: { numero_protocolo: string; id_guia_origem: string }[] = [];
  const protocolosJaExistentes: { numero_protocolo: string; id_guia_origem: string }[] = [];

  for (const linha of paraProcessar) {
    try {
      const { guia: guiaNormalizada, avisos: avisosNormalizacao } = normalizarGuia(linha.guiaBruta);

      const resultado = await registrarGuia(
        {
          idGuiaOrigem: linha.idGuia,
          guiaBruta: linha.guiaBruta,
          guiaNormalizada,
          avisosNormalizacao,
          criadoPorPapel: "SECRETARIA",
          criadoPorPrincipal: "secretaria@vitalis",
          origem: "IMPORTACAO",
          regras,
        },
        {
          protocolos: repos.protocolos,
          versoes: semAutoDuplicidade(repos.versoes),
          eventos: repos.eventos,
          relogio,
          validarGuiaDependencias: {
            motor: validarGuiaMotor,
            validacoes: repos.validacoes,
            tarefas: repos.tarefas,
            eventos: repos.eventos,
            relogio,
          },
        },
      );

      const numeroProtocolo = resultado.protocolo.numeroProtocolo;
      const protocoloId = resultado.protocolo.protocoloId;
      const guiaVersaoId = resultado.jaExistia ? resultado.protocolo.versaoAtualId : resultado.protocolo.versaoId;

      // Evidência do próprio ato de importação (RF-01: "registrar ator, arquivo, hash e
      // horário da importação") — distinta do evento CADASTRO que `registrarGuia` já grava só
      // quando o protocolo é novo; esta é gravada sempre (novo ou já existente), ligando esta
      // importação específica ao protocolo — reimportação idempotente ainda fica rastreada.
      await repos.eventos.registrar({
        protocoloId,
        guiaVersaoId,
        evento: {
          tipo: "IMPORTACAO",
          ator: "secretaria@vitalis",
          papel: "SECRETARIA",
          origem: "IMPORTACAO",
          ocorrido_em_utc: relogio.agoraUtc(),
          registrado_em_utc: relogio.agoraUtc(),
          motivo: null,
          metadata: {
            nome_arquivo: entrada.nome_arquivo,
            formato: entrada.formato,
            hash_conteudo_sha256: hash,
            numero_linha: linha.numeroLinha,
            id_guia_origem: linha.idGuia,
            protocolo_ja_existia: resultado.jaExistia,
          },
        },
      });

      (resultado.jaExistia ? protocolosJaExistentes : protocolosCriados).push({
        numero_protocolo: numeroProtocolo,
        id_guia_origem: linha.idGuia,
      });
    } catch (erro) {
      rejeitadas.push({
        numero_linha: linha.numeroLinha,
        motivo: erro instanceof ErroDominio ? erro.message : "Falha inesperada ao registrar esta linha.",
      });
    }
  }

  // Ponto de extensão da Fase 3 (fora de escopo desta tarefa): enviar o arquivo original
  // (`entrada.conteudo_csv` ou os bytes de origem do upload) para o bucket `EVIDENCE` (R2) e
  // vincular via `evidence_objects`/`evidence_links`, usando `hash` acima como `sha256` e
  // `entrada.nome_arquivo` como `original_filename`.
  // await env.EVIDENCE.put(`importacoes/${hash}`, conteudoOriginal);

  const corpo: ImportarGuiasResposta = {
    linhas_aceitas: protocolosCriados.length + protocolosJaExistentes.length,
    linhas_rejeitadas: rejeitadas,
    protocolos_criados: protocolosCriados,
    protocolos_ja_existentes: protocolosJaExistentes,
  };

  return esquemaImportarGuiasResposta.parse(corpo);
}

function parseCsvComoLinhas(conteudoCsv: string): {
  readonly linhasBrutas: readonly GuiaBruta[];
  readonly rejeitadasDoParser: LinhaRejeitada[];
  readonly numeroDaPrimeiraLinhaDeDados: number;
} {
  const resultado = parseCsv(conteudoCsv);
  return {
    linhasBrutas: resultado.linhas,
    rejeitadasDoParser: [...resultado.rejeitadas],
    numeroDaPrimeiraLinhaDeDados: 2, // linha 1 é o cabeçalho.
  };
}

export const manipularImportacaoGuias: ManipuladorRota = async (ctx) => {
  const corpoBruto = await lerCorpoJson(ctx.request);
  const corpo = await importarGuias(ctx.env.DB, ctx.papel, corpoBruto);
  return Response.json(corpo, { status: 201 });
};
