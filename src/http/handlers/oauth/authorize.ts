import { conferirSenha } from "../../../infrastructure/auth/password";
import { assinarLogin, cabecalhoSetCookieLogin } from "../../../infrastructure/auth/login-session";
import { assinarSessao, construirCabecalhoSetCookie } from "../../../infrastructure/auth/session";
import { segredoAleatorio } from "../../../infrastructure/auth/crypto-texto";
import { ESCOPO_PADRAO, redirectUriPermitida, VALIDADE_CODIGO_MS, VALIDADE_LOGIN_MS } from "../../../infrastructure/auth/oauth";
import type { ContextoOauth } from "./comum";
import { lerFormulario, redirecionarComErro, respostaComCookies, sessaoAtual } from "./comum";
import { paginaConsentimento, paginaErro, paginaLogin, respostaHtml } from "./paginas";

/**
 * Endpoint de autorização (`/oauth/authorize`): a única parte do fluxo que uma PESSOA vê.
 *
 * O cliente de IA redireciona o navegador para cá; aqui ela entra com e-mail e senha (se ainda
 * não estiver logada), confere em nome de quem o acesso será dado e autoriza. O papel exibido e
 * concedido é o da conta — nunca algo que o cliente peça por parâmetro.
 *
 * Erros de cliente/`redirect_uri` NÃO redirecionam: um `redirect_uri` não confiável é
 * exatamente o que não se deve usar para devolver erro. Esses viram página de erro. Os demais
 * voltam ao cliente com `error=` e o `state` preservado, como manda a especificação.
 */

interface ParametrosAutorizacao {
  readonly responseType: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: string;
  readonly scope: string;
  readonly state: string | null;
  readonly resource: string | null;
}

function lerParametros(fonte: URLSearchParams): ParametrosAutorizacao {
  return {
    responseType: fonte.get("response_type") ?? "",
    clientId: fonte.get("client_id") ?? "",
    redirectUri: fonte.get("redirect_uri") ?? "",
    codeChallenge: fonte.get("code_challenge") ?? "",
    codeChallengeMethod: fonte.get("code_challenge_method") ?? "",
    scope: fonte.get("scope") || ESCOPO_PADRAO,
    state: fonte.get("state"),
    resource: fonte.get("resource"),
  };
}

function ocultosDoFluxo(p: ParametrosAutorizacao): Record<string, string | null> {
  return {
    response_type: p.responseType,
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    code_challenge: p.codeChallenge,
    code_challenge_method: p.codeChallengeMethod,
    scope: p.scope,
    state: p.state,
    resource: p.resource,
  };
}

/**
 * Valida cliente e `redirect_uri` antes de qualquer outra coisa. Devolve o nome do cliente para
 * exibição, ou uma `Response` de erro já pronta.
 */
async function validarCliente(
  ctx: ContextoOauth,
  p: ParametrosAutorizacao,
): Promise<{ readonly nomeCliente: string } | { readonly resposta: Response }> {
  if (!p.clientId) {
    return { resposta: respostaHtml(paginaErro("Pedido incompleto", "O assistente não informou qual aplicativo está pedindo acesso."), 400) };
  }
  const cliente = await ctx.repo.buscarCliente(p.clientId);
  if (!cliente) {
    return {
      resposta: respostaHtml(
        paginaErro("Aplicativo não reconhecido", "Este assistente não está registrado. Peça a ele para conectar novamente do começo."),
        400,
      ),
    };
  }
  if (!p.redirectUri || !redirectUriPermitida(cliente.redirectUris, p.redirectUri)) {
    return {
      resposta: respostaHtml(
        paginaErro("Endereço de retorno inválido", "O endereço para onde o assistente quer voltar não confere com o que ele registrou."),
        400,
      ),
    };
  }
  return { nomeCliente: cliente.nome };
}

/** Confere o restante dos parâmetros, que já podem ser devolvidos ao cliente por redirecionamento. */
function validarPedido(p: ParametrosAutorizacao): Response | null {
  if (p.responseType !== "code") {
    return redirecionarComErro(p.redirectUri, p.state, "unsupported_response_type", "Somente response_type=code é aceito.");
  }
  if (p.codeChallengeMethod !== "S256" || p.codeChallenge.length < 43) {
    return redirecionarComErro(p.redirectUri, p.state, "invalid_request", "PKCE com code_challenge_method=S256 é obrigatório.");
  }
  return null;
}

/** GET /oauth/authorize — mostra login ou tela de autorização. */
export async function autorizarGet(ctx: ContextoOauth): Promise<Response> {
  const p = lerParametros(ctx.url.searchParams);
  const cliente = await validarCliente(ctx, p);
  if ("resposta" in cliente) return cliente.resposta;
  const invalido = validarPedido(p);
  if (invalido) return invalido;

  const sessao = await sessaoAtual(ctx);
  if (!sessao) {
    return respostaHtml(
      paginaLogin({
        acao: "/oauth/authorize",
        titulo: "Entrar para autorizar",
        apoio: `${cliente.nomeCliente} quer consultar a Barreira de Glosas em seu nome. Entre com sua conta da clínica para continuar.`,
        ocultos: ocultosDoFluxo(p),
      }),
    );
  }

  return respostaHtml(
    paginaConsentimento({
      nomeCliente: cliente.nomeCliente,
      nomeUsuario: sessao.nome,
      emailUsuario: sessao.email,
      papel: sessao.papel,
      ocultos: ocultosDoFluxo(p),
    }),
  );
}

/** POST /oauth/authorize — recebe o login (`acao=entrar`) ou a decisão (`acao=autorizar`). */
export async function autorizarPost(ctx: ContextoOauth): Promise<Response> {
  const formulario = await lerFormulario(ctx.request);
  const p = lerParametros(formulario);
  const cliente = await validarCliente(ctx, p);
  if ("resposta" in cliente) return cliente.resposta;
  const invalido = validarPedido(p);
  if (invalido) return invalido;

  const acao = formulario.get("acao");

  if (acao === "entrar") {
    const email = (formulario.get("email") ?? "").trim();
    const senha = formulario.get("senha") ?? "";
    const usuario = await ctx.repo.buscarUsuarioPorEmail(email);
    const senhaConfere =
      usuario !== null &&
      (await conferirSenha(senha, { hash: usuario.senhaHash, salt: usuario.senhaSalt, iteracoes: usuario.senhaIteracoes }));

    if (!usuario || !senhaConfere) {
      // Mesma mensagem para e-mail inexistente e senha errada: não revela quais contas existem.
      return respostaHtml(
        paginaLogin({
          acao: "/oauth/authorize",
          titulo: "Entrar para autorizar",
          apoio: `${cliente.nomeCliente} quer consultar a Barreira de Glosas em seu nome.`,
          erro: "E-mail ou senha não conferem.",
          emailPreenchido: email,
          ocultos: ocultosDoFluxo(p),
        }),
        401,
      );
    }

    const { valorCookie, sessao } = await assinarLogin(
      { userId: usuario.id, email: usuario.email, nome: usuario.nome, papel: usuario.papel },
      ctx.chaveAssinatura,
      ctx.agoraUtc,
      VALIDADE_LOGIN_MS,
    );
    const funcional = await assinarSessao(usuario.papel, ctx.chaveAssinatura, ctx.agoraUtc);

    return respostaComCookies(
      respostaHtml(
        paginaConsentimento({
          nomeCliente: cliente.nomeCliente,
          nomeUsuario: usuario.nome,
          emailUsuario: usuario.email,
          papel: usuario.papel,
          ocultos: ocultosDoFluxo(p),
        }),
      ),
      [
        cabecalhoSetCookieLogin(valorCookie, sessao.expiraEmUtc, ctx.seguro),
        construirCabecalhoSetCookie(funcional.valorCookie, funcional.sessao.expiraEmUtc, ctx.seguro),
      ],
    );
  }

  if (acao === "autorizar") {
    const sessao = await sessaoAtual(ctx);
    if (!sessao) {
      return respostaHtml(paginaErro("Sessão expirada", "Entre novamente para autorizar o assistente."), 401);
    }
    if (formulario.get("decisao") !== "permitir") {
      return redirecionarComErro(p.redirectUri, p.state, "access_denied", "A autorização foi cancelada.");
    }

    const codigo = segredoAleatorio(32);
    await ctx.repo.guardarCodigo(
      codigo,
      {
        clientId: p.clientId,
        userId: sessao.userId,
        redirectUri: p.redirectUri,
        codeChallenge: p.codeChallenge,
        scope: p.scope,
        expiraEmUtc: new Date(new Date(ctx.agoraUtc).getTime() + VALIDADE_CODIGO_MS).toISOString(),
      },
      ctx.agoraUtc,
      p.resource,
    );

    const destino = new URL(p.redirectUri);
    destino.searchParams.set("code", codigo);
    if (p.state) destino.searchParams.set("state", p.state);
    return Response.redirect(destino.toString(), 302);
  }

  return respostaHtml(paginaErro("Pedido inválido", "A ação enviada não foi reconhecida."), 400);
}
