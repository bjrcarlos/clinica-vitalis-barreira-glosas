import type { GuiaNormalizada } from "../domain/guide";
import type { RegraProcedimento } from "../domain/rule-set";
import type { Problema } from "../domain/validation";

/** Remove acento e caixa, e colapsa espaços — tolerante a como a descrição foi digitada, nunca a sentido. */
function normalizarDescricao(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Confere a coerência entre o código do procedimento informado na guia e a descrição/valor de
 * referência da regra (RF-05). Só deve ser chamada quando o procedimento já foi localizado por
 * `coverage.ts` — o código em si já é validado lá (`PROCEDIMENTO_DESCONHECIDO`).
 */
export function verificarProcedimento(
  guia: GuiaNormalizada,
  procedimento: RegraProcedimento,
): readonly Problema[] {
  const problemas: Problema[] = [];

  if (normalizarDescricao(guia.procedimento_descricao) !== normalizarDescricao(procedimento.descricao)) {
    problemas.push({
      codigo: "DESCRICAO_DIVERGENTE",
      titulo: "Descrição do procedimento diverge da regra",
      acao_recomendada: "REVISAR",
      area_responsavel: "SECRETARIA",
      subproblemas: [
        { rotulo: "descrição na guia", valor: guia.procedimento_descricao },
        { rotulo: "descrição de referência", valor: procedimento.descricao },
      ],
      referencia_regra: "procedimentos[].descricao",
    });
  }

  if (guia.valor_cents !== procedimento.valor_referencia_cents) {
    problemas.push({
      codigo: "VALOR_DIVERGENTE",
      titulo: "Valor da guia diverge do valor de referência",
      acao_recomendada: "REVISAR",
      area_responsavel: "SECRETARIA",
      subproblemas: [
        { rotulo: "valor da guia (centavos)", valor: String(guia.valor_cents) },
        { rotulo: "valor de referência (centavos)", valor: String(procedimento.valor_referencia_cents) },
      ],
      referencia_regra: "procedimentos[].valor_referencia_cents",
    });
  }

  return problemas;
}
