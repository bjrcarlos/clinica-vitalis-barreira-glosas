import type { GuiaNormalizada } from "../domain/guide";
import type { RegraConvenio } from "../domain/rule-set";
import type { Problema } from "../domain/validation";

const MS_POR_DIA = 86_400_000;

interface DataCalendario {
  readonly timestampUtc: number;
}

function lerDataCalendario(valor: string): DataCalendario | null {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (partes === null) return null;

  const ano = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);
  const timestampUtc = Date.UTC(ano, mes - 1, dia);
  const data = new Date(timestampUtc);

  if (
    data.getUTCFullYear() !== ano ||
    data.getUTCMonth() !== mes - 1 ||
    data.getUTCDate() !== dia
  ) {
    return null;
  }

  return { timestampUtc };
}

function formatarDataCalendario(timestampUtc: number): string {
  return new Date(timestampUtc).toISOString().slice(0, 10);
}

/**
 * A prova simula a conferência na data de lançamento. O prazo é contado desde o atendimento
 * e o próprio dia limite ainda é válido; somente o lançamento posterior gera pendência.
 */
export function verificarPrazoEnvio(
  guia: GuiaNormalizada,
  convenio: RegraConvenio,
): readonly Problema[] {
  const atendimento = lerDataCalendario(guia.data_atendimento);
  const lancamento = lerDataCalendario(guia.data_lancamento);
  if (atendimento === null || lancamento === null) return [];

  const dataLimiteUtc = atendimento.timestampUtc + convenio.prazo_envio_dias * MS_POR_DIA;
  if (lancamento.timestampUtc <= dataLimiteUtc) return [];

  return [
    {
      codigo: "PRAZO_ENVIO_EXCEDIDO",
      titulo: `Prazo de envio excedido para ${convenio.nome}`,
      acao_recomendada: "REVISAR",
      area_responsavel: "FINANCEIRO",
      subproblemas: [
        { rotulo: "data do atendimento", valor: guia.data_atendimento },
        { rotulo: "data de lançamento", valor: guia.data_lancamento },
        { rotulo: "data limite para envio", valor: formatarDataCalendario(dataLimiteUtc) },
        { rotulo: "prazo do convênio (dias)", valor: String(convenio.prazo_envio_dias) },
      ],
      referencia_regra: `convenios.${convenio.nome}.prazo_envio_dias`,
    },
  ];
}
