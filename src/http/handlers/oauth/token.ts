import { segredoAleatorio } from "../../../infrastructure/auth/crypto-texto";
import { pkceConfere, VALIDADE_ACCESS_MS, VALIDADE_REFRESH_MS } from "../../../infrastructure/auth/oauth";
import type { ContextoOauth } from "./comum";
import { erroOauth, jsonOauth, lerFormulario } from "./comum";

/**
 * Endpoint de token (`/oauth/token`): troca o código de autorização por um access token, e
 * renova pelo refresh. Nenhuma pessoa vê esta rota — quem fala aqui é o cliente de IA.
 *
 * Três garantias que o código abaixo existe para manter:
 *
 * 1. **Código é de uso único.** O consumo é um `UPDATE ... WHERE used_at_utc IS NULL`, então
 *    duas trocas simultâneas do mesmo código resultam em uma aceita e uma recusada.
 * 2. **PKCE é verificado sempre.** Sem o `code_verifier` correto, o código interceptado não vale
 *    nada — é o que protege um cliente público, que não tem secret.
 * 3. **Refresh é rotacionado.** Cada renovação revoga a sessão anterior daquele par
 *    usuário+cliente e emite um par novo; um refresh vazado deixa de servir no próximo uso
 *    legítimo.
 */

interface TokensEmitidos {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiraEmSegundos: number;
}

async function emitirPar(
  ctx: ContextoOauth,
  dados: { readonly clientId: string; readonly userId: string; readonly scope: string },
): Promise<TokensEmitidos> {
  const agoraMs = new Date(ctx.agoraUtc).getTime();
  const accessToken = segredoAleatorio(32);
  const refreshToken = segredoAleatorio(32);

  await ctx.repo.guardarToken(
    accessToken,
    { tipo: "ACCESS", clientId: dados.clientId, userId: dados.userId, scope: dados.scope, expiraEmUtc: new Date(agoraMs + VALIDADE_ACCESS_MS).toISOString() },
    ctx.agoraUtc,
  );
  await ctx.repo.guardarToken(
    refreshToken,
    { tipo: "REFRESH", clientId: dados.clientId, userId: dados.userId, scope: dados.scope, expiraEmUtc: new Date(agoraMs + VALIDADE_REFRESH_MS).toISOString() },
    ctx.agoraUtc,
  );

  return { accessToken, refreshToken, expiraEmSegundos: Math.floor(VALIDADE_ACCESS_MS / 1000) };
}

function respostaDeTokens(tokens: TokensEmitidos, scope: string): Response {
  return jsonOauth({
    access_token: tokens.accessToken,
    token_type: "Bearer",
    expires_in: tokens.expiraEmSegundos,
    refresh_token: tokens.refreshToken,
    scope,
  });
}

export async function trocarToken(ctx: ContextoOauth): Promise<Response> {
  const formulario = await lerFormulario(ctx.request);
  const grantType = formulario.get("grant_type");

  if (grantType === "authorization_code") {
    const codigo = formulario.get("code") ?? "";
    const clientId = formulario.get("client_id") ?? "";
    const redirectUri = formulario.get("redirect_uri") ?? "";
    const codeVerifier = formulario.get("code_verifier") ?? "";

    const registro = await ctx.repo.buscarCodigo(codigo);
    if (!registro) return erroOauth(400, "invalid_grant", "Código de autorização desconhecido.");
    if (registro.usadoEmUtc !== null) return erroOauth(400, "invalid_grant", "Código de autorização já utilizado.");
    if (Date.parse(registro.expiraEmUtc) < Date.parse(ctx.agoraUtc)) {
      return erroOauth(400, "invalid_grant", "Código de autorização expirado.");
    }
    if (registro.clientId !== clientId) return erroOauth(400, "invalid_grant", "Código emitido para outro cliente.");
    if (registro.redirectUri !== redirectUri) return erroOauth(400, "invalid_grant", "redirect_uri diferente da usada na autorização.");
    if (!(await pkceConfere(codeVerifier, registro.codeChallenge))) {
      return erroOauth(400, "invalid_grant", "code_verifier não corresponde ao desafio PKCE.");
    }

    // Só agora o código é consumido: se a corrida for perdida, nenhum token foi emitido.
    if (!(await ctx.repo.consumirCodigo(codigo, ctx.agoraUtc))) {
      return erroOauth(400, "invalid_grant", "Código de autorização já utilizado.");
    }

    const tokens = await emitirPar(ctx, { clientId: registro.clientId, userId: registro.userId, scope: registro.scope });
    return respostaDeTokens(tokens, registro.scope);
  }

  if (grantType === "refresh_token") {
    const refresh = formulario.get("refresh_token") ?? "";
    const clientId = formulario.get("client_id") ?? "";

    const registro = await ctx.repo.buscarToken(refresh);
    if (!registro || registro.tipo !== "REFRESH") return erroOauth(400, "invalid_grant", "Refresh token desconhecido.");
    if (registro.revogadoEmUtc !== null) return erroOauth(400, "invalid_grant", "Refresh token revogado.");
    if (Date.parse(registro.expiraEmUtc) < Date.parse(ctx.agoraUtc)) return erroOauth(400, "invalid_grant", "Refresh token expirado.");
    if (clientId && registro.clientId !== clientId) return erroOauth(400, "invalid_grant", "Refresh token emitido para outro cliente.");

    // Rotação: a sessão anterior inteira sai de circulação antes do par novo entrar.
    await ctx.repo.revogarTokensDoCliente(registro.userId, registro.clientId, ctx.agoraUtc);
    const tokens = await emitirPar(ctx, { clientId: registro.clientId, userId: registro.userId, scope: registro.scope });
    return respostaDeTokens(tokens, registro.scope);
  }

  return erroOauth(400, "unsupported_grant_type", "Use authorization_code ou refresh_token.");
}

/** Revogação (RFC 7009): responde 200 mesmo para token desconhecido, como a especificação exige. */
export async function revogarToken(ctx: ContextoOauth): Promise<Response> {
  const formulario = await lerFormulario(ctx.request);
  const token = formulario.get("token") ?? "";
  if (token) {
    const registro = await ctx.repo.buscarToken(token);
    if (registro) await ctx.repo.revogarTokensDoCliente(registro.userId, registro.clientId, ctx.agoraUtc);
  }
  return jsonOauth({}, 200);
}
