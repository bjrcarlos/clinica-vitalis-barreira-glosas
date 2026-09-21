import type { GuiaNormalizada } from "../domain/guide";
import type { ConjuntoRegras, RegraConvenio, RegraProcedimento } from "../domain/rule-set";
import type { Problema } from "../domain/validation";
import { chaveNormalizada } from "./rule-set";

/**
 * Resultado de localizar o convênio e o procedimento da guia no conjunto de regras vigente.
 * `convenio`/`procedimento` vêm `null` quando não encontrados — as etapas seguintes do motor
 * (campos obrigatórios, cobertura, autorização, sessões, descrição/valor) só rodam quando o
 * respectivo dado é conhecido; nunca inventam a exigência ou a cobertura.
 */
export interface RegrasLocalizadas {
  readonly problemas: readonly Problema[];
  readonly convenio: RegraConvenio | null;
  readonly procedimento: RegraProcedimento | null;
}

/**
 * Confere se o convênio e o procedimento da guia existem no conjunto de regras (RF-05, passo
 * 2 da ordem §21.3). Convênio ou procedimento inexistente vira revisão humana — nunca uma
 * decisão de cobertura.
 *
 * Convênio é resolvido por `chaveNormalizada` (sem acento, sem caixa — mesma tolerância que
 * `rule-set.ts` já usa em `convenioPorNome`), nunca por igualdade estrita de string: RF-02
 * permite cadastro manual, onde a grafia pode variar.
 */
export function localizarConvenioEProcedimento(
  guia: GuiaNormalizada,
  ruleSet: ConjuntoRegras,
): RegrasLocalizadas {
  const problemas: Problema[] = [];

  const chaveConvenioGuia = chaveNormalizada(guia.convenio);
  const convenio = ruleSet.convenios.find((c) => chaveNormalizada(c.nome) === chaveConvenioGuia) ?? null;
  if (!convenio) {
    problemas.push({
      codigo: "CONVENIO_DESCONHECIDO",
      titulo: "Convênio não consta no conjunto de regras vigente",
      acao_recomendada: "REVISAR",
      area_responsavel: "SECRETARIA",
      subproblemas: [{ rotulo: "convênio informado na guia", valor: guia.convenio }],
      referencia_regra: "convenios[].nome",
    });
  }

  const procedimento = ruleSet.procedimentos.find((p) => p.codigo === guia.procedimento_codigo) ?? null;
  if (!procedimento) {
    problemas.push({
      codigo: "PROCEDIMENTO_DESCONHECIDO",
      titulo: "Procedimento não consta no conjunto de regras vigente",
      acao_recomendada: "REVISAR",
      area_responsavel: "SECRETARIA",
      subproblemas: [{ rotulo: "código informado na guia", valor: guia.procedimento_codigo }],
      referencia_regra: "procedimentos[].codigo",
    });
  }

  return { problemas, convenio, procedimento };
}

/**
 * Confere se o convênio cobre o procedimento (RF-05, passo 4 da ordem §21.3). Só deve ser
 * chamada quando ambos já foram localizados por `localizarConvenioEProcedimento`.
 */
export function verificarCobertura(
  convenio: RegraConvenio,
  procedimento: RegraProcedimento,
): readonly Problema[] {
  if (convenio.procedimentos_cobertos.includes(procedimento.codigo)) return [];

  return [
    {
      codigo: "PROCEDIMENTO_NAO_COBERTO",
      titulo: `${convenio.nome} não cobre este procedimento`,
      acao_recomendada: "NAO_FATURAR",
      area_responsavel: "FINANCEIRO",
      subproblemas: [
        { rotulo: "procedimento", valor: `${procedimento.codigo} — ${procedimento.descricao}` },
        { rotulo: "convênio", valor: convenio.nome },
      ],
      referencia_regra: `convenios.${convenio.nome}.procedimentos_cobertos`,
    },
  ];
}
