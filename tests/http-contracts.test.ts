import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ErroDominio, Roteador, respostaDeErro, respostaJsonErro } from "../src/http/routes";
import type { Env } from "../src/worker/index";
import {
  assinarSessao,
  construirCabecalhoSetCookie,
  isPapelSessao,
  lerPapelDaRequisicao,
  NOME_COOKIE_SESSAO,
  PAPEL_PADRAO_SEM_SESSAO,
  verificarSessao,
} from "../src/infrastructure/auth/session";

// Testes do roteador HTTP (PRD-SDD §24) e da sessão assinada por HMAC (identidade da demo,
// PRD-SDD §8). Nenhum handler de negócio real existe ainda nesta fase — os testes abaixo
// registram handlers de teste no `Roteador`, exatamente como um agente futuro fará ao importar
// `ContextoRota`/`ManipuladorRota` de `src/http/routes.ts`.

const CHAVE_SECRETA = "chave-de-teste-para-hmac-nao-usar-em-producao";
const AGORA_UTC = "2026-09-20T12:00:00.000Z";

function envFalso(chave: string | undefined = CHAVE_SECRETA): Env {
  // O roteador só lê `LINK_SIGNING_KEY` deste objeto (para resolver o papel da sessão) — os
  // outros bindings do Cloudflare Worker não são tocados por nada testado aqui.
  return { LINK_SIGNING_KEY: chave } as unknown as Env;
}

function requisicaoComCookie(url: string, valorCookie?: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  if (valorCookie !== undefined) headers.set("cookie", `${NOME_COOKIE_SESSAO}=${valorCookie}`);
  return new Request(url, { ...init, headers });
}

describe("Roteador — casamento de rota, parâmetros, 404 e 405", () => {
  function montarRoteadorDeTeste(): Roteador {
    return new Roteador()
      .get("/api/protocols", async (ctx) => Response.json({ rota: "lista", papel: ctx.papel }))
      .get("/api/protocols/:numero", async (ctx) => Response.json({ numero: ctx.params.numero }))
      .post("/api/protocols/:numero/versions", async (ctx) =>
        Response.json({ numero: ctx.params.numero, criado: true }, { status: 201 }),
      );
  }

  it("casa rota estática e injeta o papel resolvido no contexto", async () => {
    const roteador = montarRoteadorDeTeste();
    const resposta = await roteador.despachar(new Request("https://vitalis.test/api/protocols"), envFalso(undefined));

    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();
    expect(corpo).toEqual({ rota: "lista", papel: "DIRECAO" });
  });

  it("extrai parâmetro de caminho nomeado (:numero)", async () => {
    const roteador = montarRoteadorDeTeste();
    const resposta = await roteador.despachar(
      new Request("https://vitalis.test/api/protocols/VT-26-0011"),
      envFalso(),
    );

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ numero: "VT-26-0011" });
  });

  it("extrai múltiplos segmentos e aceita o método correto numa rota mais profunda", async () => {
    const roteador = montarRoteadorDeTeste();
    const resposta = await roteador.despachar(
      new Request("https://vitalis.test/api/protocols/VT-26-0042/versions", { method: "POST" }),
      envFalso(),
    );

    expect(resposta.status).toBe(201);
    expect(await resposta.json()).toEqual({ numero: "VT-26-0042", criado: true });
  });

  it("404 quando nenhum padrão de caminho bate", async () => {
    const roteador = montarRoteadorDeTeste();
    const resposta = await roteador.despachar(new Request("https://vitalis.test/api/nao-existe"), envFalso());

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({
      erro: { codigo: "ROTA_NAO_ENCONTRADA", mensagem: "Rota não encontrada." },
    });
  });

  it("405 quando o caminho existe mas o método não está registrado para ele", async () => {
    const roteador = montarRoteadorDeTeste();
    const resposta = await roteador.despachar(
      new Request("https://vitalis.test/api/protocols/VT-26-0011", { method: "DELETE" }),
      envFalso(),
    );

    expect(resposta.status).toBe(405);
    expect(await resposta.json()).toEqual({
      erro: { codigo: "METODO_NAO_PERMITIDO", mensagem: "Método não permitido para esta rota." },
    });
  });

  it("não confunde /api/protocols (lista) com /api/protocols/:numero (detalhe)", async () => {
    const roteador = montarRoteadorDeTeste();
    const resposta = await roteador.despachar(
      new Request("https://vitalis.test/api/protocols/VT-26-0011/versions"),
      envFalso(),
    );

    // GET não está registrado nesse caminho de 3 segmentos (só POST está) — 405, não 404.
    expect(resposta.status).toBe(405);
  });

  it("converte erro de domínio lançado pelo handler no status HTTP correto", async () => {
    const roteador = new Roteador().post("/api/protocols/:numero/release", async () => {
      throw new ErroDominio("ROLE_NOT_ALLOWED", "Papel atual não pode liberar protocolos.");
    });

    const resposta = await roteador.despachar(
      new Request("https://vitalis.test/api/protocols/VT-26-0011/release", { method: "POST" }),
      envFalso(),
    );

    expect(resposta.status).toBe(403);
    expect(await resposta.json()).toEqual({
      erro: { codigo: "ROLE_NOT_ALLOWED", mensagem: "Papel atual não pode liberar protocolos." },
    });
  });

  it("resolve o papel real quando a requisição traz um cookie de sessão válido", async () => {
    // `Roteador.despachar` usa o relógio real (é borda HTTP, não domínio puro) para checar
    // expiração — assina com validade de 100 anos para o teste não depender de quando roda.
    const roteador = new Roteador().get("/api/protocols", async (ctx) => Response.json({ papel: ctx.papel }));
    const cemAnosEmMs = 100 * 365 * 24 * 60 * 60 * 1000;
    const { valorCookie } = await assinarSessao("FINANCEIRO", CHAVE_SECRETA, AGORA_UTC, cemAnosEmMs);

    const resposta = await roteador.despachar(
      requisicaoComCookie("https://vitalis.test/api/protocols", valorCookie),
      envFalso(),
    );

    expect(await resposta.json()).toEqual({ papel: "FINANCEIRO" });
  });
});

describe("respostaDeErro — mapeamento de erro para status HTTP", () => {
  it.each([
    ["ROLE_NOT_ALLOWED", 403],
    ["INVALID_STATE_TRANSITION", 409],
    ["OPEN_BLOCKING_TASKS", 409],
    ["GUIDE_NOT_READY", 409],
    ["EVIDENCE_REQUIRED", 409],
    ["DUPLICATE_MERGE_CONFLICT", 409],
    ["AI_REVIEW_REQUIRED", 409],
  ] as const)("%s vira %i", async (codigo, statusEsperado) => {
    const resposta = respostaDeErro(new ErroDominio(codigo, "mensagem de teste"));
    expect(resposta.status).toBe(statusEsperado);
    expect(await resposta.json()).toEqual({ erro: { codigo, mensagem: "mensagem de teste" } });
  });

  it("código de domínio desconhecido usa o padrão 409, não 500", async () => {
    const resposta = respostaDeErro(new ErroDominio("CODIGO_AINDA_NAO_MAPEADO", "algo específico da rota"));
    expect(resposta.status).toBe(409);
  });

  it("ErroDominio pode forçar um status explícito (ex.: 404 de \"não encontrado\")", async () => {
    const resposta = respostaDeErro(new ErroDominio("PROTOCOLO_NAO_ENCONTRADO", "Protocolo não encontrado.", 404));
    expect(resposta.status).toBe(404);
  });

  it("ZodError de validação de entrada vira 422 com o código estável VALIDATION_ERROR", async () => {
    const esquema = z.object({ papel: z.enum(["SECRETARIA", "FINANCEIRO", "DIRECAO"]) });
    const resultado = esquema.safeParse({ papel: "GERENTE" });
    expect(resultado.success).toBe(false);

    const resposta = respostaDeErro(resultado.error);
    expect(resposta.status).toBe(422);
    const corpo = (await resposta.json()) as { erro: { codigo: string; mensagem: string } };
    expect(corpo.erro.codigo).toBe("VALIDATION_ERROR");
    expect(corpo.erro.mensagem.length).toBeGreaterThan(0);
  });

  it("erro realmente inesperado (não é ZodError nem ErroDominio) vira 500 sem vazar a mensagem original", async () => {
    const resposta = respostaDeErro(new Error("detalhe interno sensível de implementação"));
    expect(resposta.status).toBe(500);
    const corpo = (await resposta.json()) as { erro: { codigo: string; mensagem: string } };
    expect(corpo.erro.codigo).toBe("ERRO_INESPERADO");
    expect(corpo.erro.mensagem).not.toContain("detalhe interno sensível");
  });

  // Controle negativo: se alguém "simplificar" respostaJsonErro para sempre devolver 200 (ou
  // remover o campo erro), este teste cai — confirma que a asserção acima está de fato viva.
  it("controle negativo: respostaJsonErro nunca usa o status 200", () => {
    const resposta = respostaJsonErro(409, "X", "y");
    expect(resposta.status).not.toBe(200);
  });
});

describe("sessão assinada por HMAC — assinar, verificar e ler o papel da requisição", () => {
  it("assina e verifica uma sessão válida, devolvendo o papel e as datas emitidas", async () => {
    const { valorCookie, sessao } = await assinarSessao("SECRETARIA", CHAVE_SECRETA, AGORA_UTC);
    expect(sessao.papel).toBe("SECRETARIA");
    expect(sessao.emitidaEmUtc).toBe(AGORA_UTC);

    const verificada = await verificarSessao(valorCookie, CHAVE_SECRETA, AGORA_UTC);
    expect(verificada).toEqual(sessao);
  });

  it("controle negativo: adulterar um único caractere da assinatura invalida a sessão", async () => {
    const { valorCookie } = await assinarSessao("FINANCEIRO", CHAVE_SECRETA, AGORA_UTC);
    const ultimoChar = valorCookie.at(-1);
    const substituto = ultimoChar === "a" ? "b" : "a";
    const adulterado = `${valorCookie.slice(0, -1)}${substituto}`;

    expect(await verificarSessao(adulterado, CHAVE_SECRETA, AGORA_UTC)).toBeNull();
  });

  it("rejeita sessão verificada com uma chave secreta diferente da que assinou", async () => {
    const { valorCookie } = await assinarSessao("FINANCEIRO", CHAVE_SECRETA, AGORA_UTC);
    expect(await verificarSessao(valorCookie, "outra-chave-completamente-diferente", AGORA_UTC)).toBeNull();
  });

  it("rejeita sessão expirada", async () => {
    const { valorCookie } = await assinarSessao("SECRETARIA", CHAVE_SECRETA, AGORA_UTC, 1000);
    const doisSegundosDepois = new Date(new Date(AGORA_UTC).getTime() + 2000).toISOString();

    expect(await verificarSessao(valorCookie, CHAVE_SECRETA, doisSegundosDepois)).toBeNull();
  });

  it("aceita a sessão exatamente no instante de expiração (inclusivo)", async () => {
    const { valorCookie, sessao } = await assinarSessao("SECRETARIA", CHAVE_SECRETA, AGORA_UTC, 1000);
    expect(await verificarSessao(valorCookie, CHAVE_SECRETA, sessao.expiraEmUtc)).not.toBeNull();
  });

  it("rejeita valor de cookie malformado sem lançar", async () => {
    await expect(verificarSessao("nao-e-um-cookie-assinado", CHAVE_SECRETA, AGORA_UTC)).resolves.toBeNull();
    await expect(verificarSessao("", CHAVE_SECRETA, AGORA_UTC)).resolves.toBeNull();
    await expect(verificarSessao(".", CHAVE_SECRETA, AGORA_UTC)).resolves.toBeNull();
  });

  it("lerPapelDaRequisicao devolve DIRECAO (leitura) sem cookie", async () => {
    const requisicao = new Request("https://vitalis.test/api/protocols");
    expect(await lerPapelDaRequisicao(requisicao, CHAVE_SECRETA, AGORA_UTC)).toBe(PAPEL_PADRAO_SEM_SESSAO);
  });

  it("lerPapelDaRequisicao devolve DIRECAO quando LINK_SIGNING_KEY não está configurada, mesmo com cookie válido", async () => {
    const { valorCookie } = await assinarSessao("FINANCEIRO", CHAVE_SECRETA, AGORA_UTC);
    const requisicao = requisicaoComCookie("https://vitalis.test/api/protocols", valorCookie);

    expect(await lerPapelDaRequisicao(requisicao, undefined, AGORA_UTC)).toBe("DIRECAO");
  });

  it("lerPapelDaRequisicao devolve o papel correto com cookie válido e chave configurada", async () => {
    const { valorCookie } = await assinarSessao("SECRETARIA", CHAVE_SECRETA, AGORA_UTC);
    const requisicao = requisicaoComCookie("https://vitalis.test/api/protocols", valorCookie);

    expect(await lerPapelDaRequisicao(requisicao, CHAVE_SECRETA, AGORA_UTC)).toBe("SECRETARIA");
  });

  it("nunca lê o papel de um cabeçalho livre nem de outro nome de cookie", async () => {
    const requisicao = requisicaoComCookie("https://vitalis.test/api/protocols", undefined, {
      headers: { "x-papel": "FINANCEIRO", cookie: "outro_cookie=FINANCEIRO" },
    });

    expect(await lerPapelDaRequisicao(requisicao, CHAVE_SECRETA, AGORA_UTC)).toBe("DIRECAO");
  });

  it("construirCabecalhoSetCookie inclui os atributos obrigatórios e Secure só quando pedido", async () => {
    const { valorCookie, sessao } = await assinarSessao("SECRETARIA", CHAVE_SECRETA, AGORA_UTC);

    const semSecure = construirCabecalhoSetCookie(valorCookie, sessao.expiraEmUtc, false);
    expect(semSecure).toContain(`${NOME_COOKIE_SESSAO}=${valorCookie}`);
    expect(semSecure).toContain("HttpOnly");
    expect(semSecure).toContain("SameSite=Lax");
    expect(semSecure).toContain("Path=/");
    expect(semSecure).not.toContain("Secure");

    const comSecure = construirCabecalhoSetCookie(valorCookie, sessao.expiraEmUtc, true);
    expect(comSecure).toContain("Secure");
  });

  it("isPapelSessao aceita só os três papéis válidos", () => {
    expect(isPapelSessao("SECRETARIA")).toBe(true);
    expect(isPapelSessao("FINANCEIRO")).toBe(true);
    expect(isPapelSessao("DIRECAO")).toBe(true);
    expect(isPapelSessao("SISTEMA")).toBe(false);
    expect(isPapelSessao("gerente")).toBe(false);
  });
});
