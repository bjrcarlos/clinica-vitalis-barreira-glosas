import { conferirSenha } from "../../../infrastructure/auth/password";
import type { UsuarioComSenha } from "../../../infrastructure/d1/identity";
import type { ContextoOauth } from "./comum";

/**
 * Conferência de e-mail e senha, usada tanto pelo login direto (`/entrar`) quanto pelo login
 * dentro do fluxo OAuth (`/oauth/authorize`). Uma implementação só: se a defesa contra tentativa
 * repetida existisse em apenas um dos dois caminhos, o outro seria a porta aberta.
 *
 * O que acontece aqui, em ordem:
 *
 * 1. conta bloqueada por tentativas recentes é recusada mesmo com a senha certa;
 * 2. senha errada incrementa o contador e, no limite, bloqueia a conta por um tempo;
 * 3. acerto zera o contador, grava o último acesso e registra o evento de auditoria.
 *
 * A mensagem devolvida é sempre a mesma para e-mail inexistente e senha errada — quem tenta
 * adivinhar não descobre quais contas existem.
 */

/** Tentativas erradas seguidas antes de bloquear a conta. */
export const LIMITE_TENTATIVAS = 5;
/** Quanto tempo a conta fica bloqueada depois de estourar o limite. */
export const BLOQUEIO_MS = 15 * 60 * 1000;

const MENSAGEM_GENERICA = "E-mail ou senha não conferem.";

export type ResultadoCredenciais =
  | { readonly tipo: "ok"; readonly usuario: UsuarioComSenha }
  | { readonly tipo: "recusado"; readonly mensagem: string };

export async function conferirCredenciais(ctx: ContextoOauth, email: string, senha: string): Promise<ResultadoCredenciais> {
  const usuario = await ctx.repo.buscarUsuarioPorEmail(email);
  if (!usuario) return { tipo: "recusado", mensagem: MENSAGEM_GENERICA };

  if (usuario.bloqueadoAteUtc !== null && Date.parse(usuario.bloqueadoAteUtc) > Date.parse(ctx.agoraUtc)) {
    const minutos = Math.max(1, Math.ceil((Date.parse(usuario.bloqueadoAteUtc) - Date.parse(ctx.agoraUtc)) / 60000));
    return {
      tipo: "recusado",
      mensagem: `Muitas tentativas. Esta conta volta a aceitar login em ${minutos} minuto${minutos > 1 ? "s" : ""}.`,
    };
  }

  const confere = await conferirSenha(senha, {
    hash: usuario.senhaHash,
    salt: usuario.senhaSalt,
    iteracoes: usuario.senhaIteracoes,
  });

  if (!confere) {
    const resultado = await ctx.repo.registrarFalhaDeSenha(usuario.id, LIMITE_TENTATIVAS, BLOQUEIO_MS, ctx.agoraUtc);
    if (resultado.bloqueou) {
      await ctx.repo.registrarEvento({
        id: crypto.randomUUID(),
        userId: usuario.id,
        atorUserId: null,
        atorEmail: null,
        tipo: "CONTA_BLOQUEADA",
        metadata: { tentativas: LIMITE_TENTATIVAS, minutos: BLOQUEIO_MS / 60000 },
        ocorridoEmUtc: ctx.agoraUtc,
        registradoEmUtc: ctx.agoraUtc,
      });
      return {
        tipo: "recusado",
        mensagem: `Muitas tentativas. Esta conta volta a aceitar login em ${BLOQUEIO_MS / 60000} minutos.`,
      };
    }
    return { tipo: "recusado", mensagem: MENSAGEM_GENERICA };
  }

  await ctx.repo.registrarAcesso(usuario.id, ctx.agoraUtc);
  await ctx.repo.registrarEvento({
    id: crypto.randomUUID(),
    userId: usuario.id,
    atorUserId: usuario.id,
    atorEmail: usuario.email,
    tipo: "ACESSO_REALIZADO",
    metadata: {},
    ocorridoEmUtc: ctx.agoraUtc,
    registradoEmUtc: ctx.agoraUtc,
  });

  return { tipo: "ok", usuario };
}
