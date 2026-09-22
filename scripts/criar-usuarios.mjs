#!/usr/bin/env node
/**
 * Gera o SQL das contas de acesso (Secretaria, Financeiro, Direção) com senha já derivada.
 *
 * A senha NUNCA entra no SQL nem no repositório: o arquivo gerado leva apenas o hash PBKDF2, o
 * salt e o número de iterações. As senhas em claro são impressas uma única vez aqui e gravadas
 * em `.secrets.local.md` (ignorado pelo Git), que é onde este projeto já guarda credencial local.
 *
 * Uso:
 *   node scripts/criar-usuarios.mjs                 # senhas aleatórias
 *   node scripts/criar-usuarios.mjs --senha SENHA   # mesma senha para as três contas
 *
 * Depois, aplique o SQL gerado:
 *   pnpm exec wrangler d1 execute vitalis-glosas --local --file <arquivo>
 *   pnpm exec wrangler d1 execute vitalis-glosas --remote --file <arquivo>
 */
import { writeFileSync, appendFileSync, existsSync } from "node:fs";
import { randomUUID, webcrypto } from "node:crypto";
import { resolve } from "node:path";

const cripto = webcrypto;
const ITERACOES = 100_000;

const CONTAS = [
  { email: "secretaria@vitalis.example", nome: "Ana Prado", papel: "SECRETARIA" },
  { email: "financeiro@vitalis.example", nome: "Carla Menezes", papel: "FINANCEIRO" },
  { email: "direcao@vitalis.example", nome: "Dr. Renato Vilela", papel: "DIRECAO" },
];

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Senha legível de digitar e forte o suficiente: 16 caracteres sem os que se confundem (0/O, 1/l). */
function senhaAleatoria() {
  const alfabeto = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = cripto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join("");
}

async function derivar(senha, saltBytes) {
  const chave = await cripto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await cripto.subtle.deriveBits({ name: "PBKDF2", salt: saltBytes, iterations: ITERACOES, hash: "SHA-256" }, chave, 256);
  return base64Url(new Uint8Array(bits));
}

const indiceSenha = process.argv.indexOf("--senha");
const senhaFixa = indiceSenha !== -1 ? process.argv[indiceSenha + 1] : null;

const agora = new Date().toISOString();
const linhasSql = [
  "-- Contas de acesso. Gerado por scripts/criar-usuarios.mjs — não contém senha em claro.",
  "-- Reaplicar é seguro: a linha existente é substituída pelo e-mail (chave única).",
];
const paraSegredos = [];

for (const conta of CONTAS) {
  const senha = senhaFixa ?? senhaAleatoria();
  const saltBytes = cripto.getRandomValues(new Uint8Array(16));
  const salt = base64Url(saltBytes);
  const hash = await derivar(senha, saltBytes);
  const id = randomUUID();

  // `ON CONFLICT` em vez de DELETE+INSERT: apagar a linha quebraria as chaves estrangeiras dos
  // tokens OAuth já emitidos para aquela pessoa. Assim o id da conta é preservado e trocar a
  // senha não derruba nada que já esteja conectado.
  linhasSql.push(
    `INSERT INTO users (id, email, nome, papel, senha_hash, senha_salt, senha_iteracoes, ativo, created_at_utc, updated_at_utc)`,
    `VALUES ('${id}', '${conta.email}', '${conta.nome.replace(/'/g, "''")}', '${conta.papel}', '${hash}', '${salt}', ${ITERACOES}, 1, '${agora}', '${agora}')`,
    `ON CONFLICT(email) DO UPDATE SET nome = excluded.nome, papel = excluded.papel, senha_hash = excluded.senha_hash, senha_salt = excluded.senha_salt, senha_iteracoes = excluded.senha_iteracoes, ativo = 1, updated_at_utc = excluded.updated_at_utc;`,
  );
  paraSegredos.push(`- \`${conta.email}\` (${conta.papel}): \`${senha}\``);
}

const destinoSql = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : resolve("usuarios.local.sql");
writeFileSync(destinoSql, linhasSql.join("\n") + "\n", "utf8");

const arquivoSegredos = resolve(".secrets.local.md");
if (existsSync(arquivoSegredos)) {
  appendFileSync(
    arquivoSegredos,
    `\n## Contas de acesso (geradas em ${agora})\n\nEntre em \`/entrar\`. O papel da conta vale para a interface e para o MCP.\n\n${paraSegredos.join("\n")}\n`,
    "utf8",
  );
}

console.log(`SQL escrito em ${destinoSql}`);
console.log(existsSync(arquivoSegredos) ? "Senhas anexadas em .secrets.local.md" : "Aviso: .secrets.local.md não existe; as senhas estão só abaixo.");
console.log("");
for (const linha of paraSegredos) console.log(linha.replace(/^- /, "  "));
