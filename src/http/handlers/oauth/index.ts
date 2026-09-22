import type { Env } from "../../../worker/index";
import { metadataRecursoProtegido, metadataServidorAutorizacao } from "../../../infrastructure/auth/oauth";
import { contextoOauth, erroOauth, jsonOauth, sessaoAtual } from "./comum";
import { autorizarGet, autorizarPost } from "./authorize";
import { registrarCliente } from "./register";
import { revogarToken, trocarToken } from "./token";
import { entrarGet, entrarPost, sair } from "./login";

/**
 * Roteia tudo que é identidade: descoberta OAuth, registro de cliente, autorização, token,
 * revogação e o login direto no sistema. Fica fora do roteador de `/api/**` porque estes
 * caminhos são fixados por especificação (`/.well-known/...`, `/oauth/...`) e porque metade
 * deles responde HTML, não JSON.
 *
 * Devolve `null` quando o caminho não é desta área — aí o Worker segue para a SPA ou para a API.
 */
export async function manipularIdentidade(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const caminho = url.pathname;
  const metodo = request.method;

  const ehDescoberta =
    caminho === "/.well-known/oauth-protected-resource" ||
    caminho === "/.well-known/oauth-protected-resource/mcp" ||
    caminho === "/.well-known/oauth-authorization-server" ||
    caminho === "/.well-known/oauth-authorization-server/mcp";

  const ehOauth = caminho.startsWith("/oauth/");
  const ehLogin = caminho === "/entrar" || caminho === "/sair" || caminho === "/api/me";

  if (!ehDescoberta && !ehOauth && !ehLogin) return null;

  // Descoberta é pública e não precisa de contexto autenticado nem de banco.
  if (ehDescoberta) {
    if (metodo !== "GET" && metodo !== "HEAD") return erroOauth(405, "invalid_request", "Use GET.");
    const corpo = caminho.startsWith("/.well-known/oauth-protected-resource")
      ? metadataRecursoProtegido(url.origin)
      : metadataServidorAutorizacao(url.origin);
    return jsonOauth(corpo, 200, { "access-control-allow-origin": "*" });
  }

  const ctx = contextoOauth(request, env);

  if (caminho === "/oauth/register") {
    if (metodo !== "POST") return erroOauth(405, "invalid_request", "Use POST.");
    return registrarCliente(ctx);
  }

  if (caminho === "/oauth/authorize") {
    if (metodo === "GET") return autorizarGet(ctx);
    if (metodo === "POST") return autorizarPost(ctx);
    return erroOauth(405, "invalid_request", "Use GET ou POST.");
  }

  if (caminho === "/oauth/token") {
    if (metodo !== "POST") return erroOauth(405, "invalid_request", "Use POST.");
    return trocarToken(ctx);
  }

  if (caminho === "/oauth/revoke") {
    if (metodo !== "POST") return erroOauth(405, "invalid_request", "Use POST.");
    return revogarToken(ctx);
  }

  if (caminho === "/entrar") {
    if (metodo === "GET") return entrarGet(ctx);
    if (metodo === "POST") return entrarPost(ctx);
    return erroOauth(405, "invalid_request", "Use GET ou POST.");
  }

  if (caminho === "/sair") {
    if (metodo !== "POST" && metodo !== "GET") return erroOauth(405, "invalid_request", "Use POST.");
    return sair(ctx);
  }

  // GET /api/me — quem está logado nesta aba. A interface usa para saudar pelo nome e para
  // mostrar o perfil real em vez do seletor de demonstração.
  if (caminho === "/api/me") {
    if (metodo !== "GET") return erroOauth(405, "invalid_request", "Use GET.");
    const sessao = await sessaoAtual(ctx);
    return jsonOauth(
      sessao
        ? { autenticado: true, nome: sessao.nome, email: sessao.email, papel: sessao.papel, expira_em_utc: sessao.expiraEmUtc }
        : { autenticado: false },
    );
  }

  return erroOauth(404, "invalid_request", "Rota de identidade não encontrada.");
}
