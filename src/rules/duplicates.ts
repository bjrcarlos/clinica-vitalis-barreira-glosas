import type { GuiaNormalizada } from "../domain/guide";
import type { CandidatoDuplicidade, Problema, Subproblema } from "../domain/validation";

/**
 * Suspeita de duplicidade por chave composta EXPLICÁVEL (RF-13): o núcleo é mesmo paciente +
 * mesmo convênio + mesma data de atendimento + mesmo procedimento. Carteirinha divergente
 * DESCARTA a suspeita: duas carteirinhas diferentes identificam beneficiários diferentes, e o
 * PRD §36 trata falso positivo de duplicidade como risco alto. Carteirinha ausente em um dos
 * lados não descarta — dado faltante não é prova de diferença. Cada candidato restante vira
 * um problema próprio,
 * citando o `id_guia` do par e exatamente os campos que coincidiram — nunca mescla nada aqui,
 * isso é ação exclusiva do financeiro em outra etapa do produto.
 */
export function verificarDuplicidade(
  guia: GuiaNormalizada,
  candidatos: readonly CandidatoDuplicidade[],
): readonly Problema[] {
  const problemas: Problema[] = [];

  for (const candidato of candidatos) {
    const par = candidato.guia;
    const nucleoBate =
      par.paciente === guia.paciente &&
      par.convenio === guia.convenio &&
      par.data_atendimento === guia.data_atendimento &&
      par.procedimento_codigo === guia.procedimento_codigo;

    if (!nucleoBate) continue;

    const carteirinhasConhecidas = par.carteirinha !== null && guia.carteirinha !== null;
    if (carteirinhasConhecidas && par.carteirinha !== guia.carteirinha) continue;

    const camposCoincidentes: Subproblema[] = [
      { rotulo: "paciente", valor: guia.paciente },
      { rotulo: "convênio", valor: guia.convenio },
      { rotulo: "data do atendimento", valor: guia.data_atendimento },
      { rotulo: "procedimento", valor: guia.procedimento_codigo },
    ];
    if (par.carteirinha === guia.carteirinha) {
      camposCoincidentes.push({ rotulo: "carteirinha", valor: guia.carteirinha });
    }
    if (par.numero_autorizacao !== null && par.numero_autorizacao === guia.numero_autorizacao) {
      camposCoincidentes.push({ rotulo: "número da autorização", valor: guia.numero_autorizacao });
    }

    problemas.push({
      codigo: "POSSIVEL_DUPLICIDADE",
      titulo: `Possível duplicidade com a guia ${par.id_guia}`,
      acao_recomendada: "REVISAR",
      area_responsavel: "FINANCEIRO",
      subproblemas: [
        { rotulo: "id_guia do par", valor: par.id_guia },
        { rotulo: "protocolo do par", valor: candidato.numeroProtocolo },
        ...camposCoincidentes,
      ],
      referencia_regra:
        "duplicidade.chave_composta(paciente+convenio+data_atendimento+procedimento, carteirinha divergente descarta)",
    });
  }

  return problemas;
}
