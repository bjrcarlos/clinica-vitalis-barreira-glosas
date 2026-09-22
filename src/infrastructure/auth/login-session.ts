import { deBase64Url, paraBase64Url } from "./crypto-texto";
import type { PapelSessao } from "./session";
import { isPapelSessao } from "./session";

/**
 * Sessão de navegador de uma pessoa REAL (conta com e-mail e senha), distinta do cookie de
 * identidade funcional da demonstração em `session.ts`:
 *
 * - `session.ts` responde "qual papel esta aba está exercendo" e é trocado por um seletor;
 * - este módulo responde "quem entrou", com id de usuário, nome e e-mail.
 *
 * É esta sessão que o fluxo OAuth usa para saber em nome de quem emitir o token do MCP. Ela
 * também emite o cookie funcional (mesmo papel da conta), para a interface refletir o login sem
 * precisar de uma segunda escolha.
 *
 * Mesma técnica do outro módulo: payload em base64url assinado com HMAC-SHA256
 * (`LINK_SIGNING_KEY`), verificado por `crypto.subtle.verify` (tempo constante). O valor do
 * cookie nunca é logado.
 */

export const NOME_COOKIE_LOGIN = "vitalis_login";

export interface SessaoLogin {
  readonly userId: string;
  readonly email: string;
  readonly nome: string;
  readonly papel: PapelSessao;
  readonly emitidaEmUtc: string;
  readonly expiraEmUtc: string;
}

interface PayloadLogin {
  readonly u: string;
  readonly e: string;
  readonly n: string;
  readonly p: string;
  readonly iat: string;
  readonly exp: string;
}

async function importarChave(chaveSecreta: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(chaveSecreta), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function assinarLogin(
  dados: { readonly userId: string; readonly email: string; readonly nome: string; readonly papel: PapelSessao },
  chaveSecreta: string,
  agoraUtc: string,
  duracaoMs: number,
): Promise<{ readonly valorCookie: string; readonly sessao: SessaoLogin }> {
  const expiraEmUtc = new Date(new Date(agoraUtc).getTime() + duracaoMs).toISOString();
  const payload: PayloadLogin = {
    u: dados.userId,
    e: dados.email,
    n: dados.nome,
    p: dados.papel,
    iat: agoraUtc,
    exp: expiraEmUtc,
  };
  const payloadB64 = paraBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const chave = await importarChave(chaveSecreta);
  const assinatura = new Uint8Array(await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(payloadB64)));
  return {
    valorCookie: `${payloadB64}.${paraBase64Url(assinatura)}`,
    sessao: { ...dados, emitidaEmUtc: agoraUtc, expiraEmUtc },
  };
}

/** Verifica assinatura, formato e expiração. Devolve `null` para qualquer falha — nunca lança. */
export async function verificarLogin(
  valorCookie: string,
  chaveSecreta: string,
  agoraUtc: string,
): Promise<SessaoLogin | null> {
  const separador = valorCookie.indexOf(".");
  if (separador <= 0 || separador === valorCookie.length - 1) return null;

  const payloadB64 = valorCookie.slice(0, separador);
  const assinaturaBytes = deBase64Url(valorCookie.slice(separador + 1));
  if (assinaturaBytes === null) return null;

  const chave = await importarChave(chaveSecreta);
  const valido = await crypto.subtle.verify("HMAC", chave, assinaturaBytes, new TextEncoder().encode(payloadB64));
  if (!valido) return null;

  const payloadBytes = deBase64Url(payloadB64);
  if (payloadBytes === null) return null;

  let payload: PayloadLogin;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as PayloadLogin;
  } catch {
    return null;
  }

  if (
    typeof payload.u !== "string" ||
    typeof payload.e !== "string" ||
    typeof payload.n !== "string" ||
    typeof payload.p !== "string" ||
    !isPapelSessao(payload.p) ||
    typeof payload.exp !== "string" ||
    typeof payload.iat !== "string"
  ) {
    return null;
  }

  const expiraEmMs = Date.parse(payload.exp);
  const agoraEmMs = Date.parse(agoraUtc);
  if (Number.isNaN(expiraEmMs) || Number.isNaN(agoraEmMs) || agoraEmMs > expiraEmMs) return null;

  return {
    userId: payload.u,
    email: payload.e,
    nome: payload.n,
    papel: payload.p,
    emitidaEmUtc: payload.iat,
    expiraEmUtc: payload.exp,
  };
}

/** Lê um cookie pelo nome no cabeçalho `Cookie` bruto. */
export function lerCookie(cabecalhoCookie: string | null, nome: string): string | null {
  if (cabecalhoCookie === null) return null;
  for (const parte of cabecalhoCookie.split(";")) {
    const separador = parte.indexOf("=");
    if (separador === -1) continue;
    if (parte.slice(0, separador).trim() === nome) return parte.slice(separador + 1).trim();
  }
  return null;
}

/** `Set-Cookie` da sessão de login: HttpOnly, SameSite=Lax (o retorno do OAuth é uma navegação de topo). */
export function cabecalhoSetCookieLogin(valorCookie: string, expiraEmUtc: string, seguro: boolean): string {
  const partes = [
    `${NOME_COOKIE_LOGIN}=${valorCookie}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${new Date(expiraEmUtc).toUTCString()}`,
  ];
  if (seguro) partes.push("Secure");
  return partes.join("; ");
}

/** `Set-Cookie` que apaga a sessão de login (sair). */
export function cabecalhoLimparLogin(seguro: boolean): string {
  const partes = [`${NOME_COOKIE_LOGIN}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (seguro) partes.push("Secure");
  return partes.join("; ");
}
