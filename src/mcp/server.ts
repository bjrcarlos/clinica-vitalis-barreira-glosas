import { createMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import type { Env } from "../worker/index";
import { autenticar, type ContextoMcp } from "./auth";
import { registrarConsultarRegra } from "./tools/consultar-regra";
import { registrarVerificarGuia } from "./tools/verificar-guia";
import { registrarRegistrarGuia } from "./tools/registrar-guia";
import { registrarMinhasPendencias } from "./tools/minhas-pendencias";
import { registrarConsultarHistorico } from "./tools/consultar-historico";

/**
 * As cinco tools do PRD-SDD §23.3, registradas numa `McpServer` nova a cada requisição — nunca
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
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Autenticação Bearer inválida ou ausente." } },
      { status: 401 },
    );
  }
  const handler = createMcpHandler(() => construirServidor(env, contexto));
  return handler.fetch(request);
}
