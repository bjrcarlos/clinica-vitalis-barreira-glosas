import type { GuiaNormalizada } from "../domain/guide";
import type { Problema } from "../domain/validation";

const MS_POR_DIA = 86_400_000;

/** Converte uma data de calendário `YYYY-MM-DD` num instante UTC à meia-noite. */
function paraDiaUtc(dataIso: string): number {
  const [ano, mes, dia] = dataIso.split("-").map(Number);
  return Date.UTC(ano, mes - 1, dia);
}

/** Dias entre duas datas de calendário; positivo quando `ateIso` é posterior a `deIso`. */
function diferencaDias(deIso: string, ateIso: string): number {
  return Math.round((paraDiaUtc(ateIso) - paraDiaUtc(deIso)) / MS_POR_DIA);
}

/**
 * Confere a data final da autorização contra a data do atendimento (RF-05/RN-03).
 *
 * O CSV da prova não possui data de concessão da autorização. Portanto, não é possível
 * verificar uma janela máxima de validade sem inventar a data inicial. A única decisão
 * reproduzível é: a data final precisa ser igual ou posterior ao atendimento.
 *
 * A comparação é inclusiva: a autorização vence no próprio dia do atendimento, ainda vale.
 * Guia sem data de validade não gera problema aqui — a ausência já é tratada por
 * `CAMPO_OBRIGATORIO_AUSENTE` em `required-fields.ts`.
 */
export function verificarAutorizacao(guia: GuiaNormalizada): readonly Problema[] {
  if (guia.autorizacao_validade.trim().length === 0) return [];

  const diasJanela = diferencaDias(guia.data_atendimento, guia.autorizacao_validade);

  if (diasJanela < 0) {
    return [
      {
        codigo: "AUTORIZACAO_VENCIDA",
        titulo: "Autorização vencida antes do atendimento",
        acao_recomendada: "CORRIGIR",
        area_responsavel: "SECRETARIA",
        subproblemas: [
          { rotulo: "data do atendimento", valor: guia.data_atendimento },
          { rotulo: "validade da autorização", valor: guia.autorizacao_validade },
          { rotulo: "dias vencida", valor: String(Math.abs(diasJanela)) },
        ],
        referencia_regra: "definicoes.autorizacao_valida",
      },
    ];
  }

  return [];
}
