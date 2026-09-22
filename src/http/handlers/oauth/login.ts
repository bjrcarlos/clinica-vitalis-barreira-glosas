import { conferirSenha } from "../../../infrastructure/auth/password";
import { assinarLogin, cabecalhoLimparLogin, cabecalhoSetCookieLogin } from "../../../infrastructure/auth/login-session";
import { assinarSessao, construirCabecalhoSetCookie } from "../../../infrastructure/auth/session";
import { VALIDADE_LOGIN_MS } from "../../../infrastructure/auth/oauth";
import type { ContextoOauth } from "./comum";
import { lerFormulario, respostaComCookies } from "./comum";
import { paginaLogin, respostaHtml } from "./paginas";

/**
 * Login direto no sistema (`/entrar` e `/sair`), fora do fluxo do MCP: é como a pessoa passa a
 * usar a interface com o papel da própria conta, em vez do seletor de demonstração.
 *
 * Um login, dois cookies: a sessão de identidade (quem é) e a sessão funcional (qual papel a
 * interface exerce). O segundo já existia e continua sendo a única coisa que os handlers de
 * mutação leem — assim nada no resto do sistema precisou mudar para passar a respeitar a conta.
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
  const senha = formulario.get("senha") ?? "";

  const usuario = await ctx.repo.buscarUsuarioPorEmail(email);
  const confere =
    usuario !== null &&
    (await conferirSenha(senha, { hash: usuario.senhaHash, salt: usuario.senhaSalt, iteracoes: usuario.senhaIteracoes }));

  if (!usuario || !confere) {
    return respostaHtml(
      paginaLogin({
        acao: "/entrar",
        titulo: "Entrar na Barreira de Glosas",
        apoio: "Use a conta da clínica.",
        erro: "E-mail ou senha não conferem.",
        emailPreenchido: email,
        ocultos: { redirecionar: destino },
      }),
      401,
    );
  }

  const login = await assinarLogin(
    { userId: usuario.id, email: usuario.email, nome: usuario.nome, papel: usuario.papel },
    ctx.chaveAssinatura,
    ctx.agoraUtc,
    VALIDADE_LOGIN_MS,
  );
  const funcional = await assinarSessao(usuario.papel, ctx.chaveAssinatura, ctx.agoraUtc);

  return respostaComCookies(new Response(null, { status: 302, headers: { location: destino } }), [
    cabecalhoSetCookieLogin(login.valorCookie, login.sessao.expiraEmUtc, ctx.seguro),
    construirCabecalhoSetCookie(funcional.valorCookie, funcional.sessao.expiraEmUtc, ctx.seguro),
  ]);
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
