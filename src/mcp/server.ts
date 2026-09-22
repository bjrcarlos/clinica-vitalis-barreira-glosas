import { createMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import type { Env } from "../worker/index";
import { autenticar, type ContextoMcp } from "./auth";
import { desafioBearer } from "../infrastructure/auth/oauth";
import { registrarConsultarRegra } from "./tools/consultar-regra";
import { registrarVerificarGuia } from "./tools/verificar-guia";
import { registrarRegistrarGuia } from "./tools/registrar-guia";
import { registrarMinhasPendencias } from "./tools/minhas-pendencias";
import { registrarConsultarHistorico } from "./tools/consultar-historico";
import { registrarConsultarRelatorio } from "./tools/consultar-relatorio";

/**
 * As tools do PRD-SDD §23.3 (mais `consultar_relatorio`, da Fase 6), registradas numa `McpServer` nova a cada requisição — nunca
 * uma instância compartilhada entre chamadas (§23.1 "uma instância lógica de servidor por
 * requisição"). `contexto` já veio do Bearer autenticado em `manipularMcp`; nenhuma tool aceita
 * papel/área como argumento.
 */
function construirServidor(env: Env, contexto: ContextoMcp): McpServer {
  const server = new McpServer({ name: "vitalis-mcp", version: "1.0.0" });
  registrarConsultarRegra(server, env);
  registrarVerificarGuia(server, env);
  registrarRegistrarGuia(server, env, contexto);
  registrarMinhasPendencias(server, env, contexto);
  registrarConsultarHistorico(server, env, contexto);
  registrarConsultarRelatorio(server, env, contexto);
  return server;
}

/**
 * Transporte MCP (`POST /mcp`, PRD-SDD §17 e §23.1): `createMcpHandler` do Agents SDK
 * (`agents/mcp/server`) sobre o MCP SDK v2 (`@modelcontextprotocol/server`) — nunca `McpAgent`
 * (Durable Object, descontinuado e proibido para este uso). O handler é stateless: cada chamada
 * autentica o Bearer primeiro (antes de qualquer parsing de JSON-RPC) e só então constrói uma
 * `McpServer` fechada sobre o `contexto` resolvido; nada persiste entre requisições.
 */
export async function manipularMcp(request: Request, env: Env): Promise<Response> {
  const contexto = await autenticar(request, env);
  if (!contexto) {
    // `WWW-Authenticate` com `resource_metadata` (RFC 9728) é o que faz um cliente MCP
    // descobrir sozinho onde autenticar e iniciar o OAuth — sem ele, o cliente só vê 401.
    const origem = new URL(request.url).origin;
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Autenticação necessária. Conclua o login OAuth ou use um Bearer válido." } },
      {
        status: 401,
        headers: { "WWW-Authenticate": desafioBearer(origem, "invalid_token", "Bearer ausente, expirado ou revogado.") },
      },
    );
  }
  const handler = createMcpHandler(() => construirServidor(env, contexto));
  return handler.fetch(request);
}
