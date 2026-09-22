/**
 * Conversões de texto/bytes usadas pelo OAuth e pelo armazenamento de senha. Isoladas aqui para
 * que `password.ts` e `oauth.ts` não repitam base64url — e para serem testáveis sozinhas.
 */

export function paraBase64Url(bytes: Uint8Array): string {
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function deBase64Url(texto: string): Uint8Array<ArrayBuffer> | null {
  try {
    const normalizado = texto.replace(/-/g, "+").replace(/_/g, "/");
    const comPreenchimento = normalizado.padEnd(normalizado.length + ((4 - (normalizado.length % 4)) % 4), "=");
    return Uint8Array.from(atob(comPreenchimento), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Bytes aleatórios criptograficamente fortes, já em base64url — formato de todo segredo emitido aqui. */
export function segredoAleatorio(bytes = 32): string {
  return paraBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/**
 * SHA-256 em base64url. É assim que código de autorização e token são guardados: o banco nunca
 * vê o valor original, então um vazamento de banco não vira sessão ativa.
 */
export async function hashSha256(valor: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(valor));
  return paraBase64Url(new Uint8Array(digest));
}

/**
 * Comparação de dois textos em tempo constante. Percorre sempre o mesmo número de posições para
 * não vazar, pelo tempo de resposta, quantos caracteres iniciais bateram.
 */
export function iguaisEmTempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i += 1) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}
