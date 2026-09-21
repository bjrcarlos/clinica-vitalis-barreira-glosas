import type { GeradorId } from "../application/ports";

/** Gerador de identificadores internos via UUID v4 (Web Crypto — disponível no Worker e no Node 24). */
export class GeradorIdCrypto implements GeradorId {
  novo(): string {
    return crypto.randomUUID();
  }
}

/** Extrai os dois dígitos do ano UTC de um instante ISO — usado para compor "VT-YY-NNNN". */
export function anoUtcDoisDigitos(instanteIso: string): string {
  const ano = new Date(instanteIso).getUTCFullYear();
  return String(ano % 100).padStart(2, "0");
}

/** Formata um número de protocolo "VT-YY-NNNN" a partir do ano (2 dígitos) e do sequencial. */
export function formatarNumeroProtocolo(anoDoisDigitos: string, sequencial: number): string {
  return `VT-${anoDoisDigitos}-${String(sequencial).padStart(4, "0")}`;
}

/**
 * Posição (1-based) em que o sequencial começa dentro de "VT-YY-NNNN": depois do prefixo fixo
 * "VT-" (3 caracteres) e do ano de 2 dígitos + hífen (3 caracteres). Usado pelo SQL de
 * `d1/protocols.ts` para extrair e incrementar o maior sequencial já existente do ano.
 */
export const INICIO_SEQUENCIAL_NO_NUMERO_PROTOCOLO = 7;

/**
 * Fragmento SQL (SQLite/D1) que deriva o próximo sequencial de protocolo do ano a partir do
 * maior já existente. Só é seguro porque roda dentro de uma única instrução `INSERT ... SELECT`
 * em `d1/protocols.ts` — nunca como uma leitura seguida de uma escrita em duas chamadas
 * separadas, o que abriria uma corrida entre registros concorrentes (requisito de "sem colisão,
 * dentro da mesma transação"). `printf('%04d', ...)` nunca trunca: acima de 9999 o número só
 * fica mais largo, nunca colide.
 */
export const PROXIMO_SEQUENCIAL_PROTOCOLO_SQL =
  `COALESCE(MAX(CAST(substr(protocol_number, ${INICIO_SEQUENCIAL_NO_NUMERO_PROTOCOLO}) AS INTEGER)), 0) + 1`;
