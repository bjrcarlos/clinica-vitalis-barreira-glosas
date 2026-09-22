import type { Env } from "../worker/index";

/**
 * Contexto autenticado do MCP (PRD-SDD §23.2): papel e principal derivados do token Bearer,
 * nunca de um parâmetro de tool. Cada tool recebe este objeto por parâmetro/closure — jamais
 * aceita `papel`/`area` vindo de `arguments` do `tools/call`.
 */
export interface ContextoMcp {
  readonly papel: "SECRETARIA" | "FINANCEIRO";
  readonly principal: string;
}

async function hashToken(token: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}

/**
 * Compara dois tokens por hash SHA-256 e verificação HMAC (em vez de `===` direto) para não
 * expor timing de comparação de string ao comparar o token recebido com o secret configurado.
 */
async function tokenIgual(token: string, esperado: string): Promise<boolean> {
  const atual = await hashToken(token);
  const hashEsperado = await hashToken(esperado);
  const chave = await crypto.subtle.importKey("raw", hashEsperado, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const assinaturaEsperada = new Uint8Array(await crypto.subtle.sign("HMAC", chave, hashEsperado));
  return crypto.subtle.verify("HMAC", chave, assinaturaEsperada, atual);
}

/** Lê `Authorization: Bearer ...` e resolve o papel comparando contra os dois secrets configurados. */
export async function autenticar(request: Request, env: Env): Promise<ContextoMcp | null> {
  const valor = request.headers.get("authorization");
  if (valor === null || !valor.startsWith("Bearer ")) return null;
  const token = valor.slice("Bearer ".length).trim();
  if (env.MCP_SECRETARIA_TOKEN && (await tokenIgual(token, env.MCP_SECRETARIA_TOKEN))) return { papel: "SECRETARIA", principal: "secretaria@mcp" };
  if (env.MCP_FINANCEIRO_TOKEN && (await tokenIgual(token, env.MCP_FINANCEIRO_TOKEN))) return { papel: "FINANCEIRO", principal: "financeiro@mcp" };
  return null;
}
