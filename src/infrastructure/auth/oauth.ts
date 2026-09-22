import { hashSha256, iguaisEmTempoConstante } from "./crypto-texto";

/**
 * Peças do OAuth 2.1 que não dependem de banco nem de `Request`: validação de PKCE, de
 * `redirect_uri` e os dois documentos de descoberta. Ficam separadas para serem testadas sem
 * subir Worker nem D1 — é onde moram as decisões que, se erradas, viram falha de segurança.
 *
 * Desenho: clientes PÚBLICOS (sem secret), registrados dinamicamente (RFC 7591), com PKCE S256
 * obrigatório. É o que permite ao Claude Code e ao Codex se conectarem sem ninguém copiar
 * token à mão — e o que impede que um código interceptado seja trocado por outro cliente.
 */

/** Validade do código de autorização: curta por definição, ele é trocado por token em segundos. */
export const VALIDADE_CODIGO_MS = 5 * 60 * 1000;
/** Validade do access token. Expirado, o cliente usa o refresh sem incomodar a pessoa. */
export const VALIDADE_ACCESS_MS = 60 * 60 * 1000;
/** Validade do refresh token: um mês, rotacionado a cada uso. */
export const VALIDADE_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
/** Duração da sessão de navegador usada durante o fluxo (mesma janela da sessão da interface). */
export const VALIDADE_LOGIN_MS = 12 * 60 * 60 * 1000;

export const ESCOPO_PADRAO = "vitalis.mcp";

/**
 * Confere o PKCE (RFC 7636, método S256): `code_challenge` tem que ser o SHA-256 em base64url do
 * `code_verifier` que o cliente guardou. Só S256 — `plain` não é aceito em lugar nenhum.
 */
export async function pkceConfere(codeVerifier: string, codeChallenge: string): Promise<boolean> {
  if (codeVerifier.length < 43 || codeVerifier.length > 128) return false;
  const calculado = await hashSha256(codeVerifier);
  return iguaisEmTempoConstante(calculado, codeChallenge);
}

/**
 * `redirect_uri` precisa bater EXATAMENTE com uma das registradas — sem prefixo, sem curinga.
 * Comparação frouxa aqui é o caminho clássico para roubo de código de autorização.
 */
export function redirectUriPermitida(registradas: readonly string[], solicitada: string): boolean {
  return registradas.some((registrada) => registrada === solicitada);
}

/**
 * Cliente de IA registrando-se sozinho declara suas URLs de retorno. Aceitamos apenas HTTPS ou
 * loopback (`http://127.0.0.1`/`http://localhost`, que é como os CLIs recebem o retorno) — nunca
 * `http://` de um host qualquer, que trafegaria o código em claro.
 */
export function redirectUriAceitavel(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
}

/** Metadata do recurso protegido (RFC 9728): diz ao cliente QUEM autoriza o acesso a `/mcp`. */
export function metadataRecursoProtegido(origem: string): Record<string, unknown> {
  return {
    resource: `${origem}/mcp`,
    authorization_servers: [origem],
    scopes_supported: [ESCOPO_PADRAO],
    bearer_methods_supported: ["header"],
    resource_name: "Barreira de Glosas — Clínica Vitalis",
    resource_documentation: `${origem}/conectar`,
  };
}

/** Metadata do servidor de autorização (RFC 8414): os endereços que o cliente usa sozinho. */
export function metadataServidorAutorizacao(origem: string): Record<string, unknown> {
  return {
    issuer: origem,
    authorization_endpoint: `${origem}/oauth/authorize`,
    token_endpoint: `${origem}/oauth/token`,
    registration_endpoint: `${origem}/oauth/register`,
    revocation_endpoint: `${origem}/oauth/revoke`,
    scopes_supported: [ESCOPO_PADRAO],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    service_documentation: `${origem}/conectar`,
  };
}

/** Cabeçalho que dispara a descoberta no cliente quando o Bearer falta ou não serve (RFC 9728 §5.1). */
export function desafioBearer(origem: string, erro?: string, descricao?: string): string {
  const partes = [`Bearer resource_metadata="${origem}/.well-known/oauth-protected-resource"`];
  if (erro) partes.push(`error="${erro}"`);
  if (descricao) partes.push(`error_description="${descricao.replace(/"/g, "'")}"`);
  return partes.join(", ");
}
