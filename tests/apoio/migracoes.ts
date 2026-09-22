import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

const DIRETORIO_MIGRACOES = resolve(import.meta.dirname, "../../migrations");

/**
 * Aplica TODAS as migrações, em ordem de nome, num banco de teste em memória.
 *
 * Existe porque cada teste carregava `0001_init.sql` explicitamente: quando a `0002` chegou,
 * sete testes quebraram com "no such table" sem que nada no que eles verificam tivesse mudado.
 * Ler o diretório inteiro faz o esquema de teste acompanhar o esquema real sozinho — a próxima
 * migração não vai exigir tocar em teste nenhum.
 */
export function aplicarMigracoes(db: DatabaseSync): void {
  const arquivos = readdirSync(DIRETORIO_MIGRACOES)
    .filter((nome) => nome.endsWith(".sql"))
    .sort();
  for (const arquivo of arquivos) {
    db.exec(readFileSync(resolve(DIRETORIO_MIGRACOES, arquivo), "utf-8"));
  }
}
