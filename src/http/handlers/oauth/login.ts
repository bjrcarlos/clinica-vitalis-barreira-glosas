import { criarSenha } from "../../../infrastructure/auth/password";
import { assinarLogin, cabecalhoLimparLogin, cabecalhoSetCookieLogin } from "../../../infrastructure/auth/login-session";
import { assinarSessao, construirCabecalhoSetCookie } from "../../../infrastructure/auth/session";
import { VALIDADE_LOGIN_MS } from "../../../infrastructure/auth/oauth";
import { TAMANHO_MINIMO_SENHA } from "../usuarios";
import type { ContextoOauth } from "./comum";
import { lerFormulario, respostaComCookies, sessaoAtual } from "./comum";
import { conferirCredenciais } from "./credenciais";
import { paginaDefinirSenha, paginaLogin, respostaHtml } from "./paginas";

/**
 * Login direto no sistema (`/entrar`, `/sair`) e a troca obrigatória de senha provisória
 * (`/trocar-senha`), fora do fluxo do MCP.
 *
 * Um login, dois cookies: a sessão de identidade (quem é) e a sessão funcional (qual papel a
 * interface exerce). O segundo já existia e continua sendo a única coisa que os handlers de
 * mutação leem — por isso o resto do sistema passou a respeitar a conta sem precisar mudar.
 */

/**
 * Só aceita destino interno. Um `?redirecionar=` que aponte para fora vira redirecionamento
 * aberto — o clássico para phishing em cima de um domínio legítimo.
 */
export function destinoInternoSeguro(bruto: string | null): string {
  if (!bruto) return "/";
  if (!bruto.startsWith("/") || bruto.startsWith("//")) return "/";
  return bruto;
}

/** Emite os dois cookies de uma sessão recém-aberta e devolve a resposta já com eles. */
async function comSessao(
  ctx: ContextoOauth,
  usuario: { readonly id: string; readonly email: string; readonly nome: string; readonly papel: "SECRETARIA" | "FINANCEIRO" | "DIRECAO" },
  resposta: Response,
): Promise<Response> {
  const login = await assinarLogin(
    { userId: usuario.id, email: usuario.email, nome: usuario.nome, papel: usuario.papel },
    ctx.chaveAssinatura,
    ctx.agoraUtc,
    VALIDADE_LOGIN_MS,
  );
  const funcional = await assinarSessao(usuario.papel, ctx.chaveAssinatura, ctx.agoraUtc);
  return respostaComCookies(resposta, [
    cabecalhoSetCookieLogin(login.valorCookie, login.sessao.expiraEmUtc, ctx.seguro),
    construirCabecalhoSetCookie(funcional.valorCookie, funcional.sessao.expiraEmUtc, ctx.seguro),
  ]);
}

export async function entrarGet(ctx: ContextoOauth): Promise<Response> {
  const destino = destinoInternoSeguro(ctx.url.searchParams.get("redirecionar"));
  return respostaHtml(
    paginaLogin({
      acao: "/entrar",
      titulo: "Entrar na Barreira de Glosas",
      apoio: "Use a conta da clínica. Seu perfil define o que você vê aqui e o que o seu assistente de IA pode consultar.",
      ocultos: { redirecionar: destino },
    }),
  );
}

export async function entrarPost(ctx: ContextoOauth): Promise<Response> {
  const formulario = await lerFormulario(ctx.request);
  const destino = destinoInternoSeguro(formulario.get("redirecionar"));
  const email = (formulario.get("email") ?? "").trim();

  const resultado = await conferirCredenciais(ctx, email, formulario.get("senha") ?? "");
  if (resultado.tipo === "recusado") {
    return respostaHtml(
      paginaLogin({
        acao: "/entrar",
        titulo: "Entrar na Barreira de Glosas",
        apoio: "Use a conta da clínica.",
        erro: resultado.mensagem,
        emailPreenchido: email,
        ocultos: { redirecionar: destino },
      }),
      401,
    );
  }

  // Senha provisória serve para entrar uma vez: a sessão é aberta, mas o caminho leva direto
  // para a definição de senha, com o destino original preservado.
  const proximo = resultado.usuario.senhaProvisoria
    ? `/trocar-senha?redirecionar=${encodeURIComponent(destino)}`
    : destino;

  return comSessao(ctx, resultado.usuario, new Response(null, { status: 302, headers: { location: proximo } }));
}

/** GET /trocar-senha — só para quem entrou com senha provisória; os demais trocam pela interface. */
export async function trocarSenhaGet(ctx: ContextoOauth): Promise<Response> {
  const sessao = await sessaoAtual(ctx);
  const destino = destinoInternoSeguro(ctx.url.searchParams.get("redirecionar"));
  if (!sessao) {
    return new Response(null, { status: 302, headers: { location: `/entrar?redirecionar=${encodeURIComponent(destino)}` } });
  }
  const usuario = await ctx.repo.buscarUsuarioPorId(sessao.userId);
  if (!usuario?.senhaProvisoria) {
    return new Response(null, { status: 302, headers: { location: destino } });
  }
  return respostaHtml(paginaDefinirSenha({ nome: sessao.nome, destino, minimo: TAMANHO_MINIMO_SENHA }));
}

export async function trocarSenhaPost(ctx: ContextoOauth): Promise<Response> {
  const sessao = await sessaoAtual(ctx);
  const formulario = await lerFormulario(ctx.request);
  const destino = destinoInternoSeguro(formulario.get("redirecionar"));
  if (!sessao) {
    return new Response(null, { status: 302, headers: { location: `/entrar?redirecionar=${encodeURIComponent(destino)}` } });
  }

  const nova = formulario.get("senha_nova") ?? "";
  const confirmacao = formulario.get("senha_confirmacao") ?? "";
  const problema =
    nova.length < TAMANHO_MINIMO_SENHA
      ? `A senha precisa de pelo menos ${TAMANHO_MINIMO_SENHA} caracteres.`
      : nova !== confirmacao
        ? "As duas senhas digitadas não são iguais."
        : null;

  if (problema) {
    return respostaHtml(paginaDefinirSenha({ nome: sessao.nome, destino, minimo: TAMANHO_MINIMO_SENHA, erro: problema }), 400);
  }

  const usuario = await ctx.repo.buscarUsuarioPorId(sessao.userId);
  if (!usuario) {
    return new Response(null, { status: 302, headers: { location: "/entrar" } });
  }

  const armazenada = await criarSenha(nova);
  await ctx.repo.definirSenha(usuario.id, armazenada, false, ctx.agoraUtc);
  await ctx.repo.registrarEvento({
    id: crypto.randomUUID(),
    userId: usuario.id,
    atorUserId: usuario.id,
    atorEmail: usuario.email,
    tipo: "SENHA_TROCADA",
    metadata: { origem: "PRIMEIRO_ACESSO" },
    ocorridoEmUtc: ctx.agoraUtc,
    registradoEmUtc: ctx.agoraUtc,
  });

  return comSessao(ctx, usuario, new Response(null, { status: 302, headers: { location: destino } }));
}

/**
 * Sair encerra a sessão do navegador. Não revoga token de MCP já emitido: são coisas diferentes,
 * e derrubar o assistente de alguém que só fechou a aba seria surpreendente. Revogar o acesso do
 * assistente é uma ação própria, na tela "Conectar seu assistente".
 */
export async function sair(ctx: ContextoOauth): Promise<Response> {
  const destino = destinoInternoSeguro(ctx.url.searchParams.get("redirecionar"));
  const funcionalExpirado = construirCabecalhoSetCookie("", new Date(0).toISOString(), ctx.seguro);
  return respostaComCookies(new Response(null, { status: 302, headers: { location: destino } }), [
    cabecalhoLimparLogin(ctx.seguro),
    funcionalExpirado,
  ]);
}
