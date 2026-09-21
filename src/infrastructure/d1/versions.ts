import type { Versoes } from "../../application/ports";
import type { GuiaNormalizada } from "../../domain/guide";
import type { CandidatoDuplicidade } from "../../domain/validation";

interface LinhaCandidato {
  readonly protocol_id: string;
  readonly protocol_number: string;
  readonly normalized_payload_json: string;
}

/**
 * Implementação D1 da porta `Versoes`.
 *
 * `guide_versions` não guarda colunas individuais pesquisáveis (migrations/0001_init.sql só
 * tem os blobs `raw_payload_json`/`normalized_payload_json`) — a busca usa `json_extract` sobre
 * o payload normalizado.
 *
 * Chave composta usada para localizar candidatos a duplicidade (RF-13, "chave composta
 * explicável"): mesmo paciente, convênio, procedimento e data de atendimento — o mesmo núcleo
 * que `src/rules/duplicates.ts` exige (carteirinha é só reforço opcional, nunca condição). Esta
 * consulta só ESCOLHE quem entra na lista de candidatos — decidir se algum deles é de fato
 * `POSSIVEL_DUPLICIDADE` é regra do motor (`src/rules`), que recebe a lista e compara os
 * campos completos.
 */
export class RepositorioVersoesD1 implements Versoes {
  constructor(private readonly db: D1Database) {}

  async listarCandidatosDuplicidade(guia: GuiaNormalizada): Promise<readonly CandidatoDuplicidade[]> {
    const linhas = await this.db
      .prepare(
        `SELECT p.id AS protocol_id, p.protocol_number AS protocol_number,
                gv.normalized_payload_json AS normalized_payload_json
         FROM protocols p
         JOIN guide_versions gv ON gv.id = p.current_version_id
         WHERE p.workflow_status != 'MESCLADA'
           AND json_extract(gv.normalized_payload_json, '$.convenio') = ?
           AND json_extract(gv.normalized_payload_json, '$.paciente') = ?
           AND json_extract(gv.normalized_payload_json, '$.procedimento_codigo') = ?
           AND json_extract(gv.normalized_payload_json, '$.data_atendimento') = ?`,
      )
      .bind(guia.convenio, guia.paciente, guia.procedimento_codigo, guia.data_atendimento)
      .all<LinhaCandidato>();

    return linhas.results.map((linha) => ({
      protocoloId: linha.protocol_id,
      numeroProtocolo: linha.protocol_number,
      guia: JSON.parse(linha.normalized_payload_json) as GuiaNormalizada,
    }));
  }
}
