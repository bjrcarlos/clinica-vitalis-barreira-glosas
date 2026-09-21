import type { GuiaNormalizada } from "../domain/guide";
import type { RegraConvenio } from "../domain/rule-set";
import type { Problema } from "../domain/validation";

const MS_POR_DIA = 86_400_000;

/** Converte uma data de calendário "YYYY-MM-DD" num instante UTC à meia-noite, para diferença exata de dias. */
function paraDiaUtc(dataIso: string): number {
  const [ano, mes, dia] = dataIso.split("-").map(Number);
  return Date.UTC(ano, mes - 1, dia);
}

/** Dias entre duas datas de calendário ("YYYY-MM-DD"); positivo quando `ateIso` é depois de `deIso`. */
function diferencaDias(deIso: string, ateIso: string): number {
  return Math.round((paraDiaUtc(ateIso) - paraDiaUtc(deIso)) / MS_POR_DIA);
}

/**
 * Confere a validade da autorização contra a data do atendimento (RF-05) e a janela de
 * validade contra o máximo que o convênio permite.
 *
 * Comparação de validade é INCLUSIVA (RN-03): vence no próprio dia do atendimento, ainda vale.
 * Guia sem data de validade não gera problema aqui — a ausência do campo já é
 * `CAMPO_OBRIGATORIO_AUSENTE` (`required-fields.ts`); esta função não duplica esse aviso.
 *
 * Suposição declarada: a "janela de validade" comparada contra
 * `validade_maxima_autorizacao_dias` é a distância, em dias, entre a data do atendimento e a
 * data de validade da autorização — únicas duas datas de autorização disponíveis na guia
 * normalizada. As duas violações (vencida / janela acima do máximo) são tratadas como
 * mutuamente exclusivas: uma autorização já vencida não tem janela a avaliar.
 */
export function verificarAutorizacao(guia: GuiaNormalizada, convenio: RegraConvenio): readonly Problema[] {
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

  if (diasJanela > convenio.validade_maxima_autorizacao_dias) {
    return [
      {
        codigo: "AUTORIZACAO_VALIDADE_ACIMA_DO_MAXIMO",
        titulo: `Janela de validade acima do máximo permitido por ${convenio.nome}`,
        acao_recomendada: "REVISAR",
        area_responsavel: "SECRETARIA",
        subproblemas: [
          { rotulo: "dias entre atendimento e validade", valor: String(diasJanela) },
          {
            rotulo: "máximo permitido pelo convênio",
            valor: String(convenio.validade_maxima_autorizacao_dias),
          },
        ],
        referencia_regra: `convenios.${convenio.nome}.validade_maxima_autorizacao_dias`,
      },
    ];
  }

  return [];
}
