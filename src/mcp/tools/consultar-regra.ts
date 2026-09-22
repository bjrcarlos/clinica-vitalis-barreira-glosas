import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { carregarRegrasAtivas } from "../../http/handlers/create-protocol";
import type { Env } from "../../worker/index";

const schemaRegra = z.object({
  convenio: z.string().trim().min(1),
  procedimento_codigo: z.string().trim().min(1).optional(),
});

/** `consultar_regra` (PRD-SDD §23.3): consulta a regra ativa de um convênio/procedimento. Não persiste. */
export function registrarConsultarRegra(server: McpServer, env: Env): void {
  server.registerTool(
    "consultar_regra",
    {
      description: "Consulta a regra oficial de um convênio e procedimento.",
      inputSchema: schemaRegra,
    },
    async (entrada) => {
      const regras = await carregarRegrasAtivas(env.DB);
      const convenio = regras.convenios.find((item) => item.nome === entrada.convenio);
      if (!convenio) throw new Error("Convênio não encontrado na regra ativa.");
      const procedimento = entrada.procedimento_codigo
        ? (regras.procedimentos.find((item) => item.codigo === entrada.procedimento_codigo) ?? null)
        : null;
      const resultado = { versao: regras.versao, sha256: regras.sha256, origem: "regras_convenio.json.txt", convenio, procedimento, referencia_fonte: "rule_sets.source_json" };
      return { content: [{ type: "text", text: JSON.stringify(resultado) }] };
    },
  );
}
