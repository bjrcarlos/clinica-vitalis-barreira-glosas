import type { GuiaNormalizada } from "../domain/guide";
import type { ConjuntoRegras } from "../domain/rule-set";
import type { Area, Origem } from "../domain/statuses";
import type { CandidatoDuplicidade, ResultadoValidacao } from "../domain/validation";
import type { Eventos, NovaTarefa, Relogio, Tarefas, Validacoes } from "./ports";

/**
 * Assinatura do motor puro de validação (PRD §21.1). Este caso de uso não importa `src/rules`
 * diretamente — quem monta `ValidarGuiaDependencias` injeta a função concreta, então este
 * arquivo compila e é testável sem depender de quando/como o motor é escrito.
 */
export type MotorValidacao = (
  guia: GuiaNormalizada,
  regras: ConjuntoRegras,
  candidatosDuplicidade: readonly CandidatoDuplicidade[],
) => ResultadoValidacao;

export interface ValidarGuiaEntrada {
  readonly protocoloId: string;
  readonly guiaVersaoId: string;
  readonly guia: GuiaNormalizada;
  readonly regras: ConjuntoRegras;
  readonly candidatosDuplicidade: readonly CandidatoDuplicidade[];
  readonly origem: Origem;
}

export interface ValidarGuiaDependencias {
  readonly motor: MotorValidacao;
  readonly validacoes: Validacoes;
  readonly tarefas: Tarefas;
  readonly eventos: Eventos;
  readonly relogio: Relogio;
}

export interface ValidarGuiaSaida {
  readonly resultado: ResultadoValidacao;
  readonly validationRunId: string;
  readonly issueIds: readonly string[];
  readonly taskIds: readonly string[];
  readonly eventoId: string;
}

// O evento VALIDACAO é gerado pelo motor determinístico, não por uma pessoa — "papel vem da
// credencial, nunca de parâmetro de entrada" (CLAUDE.md) não se aplica aqui porque não há
// credencial humana nesta ação.
const ATOR_MOTOR = "motor-validacao";
const PAPEL_MOTOR: Area = "SISTEMA";

/**
 * Caso de uso "validar guia": roda o motor puro sobre uma guia já normalizada, grava a
 * execução (`validation_run` + `validation_issues`, e — dentro da implementação D1 de
 * `Validacoes` — os campos denormalizados de `protocols`), as tarefas resultantes e o evento de
 * fluxo. Nenhuma regra de negócio mora aqui: quem decide é `deps.motor`; isto só orquestra a
 * gravação do que ele decidiu.
 */
export async function validarGuia(
  entrada: ValidarGuiaEntrada,
  deps: ValidarGuiaDependencias,
): Promise<ValidarGuiaSaida> {
  const iniciadoEmUtc = deps.relogio.agoraUtc();
  const resultado = deps.motor(entrada.guia, entrada.regras, entrada.candidatosDuplicidade);
  const concluidoEmUtc = deps.relogio.agoraUtc();

  const execucaoSalva = await deps.validacoes.salvarExecucao({
    protocoloId: entrada.protocoloId,
    guiaVersaoId: entrada.guiaVersaoId,
    resultado,
    iniciadoEmUtc,
    concluidoEmUtc,
  });

  // `Tarefa` (domínio) não carrega o código do `Problema` que a originou — grava-se sem
  // `issueId`, o que o schema já prevê ("tasks.issue_id ... a partir de um problema (ou
  // diretamente)"). Inventar uma correspondência posicional seria regra de negócio nova.
  const novasTarefas: readonly NovaTarefa[] = resultado.tarefas.map((tarefa) => ({
    protocoloId: entrada.protocoloId,
    issueId: null,
    tarefa,
  }));
  const taskIds = await deps.tarefas.criarEmLote(novasTarefas);

  const eventoId = await deps.eventos.registrar({
    protocoloId: entrada.protocoloId,
    guiaVersaoId: entrada.guiaVersaoId,
    evento: {
      tipo: "VALIDACAO",
      ator: ATOR_MOTOR,
      papel: PAPEL_MOTOR,
      origem: entrada.origem,
      ocorrido_em_utc: iniciadoEmUtc,
      registrado_em_utc: concluidoEmUtc,
      motivo: null,
      metadata: {
        validation_run_id: execucaoSalva.validationRunId,
        status: resultado.status,
        risco_cents: resultado.risco_cents,
      },
    },
  });

  return {
    resultado,
    validationRunId: execucaoSalva.validationRunId,
    issueIds: execucaoSalva.issueIds,
    taskIds,
    eventoId,
  };
}
