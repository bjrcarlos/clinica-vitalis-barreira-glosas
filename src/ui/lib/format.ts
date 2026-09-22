/**
 * Formatadores de apresentação — únicos deste arquivo em toda a UI (evita cada tela
 * reimplementar fuso, moeda ou rótulo com sua própria lógica, e evita duplicar a tradução
 * ASCII → acentuado que já existe em `src/domain/statuses.ts`).
 *
 * Datas: os identificadores canônicos do domínio são instantes ISO UTC (CLAUDE.md, invariantes
 * de domínio). Este arquivo só formata para exibição; nunca decide fuso em nenhum outro lugar.
 */
import {
  apresentarArea,
  apresentarFluxoStatus,
  apresentarValidacaoStatus,
  type Area,
  type FluxoStatus,
  type ValidacaoStatus,
} from "../../domain/statuses";

import {
  formatarCentavos as formatarCentavosDominio,
  formatarDataCalendario,
  formatarDataCurta as formatarDataCurtaDominio,
  formatarDataHoraBrasilia as formatarDataHoraBrasiliaDominio,
} from "../../domain/apresentacao";

const UM_DIA_EM_MS = 86_400_000;

/** `dd/MM/aaaa HH:mm:ss`, fuso America/Sao_Paulo, com o rótulo "horário de Brasília" — implementação em `src/domain/apresentacao.ts`. */
export const formatarDataHoraBrasilia = formatarDataHoraBrasiliaDominio;

/** `dd/MM/aaaa`, fuso America/Sao_Paulo, sem hora nem rótulo — implementação em `src/domain/apresentacao.ts`. */
export const formatarDataCurta = formatarDataCurtaDominio;

/** Formata `valor` como `dd/MM/aaaa` quando ele é uma data de calendário ISO; qualquer outro valor volta inalterado. */
export const formatarValorSePossuirDataDeCalendario = formatarDataCalendario;

/** Centavos inteiros → `R$ 1.234,56` — implementação em `src/domain/apresentacao.ts`. */
export const formatarCentavos = formatarCentavosDominio;

/** Rótulo em português, com acento, de um `ValidacaoStatus` ASCII (ex.: badges de estado). */
export function formatarRotuloValidacaoStatus(status: ValidacaoStatus): string {
  return apresentarValidacaoStatus(status);
}

/** Rótulo em português, com acento, de um `FluxoStatus` ASCII (ex.: ponto de estado de fluxo). */
export function formatarRotuloFluxoStatus(status: FluxoStatus): string {
  return apresentarFluxoStatus(status);
}

/** Rótulo em português de uma `Area` ASCII. */
export function formatarRotuloArea(area: Area): string {
  return apresentarArea(area);
}

/**
 * "há N dias" a partir de um instante ISO UTC (ex.: pendência aberta em `ocorridoEmUtc`).
 * `agoraUtc` é injetável — nunca chama `Date.now()` implicitamente, para o resultado ser
 * reproduzível em teste (mesma convenção de relógio de `src/infrastructure/clock.ts`).
 */
export function formatarHaDias(ocorridoEmUtc: string, agoraUtc: string = new Date().toISOString()): string {
  const diferencaMs = new Date(agoraUtc).getTime() - new Date(ocorridoEmUtc).getTime();
  const dias = Math.max(0, Math.floor(diferencaMs / UM_DIA_EM_MS));
  if (dias === 0) return "hoje";
  if (dias === 1) return "há 1 dia";
  return `há ${dias} dias`;
}
