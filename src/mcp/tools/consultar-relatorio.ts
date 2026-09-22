import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { montarRelatorio } from "../../http/handlers/report";
import { esquemaRelatorioResposta, type RelatorioResposta } from "../../http/contracts";
import { apresentarArea, apresentarValidacaoStatus } from "../../domain/statuses";
import { formatarCentavos, formatarDataCurta, formatarDataHoraBrasilia } from "../../domain/apresentacao";
import type { Env } from "../../worker/index";
import type { ContextoMcp } from "../auth";
import { SOMENTE_LEITURA, erroTool, responder, tabela } from "../resposta";

const schemaRelatorio = z.object({});

const esquemaSaidaRelatorio = esquemaRelatorioResposta.extend({
  gerado_em: z.string(),
  orientacao: z.string(),
});

const ORDEM_ESTADOS: ReadonlyArray<RelatorioResposta["distribuicao_por_estado_validacao"][number]["status_validacao"]> = ["CORRIGIR", "REVISAO_HUMANA", "NAO_FATURAR_CONVENIO", "OK"];

/** Bloco Markdown do relatório — mesma ordem de leitura da tela da Direção. */
function textoDoRelatorio(r: RelatorioResposta): string {
  const porEstado = tabela(
    ["Estado", "Guias", "Risco"],
    ORDEM_ESTADOS.map((estado) => {
      const linha = r.distribuicao_por_estado_validacao.find((l) => l.status_validacao === estado);
      return [apresentarValidacaoStatus(estado), linha?.quantidade ?? 0, formatarCentavos(linha?.risco_cents ?? 0)];
    }),
  );

  const blocosMotivos = ORDEM_ESTADOS.filter((estado) => estado !== "OK")
    .map((estado) => {
      const total = r.distribuicao_por_estado_validacao.find((l) => l.status_validacao === estado);
      const motivos = r.motivos_por_estado.filter((m) => m.status_validacao === estado);
      if (!total || total.quantidade === 0 || motivos.length === 0) return "";
      const soma = motivos.reduce((acc, m) => acc + m.guias, 0);
      const aviso = soma > total.quantidade ? `\n\n> ${soma} entradas para ${total.quantidade} guias: uma guia pode ter mais de um motivo.` : "";
      return `**${apresentarValidacaoStatus(estado)} — ${total.quantidade} guia(s) · ${formatarCentavos(total.risco_cents)}**

${tabela(["Motivo", "Guias", "Quem resolve", "Protocolos"], motivos.map((m) => [m.titulo, m.guias, m.area_responsavel ? apresentarArea(m.area_responsavel) : "—", m.protocol_numbers.join(", ")]))}${aviso}`;
    })
    .filter((bloco) => bloco.length > 0)
    .join("\n\n");

  const porArea = tabela(
    ["Área", "Tarefas abertas", "Risco", "Mais antiga"],
    r.distribuicao_por_area.map((a) => [apresentarArea(a.area), a.quantidade_tarefas_abertas, formatarCentavos(a.risco_cents), a.pendencia_mais_antiga_utc ? formatarDataCurta(a.pendencia_mais_antiga_utc) : "—"]),
  );

  const antigas =
    r.pendencias_mais_antigas.length === 0
      ? "_Nenhuma pendência aberta._"
      : tabela(
          ["Protocolo", "Estado", "Resumo", "Área", "Risco", "Aberta desde"],
          r.pendencias_mais_antigas.map((p) => [p.numero_protocolo, apresentarValidacaoStatus(p.status_validacao), p.resumo, p.area_responsavel ? apresentarArea(p.area_responsavel) : "—", formatarCentavos(p.risco_cents), formatarDataCurta(p.aberta_desde_utc)]),
        );

  return `## Relatório consolidado da clínica

Gerado em ${formatarDataHoraBrasilia(r.gerado_em_utc)} · regras ${r.regras_aplicadas.versao}

- Guias verificadas: **${r.guias_verificadas.valor}**
- Exigem atenção: **${r.exigem_atencao.valor}**
- Risco inicial: ${formatarCentavos(r.risco_inicial_cents.valor)} · tratado: ${formatarCentavos(r.risco_tratado_cents.valor)} · **pendente: ${formatarCentavos(r.risco_pendente_cents.valor)}**

**Guias por estado** (contagem oficial: cada guia conta uma vez)

${porEstado}

${blocosMotivos}

**Risco por área**

${porArea}

**Pendências mais antigas**

${antigas}

_Estes são os mesmos números da tela de relatório. Contagem de guias sai daqui, nunca de consultar_historico._`;
}

/**
 * `consultar_relatorio`: visão consolidada das duas áreas — o mesmo conteúdo da tela de
 * relatório da Direção, sem nenhum recálculo próprio (`montarRelatorio` é a única fonte).
 *
 * Exclusiva da Direção, por decisão do dono do produto: Secretaria e Financeiro trabalham por
 * fila (`minhas_pendencias`), a Direção lê o todo e não tem fila. Como toda permissão do MCP,
 * o papel vem da credencial — pedir a tool com outro Bearer não muda o que ela devolve.
 */
export function registrarConsultarRelatorio(server: McpServer, env: Env, contexto: ContextoMcp): void {
  server.registerTool(
    "consultar_relatorio",
    {
      title: "Relatório consolidado (Direção)",
      description:
        "FONTE ÚNICA das contagens da clínica: guias verificadas, guias por estado, motivos por estado (com protocolos e quem resolve), risco por área e pendências mais antigas — os mesmos números da tela de relatório. Use para qualquer pergunta de 'quantas guias estão em X' e apresente o texto devolvido como veio, já com o detalhamento por motivo; nunca some estados vindos de consultar_historico. Exclusivo da Direção.",
      inputSchema: schemaRelatorio,
      outputSchema: esquemaSaidaRelatorio,
      annotations: SOMENTE_LEITURA,
    },
    async () => {
      if (contexto.papel !== "DIRECAO") {
        throw erroTool("ROLE_NOT_ALLOWED", "Somente a Direção pode consultar o relatório consolidado. Use minhas_pendencias para a sua fila.");
      }
      const relatorio = await montarRelatorio(env.DB);
      const saida = {
        ...relatorio,
        gerado_em: formatarDataHoraBrasilia(relatorio.gerado_em_utc),
        orientacao:
          "Estes são os números oficiais da clínica, os mesmos da tela de relatório. Use-os para qualquer contagem; não derive contagem de consultar_historico, que devolve eventos. Ao responder uma contagem por estado, apresente junto o detalhamento de motivos_por_estado (motivo, guias, protocolos e responsável) em tabela — uma guia pode ter mais de um motivo, então a soma dos motivos pode passar do total do estado.",
      };
      return responder(textoDoRelatorio(relatorio), saida);
    },
  );
}
