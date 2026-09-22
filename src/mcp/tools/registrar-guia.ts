import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { carregarRegrasAtivas, buscarResumoWire } from "../../http/handlers/create-protocol";
import { normalizarGuia } from "../../domain/normalize";
import { esquemaGuiaBruta } from "../../http/contracts";
import { validarGuia as motorValidacao } from "../../rules/engine";
import { criarRepositoriosD1 } from "../../infrastructure/d1/repositories";
import { GeradorIdCrypto } from "../../infrastructure/id";
import { RelogioReal } from "../../infrastructure/clock";
import { interpretarObservacao, type AiLike } from "../../infrastructure/ai/interpreter";
import { registrarGuia } from "../../application/register-guide";
import type { Env } from "../../worker/index";
import type { ContextoMcp } from "../auth";

const schemaRegistrar = z.object({
  id_guia_origem: z.string().trim().min(1).max(200),
  guia: esquemaGuiaBruta,
});

function aiDoAmbiente(env: Env): AiLike | undefined {
  return env.AI as unknown as AiLike | undefined;
}

/**
 * `registrar_guia` (PRD-SDD §23.3): exclusiva da Secretaria, idempotente por `id_guia_origem`.
 * `contexto` vem do Bearer autenticado (nunca de `arguments`) — é aqui que a exclusividade de
 * papel é imposta, antes de qualquer escrita.
 */
export function registrarRegistrarGuia(server: McpServer, env: Env, contexto: ContextoMcp): void {
  server.registerTool(
    "registrar_guia",
    {
      description: "Registra uma nova guia pela Secretaria, com idempotência de origem.",
      inputSchema: schemaRegistrar,
    },
    async (entrada) => {
      if (contexto.papel !== "SECRETARIA") throw new Error("Somente a Secretaria pode registrar_guia.");
      const regras = await carregarRegrasAtivas(env.DB);
      const normalizada = normalizarGuia(entrada.guia);
      const interpretacao = await interpretarObservacao(aiDoAmbiente(env), normalizada.guia, regras);
      const ids = new GeradorIdCrypto();
      const relogio = new RelogioReal();
      const repos = criarRepositoriosD1(env.DB, ids, relogio);
      const registro = await registrarGuia(
        {
          idGuiaOrigem: entrada.id_guia_origem,
          guiaBruta: entrada.guia,
          guiaNormalizada: normalizada.guia,
          avisosNormalizacao: normalizada.avisos,
          criadoPorPapel: "SECRETARIA",
          criadoPorPrincipal: contexto.principal,
          origem: "MCP",
          regras,
          interpretacaoIA: interpretacao.interpretacao,
          aiStatus: interpretacao.status,
          aiModel: interpretacao.modelo,
          aiPromptVersion: interpretacao.promptVersion,
          aiInputJson: interpretacao.inputJson,
          aiOutputJson: interpretacao.outputJson,
        },
        { protocolos: repos.protocolos, versoes: repos.versoes, eventos: repos.eventos, relogio, validarGuiaDependencias: { motor: motorValidacao, validacoes: repos.validacoes, tarefas: repos.tarefas, eventos: repos.eventos, relogio } },
      );
      const resumo = await buscarResumoWire(env.DB, registro.protocolo.numeroProtocolo);
      const saida = {
        ja_existia: registro.jaExistia,
        protocolo: resumo,
        resultado_validacao: registro.validacao?.resultado ?? null,
        url_revisao: `/protocolos/${encodeURIComponent(registro.protocolo.numeroProtocolo)}`,
      };
      return { content: [{ type: "text", text: JSON.stringify(saida) }] };
    },
  );
}
