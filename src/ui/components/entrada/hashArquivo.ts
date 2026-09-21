/**
 * SHA-256 de um arquivo, calculado no navegador (Web Crypto) — RF-01 exige mostrar o hash do
 * arquivo antes de confirmar a importação. Puro em relação ao domínio (não decide nada), só
 * usa uma API de plataforma que não existe em `src/domain`/`src/rules`.
 */
export async function calcularSha256Hex(arquivo: File): Promise<string> {
  const bytes = await arquivo.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** `a41f2c9e…d07b3a5f` — hash inteiro só no `title`, forma curta na tela (docs/DESIGN.md, `.mono`). */
export function truncarHash(hashHex: string): string {
  if (hashHex.length <= 12) return hashHex;
  return `${hashHex.slice(0, 4)}…${hashHex.slice(-4)}`;
}
