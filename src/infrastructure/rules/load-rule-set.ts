/// <reference types="@cloudflare/workers-types" />
import { montarConjuntoRegras, type ConjuntoRegrasIndexado } from "../../rules/rule-set";
import type { GeradorId, Relogio } from "../../application/ports";

/**
 * Persiste o conjunto de regras oficial em `rule_sets`, respeitando RN-01 (fonte da verdade
 * versionada e com hash) e RN-02 (imutabilidade histórica): reimportar o MESMO conteúdo nunca
 * duplica linha nem reativa silenciosamente uma versão que não esteja ativa; conteúdo
 * diferente cria uma linha nova e só ela fica ativa.
 *
 * Recebe o texto original já carregado (a leitura do arquivo é responsabilidade de quem chama
 * — script de seed em Node, ou outra origem — para este módulo continuar servindo tanto o
 * Worker quanto Node 24, como o cálculo do hash abaixo via WebCrypto).
 */
export interface RegraCarregada {
  readonly conjunto: ConjuntoRegrasIndexado;
  readonly ruleSetId: string;
  /** `true` somente quando esta chamada criou e ativou uma versão nova (conteúdo inédito). */
  readonly novaVersaoAtivada: boolean;
}

export async function carregarESalvarConjuntoRegras(
  textoOriginal: string,
  db: D1Database,
  relogio: Relogio,
  geradorId: GeradorId,
): Promise<RegraCarregada> {
  const sha256 = await calcularSha256(textoOriginal);
  const conjunto = montarConjuntoRegras(textoOriginal, sha256);

  const existente = await db
    .prepare("SELECT id FROM rule_sets WHERE source_sha256 = ?")
    .bind(sha256)
    .first<{ id: string }>();

  if (existente !== null) {
    return { conjunto, ruleSetId: existente.id, novaVersaoAtivada: false };
  }

  const ruleSetId = geradorId.novo();
  const agoraUtc = relogio.agoraUtc();

  await db.batch([
    db.prepare("UPDATE rule_sets SET is_active = 0 WHERE is_active = 1"),
    db
      .prepare(
        `INSERT INTO rule_sets
           (id, version, source_json, source_sha256, imported_at_utc, activated_at_utc, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
      )
      .bind(ruleSetId, conjunto.versao, textoOriginal, sha256, agoraUtc, agoraUtc),
  ]);

  return { conjunto, ruleSetId, novaVersaoAtivada: true };
}

/** SHA-256 em hexadecimal via WebCrypto — disponível tanto no Worker quanto no Node 24. */
async function calcularSha256(texto: string): Promise<string> {
  const bytes = new TextEncoder().encode(texto);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
