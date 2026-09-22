import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { aplicarMigracoes } from "./apoio/migracoes";
import { D1SobreSqlite } from "./apoio/d1-sqlite";
import { manipularIdentidade } from "../src/http/handlers/oauth/index";
import { validarAlteracao, TAMANHO_MINIMO_SENHA } from "../src/http/handlers/usuarios";
import { LIMITE_TENTATIVAS } from "../src/http/handlers/oauth/credenciais";
import { criarSenha } from "../src/infrastructure/auth/password";
import { RepositorioIdentidadeD1 } from "../src/infrastructure/d1/identity";
import type { PapelSessao } from "../src/infrastructure/auth/session";
import type { Env } from "../src/worker/index";

/**
 * Administração de contas: quem pode administrar, o que o sistema recusa mesmo vindo da Direção,
 * e o que acontece com o acesso do assistente de IA quando uma conta muda.
 *
 * O teste mais importante deste arquivo é o primeiro: a autorização destas rotas sai da sessão
 * de LOGIN, não do cookie de identidade funcional. Como o seletor de demonstração deixa qualquer
 * visitante dizer "sou a Direção", ler o cookie errado aqui significaria criar contas sem senha
 * nenhuma — é o controle negativo que prova que o gate mede alguma coisa.
 */

const CHAVE = "chave-de-teste-usuarios-1234567890";

let banco: DatabaseSync;
let env: Env;
let repo: RepositorioIdentidadeD1;

async function criarConta(email: string, papel: PapelSessao, senha: string, ativo = true): Promise<string> {
  const armazenada = await criarSenha(senha, 1_000);
  const id = randomUUID();
  const agora = new Date().toISOString();
  banco
    .prepare(
      "INSERT INTO users (id, email, nome, papel, senha_hash, senha_salt, senha_iteracoes, ativo, created_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(id, email, `Pessoa ${papel}`, papel, armazenada.hash, armazenada.salt, armazenada.iteracoes, ativo ? 1 : 0, agora, agora);
  return id;
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

function json(metodo: string, corpo: unknown, cookie?: string): RequestInit {
  return {
    method: metodo,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(corpo),
  };
}

/** Faz login de verdade e devolve o cabeçalho `Cookie` da sessão resultante. */
async function entrar(email: string, senha: string): Promise<string> {
  const resposta = await manipularIdentidade(requisicao("/entrar", formulario({ email, senha, redirecionar: "/" })), env);
  return (resposta!.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function chamar(caminho: string, init: RequestInit): Promise<{ status: number; corpo: Record<string, never> }> {
  const resposta = await manipularIdentidade(requisicao(caminho, init), env);
  const texto = await resposta!.text();
  return { status: resposta!.status, corpo: texto ? JSON.parse(texto) : {} };
}

beforeEach(async () => {
  banco = new DatabaseSync(":memory:");
  aplicarMigracoes(banco);
  repo = new RepositorioIdentidadeD1(new D1SobreSqlite(banco) as unknown as D1Database);
  env = {
    DB: new D1SobreSqlite(banco) as unknown as D1Database,
    EVIDENCE: {} as R2Bucket,
    AI: {} as Ai,
    ASSETS: {} as Fetcher,
    LINK_SIGNING_KEY: CHAVE,
  } as Env;
});

describe("quem pode administrar contas", () => {
  it("recusa sem login, mesmo com o cookie de identidade funcional dizendo DIRECAO", async () => {
    // Controle negativo: este é exatamente o ataque que a separação de cookies impede.
    const { assinarSessao } = await import("../src/infrastructure/auth/session");
    const funcional = await assinarSessao("DIRECAO", CHAVE, new Date().toISOString());

    const semNada = await chamar("/api/users", { method: "GET" });
    expect(semNada.status).toBe(401);

    const comFuncional = await chamar("/api/users", {
      method: "GET",
      headers: { cookie: `vitalis_sessao=${funcional.valorCookie}` },
    });
    expect(comFuncional.status).toBe(401);
  });

  it("recusa quem está logado mas não é Direção", async () => {
    await criarConta("secretaria@vitalis.example", "SECRETARIA", "senha-secretaria");
    const cookie = await entrar("secretaria@vitalis.example", "senha-secretaria");

    const lista = await chamar("/api/users", { method: "GET", headers: { cookie } });
    expect(lista.status).toBe(403);

    const criacao = await chamar("/api/users", json("POST", { nome: "X", email: "x@vitalis.example", papel: "SECRETARIA" }, cookie));
    expect(criacao.status).toBe(403);
  });

  it("deixa a Direção listar e criar", async () => {
    await criarConta("direcao@vitalis.example", "DIRECAO", "senha-direcao");
    const cookie = await entrar("direcao@vitalis.example", "senha-direcao");

    const lista = await chamar("/api/users", { method: "GET", headers: { cookie } });
    expect(lista.status).toBe(200);
    expect((lista.corpo as Record<string, unknown[]>).usuarios).toHaveLength(1);
  });
});

describe("criar conta", () => {
  let cookieDirecao: string;

  beforeEach(async () => {
    await criarConta("direcao@vitalis.example", "DIRECAO", "senha-direcao");
    cookieDirecao = await entrar("direcao@vitalis.example", "senha-direcao");
  });

  it("devolve a senha provisória uma vez e a conta nasce obrigada a trocá-la", async () => {
    const criacao = await chamar(
      "/api/users",
      json("POST", { nome: "Marina Alves", email: "Marina@Vitalis.Example", papel: "SECRETARIA" }, cookieDirecao),
    );
    expect(criacao.status).toBe(201);

    const corpo = criacao.corpo as unknown as { senha_provisoria: string; usuario: { id: string; email: string; senhaProvisoria: boolean } };
    expect(corpo.senha_provisoria.length).toBeGreaterThanOrEqual(12);
    // E-mail é normalizado para minúsculas — senão a mesma pessoa entraria como duas contas.
    expect(corpo.usuario.email).toBe("marina@vitalis.example");
    expect(corpo.usuario.senhaProvisoria).toBe(true);

    // A senha provisória entra de verdade, e o login manda definir uma nova.
    const resposta = await manipularIdentidade(
      requisicao("/entrar", formulario({ email: "marina@vitalis.example", senha: corpo.senha_provisoria, redirecionar: "/guias" })),
      env,
    );
    expect(resposta!.status).toBe(302);
    expect(resposta!.headers.get("location")).toContain("/trocar-senha");
  });

  it("recusa e-mail repetido, mesmo com outra caixa", async () => {
    await chamar("/api/users", json("POST", { nome: "Marina", email: "marina@vitalis.example", papel: "SECRETARIA" }, cookieDirecao));
    const segunda = await chamar("/api/users", json("POST", { nome: "Outra", email: "MARINA@vitalis.example", papel: "FINANCEIRO" }, cookieDirecao));
    expect(segunda.status).toBe(409);
    expect((segunda.corpo as unknown as { erro: { codigo: string } }).erro.codigo).toBe("EMAIL_EM_USO");
  });

  it("registra quem criou, no histórico de identidade", async () => {
    await chamar("/api/users", json("POST", { nome: "Marina", email: "marina@vitalis.example", papel: "SECRETARIA" }, cookieDirecao));
    const eventos = await repo.listarEventos(10);
    const criacao = eventos.find((evento) => evento.tipo === "CONTA_CRIADA");
    expect(criacao?.atorEmail).toBe("direcao@vitalis.example");
  });
});

describe("proteções que valem até para a Direção", () => {
  it("não deixa desativar a própria conta", async () => {
    const id = await criarConta("direcao@vitalis.example", "DIRECAO", "senha-direcao");
    await criarConta("outra-direcao@vitalis.example", "DIRECAO", "senha-outra");
    const cookie = await entrar("direcao@vitalis.example", "senha-direcao");

    const resposta = await chamar(`/api/users/${id}`, json("PATCH", { ativo: false }, cookie));
    expect(resposta.status).toBe(409);
    expect((resposta.corpo as unknown as { erro: { codigo: string } }).erro.codigo).toBe("AUTO_DESATIVACAO");
  });

  it("não deixa a última Direção ativa ser rebaixada nem desativada", async () => {
    const idDirecao = await criarConta("direcao@vitalis.example", "DIRECAO", "senha-direcao");
    const idSecretaria = await criarConta("secretaria@vitalis.example", "SECRETARIA", "senha-secretaria");
    const cookie = await entrar("direcao@vitalis.example", "senha-direcao");

    const rebaixar = await chamar(`/api/users/${idDirecao}`, json("PATCH", { papel: "SECRETARIA" }, cookie));
    expect(rebaixar.status).toBe(409);

    // Com uma segunda Direção, a mesma operação passa a ser permitida.
    await chamar(`/api/users/${idSecretaria}`, json("PATCH", { papel: "DIRECAO" }, cookie));
    const agoraPode = await chamar(`/api/users/${idDirecao}`, json("PATCH", { papel: "SECRETARIA" }, cookie));
    expect(agoraPode.status).toBe(200);
  });

  it("a regra pura cobre os três casos sem precisar de banco", () => {
    const base = {
      alvoId: "alvo",
      alvoPapelAtual: "DIRECAO" as PapelSessao,
      alvoAtivoAtual: true,
      autorId: "autor",
      direcoesAtivas: 1,
    };
    expect(validarAlteracao({ ...base, novoAtivo: false })?.codigo).toBe("ULTIMA_DIRECAO");
    expect(validarAlteracao({ ...base, novoPapel: "FINANCEIRO" })?.codigo).toBe("ULTIMA_DIRECAO");
    expect(validarAlteracao({ ...base, alvoId: "autor", novoAtivo: false })?.codigo).toBe("AUTO_DESATIVACAO");
    expect(validarAlteracao({ ...base, direcoesAtivas: 2, novoPapel: "FINANCEIRO" })).toBeNull();
  });
});

describe("efeito das mudanças sobre o acesso já concedido", () => {
  it("trocar o papel e desativar derrubam os tokens de MCP da pessoa", async () => {
    await criarConta("direcao@vitalis.example", "DIRECAO", "senha-direcao");
    const idAlvo = await criarConta("secretaria@vitalis.example", "SECRETARIA", "senha-secretaria");
    const cookie = await entrar("direcao@vitalis.example", "senha-direcao");

    await repo.registrarCliente({ id: "cli-1", nome: "Cliente", redirectUris: ["https://x.example/cb"], grantTypes: ["authorization_code"] }, new Date().toISOString());
    await repo.guardarToken(
      "token-vivo",
      { tipo: "ACCESS", clientId: "cli-1", userId: idAlvo, scope: "vitalis.mcp", expiraEmUtc: new Date(Date.now() + 3_600_000).toISOString() },
      new Date().toISOString(),
    );

    await chamar(`/api/users/${idAlvo}`, json("PATCH", { papel: "FINANCEIRO" }, cookie));
    expect((await repo.buscarToken("token-vivo"))?.revogadoEmUtc).not.toBeNull();
  });

  it("conta desativada não entra mais, mesmo com a senha certa", async () => {
    await criarConta("direcao@vitalis.example", "DIRECAO", "senha-direcao");
    const idAlvo = await criarConta("secretaria@vitalis.example", "SECRETARIA", "senha-secretaria");
    const cookie = await entrar("direcao@vitalis.example", "senha-direcao");

    await chamar(`/api/users/${idAlvo}`, json("PATCH", { ativo: false }, cookie));
    const tentativa = await entrar("secretaria@vitalis.example", "senha-secretaria");
    expect(tentativa).not.toContain("vitalis_login");
  });

  it("redefinir senha gera provisória nova e obriga troca", async () => {
    await criarConta("direcao@vitalis.example", "DIRECAO", "senha-direcao");
    const idAlvo = await criarConta("secretaria@vitalis.example", "SECRETARIA", "senha-antiga");
    const cookie = await entrar("direcao@vitalis.example", "senha-direcao");

    const resposta = await chamar(`/api/users/${idAlvo}/senha`, { method: "POST", headers: { cookie } });
    const nova = (resposta.corpo as unknown as { senha_provisoria: string }).senha_provisoria;
    expect(resposta.status).toBe(200);

    // A antiga morre na hora; a nova entra e cai na definição de senha.
    const comAntiga = await manipularIdentidade(
      requisicao("/entrar", formulario({ email: "secretaria@vitalis.example", senha: "senha-antiga", redirecionar: "/" })),
      env,
    );
    expect(comAntiga!.status).toBe(401);

    const comNova = await manipularIdentidade(
      requisicao("/entrar", formulario({ email: "secretaria@vitalis.example", senha: nova, redirecionar: "/" })),
      env,
    );
    expect(comNova!.headers.get("location")).toContain("/trocar-senha");
  });
});

describe("trocar a própria senha", () => {
  it("exige a senha atual e recusa senha curta", async () => {
    await criarConta("secretaria@vitalis.example", "SECRETARIA", "senha-secretaria");
    const cookie = await entrar("secretaria@vitalis.example", "senha-secretaria");

    const errada = await chamar("/api/me/senha", json("POST", { senha_atual: "chute", senha_nova: "uma-senha-longa-o-bastante" }, cookie));
    expect(errada.status).toBe(401);

    const curta = await chamar("/api/me/senha", json("POST", { senha_atual: "senha-secretaria", senha_nova: "curta" }, cookie));
    expect(curta.status).toBe(400);
    expect(TAMANHO_MINIMO_SENHA).toBeGreaterThanOrEqual(10);

    const certa = await chamar("/api/me/senha", json("POST", { senha_atual: "senha-secretaria", senha_nova: "uma-senha-longa-o-bastante" }, cookie));
    expect(certa.status).toBe(200);

    // A senha nova passa a valer, e a antiga não.
    expect(await entrar("secretaria@vitalis.example", "uma-senha-longa-o-bastante")).toContain("vitalis_login");
    expect(await entrar("secretaria@vitalis.example", "senha-secretaria")).not.toContain("vitalis_login");
  });

  it("sem login, ninguém troca senha nenhuma", async () => {
    const resposta = await chamar("/api/me/senha", json("POST", { senha_atual: "x", senha_nova: "uma-senha-longa-o-bastante" }));
    expect(resposta.status).toBe(401);
  });
});

describe("tentativas de senha", () => {
  it("bloqueia a conta depois do limite e recusa até a senha certa", async () => {
    await criarConta("secretaria@vitalis.example", "SECRETARIA", "senha-secretaria");

    for (let tentativa = 0; tentativa < LIMITE_TENTATIVAS; tentativa += 1) {
      await entrar("secretaria@vitalis.example", "chute-errado");
    }

    const depois = await manipularIdentidade(
      requisicao("/entrar", formulario({ email: "secretaria@vitalis.example", senha: "senha-secretaria", redirecionar: "/" })),
      env,
    );
    expect(depois!.status).toBe(401);
    expect(await depois!.text()).toContain("Muitas tentativas");

    const eventos = await repo.listarEventos(10);
    expect(eventos.some((evento) => evento.tipo === "CONTA_BLOQUEADA")).toBe(true);
  });

  it("acerto antes do limite zera o contador", async () => {
    await criarConta("secretaria@vitalis.example", "SECRETARIA", "senha-secretaria");
    await entrar("secretaria@vitalis.example", "chute-errado");
    await entrar("secretaria@vitalis.example", "chute-errado");
    expect(await entrar("secretaria@vitalis.example", "senha-secretaria")).toContain("vitalis_login");

    const usuario = await repo.buscarUsuarioPorEmail("secretaria@vitalis.example");
    expect(usuario?.tentativasFalhas).toBe(0);
    expect(usuario?.bloqueadoAteUtc).toBeNull();
  });
});
