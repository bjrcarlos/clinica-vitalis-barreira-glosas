import type { Env } from "../worker/index";
import { RepositorioIdentidadeD1 } from "../infrastructure/d1/identity";
import type { PapelSessao } from "../infrastructure/auth/session";

/**
 * Contexto autenticado do MCP (PRD-SDD §23.2): papel e principal derivados da credencial, nunca
 * de um parâmetro de tool. Cada tool recebe este objeto por parâmetro/closure — jamais aceita
 * `papel`/`area` vindo de `arguments` do `tools/call`.
 *
 * Dois caminhos de credencial, nesta ordem:
 *
 * 1. **Token OAuth** emitido a uma pessoa depois do login (`/oauth/authorize`). O papel é o da
 *    conta, e `principal` identifica a pessoa — é o caminho normal desde a Fase 6.
 * 2. **Bearer fixo por área**, um secret por área, mantido como atalho de demonstração por
 *    decisão do dono do produto. Não identifica pessoa: `principal` é a própria área.
 */
export interface ContextoMcp {
  readonly papel: PapelSessao;
  readonly principal: string;
  /** Como a credencial foi apresentada — entra no evento de auditoria de tudo que a sessão escrever. */
  readonly origemCredencial: "OAUTH" | "TOKEN_FIXO";
  /** Presente apenas no caminho OAuth, onde existe uma pessoa por trás do token. */
  readonly usuario?: { readonly id: string; readonly nome: string; readonly email: string };
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

/** Resolve um access token OAuth em contexto, conferindo validade, revogação e conta ativa. */
async function autenticarPorOauth(token: string, env: Env, agoraUtc: string): Promise<ContextoMcp | null> {
  const repo = new RepositorioIdentidadeD1(env.DB);
  const registro = await repo.buscarToken(token);
  if (!registro || registro.tipo !== "ACCESS") return null;
  if (registro.revogadoEmUtc !== null) return null;
  if (Date.parse(registro.expiraEmUtc) < Date.parse(agoraUtc)) return null;

  const usuario = await repo.buscarUsuarioPorId(registro.userId);
  if (!usuario) return null;

  return {
    papel: usuario.papel,
    principal: usuario.email,
    origemCredencial: "OAUTH",
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email },
  };
}

/** Lê `Authorization: Bearer ...` e resolve o papel — primeiro como token OAuth, depois como secret de área. */
export async function autenticar(request: Request, env: Env, agoraUtc: string = new Date().toISOString()): Promise<ContextoMcp | null> {
  const valor = request.headers.get("authorization");
  if (valor === null || !valor.startsWith("Bearer ")) return null;
  const token = valor.slice("Bearer ".length).trim();
  if (token === "") return null;

  const porOauth = await autenticarPorOauth(token, env, agoraUtc);
  if (porOauth) return porOauth;

  if (env.MCP_SECRETARIA_TOKEN && (await tokenIgual(token, env.MCP_SECRETARIA_TOKEN))) {
    return { papel: "SECRETARIA", principal: "secretaria@mcp", origemCredencial: "TOKEN_FIXO" };
  }
  if (env.MCP_FINANCEIRO_TOKEN && (await tokenIgual(token, env.MCP_FINANCEIRO_TOKEN))) {
    return { papel: "FINANCEIRO", principal: "financeiro@mcp", origemCredencial: "TOKEN_FIXO" };
  }
  return null;
}
