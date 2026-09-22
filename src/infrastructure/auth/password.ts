import { deBase64Url, iguaisEmTempoConstante, paraBase64Url, segredoAleatorio } from "./crypto-texto";

/**
 * Senha de conta: PBKDF2-SHA256 via WebCrypto, o único derivador de chave disponível no runtime
 * dos Workers (não há Argon2/bcrypt nativo). Senha nunca é gravada em claro nem aparece em log.
 *
 * O número de iterações fica GUARDADO JUNTO com o hash (`senha_iteracoes`), não fixo no código:
 * é o que permite aumentar o custo no futuro sem invalidar as senhas já cadastradas — cada hash
 * é verificado com o custo que tinha quando foi criado.
 */

/** Custo atual de novas senhas. Abaixo do recomendado para senha humana de produção (600k), escolhido para caber no limite de CPU de uma requisição de Worker. */
export const ITERACOES_PADRAO = 100_000;

export interface SenhaArmazenada {
  readonly hash: string;
  readonly salt: string;
  readonly iteracoes: number;
}

async function derivar(senha: string, saltBytes: Uint8Array, iteracoes: number): Promise<string> {
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes as unknown as BufferSource, iterations: iteracoes, hash: "SHA-256" },
    chave,
    256,
  );
  return paraBase64Url(new Uint8Array(bits));
}

/** Deriva o hash de uma senha nova, com salt aleatório próprio. */
export async function criarSenha(senha: string, iteracoes: number = ITERACOES_PADRAO): Promise<SenhaArmazenada> {
  const salt = segredoAleatorio(16);
  const saltBytes = deBase64Url(salt);
  if (!saltBytes) throw new Error("Falha ao gerar salt de senha.");
  return { hash: await derivar(senha, saltBytes, iteracoes), salt, iteracoes };
}

/**
 * Confere uma senha contra o que está guardado. Devolve `false` (nunca lança) para salt corrompido:
 * do ponto de vista de quem tenta entrar, conta quebrada e senha errada são a mesma coisa.
 */
export async function conferirSenha(senha: string, armazenada: SenhaArmazenada): Promise<boolean> {
  const saltBytes = deBase64Url(armazenada.salt);
  if (!saltBytes) return false;
  const derivado = await derivar(senha, saltBytes, armazenada.iteracoes);
  return iguaisEmTempoConstante(derivado, armazenada.hash);
}
