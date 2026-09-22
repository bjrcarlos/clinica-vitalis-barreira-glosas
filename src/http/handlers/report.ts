import type { ManipuladorRota } from "../routes";
import { esquemaRelatorioResposta, type RelatorioResposta } from "../contracts";
import type { Area, ValidacaoStatus } from "../../domain/statuses";
import { apresentarCodigoProblema, type CodigoProblema } from "../../domain/validation";

/**
 * GET /api/report — PRD-SDD §27. Lê exclusivamente o que o motor (Fase 1) já gravou em D1;
 * nenhuma regra de negócio é decidida aqui, só agregação SQL + formatação.
 *
 * Protocolo `MESCLADA` nunca entra em nenhum bloco (RF-13/§27.4: "valores mesclados não podem
 * ser duplicados") — nenhum protocolo está mesclado nesta fase (merge é Fase 3), mas a
 * exclusão já fica correta para quando existir.
 */

interface LinhaProtocoloNumero {
  readonly protocol_number: string;
}

interface LinhaRisco {
  readonly protocol_number: string;
  readonly valor: number;
}

interface LinhaMotivo {
  readonly codigo: string;
  readonly ocorrencias: number;
  readonly numeros: string | null;
}

interface LinhaDistribuicaoValidacao {
  readonly status_validacao: string;
  readonly quantidade: number;
  readonly risco_cents: number;
}

interface LinhaAreaRisco {
  readonly area: string;
  readonly quantidade: number;
  readonly risco_cents: number;
  readonly numeros: string | null;
}

interface LinhaAreaTarefas {
  readonly area: string;
  readonly quantidade_tarefas_abertas: number;
  readonly mais_antiga: string | null;
}

interface LinhaMotivoPorEstado {
  readonly status_validacao: string;
  readonly codigo: string;
  readonly area_responsavel: string | null;
  readonly guias: number;
  readonly numeros: string | null;
}

interface LinhaPendenciaAntiga {
  readonly numero_protocolo: string;
  readonly id_guia_origem: string | null;
  readonly unidade: string | null;
  readonly status_validacao: string;
  readonly area_responsavel: string | null;
  readonly risco_cents: number;
  readonly aberta_desde_utc: string;
  readonly resumo: string | null;
}

interface LinhaRegraAtiva {
  readonly version: string;
  readonly source_sha256: string;
}

function separarNumeros(csv: string | null): string[] {
  if (csv === null || csv.trim().length === 0) return [];
  return csv.split(",").filter((valor) => valor.length > 0);
}

function metrica(
  valor: number,
  linhas: readonly { readonly protocol_number: string }[],
): { valor: number; protocol_numbers: string[] } {
  return { valor, protocol_numbers: linhas.map((linha) => linha.protocol_number).sort() };
}

function somar(linhas: readonly LinhaRisco[]): number {
  return linhas.reduce((total, linha) => total + linha.valor, 0);
}

/** Ordem fixa de exibição da distribuição por estado de validação (rosca + legenda do Dashboard). */
const ORDEM_ESTADOS_VALIDACAO: readonly ValidacaoStatus[] = ["OK", "CORRIGIR", "REVISAO_HUMANA", "NAO_FATURAR_CONVENIO"];

export async function montarRelatorio(db: D1Database): Promise<RelatorioResposta> {
  const [
    regraAtivaResultado,
    verificadasResultado,
    distribuicaoValidacaoResultado,
    exigemAtencaoResultado,
    riscoInicialResultado,
    riscoTratadoResultado,
    riscoPendenteResultado,
    motivosResultado,
    motivosPorEstadoResultado,
    areaRiscoResultado,
    areaTarefasResultado,
    pendenciasAntigasResultado,
  ] = await Promise.all([
    db.prepare(`SELECT version, source_sha256 FROM rule_sets WHERE is_active = 1 LIMIT 1`).first<LinhaRegraAtiva>(),

    db
      .prepare(
        `SELECT p.protocol_number
         FROM protocols p
         WHERE p.workflow_status != 'MESCLADA'
           AND EXISTS (SELECT 1 FROM validation_runs vr WHERE vr.protocol_id = p.id)
         ORDER BY p.protocol_number`,
      )
      .all<LinhaProtocoloNumero>(),

    // Distribuição por estado de validação (rosca "Estado das guias" do Dashboard): MESMO
    // universo de "guias verificadas" acima (não mesclado + validação concluída) — nunca um
    // critério novo. `risco_cents` sai de graça na mesma agregação (SUM sobre a mesma linha do
    // GROUP BY, sem JOIN extra), por isso vai junto.
    db
      .prepare(
        `SELECT p.validation_status AS status_validacao, COUNT(*) AS quantidade,
                SUM(p.current_risk_cents) AS risco_cents
         FROM protocols p
         WHERE p.workflow_status != 'MESCLADA'
           AND EXISTS (SELECT 1 FROM validation_runs vr WHERE vr.protocol_id = p.id)
         GROUP BY p.validation_status`,
      )
      .all<LinhaDistribuicaoValidacao>(),

    db
      .prepare(
        `SELECT p.protocol_number
         FROM protocols p
         WHERE p.workflow_status != 'MESCLADA'
           AND (
             p.validation_status != 'OK'
             OR EXISTS (SELECT 1 FROM tasks t WHERE t.protocol_id = p.id AND t.blocking = 1 AND t.status = 'ABERTA')
           )
         ORDER BY p.protocol_number`,
      )
      .all<LinhaProtocoloNumero>(),

    db
      .prepare(
        `SELECT p.protocol_number, p.initial_risk_cents AS valor
         FROM protocols p
         WHERE p.workflow_status != 'MESCLADA' AND p.initial_risk_cents > 0
         ORDER BY p.protocol_number`,
      )
      .all<LinhaRisco>(),

    // Tratado (§27.4): risco inicial de protocolo que chegou a destino final válido OU foi
    // corrigido e liberado — nunca de um protocolo mesclado (fora da lista abaixo por definição).
    db
      .prepare(
        `SELECT p.protocol_number, p.initial_risk_cents AS valor
         FROM protocols p
         WHERE p.initial_risk_cents > 0
           AND p.workflow_status IN ('LIBERADA_PARA_ENVIO', 'ENVIADA', 'ENCERRADA_PARTICULAR', 'ENCERRADA_CANCELADA')
         ORDER BY p.protocol_number`,
      )
      .all<LinhaRisco>(),

    // Pendente (§27.4): risco ATUAL dos protocolos ainda em tratamento.
    db
      .prepare(
        `SELECT p.protocol_number, p.current_risk_cents AS valor
         FROM protocols p
         WHERE p.current_risk_cents > 0 AND p.workflow_status = 'EM_TRATAMENTO'
         ORDER BY p.protocol_number`,
      )
      .all<LinhaRisco>(),

    db
      .prepare(
        `SELECT vi.code AS codigo, COUNT(*) AS ocorrencias,
                GROUP_CONCAT(DISTINCT p.protocol_number) AS numeros
         FROM validation_issues vi
         JOIN validation_runs vr ON vr.id = vi.validation_run_id
         JOIN protocols p ON p.id = vr.protocol_id
         WHERE vi.status = 'ABERTO' AND p.workflow_status != 'MESCLADA'
         GROUP BY vi.code
         ORDER BY ocorrencias DESC, codigo ASC`,
      )
      .all<LinhaMotivo>(),

    // Mesmos motivos, agora quebrados por estado de validação e contando GUIAS (protocolo
    // distinto), não ocorrências: é o detalhamento que a pergunta "quantas precisam de correção"
    // pede logo em seguida. Uma guia com dois motivos aparece nos dois, e por isso a soma das
    // linhas pode passar do total do estado — a contagem oficial continua sendo a distribuição.
    db
      .prepare(
        `SELECT p.validation_status AS status_validacao, vi.code AS codigo, vi.owner_area AS area_responsavel,
                COUNT(DISTINCT p.id) AS guias, GROUP_CONCAT(DISTINCT p.protocol_number) AS numeros
         FROM validation_issues vi
         JOIN validation_runs vr ON vr.id = vi.validation_run_id
         JOIN protocols p ON p.id = vr.protocol_id
         WHERE vi.status = 'ABERTO' AND p.workflow_status != 'MESCLADA'
         GROUP BY p.validation_status, vi.code, vi.owner_area
         ORDER BY p.validation_status ASC, guias DESC, vi.code ASC`,
      )
      .all<LinhaMotivoPorEstado>(),

    // Risco e contagem de protocolo por área: usa `protocols.assigned_area` (um único dono por
    // protocolo, já denormalizado por `RepositorioValidacoesD1`) para que a soma das áreas nunca
    // ultrapasse o risco pendente total — um protocolo nunca soma em duas áreas ao mesmo tempo.
    db
      .prepare(
        `SELECT p.assigned_area AS area, COUNT(*) AS quantidade, SUM(p.current_risk_cents) AS risco_cents,
                GROUP_CONCAT(p.protocol_number) AS numeros
         FROM protocols p
         WHERE p.assigned_area IS NOT NULL AND p.workflow_status != 'MESCLADA'
         GROUP BY p.assigned_area`,
      )
      .all<LinhaAreaRisco>(),

    // Quantidade de tarefas abertas por área: conta a TAREFA (não o protocolo) — um protocolo
    // pode ter tarefas abertas para as duas áreas ao mesmo tempo (ex.: procedimento não coberto
    // para o Financeiro e campo obrigatório para a Secretaria na mesma guia).
    db
      .prepare(
        `SELECT t.assigned_area AS area, COUNT(*) AS quantidade_tarefas_abertas, MIN(t.created_at_utc) AS mais_antiga
         FROM tasks t
         JOIN protocols p ON p.id = t.protocol_id
         WHERE t.status = 'ABERTA' AND p.workflow_status != 'MESCLADA'
         GROUP BY t.assigned_area`,
      )
      .all<LinhaAreaTarefas>(),

    db
      .prepare(
        `SELECT p.protocol_number AS numero_protocolo, p.source_guide_id AS id_guia_origem,
                json_extract(gv.normalized_payload_json, '$.unidade') AS unidade,
                p.validation_status AS status_validacao,
                p.assigned_area AS area_responsavel,
                p.current_risk_cents AS risco_cents,
                (SELECT MIN(t2.created_at_utc) FROM tasks t2
                   WHERE t2.protocol_id = p.id AND t2.status = 'ABERTA' AND t2.blocking = 1) AS aberta_desde_utc,
                -- Título do problema ABERTO de maior gravidade do protocolo (nunca o resumo
                -- inteiro do motor) — mesma ordem de precedência de RN-06/PRECEDENCIA_VALIDACAO_STATUS
                -- (não faturar > revisão humana > corrigir). O resumo completo continua disponível
                -- em GET /api/protocols/:numero (resultado_validacao_atual.resumo).
                (SELECT vi2.title FROM validation_issues vi2
                   JOIN validation_runs vr2 ON vr2.id = vi2.validation_run_id
                   WHERE vr2.protocol_id = p.id AND vi2.status = 'ABERTO'
                   ORDER BY CASE vi2.recommended_action
                              WHEN 'NAO_FATURAR' THEN 0
                              WHEN 'REVISAR' THEN 1
                              WHEN 'CORRIGIR' THEN 2
                              ELSE 3
                            END, vi2.created_at_utc ASC
                   LIMIT 1) AS resumo
         FROM protocols p
         JOIN guide_versions gv ON gv.id = p.current_version_id
         WHERE p.workflow_status != 'MESCLADA'
           AND EXISTS (SELECT 1 FROM tasks t WHERE t.protocol_id = p.id AND t.status = 'ABERTA' AND t.blocking = 1)
         ORDER BY aberta_desde_utc ASC
         LIMIT 10`,
      )
      .all<LinhaPendenciaAntiga>(),
  ]);

  const regraAtiva = regraAtivaResultado ?? { version: "", source_sha256: "" };

  const distribuicaoValidacaoPorStatus = new Map<string, LinhaDistribuicaoValidacao>();
  for (const linha of distribuicaoValidacaoResultado.results) distribuicaoValidacaoPorStatus.set(linha.status_validacao, linha);
  const distribuicaoPorEstadoValidacao = ORDEM_ESTADOS_VALIDACAO.map((status) => {
    const linha = distribuicaoValidacaoPorStatus.get(status) ?? null;
    return {
      status_validacao: status,
      quantidade: linha?.quantidade ?? 0,
      risco_cents: linha?.risco_cents ?? 0,
    };
  });

  const areaRiscoPorNome = new Map<string, LinhaAreaRisco>();
  for (const linha of areaRiscoResultado.results) areaRiscoPorNome.set(linha.area, linha);
  const areaTarefasPorNome = new Map<string, LinhaAreaTarefas>();
  for (const linha of areaTarefasResultado.results) areaTarefasPorNome.set(linha.area, linha);
  const nomesDeArea = new Set<string>([...areaRiscoPorNome.keys(), ...areaTarefasPorNome.keys()]);

  const distribuicaoPorArea = Array.from(nomesDeArea)
    .sort()
    .map((area) => {
      const risco = areaRiscoPorNome.get(area) ?? null;
      const tarefas = areaTarefasPorNome.get(area) ?? null;
      return {
        area: area as Area,
        quantidade_tarefas_abertas: tarefas?.quantidade_tarefas_abertas ?? 0,
        risco_cents: risco?.risco_cents ?? 0,
        pendencia_mais_antiga_utc: tarefas?.mais_antiga ?? null,
        protocol_numbers: separarNumeros(risco?.numeros ?? null).sort(),
      };
    });

  const resposta: RelatorioResposta = {
    gerado_em_utc: new Date().toISOString(),
    regras_aplicadas: { versao: regraAtiva.version, sha256: regraAtiva.source_sha256 },
    guias_verificadas: metrica(verificadasResultado.results.length, verificadasResultado.results),
    exigem_atencao: metrica(exigemAtencaoResultado.results.length, exigemAtencaoResultado.results),
    risco_inicial_cents: metrica(somar(riscoInicialResultado.results), riscoInicialResultado.results),
    risco_tratado_cents: metrica(somar(riscoTratadoResultado.results), riscoTratadoResultado.results),
    risco_pendente_cents: metrica(somar(riscoPendenteResultado.results), riscoPendenteResultado.results),
    principais_motivos: motivosResultado.results.map((linha) => ({
      codigo: linha.codigo as CodigoProblema,
      // Rótulo GENÉRICO por código (nunca o `title` de uma ocorrência específica, que pode citar
      // dados de uma guia — ex. "Faltam campos obrigatórios para Plano Bem" — e induziria a
      // achar que todas as ocorrências agregadas aqui são daquele mesmo convênio/guia).
      titulo: apresentarCodigoProblema(linha.codigo as CodigoProblema),
      ocorrencias: linha.ocorrencias,
      protocol_numbers: separarNumeros(linha.numeros).sort(),
    })),
    distribuicao_por_area: distribuicaoPorArea,
    distribuicao_por_estado_validacao: distribuicaoPorEstadoValidacao,
    motivos_por_estado: motivosPorEstadoResultado.results.map((linha) => ({
      status_validacao: linha.status_validacao as RelatorioResposta["distribuicao_por_estado_validacao"][number]["status_validacao"],
      codigo: linha.codigo,
      titulo: apresentarCodigoProblema(linha.codigo as CodigoProblema),
      area_responsavel: linha.area_responsavel as Area | null,
      guias: linha.guias,
      protocol_numbers: separarNumeros(linha.numeros).sort(),
    })),
    pendencias_mais_antigas: pendenciasAntigasResultado.results.map((linha) => ({
      numero_protocolo: linha.numero_protocolo,
      id_guia_origem: linha.id_guia_origem,
      unidade: linha.unidade ?? "",
      status_validacao: linha.status_validacao as RelatorioResposta["pendencias_mais_antigas"][number]["status_validacao"],
      resumo: linha.resumo ?? "",
      area_responsavel: linha.area_responsavel as Area | null,
      risco_cents: linha.risco_cents,
      aberta_desde_utc: linha.aberta_desde_utc,
    })),
  };

  return esquemaRelatorioResposta.parse(resposta);
}

export const manipularRelatorio: ManipuladorRota = async (ctx) => {
  const resposta = await montarRelatorio(ctx.env.DB);
  return Response.json(resposta);
};
