import { DatabaseSync } from "node:sqlite";
import { randomUUID, webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { aplicarMigracoes } from "./apoio/migracoes";
import { D1SobreSqlite } from "./apoio/d1-sqlite";
import { manipularIdentidade } from "../src/http/handlers/oauth/index";
import { manipularMcp } from "../src/mcp/server";
import { criarSenha } from "../src/infrastructure/auth/password";
import { pkceConfere, redirectUriAceitavel, redirectUriPermitida } from "../src/infrastructure/auth/oauth";
import { assinarLogin, verificarLogin } from "../src/infrastructure/auth/login-session";
import { destinoInternoSeguro } from "../src/http/handlers/oauth/login";
import type { Env } from "../src/worker/index";

/**
 * OAuth 2.1 do MCP (Fase 6): login individual, autorização com PKCE, emissão de token e as
 * permissões por papel que esse token passa a carregar.
 *
 * O que estes testes existem para impedir, em ordem de gravidade:
 *
 * 1. um código de autorização valer duas vezes;
 * 2. um código valer sem o `code_verifier` correto (PKCE contornado);
 * 3. `redirect_uri` não registrada receber código;
 * 4. papel vir de outro lugar que não a conta autenticada;
 * 5. sessão assinada aceitar payload adulterado ou expirado.
 */

const CHAVE = "chave-de-teste-oauth-1234567890";
const REDIRECT = "http://127.0.0.1:53210/callback";

let banco: DatabaseSync;
let env: Env;

async function criarConta(email: string, papel: string, senha: string): Promise<string> {
  const armazenada = await criarSenha(senha, 1_000);
  const id = randomUUID();
  const agora = new Date().toISOString();
  banco
    .prepare(
      "INSERT INTO users (id, email, nome, papel, senha_hash, senha_salt, senha_iteracoes, ativo, created_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
    )
    .run(id, email, `Pessoa ${papel}`, papel, armazenada.hash, armazenada.salt, armazenada.iteracoes, agora, agora);
  return id;
}

const base64Url = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function pkce() {
  const verifier = base64Url(webcrypto.getRandomValues(new Uint8Array(32)));
  const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

function requisicao(caminho: string, init: RequestInit = {}): Request {
  return new Request(`https://vitalis.example${caminho}`, init);
}

function formulario(dados: Record<string, string>, cookie?: string): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) },
    body: new URLSearchParams(dados).toString(),
  };
}

async function registrarCliente(nome = "Cliente de Teste"): Promise<string> {
  const resposta = await manipularIdentidade(
    requisicao("/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: nome, redirect_uris: [REDIRECT] }),
    }),
    env,
  );
  const corpo = (await resposta!.json()) as { client_id: string };
  return corpo.client_id;
}

/** Percorre login + consentimento e devolve o código de autorização emitido. */
async function obterCodigo(clientId: string, challenge: string, email: string, senha: string): Promise<string> {
  const campos = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "vitalis.mcp",
    state: "abc",
  };

  const login = await manipularIdentidade(requisicao("/oauth/authorize", formulario({ ...campos, acao: "entrar", email, senha })), env);
  const cookie = (login!.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

  const decisao = await manipularIdentidade(
    requisicao("/oauth/authorize", formulario({ ...campos, acao: "autorizar", decisao: "permitir" }, cookie)),
    env,
  );
  return new URL(decisao!.headers.get("location")!).searchParams.get("code")!;
}

async function trocarPorToken(dados: Record<string, string>): Promise<Record<string, string>> {
  const resposta = await manipularIdentidade(requisicao("/oauth/token", formulario(dados)), env);
  return (await resposta!.json()) as Record<string, string>;
}

async function chamarMcp(token: string | null, nome: string, argumentos: Record<string, unknown> = {}): Promise<Response> {
  return manipularMcp(
    requisicao("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: nome, arguments: argumentos } }),
    }),
    env,
  );
}

async function textoDaTool(resposta: Response): Promise<string> {
  const bruto = await resposta.text();
  const linha = bruto.split("\n").find((l) => l.startsWith("data: "));
  const corpo = JSON.parse(linha!.slice(6)) as { result?: { content?: Array<{ text: string }> } };
  return corpo.result?.content?.map((c) => c.text).join("") ?? bruto;
}

/** O objeto de `structuredContent` da resposta da tool. */
async function dadoDaTool(resposta: Response): Promise<Record<string, unknown>> {
  const bruto = await resposta.text();
  const linha = bruto.split("\n").find((l) => l.startsWith("data: "));
  const corpo = JSON.parse(linha!.slice(6)) as { result?: { structuredContent?: Record<string, unknown> } };
  return corpo.result?.structuredContent ?? {};
}

beforeEach(async () => {
  banco = new DatabaseSync(":memory:");
  aplicarMigracoes(banco);
  env = {
    DB: new D1SobreSqlite(banco) as unknown as D1Database,
    EVIDENCE: {} as R2Bucket,
    AI: {} as Ai,
    ASSETS: {} as Fetcher,
    LINK_SIGNING_KEY: CHAVE,
  } as Env;
  await criarConta("secretaria@vitalis.example", "SECRETARIA", "senha-secretaria");
  await criarConta("direcao@vitalis.example", "DIRECAO", "senha-direcao");
});

describe("peças puras do OAuth", () => {
  it("PKCE S256 aceita o verifier certo e recusa o errado", async () => {
    const { verifier, challenge } = await pkce();
    expect(await pkceConfere(verifier, challenge)).toBe(true);
    expect(await pkceConfere(base64Url(webcrypto.getRandomValues(new Uint8Array(32))), challenge)).toBe(false);
  });

  it("recusa verifier curto demais, mesmo que o hash batesse", async () => {
    const curto = "abc";
    const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(curto));
    expect(await pkceConfere(curto, base64Url(new Uint8Array(digest)))).toBe(false);
  });

  it("redirect_uri precisa bater exatamente, sem prefixo", () => {
    const registradas = ["http://127.0.0.1:53210/callback"];
    expect(redirectUriPermitida(registradas, "http://127.0.0.1:53210/callback")).toBe(true);
    expect(redirectUriPermitida(registradas, "http://127.0.0.1:53210/callback/extra")).toBe(false);
    expect(redirectUriPermitida(registradas, "http://127.0.0.1:53211/callback")).toBe(false);
  });

  it("aceita https e loopback no registro; recusa http de host qualquer", () => {
    expect(redirectUriAceitavel("https://app.exemplo/callback")).toBe(true);
    expect(redirectUriAceitavel("http://localhost:1234/cb")).toBe(true);
    expect(redirectUriAceitavel("http://site-do-atacante.example/cb")).toBe(false);
    expect(redirectUriAceitavel("nao-e-url")).toBe(false);
  });

  it("só redireciona para destino interno depois do login", () => {
    expect(destinoInternoSeguro("/pendencias")).toBe("/pendencias");
    expect(destinoInternoSeguro("//site-externo.example")).toBe("/");
    expect(destinoInternoSeguro("https://site-externo.example")).toBe("/");
    expect(destinoInternoSeguro(null)).toBe("/");
  });

  it("sessão de login rejeita payload adulterado e sessão expirada", async () => {
    const agora = "2026-09-22T12:00:00.000Z";
    const { valorCookie } = await assinarLogin(
      { userId: "u1", email: "a@b.example", nome: "Pessoa", papel: "SECRETARIA" },
      CHAVE,
      agora,
      60_000,
    );
    expect(await verificarLogin(valorCookie, CHAVE, agora)).not.toBeNull();

    const [payload, assinatura] = valorCookie.split(".");
    const adulterado = `${Buffer.from(JSON.stringify({ u: "u1", e: "a@b.example", n: "Pessoa", p: "DIRECAO", iat: agora, exp: "2030-01-01T00:00:00.000Z" })).toString("base64url")}.${assinatura}`;
    expect(await verificarLogin(adulterado, CHAVE, agora)).toBeNull();
    expect(await verificarLogin(`${payload}.${assinatura}`, "outra-chave-qualquer-123456", agora)).toBeNull();
    expect(await verificarLogin(valorCookie, CHAVE, "2026-09-23T12:00:00.000Z")).toBeNull();
  });
});

describe("fluxo de autorização", () => {
  it("emite token para quem entrou e o papel do token é o da conta", async () => {
    const clientId = await registrarCliente();
    const { verifier, challenge } = await pkce();
    const codigo = await obterCodigo(clientId, challenge, "secretaria@vitalis.example", "senha-secretaria");

    const tokens = await trocarPorToken({
      grant_type: "authorization_code",
      code: codigo,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    });
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.token_type).toBe("Bearer");

    const dado = await dadoDaTool(await chamarMcp(tokens.access_token, "minhas_pendencias"));
    expect(dado.area).toBe("SECRETARIA");
  });

  it("código de autorização não vale duas vezes", async () => {
    const clientId = await registrarCliente();
    const { verifier, challenge } = await pkce();
    const codigo = await obterCodigo(clientId, challenge, "secretaria@vitalis.example", "senha-secretaria");
    const comum = { grant_type: "authorization_code", code: codigo, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier };

    expect((await trocarPorToken(comum)).access_token).toBeTruthy();
    expect((await trocarPorToken(comum)).error).toBe("invalid_grant");
  });

  it("código não vale com code_verifier errado", async () => {
    const clientId = await registrarCliente();
    const { challenge } = await pkce();
    const codigo = await obterCodigo(clientId, challenge, "secretaria@vitalis.example", "senha-secretaria");

    const resultado = await trocarPorToken({
      grant_type: "authorization_code",
      code: codigo,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: base64Url(webcrypto.getRandomValues(new Uint8Array(32))),
    });
    expect(resultado.error).toBe("invalid_grant");
  });

  it("código não vale para outro cliente nem para outra redirect_uri", async () => {
    const clientId = await registrarCliente();
    const outroCliente = await registrarCliente("Outro");
    const { verifier, challenge } = await pkce();
    const codigo = await obterCodigo(clientId, challenge, "secretaria@vitalis.example", "senha-secretaria");

    expect(
      (await trocarPorToken({ grant_type: "authorization_code", code: codigo, client_id: outroCliente, redirect_uri: REDIRECT, code_verifier: verifier }))
        .error,
    ).toBe("invalid_grant");
    expect(
      (
        await trocarPorToken({
          grant_type: "authorization_code",
          code: codigo,
          client_id: clientId,
          redirect_uri: "http://127.0.0.1:53210/outro",
          code_verifier: verifier,
        })
      ).error,
    ).toBe("invalid_grant");
  });

  it("senha errada não emite sessão", async () => {
    const clientId = await registrarCliente();
    const { challenge } = await pkce();
    const resposta = await manipularIdentidade(
      requisicao(
        "/oauth/authorize",
        formulario({
          response_type: "code",
          client_id: clientId,
          redirect_uri: REDIRECT,
          code_challenge: challenge,
          code_challenge_method: "S256",
          acao: "entrar",
          email: "secretaria@vitalis.example",
          senha: "senha-errada",
        }),
      ),
      env,
    );
    expect(resposta!.status).toBe(401);
    expect((resposta!.headers.getSetCookie?.() ?? []).join()).not.toContain("vitalis_login");
  });

  it("redirect_uri não registrada é recusada sem redirecionar", async () => {
    const clientId = await registrarCliente();
    const { challenge } = await pkce();
    const resposta = await manipularIdentidade(
      requisicao(
        `/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent("https://atacante.example/roubo")}&code_challenge=${challenge}&code_challenge_method=S256`,
      ),
      env,
    );
    expect(resposta!.status).toBe(400);
    expect(resposta!.headers.get("location")).toBeNull();
  });

  it("refresh rotaciona: o access anterior para de valer", async () => {
    const clientId = await registrarCliente();
    const { verifier, challenge } = await pkce();
    const codigo = await obterCodigo(clientId, challenge, "direcao@vitalis.example", "senha-direcao");
    const primeiro = await trocarPorToken({
      grant_type: "authorization_code",
      code: codigo,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    });

    const renovado = await trocarPorToken({ grant_type: "refresh_token", refresh_token: primeiro.refresh_token, client_id: clientId });
    expect(renovado.access_token).toBeTruthy();
    expect((await chamarMcp(primeiro.access_token, "consultar_regra", { convenio: "Vitalcard" })).status).toBe(401);
  });
});

describe("papel do token manda no MCP", () => {
  async function tokenDe(email: string, senha: string): Promise<string> {
    const clientId = await registrarCliente();
    const { verifier, challenge } = await pkce();
    const codigo = await obterCodigo(clientId, challenge, email, senha);
    const tokens = await trocarPorToken({
      grant_type: "authorization_code",
      code: codigo,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    });
    return tokens.access_token;
  }

  it("Direção não tem fila e recebe explicação, não uma lista vazia", async () => {
    const texto = await textoDaTool(await chamarMcp(await tokenDe("direcao@vitalis.example", "senha-direcao"), "minhas_pendencias"));
    expect(texto).toContain("não tem fila própria");
  });

  it("consultar_relatorio é exclusivo da Direção", async () => {
    const daSecretaria = await textoDaTool(await chamarMcp(await tokenDe("secretaria@vitalis.example", "senha-secretaria"), "consultar_relatorio"));
    expect(daSecretaria).toContain("Somente a Direção");

    const daDirecao = await dadoDaTool(await chamarMcp(await tokenDe("direcao@vitalis.example", "senha-direcao"), "consultar_relatorio"));
    expect(daDirecao.regras_aplicadas).toBeDefined();
  });

  it("registrar_guia continua exclusivo da Secretaria, agora por conta", async () => {
    const resposta = await chamarMcp(await tokenDe("direcao@vitalis.example", "senha-direcao"), "registrar_guia", {
      id_guia_origem: "G-TESTE-OAUTH",
      guia: {
        id_guia: "G-TESTE-OAUTH",
        unidade: "Centro",
        data_atendimento: "2026-09-01",
        paciente: "P-1",
        convenio: "Vitalcard",
        carteirinha: "VC-1",
        cid: "M79.7",
        procedimento_codigo: "50000470",
        procedimento_descricao: "Sessão",
        numero_autorizacao: "AUT-1",
        autorizacao_validade: "2026-09-20",
        autorizacao_sessoes_limite: "10",
        sessao_numero_na_autorizacao: "1",
        profissional: "Ana",
        profissional_registro: "CREFITO-1",
        valor: "62,00",
        observacao_recepcao: "",
        data_lancamento: "2026-09-01",
      },
    });
    expect(await textoDaTool(resposta)).toContain("Somente a Secretaria");
  });

  it("sem Bearer, /mcp responde 401 e diz onde autenticar", async () => {
    const resposta = await chamarMcp(null, "consultar_regra", { convenio: "Vitalcard" });
    expect(resposta.status).toBe(401);
    expect(resposta.headers.get("www-authenticate")).toContain("resource_metadata");
  });

  it("token revogado deixa de valer no MCP", async () => {
    const token = await tokenDe("secretaria@vitalis.example", "senha-secretaria");
    expect((await chamarMcp(token, "consultar_regra", { convenio: "Vitalcard" })).status).toBe(200);

    await manipularIdentidade(requisicao("/oauth/revoke", formulario({ token })), env);
    expect((await chamarMcp(token, "consultar_regra", { convenio: "Vitalcard" })).status).toBe(401);
  });
});

describe("descoberta", () => {
  it("publica os dois documentos que o cliente usa para se conectar sozinho", async () => {
    const recurso = (await (await manipularIdentidade(requisicao("/.well-known/oauth-protected-resource"), env))!.json()) as Record<string, unknown>;
    expect(recurso.resource).toBe("https://vitalis.example/mcp");
    expect(recurso.authorization_servers).toEqual(["https://vitalis.example"]);

    const servidor = (await (await manipularIdentidade(requisicao("/.well-known/oauth-authorization-server"), env))!.json()) as Record<string, unknown>;
    expect(servidor.registration_endpoint).toBe("https://vitalis.example/oauth/register");
    expect(servidor.code_challenge_methods_supported).toEqual(["S256"]);
  });
});
