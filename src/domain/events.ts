import type { Area, Origem } from "./statuses";

/** Classifica a natureza de um evento na trilha de auditoria append-only de um protocolo. */
export type TipoEvento =
  | "IMPORTACAO"
  | "CADASTRO"
  | "VALIDACAO"
  | "CORRECAO"
  | "REVISAO"
  | "LIBERACAO"
  | "ENVIO"
  | "ENCERRAMENTO"
  | "MERGE";

/** Um fato imutável ocorrido no fluxo de um protocolo: quem agiu, de onde e quando — nunca editado ou apagado. */
export interface EventoFluxo {
  readonly tipo: TipoEvento;
  readonly ator: string;
  readonly papel: Area;
  readonly origem: Origem;
  /** Instante ISO UTC em que o fato ocorreu no processo (não quando foi gravado). */
  readonly ocorrido_em_utc: string;
  /** Instante ISO UTC em que o evento entrou no sistema. */
  readonly registrado_em_utc: string;
  readonly motivo: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}
