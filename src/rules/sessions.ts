import type { GuiaNormalizada } from "../domain/guide";
import type { RegraConvenio } from "../domain/rule-set";
import type { Problema } from "../domain/validation";

/**
 * Confere o número da sessão dentro da autorização contra o limite oficial do convênio
 * (RF-05, RF-07). O limite que vale é sempre o do convênio; quando a guia também informa um
 * limite próprio, ambos aparecem como evidência para quem for corrigir — mesmo quando
 * coincidem, como no exemplo do PRD (RF-07).
 */
export function verificarLimiteSessoes(guia: GuiaNormalizada, convenio: RegraConvenio): readonly Problema[] {
  if (guia.sessao_numero_na_autorizacao <= convenio.limite_sessoes_por_autorizacao) return [];

  return [
    {
      codigo: "LIMITE_SESSOES_EXCEDIDO",
      titulo: "Sessão excede o limite de sessões da autorização",
      acao_recomendada: "CORRIGIR",
      area_responsavel: "SECRETARIA",
      subproblemas: [
        { rotulo: "sessão registrada", valor: String(guia.sessao_numero_na_autorizacao) },
        { rotulo: "limite informado na guia", valor: String(guia.autorizacao_sessoes_limite) },
        { rotulo: "limite oficial do convênio", valor: String(convenio.limite_sessoes_por_autorizacao) },
      ],
      referencia_regra: `convenios.${convenio.nome}.limite_sessoes_por_autorizacao`,
    },
  ];
}
