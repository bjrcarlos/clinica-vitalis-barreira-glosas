import type { ConjuntosDeRegras, GeradorId, Relogio } from "../../application/ports";
import type { ConjuntoRegras } from "../../domain/rule-set";

/**
 * Implementação D1 da porta `ConjuntosDeRegras`: persiste o conjunto se ainda não existir
 * (chave única é `rule_sets.version`) e marca esta versão como a única ativa.
 *
 * `source_json` grava `JSON.stringify(conjunto)` — a representação tipada que chega até aqui,
 * não os bytes originais de `regras_convenio.json.txt` (esta porta não recebe o texto bruto).
 * `source_sha256` é o hash informado por quem chamou (presumidamente calculado sobre o arquivo
 * original pelo seed); não é recalculado aqui.
 */
export class RepositorioConjuntosDeRegrasD1 implements ConjuntosDeRegras {
  constructor(
    private readonly db: D1Database,
    private readonly ids: GeradorId,
    private readonly relogio: Relogio,
  ) {}

  async ativar(conjunto: ConjuntoRegras): Promise<void> {
    const id = this.ids.novo();
    const agoraUtc = this.relogio.agoraUtc();

    await this.db.batch([
      this.db
        .prepare(
          `INSERT OR IGNORE INTO rule_sets (
             id, version, source_json, source_sha256, imported_at_utc, activated_at_utc, is_active
           ) VALUES (?, ?, ?, ?, ?, NULL, 0)`,
        )
        .bind(id, conjunto.versao, JSON.stringify(conjunto), conjunto.sha256, agoraUtc),
      this.db
        .prepare(`UPDATE rule_sets SET is_active = 0 WHERE is_active = 1 AND version != ?`)
        .bind(conjunto.versao),
      this.db
        .prepare(`UPDATE rule_sets SET is_active = 1, activated_at_utc = ? WHERE version = ?`)
        .bind(agoraUtc, conjunto.versao),
    ]);
  }
}
