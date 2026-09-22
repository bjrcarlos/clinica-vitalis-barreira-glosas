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

const FUSO_BRASILIA = "America/Sao_Paulo";
const UM_DIA_EM_MS = 86_400_000;

/** Extrai os componentes de data/hora de um instante ISO UTC já convertidos para o fuso pedido. */
function partesEmFuso(isoUtc: string, opcoes: Intl.DateTimeFormatOptions): Record<string, string> {
  const formatador = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO_BRASILIA, ...opcoes });
  const partes: Record<string, string> = {};
  for (const parte of formatador.formatToParts(new Date(isoUtc))) {
    if (parte.type !== "literal") {
      partes[parte.type] = parte.value;
    }
  }
  return partes;
}

/**
 * `dd/MM/aaaa HH:mm:ss`, fuso America/Sao_Paulo, com o rótulo "horário de Brasília"
 * (RF-11, CLAUDE.md — exibição de datas).
 */
export function formatarDataHoraBrasilia(isoUtc: string): string {
  const p = partesEmFuso(isoUtc, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second} · horário de Brasília`;
}

/** `dd/MM/aaaa`, fuso America/Sao_Paulo, sem hora nem rótulo — para colunas de tabela. */
export function formatarDataCurta(isoUtc: string): string {
  const p = partesEmFuso(isoUtc, { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${p.day}/${p.month}/${p.year}`;
}

const REGEX_DATA_DE_CALENDARIO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Formata `valor` como `dd/MM/aaaa` quando ele é uma data de calendário ISO (`AAAA-MM-DD`, ex.
 * `data_atendimento`/`autorizacao_validade`) — texto puro, sem `Date`/fuso, porque é uma data de
 * calendário, não um instante (converter por fuso deslocaria o dia). Qualquer outro valor volta
 * inalterado. Usado por pares rótulo/valor genéricos (`Subproblema`) que às vezes carregam uma
 * data e às vezes não; o dado gravado nunca é tocado, só a exibição.
 */
export function formatarValorSePossuirDataDeCalendario(valor: string): string {
  if (!REGEX_DATA_DE_CALENDARIO.test(valor)) return valor;
  const [ano, mes, dia] = valor.split("-");
  return `${dia}/${mes}/${ano}`;
}

/** Centavos inteiros (invariante de domínio) → `R$ 1.234,56`. Nunca receber float monetário. */
export function formatarCentavos(centavos: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(centavos / 100);
}

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
