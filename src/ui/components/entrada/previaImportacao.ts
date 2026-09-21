/**
 * Monta o resumo "antes de confirmar" (RF-01) reaproveitando o parser e a normalização da
 * Fase 1 — nunca reimplementa a leitura de linha nem a normalização de campo. Puro: recebe
 * texto e um conjunto de ids já buscado, não lê rede nem D1.
 */
import { parseCsv, type LinhaRejeitada } from "../../../domain/parse-csv";
import { normalizarGuia } from "../../../domain/normalize";
import type { AvisoNormalizacao, GuiaBruta } from "../../../domain/guide";

export interface LinhaAceitaPreVia {
  readonly guia: GuiaBruta;
  readonly avisos: readonly AvisoNormalizacao[];
  /** Índice (1-based, entre as próprias linhas aceitas) da primeira ocorrência deste `id_guia` no arquivo. */
  readonly duplicataDaLinhaAceita: number | null;
  readonly jaExisteNaBase: boolean;
}

export interface PreviaImportacao {
  readonly formato: "csv" | "xlsx";
  readonly linhasLidas: number;
  readonly aceitas: readonly LinhaAceitaPreVia[];
  readonly rejeitadas: readonly LinhaRejeitada[];
  /** Aceitas que são a primeira ocorrência do próprio `id_guia` e ainda não existem na base — as que de fato criam protocolo novo. */
  readonly totalNovas: number;
  readonly totalJaExistentes: number;
  readonly totalDuplicadasNoArquivo: number;
}

/**
 * `csvTexto` já é o CSV real (arquivo `.csv` lido como texto) ou o CSV sintetizado a partir de
 * um `.xlsx` (`xlsxCliente.ts`) — a partir daqui os dois formatos seguem o mesmo caminho.
 * `idsGuiaExistentesNaBase` vem de `GET /api/protocols` (ver `buscarIdsGuiaExistentes.ts`).
 */
export function prepararPreviaImportacao(
  formato: "csv" | "xlsx",
  csvTexto: string,
  idsGuiaExistentesNaBase: ReadonlySet<string>,
): PreviaImportacao {
  const resultado = parseCsv(csvTexto);

  const primeiraOcorrenciaPorId = new Map<string, number>();
  const aceitas: LinhaAceitaPreVia[] = resultado.linhas.map((guia, indice) => {
    const numeroDaLinhaAceita = indice + 1;
    const primeiraOcorrencia = primeiraOcorrenciaPorId.get(guia.id_guia);
    if (primeiraOcorrencia === undefined) {
      primeiraOcorrenciaPorId.set(guia.id_guia, numeroDaLinhaAceita);
    }
    const { avisos } = normalizarGuia(guia);
    return {
      guia,
      avisos,
      duplicataDaLinhaAceita: primeiraOcorrencia ?? null,
      jaExisteNaBase: idsGuiaExistentesNaBase.has(guia.id_guia),
    };
  });

  const totalDuplicadasNoArquivo = aceitas.filter((linha) => linha.duplicataDaLinhaAceita !== null).length;
  const totalJaExistentes = aceitas.filter(
    (linha) => linha.duplicataDaLinhaAceita === null && linha.jaExisteNaBase,
  ).length;
  const totalNovas = aceitas.length - totalDuplicadasNoArquivo - totalJaExistentes;

  return {
    formato,
    linhasLidas: resultado.linhas.length + resultado.rejeitadas.length,
    aceitas,
    rejeitadas: resultado.rejeitadas,
    totalNovas,
    totalJaExistentes,
    totalDuplicadasNoArquivo,
  };
}
