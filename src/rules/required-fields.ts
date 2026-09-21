import type { GuiaNormalizada } from "../domain/guide";
import type { RegraConvenio } from "../domain/rule-set";
import type { Problema, Subproblema } from "../domain/validation";

/**
 * Rótulos em português operacional para os campos de `GuiaNormalizada` que algum convênio
 * declara obrigatório em `regras_convenio.json`. Usado só para compor o `rotulo` do
 * subproblema — o código do problema (`CAMPO_OBRIGATORIO_AUSENTE`) nunca muda por campo.
 */
const ROTULOS_CAMPO: Readonly<Partial<Record<keyof GuiaNormalizada, string>>> = {
  numero_autorizacao: "número da autorização",
  autorizacao_validade: "validade da autorização",
  profissional_registro: "registro profissional",
  carteirinha: "carteirinha",
  cid: "CID",
  procedimento_descricao: "descrição do procedimento",
  observacao_recepcao: "observação da recepção",
};

function rotuloCampo(campo: keyof GuiaNormalizada): string {
  return ROTULOS_CAMPO[campo] ?? String(campo);
}

/** Um campo é considerado ausente quando é `null` ou uma string vazia/só espaços. Número nunca é "ausente" aqui. */
function campoAusente(valor: string | number | null): boolean {
  if (valor === null) return true;
  if (typeof valor === "string") return valor.trim().length === 0;
  return false;
}

/**
 * Verifica os campos que o convênio da guia declara obrigatórios (RF-05, RN-01). A lista de
 * campos vem inteiramente do conjunto de regras — nenhum campo é fixado aqui no código-fonte.
 * Só deve ser chamada quando o convênio da guia já foi localizado no conjunto de regras.
 */
export function verificarCamposObrigatorios(
  guia: GuiaNormalizada,
  convenio: RegraConvenio,
): readonly Problema[] {
  const subproblemas: Subproblema[] = [];
  for (const campo of convenio.campos_obrigatorios) {
    if (campoAusente(guia[campo])) {
      subproblemas.push({ rotulo: rotuloCampo(campo), valor: "ausente" });
    }
  }

  if (subproblemas.length === 0) return [];

  return [
    {
      codigo: "CAMPO_OBRIGATORIO_AUSENTE",
      titulo: `Faltam campos obrigatórios para ${convenio.nome}`,
      acao_recomendada: "CORRIGIR",
      area_responsavel: "SECRETARIA",
      subproblemas,
      referencia_regra: `convenios.${convenio.nome}.campos_obrigatorios`,
    },
  ];
}
