import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda de configuração: todo caminho servido pelo Worker precisa estar em
 * `assets.run_worker_first` do `wrangler.jsonc`.
 *
 * Existe porque este erro já aconteceu e nenhum teste o pegou. Com
 * `not_found_handling: "single-page-application"`, qualquer navegação HTML casa com o fallback
 * do `index.html`, então uma rota ausente daquela lista nunca chega ao Worker: `GET` abre a SPA
 * numa rota que ela não conhece e `POST` responde 405. Os testes de integração chamam os
 * handlers direto e passam felizes — o defeito só aparece rodando o servidor de verdade.
 *
 * Quando uma rota nova for adicionada ao roteador de identidade, este teste falha até que a
 * configuração acompanhe.
 */

const CAMINHOS_DO_WORKER = [
  "/entrar",
  "/sair",
  "/trocar-senha",
  "/oauth/authorize",
  "/oauth/token",
  "/oauth/register",
  "/oauth/revoke",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-authorization-server",
  "/mcp",
  "/api/me",
  "/api/me/senha",
  "/api/users",
  "/api/users/eventos",
];

/** Casa um caminho contra um padrão do `run_worker_first` (`/prefixo/*` ou literal). */
function coberto(padroes: readonly string[], caminho: string): boolean {
  return padroes.some((padrao) =>
    padrao.endsWith("/*") ? caminho.startsWith(padrao.slice(0, -1)) : padrao === caminho,
  );
}

describe("wrangler.jsonc — rotas que o Worker precisa atender antes dos assets", () => {
  const bruto = readFileSync(resolve(import.meta.dirname, "../wrangler.jsonc"), "utf-8");
  // JSONC: remove comentários de linha antes de interpretar.
  const config = JSON.parse(bruto.replace(/^\s*\/\/.*$/gm, "")) as {
    assets: { run_worker_first?: string[]; not_found_handling?: string };
  };

  it("lista todos os caminhos servidos pelo Worker", () => {
    const padroes = config.assets.run_worker_first ?? [];
    const faltando = CAMINHOS_DO_WORKER.filter((caminho) => !coberto(padroes, caminho));
    expect(faltando).toEqual([]);
  });

  it("continua servindo a SPA por fallback — é o que torna a lista necessária", () => {
    expect(config.assets.not_found_handling).toBe("single-page-application");
  });
});
