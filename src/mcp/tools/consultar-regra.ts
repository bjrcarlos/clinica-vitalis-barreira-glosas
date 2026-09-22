import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { carregarRegrasAtivas } from "../../http/handlers/create-protocol";
import { apresentarCampoGuia, formatarCentavos } from "../../domain/apresentacao";
import type { Env } from "../../worker/index";
import { SOMENTE_LEITURA, erroTool, responder, tabela } from "../resposta";

const schemaRegra = z.object({
  convenio: z.string().trim().min(1).describe("Nome do convênio como aparece na guia (ex.: Vitalcard). Maiúsculas e acentos não importam."),
  procedimento_codigo: z.string().trim().min(1).optional().describe("Código do procedimento (ex.: 50000470). Opcional: com ele a resposta diz se o convênio cobre e qual o valor de referência."),
});

const esquemaProcedimento = z.object({
  codigo: z.string(),
  descricao: z.string(),
  valor_referencia_cents: z.number().int(),
  valor_referencia: z.string(),
});

const esquemaSaidaRegra = z.object({
  versao_regra: z.string(),
  sha256: z.string(),
  origem: z.string(),
  convenio: z.object({
    nome: z.string(),
    campos_obrigatorios: z.array(z.object({ campo: z.string(), rotulo: z.string() })),
    limite_sessoes_por_autorizacao: z.number().int(),
    prazo_envio_dias: z.number().int(),
    validade_maxima_autorizacao_dias: z.number().int(),
    observacao: z.string(),
    procedimentos_cobertos: z.array(esquemaProcedimento),
  }),
  procedimento_consultado: esquemaProcedimento.extend({ coberto_por_este_convenio: z.boolean() }).nullable(),
  definicoes: z.object({
    autorizacao_valida: z.string(),
    sessao_numero_na_autorizacao: z.string(),
    prazo_envio_dias: z.string(),
    valor: z.string(),
  }),
  orientacao: z.string(),
});

/**
 * `consultar_regra` (PRD-SDD §23.3): a regra ativa de um convênio, opcionalmente confrontada com
 * um procedimento. Não persiste nada.
 *
 * O texto já vem pronto para leitura: campos obrigatórios com rótulo, cobertura do procedimento
 * em "sim/não", valores em reais. Convênio inexistente devolve erro com a lista dos nomes válidos
 * — é o que impede o assistente de "corrigir" o nome por conta própria.
 */
export function registrarConsultarRegra(server: McpServer, env: Env): void {
  server.registerTool(
    "consultar_regra",
    {
      title: "Consultar regra do convênio",
      description:
        "Regra oficial vigente de um convênio: campos obrigatórios, limite de sessões por autorização, prazo de envio e procedimentos cobertos. Com procedimento_codigo, diz se ele é coberto e o valor de referência. Não grava nada. Responda com o texto devolvido; a regra é a mesma que o motor de validação aplica.",
      inputSchema: schemaRegra,
      outputSchema: esquemaSaidaRegra,
      annotations: SOMENTE_LEITURA,
    },
    async (entrada) => {
      const regras = await carregarRegrasAtivas(env.DB);
      const convenio = regras.convenioPorNome(entrada.convenio);
      if (!convenio) {
        const nomes = regras.convenios.map((item) => item.nome).join(", ");
        throw erroTool("CONVENIO_DESCONHECIDO", `Convênio "${entrada.convenio}" não existe na regra ${regras.versao}. Convênios válidos: ${nomes}. Não escolha um por semelhança: confirme com a pessoa.`);
      }

      const procedimentoBruto = entrada.procedimento_codigo ? regras.procedimentoPorCodigo(entrada.procedimento_codigo) : null;
      if (entrada.procedimento_codigo && !procedimentoBruto) {
        throw erroTool("PROCEDIMENTO_DESCONHECIDO", `Procedimento "${entrada.procedimento_codigo}" não existe na tabela oficial ${regras.versao}. Confira o código na guia; não substitua por outro parecido.`);
      }

      const apresentarProcedimento = (item: { codigo: string; descricao: string; valor_referencia_cents: number }) => ({
        codigo: item.codigo,
        descricao: item.descricao,
        valor_referencia_cents: item.valor_referencia_cents,
        valor_referencia: formatarCentavos(item.valor_referencia_cents),
      });

      const cobertos = convenio.procedimentos_cobertos
        .map((codigo) => regras.procedimentoPorCodigo(codigo))
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .map(apresentarProcedimento);

      const procedimentoConsultado = procedimentoBruto
        ? { ...apresentarProcedimento(procedimentoBruto), coberto_por_este_convenio: convenio.procedimentos_cobertos.includes(procedimentoBruto.codigo) }
        : null;

      const saida = {
        versao_regra: regras.versao,
        sha256: regras.sha256,
        origem: "regras_convenio.json (rule_sets.source_json)",
        convenio: {
          nome: convenio.nome,
          campos_obrigatorios: convenio.campos_obrigatorios.map((campo) => ({ campo: String(campo), rotulo: apresentarCampoGuia(String(campo)) })),
          limite_sessoes_por_autorizacao: convenio.limite_sessoes_por_autorizacao,
          prazo_envio_dias: convenio.prazo_envio_dias,
          validade_maxima_autorizacao_dias: convenio.validade_maxima_autorizacao_dias,
          observacao: convenio.observacao,
          procedimentos_cobertos: cobertos,
        },
        procedimento_consultado: procedimentoConsultado,
        definicoes: regras.definicoes,
        orientacao:
          "Regra oficial, a mesma que o motor aplica. A autorização vale até o próprio dia do vencimento (inclusive). Esta consulta não grava nada.",
      };

      const blocoProcedimento = procedimentoConsultado
        ? `\n\n**Procedimento ${procedimentoConsultado.codigo} — ${procedimentoConsultado.descricao}**\n- Coberto por ${convenio.nome}: **${procedimentoConsultado.coberto_por_este_convenio ? "sim" : "NÃO"}**${procedimentoConsultado.coberto_por_este_convenio ? "" : " — não pode ser faturado a este convênio"}\n- Valor de referência: ${procedimentoConsultado.valor_referencia}`
        : "";

      const texto = `## Regra ${convenio.nome} · versão ${regras.versao}

- Limite de sessões por autorização: **${convenio.limite_sessoes_por_autorizacao}**
- Prazo de envio: **${convenio.prazo_envio_dias} dias** após o atendimento
- Autorização vale até o próprio dia do vencimento (inclusive)
- Observação do convênio: ${convenio.observacao}

**Campos obrigatórios**

${tabela(["Campo", "Chave"], saida.convenio.campos_obrigatorios.map((c) => [c.rotulo, c.campo]))}${blocoProcedimento}

**Procedimentos cobertos** (${cobertos.length})

${tabela(["Código", "Procedimento", "Valor de referência"], cobertos.map((p) => [p.codigo, p.descricao, p.valor_referencia]))}

_Consulta apenas: nada foi gravado._`;

      return responder(texto, saida);
    },
  );
}
