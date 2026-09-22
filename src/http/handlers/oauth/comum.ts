import type { Env } from "../../../worker/index";
import { RepositorioIdentidadeD1 } from "../../../infrastructure/d1/identity";
import { lerCookie, NOME_COOKIE_LOGIN, verificarLogin, type SessaoLogin } from "../../../infrastructure/auth/login-session";

/** Peças compartilhadas pelos handlers de OAuth e de login: contexto, respostas e leitura de formulário. */

export interface ContextoOauth {
  readonly request: Request;
  readonly env: Env;
  readonly url: URL;
  readonly origem: string;
  readonly agoraUtc: string;
  readonly seguro: boolean;
  readonly repo: RepositorioIdentidadeD1;
  readonly chaveAssinatura: string;
}

/**
 * Monta o contexto de uma requisição de identidade. Lança se `LINK_SIGNING_KEY` não estiver
 * configurada: sem ela não há como assinar sessão, e seguir adiante emitiria credencial sem
 * assinatura — falhar alto aqui é o comportamento certo.
 */
export function contextoOauth(request: Request, env: Env): ContextoOauth {
  if (!env.LINK_SIGNING_KEY) throw new Error("LINK_SIGNING_KEY não configurada neste ambiente.");
  const url = new URL(request.url);
  return {
    request,
    env,
    url,
    origem: url.origin,
    agoraUtc: new Date().toISOString(),
    seguro: url.protocol === "https:",
    repo: new RepositorioIdentidadeD1(env.DB),
    chaveAssinatura: env.LINK_SIGNING_KEY,
  };
}

/** Sessão de navegador de quem está logado agora, ou `null`. Nunca lança. */
export async function sessaoAtual(ctx: ContextoOauth): Promise<SessaoLogin | null> {
  const valor = lerCookie(ctx.request.headers.get("cookie"), NOME_COOKIE_LOGIN);
  if (valor === null) return null;
  return verificarLogin(valor, ctx.chaveAssinatura, ctx.agoraUtc);
}

/** Resposta JSON dos endpoints OAuth: nunca cacheável, como manda a especificação. */
export function jsonOauth(corpo: unknown, status = 200, cabecalhos: Record<string, string> = {}): Response {
  return Response.json(corpo, {
    status,
    headers: { "cache-control": "no-store", pragma: "no-cache", ...cabecalhos },
  });
}

/** Erro no formato do OAuth 2.1 (`error` + `error_description`), distinto do formato de erro do domínio. */
export function erroOauth(status: number, erro: string, descricao: string): Response {
  return jsonOauth({ error: erro, error_description: descricao }, status);
}

/** Lê `application/x-www-form-urlencoded` (formato dos formulários e do `token_endpoint`). */
export async function lerFormulario(request: Request): Promise<URLSearchParams> {
  const texto = await request.text();
  return new URLSearchParams(texto);
}

/**
 * Acrescenta um ou mais `Set-Cookie` a uma resposta já montada. `Headers.set` sobrescreveria o
 * anterior, então o login (que emite dois cookies: identidade real e papel funcional) precisa de
 * `append` — daí este helper em vez de montar cabeçalho à mão em cada caminho.
 */
export function respostaComCookies(resposta: Response, cookies: readonly string[]): Response {
  const cabecalhos = new Headers(resposta.headers);
  for (const cookie of cookies) cabecalhos.append("set-cookie", cookie);
  return new Response(resposta.body, { status: resposta.status, statusText: resposta.statusText, headers: cabecalhos });
}

/** Redireciona de volta ao cliente preservando `state` — caminho de erro previsto pela especificação. */
export function redirecionarComErro(redirectUri: string, state: string | null, erro: string, descricao: string): Response {
  const destino = new URL(redirectUri);
  destino.searchParams.set("error", erro);
  destino.searchParams.set("error_description", descricao);
  if (state) destino.searchParams.set("state", state);
  return Response.redirect(destino.toString(), 302);
}
