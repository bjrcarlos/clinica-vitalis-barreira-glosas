import type { GeradorId, NovoProtocolo, ProtocoloCriado, ProtocoloResumo, Protocolos, Relogio } from "../../application/ports";
import { isFluxoStatus, isValidacaoStatus } from "../../domain/statuses";
import { anoUtcDoisDigitos, PROXIMO_SEQUENCIAL_PROTOCOLO_SQL } from "../id";

interface LinhaProtocolo {
  readonly id: string;
  readonly protocol_number: string;
  readonly source_guide_id: string | null;
  readonly current_version_id: string;
  readonly validation_status: string;
  readonly workflow_status: string;
  readonly current_risk_cents: number;
  readonly initial_risk_cents: number;
}

/**
 * Implementação D1 da porta `Protocolos`: abre protocolo + versão inicial em uma única
 * transação (`db.batch`) e busca por identificadores conhecidos. O número de protocolo
 * ("VT-YY-NNNN") é derivado dentro do próprio `INSERT ... SELECT`, nunca por uma leitura
 * seguida de escrita em duas chamadas — isso é o que evita colisão entre registros
 * concorrentes (ver `d1/id.ts`).
 */
export class RepositorioProtocolosD1 implements Protocolos {
  constructor(
    private readonly db: D1Database,
    private readonly ids: GeradorId,
    private readonly relogio: Relogio,
  ) {}

  async criarComVersaoInicial(dados: NovoProtocolo): Promise<ProtocoloCriado> {
    const protocoloId = this.ids.novo();
    const versaoId = this.ids.novo();
    const registradoEmUtc = this.relogio.agoraUtc();
    const anoDoisDigitos = anoUtcDoisDigitos(dados.ocorridoEmUtc);

    const inserirProtocolo = this.db
      .prepare(
        `INSERT INTO protocols (
           id, protocol_number, source_guide_id, current_version_id,
           validation_status, workflow_status, assigned_area,
           current_risk_cents, initial_risk_cents, merged_into_protocol_id,
           created_at_utc, updated_at_utc
         )
         SELECT
           ?,
           'VT-' || ? || '-' || printf('%04d', ${PROXIMO_SEQUENCIAL_PROTOCOLO_SQL}),
           ?, ?, 'REVISAO_HUMANA', 'EM_TRATAMENTO', NULL, 0, 0, NULL, ?, ?
         FROM protocols
         WHERE protocol_number LIKE ('VT-' || ? || '-%')
         RETURNING protocol_number`,
      )
      .bind(protocoloId, anoDoisDigitos, dados.idGuiaOrigem, versaoId, registradoEmUtc, registradoEmUtc, anoDoisDigitos);

    // FK `protocols.current_version_id -> guide_versions.id` é DEFERRABLE INITIALLY DEFERRED
    // (migrations/0001_init.sql): por isso dá para inserir o protocolo antes da versão existir
    // — o vínculo só é conferido no COMMIT do batch, que cobre as duas instruções.
    //
    // `diff_json` (§19.3) é "alterações contra a versão anterior" ({campo, antes, depois} —
    // RF-10), nunca os avisos de normalização (RN-08, forma {campo, valor_original,
    // valor_normalizado, motivo}). A v1 não tem versão anterior para comparar, então grava
    // `'[]'`. `dados.avisosNormalizacao` não precisa de coluna própria nesta fase: é
    // recomputável de forma pura a partir de `raw_payload_json` (já persistido) chamando
    // `normalizarGuia()` de novo.
    const inserirVersao = this.db
      .prepare(
        `INSERT INTO guide_versions (
           id, protocol_id, version_number, raw_payload_json, normalized_payload_json,
           diff_json, change_reason, created_by_role, created_by_principal,
           occurred_at_utc, recorded_at_utc
         ) VALUES (?, ?, 1, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      )
      .bind(
        versaoId,
        protocoloId,
        JSON.stringify(dados.guiaBruta),
        JSON.stringify(dados.guiaNormalizada),
        "[]",
        dados.criadoPorPapel,
        dados.criadoPorPrincipal,
        dados.ocorridoEmUtc,
        registradoEmUtc,
      );

    const [resultadoProtocolo] = await this.db.batch<{ protocol_number: string }>([inserirProtocolo, inserirVersao]);

    const numeroProtocolo = resultadoProtocolo?.results[0]?.protocol_number;
    if (numeroProtocolo === undefined) {
      throw new Error("Falha ao gerar protocol_number: nenhuma linha retornada pelo INSERT.");
    }

    return { protocoloId, numeroProtocolo, versaoId };
  }

  async buscarPorNumero(numeroProtocolo: string): Promise<ProtocoloResumo | null> {
    const linha = await this.db
      .prepare(`SELECT * FROM protocols WHERE protocol_number = ?`)
      .bind(numeroProtocolo)
      .first<LinhaProtocolo>();
    return linha === null ? null : paraResumo(linha);
  }

  async buscarPorIdGuiaOrigem(idGuiaOrigem: string): Promise<ProtocoloResumo | null> {
    const linha = await this.db
      .prepare(`SELECT * FROM protocols WHERE source_guide_id = ?`)
      .bind(idGuiaOrigem)
      .first<LinhaProtocolo>();
    return linha === null ? null : paraResumo(linha);
  }
}

function paraResumo(linha: LinhaProtocolo): ProtocoloResumo {
  if (!isValidacaoStatus(linha.validation_status)) {
    throw new Error(`validation_status inválido em disco: ${linha.validation_status}`);
  }
  if (!isFluxoStatus(linha.workflow_status)) {
    throw new Error(`workflow_status inválido em disco: ${linha.workflow_status}`);
  }
  return {
    protocoloId: linha.id,
    numeroProtocolo: linha.protocol_number,
    idGuiaOrigem: linha.source_guide_id,
    versaoAtualId: linha.current_version_id,
    statusValidacao: linha.validation_status,
    statusFluxo: linha.workflow_status,
    riscoAtualCents: linha.current_risk_cents,
    riscoInicialCents: linha.initial_risk_cents,
  };
}
