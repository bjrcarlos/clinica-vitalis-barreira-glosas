import { z } from "zod";
import { segredoAleatorio } from "../../../infrastructure/auth/crypto-texto";
import { redirectUriAceitavel } from "../../../infrastructure/auth/oauth";
import type { ContextoOauth } from "./comum";
import { erroOauth, jsonOauth } from "./comum";

/**
 * Registro dinâmico de cliente (RFC 7591). É a peça que torna verdadeira a promessa de
 * "só colar o comando": o Claude Code, o Codex ou outro cliente MCP se cadastram sozinhos aqui,
 * sem ninguém criar aplicativo em painel nem copiar `client_id` à mão.
 *
 * Todo cliente é PÚBLICO (`token_endpoint_auth_method: "none"`) e obrigado a usar PKCE — é o
 * modelo correto para um programa que roda na máquina da pessoa e não consegue guardar segredo.
 */

const esquemaRegistro = z.object({
  client_name: z.string().trim().min(1).max(120).optional(),
  redirect_uris: z.array(z.string().url()).min(1).max(10),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
  scope: z.string().optional(),
});

export async function registrarCliente(ctx: ContextoOauth): Promise<Response> {
  let corpo: unknown;
  try {
    corpo = await ctx.request.json();
  } catch {
    return erroOauth(400, "invalid_client_metadata", "Corpo do registro não é JSON válido.");
  }

  const analisado = esquemaRegistro.safeParse(corpo);
  if (!analisado.success) {
    return erroOauth(400, "invalid_client_metadata", "Informe redirect_uris com pelo menos um endereço válido.");
  }

  const recusada = analisado.data.redirect_uris.find((uri) => !redirectUriAceitavel(uri));
  if (recusada) {
    return erroOauth(400, "invalid_redirect_uri", "Só aceitamos https ou endereço local (127.0.0.1/localhost).");
  }

  const metodo = analisado.data.token_endpoint_auth_method ?? "none";
  if (metodo !== "none") {
    return erroOauth(400, "invalid_client_metadata", "Este servidor registra apenas clientes públicos (token_endpoint_auth_method=none).");
  }

  const clientId = `vitalis-${segredoAleatorio(18)}`;
  const grantTypes = analisado.data.grant_types ?? ["authorization_code", "refresh_token"];

  await ctx.repo.registrarCliente(
    {
      id: clientId,
      nome: analisado.data.client_name ?? "Assistente de IA",
      redirectUris: analisado.data.redirect_uris,
      grantTypes,
    },
    ctx.agoraUtc,
  );

  return jsonOauth(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.parse(ctx.agoraUtc) / 1000),
      client_name: analisado.data.client_name ?? "Assistente de IA",
      redirect_uris: analisado.data.redirect_uris,
      grant_types: grantTypes,
      response_types: analisado.data.response_types ?? ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  );
}
