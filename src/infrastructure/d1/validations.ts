import type { ExecucaoSalva, ExecucaoValidacao, GeradorId, Validacoes } from "../../application/ports";
import type { Area } from "../../domain/statuses";
import type { Tarefa } from "../../domain/validation";

/**
 * Implementação D1 da porta `Validacoes`. Além de gravar `validation_runs` +
 * `validation_issues`, esta é a única implementação com acesso ao `ResultadoValidacao`
 * completo — por isso também sincroniza os campos denormalizados de `protocols`
 * (`validation_status`, `assigned_area`, `current_risk_cents`, `initial_risk_cents`) na mesma
 * transação, já que `Protocolos` (application/ports.ts) não expõe um método de atualização
 * separado.
 */
/**
 * Monta (sem executar) as escritas de uma execução de validação — extraído de
 * `RepositorioValidacoesD1.salvarExecucao` para que o merge (`src/http/handlers/merges.ts`,
 * PRD §26.2) possa incluir a revalidação da versão resultante dentro do único `db.batch()`
 * atômico da operação inteira, em vez de num `db.batch()` próprio e separado. A ORDEM dos
 * statements retornados importa e é preservada por quem os concatena: o UPDATE de
 * `protocols` vem primeiro porque seu `COUNT(*) FROM validation_runs` precisa enxergar só as
 * execuções ANTERIORES a esta (RN-05) — se o INSERT em `validation_runs` já tivesse
 * acontecido antes dele, `initial_risk_cents` nunca mais seria fixado num protocolo na sua
 * primeira validação.
 */
export function montarInsercoesExecucaoValidacao(
  db: D1Database,
  ids: GeradorId,
  execucao: ExecucaoValidacao,
): { statements: D1PreparedStatement[]; validationRunId: string; issueIds: string[] } {
  const { resultado } = execucao;
  const runId = ids.novo();
  const issueIds = resultado.problemas.map(() => ids.novo());
  const areaResponsavel = derivarAreaResponsavel(resultado.tarefas);

  // Roda ANTES do INSERT em validation_runs: o COUNT(*) só enxerga execuções anteriores,
  // então `initial_risk_cents` só é fixado na PRIMEIRA validação do protocolo (RN-05) —
  // depois disso o CASE cai no ELSE e preserva o valor já gravado.
  const atualizarProtocolo = db
    .prepare(
      `UPDATE protocols
       SET validation_status = ?,
           assigned_area = ?,
           current_risk_cents = ?,
           initial_risk_cents = CASE
             WHEN (SELECT COUNT(*) FROM validation_runs WHERE protocol_id = ?) = 0
               THEN ?
             ELSE initial_risk_cents
           END,
           updated_at_utc = ?
       WHERE id = ?`,
    )
    .bind(
      resultado.status,
      areaResponsavel,
      resultado.risco_cents,
      execucao.protocoloId,
      resultado.risco_cents,
      execucao.concluidoEmUtc,
      execucao.protocoloId,
    );

  const inserirExecucao = db
    .prepare(
      `INSERT INTO validation_runs (
         id, protocol_id, guide_version_id, rule_set_id, result_status, summary,
         ai_status, ai_model, ai_prompt_version, ai_input_json, ai_output_json,
         started_at_utc, finished_at_utc
       ) VALUES (
         ?, ?, ?, (SELECT id FROM rule_sets WHERE version = ?), ?, ?,
         ?, ?, ?, ?, ?, ?, ?
       )`,
    )
    .bind(
      runId,
      execucao.protocoloId,
      execucao.guiaVersaoId,
      resultado.regras_aplicadas.versao,
      resultado.status,
      resultado.resumo,
      execucao.aiStatus ?? "NAO_EXECUTADA",
      execucao.aiModel ?? null,
      execucao.aiPromptVersion ?? null,
      execucao.aiInputJson ?? null,
      execucao.aiOutputJson ?? null,
      execucao.iniciadoEmUtc,
      execucao.concluidoEmUtc,
    );

  const inserirProblemas = resultado.problemas.map((problema, indice) =>
    db
      .prepare(
        `INSERT INTO validation_issues (
           id, validation_run_id, code, title, recommended_action, owner_area, status,
           subproblems_json, rule_reference_json, created_at_utc, resolved_at_utc
         ) VALUES (?, ?, ?, ?, ?, ?, 'ABERTO', ?, ?, ?, NULL)`,
      )
      .bind(
        issueIds[indice],
        runId,
        problema.codigo,
        problema.titulo,
        problema.acao_recomendada,
        problema.area_responsavel,
        JSON.stringify(problema.subproblemas),
        JSON.stringify({
          referencia_regra: problema.referencia_regra,
          regras_versao: resultado.regras_aplicadas.versao,
          regras_sha256: resultado.regras_aplicadas.sha256,
        }),
        execucao.concluidoEmUtc,
      ),
  );

  return { statements: [atualizarProtocolo, inserirExecucao, ...inserirProblemas], validationRunId: runId, issueIds };
}

export class RepositorioValidacoesD1 implements Validacoes {
  constructor(
    private readonly db: D1Database,
    private readonly ids: GeradorId,
  ) {}

  async salvarExecucao(execucao: ExecucaoValidacao): Promise<ExecucaoSalva> {
    const { statements, validationRunId, issueIds } = montarInsercoesExecucaoValidacao(this.db, this.ids, execucao);
    await this.db.batch(statements);
    return { validationRunId, issueIds };
  }
}

/**
 * `Tarefa` (domínio) não carrega uma área "principal" do resultado inteiro, só por tarefa —
 * escolhe-se mecanicamente a área da primeira tarefa bloqueante e, na falta de uma, a da
 * primeira tarefa. Sem tarefas, não há área a apontar (`null`).
 */
function derivarAreaResponsavel(tarefas: readonly Tarefa[]): Area | null {
  const bloqueante = tarefas.find((tarefa) => tarefa.bloqueante);
  return (bloqueante ?? tarefas[0])?.area ?? null;
}
