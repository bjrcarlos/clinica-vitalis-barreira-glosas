/**
 * Identidade funcional da demonstração (PRD-SDD §8: OAuth de produção fora de escopo).
 *
 * `POST /api/session` escolhe um papel e o servidor devolve um cookie HttpOnly assinado com
 * HMAC-SHA256 (WebCrypto) usando `LINK_SIGNING_KEY`. Todo handler de mutação deve ler o papel
 * exclusivamente por `lerPapelDaRequisicao` — nunca de um campo do corpo ou de um cabeçalho
 * livre (CLAUDE.md: "papel vem da credencial, nunca de parâmetro de entrada"). Sem cookie
 * válido, o acesso é de leitura como `DIRECAO`.
 *
 * A verificação de assinatura usa `crypto.subtle.verify`, que compara em tempo constante —
 * nunca comparação manual de string/hex. O valor do cookie nunca é logado por este módulo.
 */

const PAPEL_SESSAO_VALORES = ["SECRETARIA", "FINANCEIRO", "DIRECAO"] as const;

/** Papel funcional da sessão de demonstração. Distinto de `Area` (domínio): não existe `SISTEMA` aqui, e `DIRECAO` é exclusivo desta camada de identidade (somente leitura). */
export type PapelSessao = (typeof PAPEL_SESSAO_VALORES)[number];

/** Confirma, em tempo de execução, se um texto arbitrário é um `PapelSessao` válido. */
export function isPapelSessao(valor: string): valor is PapelSessao {
  return (PAPEL_SESSAO_VALORES as readonly string[]).includes(valor);
}

/** Papel padrão quando não há cookie de sessão válido: acesso de leitura, nunca de mutação. */
export const PAPEL_PADRAO_SEM_SESSAO: PapelSessao = "DIRECAO";

/** Nome do cookie HttpOnly que carrega a sessão assinada. */
export const NOME_COOKIE_SESSAO = "vitalis_sessao";

/** Duração padrão de uma sessão de demonstração: um turno de trabalho. */
export const DURACAO_PADRAO_SESSAO_MS = 12 * 60 * 60 * 1000;

/** Conteúdo decodificado e verificado de uma sessão assinada. */
export interface SessaoAssinada {
  readonly papel: PapelSessao;
  readonly emitidaEmUtc: string;
  readonly expiraEmUtc: string;
}

interface PayloadSessao {
  readonly p: string;
  readonly iat: string;
  readonly exp: string;
}

function codificarBase64Url(bytes: Uint8Array): string {
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodificarBase64Url(texto: string): Uint8Array<ArrayBuffer> | null {
  try {
    const normalizado = texto.replace(/-/g, "+").replace(/_/g, "/");
    const comPreenchimento = normalizado.padEnd(
      normalizado.length + ((4 - (normalizado.length % 4)) % 4),
      "=",
    );
    const binario = atob(comPreenchimento);
    return Uint8Array.from(binario, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function importarChave(chaveSecreta: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(chaveSecreta),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
 * Assina um novo cookie de sessão para `papel`, válido a partir de `agoraUtc` pela duração
 * informada. `agoraUtc` é sempre recebido, nunca lido implicitamente (mesma disciplina de
 * relógio do resto do sistema, ainda que esta camada HTTP não seja domínio puro).
 */
export async function assinarSessao(
  papel: PapelSessao,
  chaveSecreta: string,
  agoraUtc: string,
  duracaoMs: number = DURACAO_PADRAO_SESSAO_MS,
): Promise<{ readonly valorCookie: string; readonly sessao: SessaoAssinada }> {
  const expiraEmUtc = new Date(new Date(agoraUtc).getTime() + duracaoMs).toISOString();
  const payload: PayloadSessao = { p: papel, iat: agoraUtc, exp: expiraEmUtc };
  const payloadB64 = codificarBase64Url(new TextEncoder().encode(JSON.stringify(payload)));

  const chave = await importarChave(chaveSecreta);
  const assinaturaBytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(payloadB64)),
  );
  const assinaturaB64 = codificarBase64Url(assinaturaBytes);

  return {
    valorCookie: `${payloadB64}.${assinaturaB64}`,
    sessao: { papel, emitidaEmUtc: agoraUtc, expiraEmUtc },
  };
}

/**
 * Verifica um valor de cookie de sessão: assinatura (tempo constante via `crypto.subtle.verify`),
 * formato do payload e expiração. Devolve `null` para qualquer falha — nunca lança, nunca loga
 * o valor recebido.
 */
export async function verificarSessao(
  valorCookie: string,
  chaveSecreta: string,
  agoraUtc: string,
): Promise<SessaoAssinada | null> {
  const separador = valorCookie.indexOf(".");
  if (separador <= 0 || separador === valorCookie.length - 1) return null;

  const payloadB64 = valorCookie.slice(0, separador);
  const assinaturaB64 = valorCookie.slice(separador + 1);

  const assinaturaBytes = decodificarBase64Url(assinaturaB64);
  if (assinaturaBytes === null) return null;

  const chave = await importarChave(chaveSecreta);
  const valido = await crypto.subtle.verify(
    "HMAC",
    chave,
    assinaturaBytes,
    new TextEncoder().encode(payloadB64),
  );
  if (!valido) return null;

  const payloadBytes = decodificarBase64Url(payloadB64);
  if (payloadBytes === null) return null;

  let payload: PayloadSessao;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as PayloadSessao;
  } catch {
    return null;
  }

  if (
    typeof payload.p !== "string" ||
    !isPapelSessao(payload.p) ||
    typeof payload.iat !== "string" ||
    typeof payload.exp !== "string"
  ) {
    return null;
  }

  const expiraEmMs = Date.parse(payload.exp);
  const agoraEmMs = Date.parse(agoraUtc);
  if (Number.isNaN(expiraEmMs) || Number.isNaN(agoraEmMs) || agoraEmMs > expiraEmMs) {
    return null;
  }

  return { papel: payload.p, emitidaEmUtc: payload.iat, expiraEmUtc: payload.exp };
}

/** Extrai o valor de um cookie pelo nome do cabeçalho `Cookie` bruto da requisição. */
function lerValorDoCookie(cabecalhoCookie: string | null, nome: string): string | null {
  if (cabecalhoCookie === null) return null;
  for (const parte of cabecalhoCookie.split(";")) {
    const separador = parte.indexOf("=");
    if (separador === -1) continue;
    const chave = parte.slice(0, separador).trim();
    if (chave === nome) return parte.slice(separador + 1).trim();
  }
  return null;
}

/**
 * Deriva o papel funcional de uma requisição a partir do cookie de sessão assinado — a única
 * fonte de identidade que um handler de mutação pode usar. Nunca lança: qualquer ausência ou
 * falha (sem cookie, sem `LINK_SIGNING_KEY` configurada, assinatura inválida, payload malformado,
 * sessão expirada) resolve para `DIRECAO` (leitura), nunca para um papel de escrita.
 */
export async function lerPapelDaRequisicao(
  request: Request,
  chaveSecreta: string | undefined,
  agoraUtc: string,
): Promise<PapelSessao> {
  if (!chaveSecreta) return PAPEL_PADRAO_SEM_SESSAO;

  const valorCookie = lerValorDoCookie(request.headers.get("cookie"), NOME_COOKIE_SESSAO);
  if (valorCookie === null) return PAPEL_PADRAO_SEM_SESSAO;

  const sessao = await verificarSessao(valorCookie, chaveSecreta, agoraUtc);
  return sessao?.papel ?? PAPEL_PADRAO_SEM_SESSAO;
}

/**
 * Monta o cabeçalho `Set-Cookie` para entregar uma sessão recém-assinada. `seguro` deve
 * refletir se a requisição chegou por HTTPS (`Secure` quebra cookies em `wrangler dev` local
 * por HTTP simples quando forçado incondicionalmente).
 */
export function construirCabecalhoSetCookie(
  valorCookie: string,
  expiraEmUtc: string,
  seguro: boolean,
): string {
  const atributos = [
    `${NOME_COOKIE_SESSAO}=${valorCookie}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${new Date(expiraEmUtc).toUTCString()}`,
  ];
  if (seguro) atributos.push("Secure");
  return atributos.join("; ");
}

/** Cabeçalho `Set-Cookie` que apaga imediatamente a sessão (expiração no passado, valor vazio). */
export function construirCabecalhoLimparCookie(seguro: boolean): string {
  const atributos = [
    `${NOME_COOKIE_SESSAO}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (seguro) atributos.push("Secure");
  return atributos.join("; ");
}
