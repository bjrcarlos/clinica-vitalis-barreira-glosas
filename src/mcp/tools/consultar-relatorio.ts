import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { montarRelatorio } from "../../http/handlers/report";
import type { Env } from "../../worker/index";
import type { ContextoMcp } from "../auth";

const schemaRelatorio = z.object({});

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
      description: "Relatório consolidado da clínica (verificadas, atenção, risco e pendências antigas). Exclusivo da Direção.",
      inputSchema: schemaRelatorio,
    },
    async () => {
      if (contexto.papel !== "DIRECAO") {
        throw new Error("Somente a Direção pode consultar o relatório consolidado. Use minhas_pendencias para a sua fila.");
      }
      const relatorio = await montarRelatorio(env.DB);
      return { content: [{ type: "text", text: JSON.stringify(relatorio) }] };
    },
  );
}
