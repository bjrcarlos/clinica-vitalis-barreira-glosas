import { z } from "zod";
import { criarSenha, conferirSenha } from "../../infrastructure/auth/password";
import { segredoAleatorio } from "../../infrastructure/auth/crypto-texto";
import type { PapelSessao } from "../../infrastructure/auth/session";
import type { RepositorioIdentidadeD1 } from "../../infrastructure/d1/identity";
import type { SessaoLogin } from "../../infrastructure/auth/login-session";
import type { ContextoOauth } from "./oauth/comum";
import { jsonOauth, sessaoAtual } from "./oauth/comum";

/**
 * Administração de contas (`/api/users`) e troca da própria senha (`/api/me/senha`).
 *
 * **A autorização aqui sai da sessão de LOGIN, nunca do cookie de identidade funcional.** O
 * seletor de demonstração deixa qualquer visitante dizer "sou a Direção" — se estas rotas
 * lessem aquele cookie, qualquer pessoa criaria contas. Elas exigem `vitalis_login`, que só é
 * emitido contra e-mail e senha conferidos.
 *
 * Duas regras de proteção que valem em qualquer caminho:
 *
 * 1. a última Direção ativa não pode ser desativada nem rebaixada — sem ela, ninguém mais
 *    administra contas e o sistema fica sem dono;
 * 2. ninguém desativa a própria conta, porque o efeito é se trancar para fora sem aviso.
 */

const PAPEIS = ["SECRETARIA", "FINANCEIRO", "DIRECAO"] as const;

/** Tamanho mínimo de senha escolhida por pessoa. Curto demais é o que rate limit não resolve. */
export const TAMANHO_MINIMO_SENHA = 10;

const esquemaNovoUsuario = z.object({
  nome: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  papel: z.enum(PAPEIS),
});

const esquemaAlteracao = z.object({
  papel: z.enum(PAPEIS).optional(),
  ativo: z.boolean().optional(),
});

const esquemaTrocaDeSenha = z.object({
  senha_atual: z.string().min(1),
  senha_nova: z.string().min(TAMANHO_MINIMO_SENHA).max(200),
});

/** Alfabeto sem caracteres que se confundem lidos em voz alta ou copiados de um papel (0/O, 1/l). */
const ALFABETO_SENHA = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Senha provisória de 14 caracteres, mostrada uma vez a quem criou a conta. */
export function gerarSenhaProvisoria(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (byte) => ALFABETO_SENHA[byte % ALFABETO_SENHA.length]).join("");
}

interface Erro {
  readonly status: number;
  readonly codigo: string;
  readonly mensagem: string;
}

function erro(status: number, codigo: string, mensagem: string): Response {
  return Response.json({ erro: { codigo, mensagem } }, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Decide se uma alteração pode ser aplicada. Puro de propósito: é a regra que protege o sistema
 * de ficar sem administrador, e precisa ser testável sem banco.
 */
export function validarAlteracao(entrada: {
  readonly alvoId: string;
  readonly alvoPapelAtual: PapelSessao;
  readonly alvoAtivoAtual: boolean;
  readonly autorId: string;
  readonly direcoesAtivas: number;
  readonly novoPapel?: PapelSessao;
  readonly novoAtivo?: boolean;
}): Erro | null {
  const ehAUltimaDirecao =
    entrada.alvoPapelAtual === "DIRECAO" && entrada.alvoAtivoAtual && entrada.direcoesAtivas <= 1;

  if (entrada.novoAtivo === false) {
    if (entrada.alvoId === entrada.autorId) {
      return { status: 409, codigo: "AUTO_DESATIVACAO", mensagem: "Você não pode desativar a própria conta." };
    }
    if (ehAUltimaDirecao) {
      return {
        status: 409,
        codigo: "ULTIMA_DIRECAO",
        mensagem: "Esta é a única conta da Direção ativa. Promova outra pessoa antes de desativá-la.",
      };
    }
  }

  if (entrada.novoPapel && entrada.novoPapel !== "DIRECAO" && ehAUltimaDirecao) {
    return {
      status: 409,
      codigo: "ULTIMA_DIRECAO",
      mensagem: "Esta é a única conta da Direção ativa. Promova outra pessoa antes de mudar o papel desta.",
    };
  }

  return null;
}

async function exigirDirecao(ctx: ContextoOauth): Promise<SessaoLogin | Response> {
  const sessao = await sessaoAtual(ctx);
  if (!sessao) {
    return erro(401, "NAO_AUTENTICADO", "Entre com sua conta para administrar usuários.");
  }
  if (sessao.papel !== "DIRECAO") {
    return erro(403, "ROLE_NOT_ALLOWED", "Somente a Direção administra contas.");
  }
  return sessao;
}

async function registrar(
  repo: RepositorioIdentidadeD1,
  agoraUtc: string,
  dados: {
    readonly userId: string;
    readonly ator: SessaoLogin | null;
    readonly tipo: Parameters<RepositorioIdentidadeD1["registrarEvento"]>[0]["tipo"];
    readonly metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await repo.registrarEvento({
    id: crypto.randomUUID(),
    userId: dados.userId,
    atorUserId: dados.ator?.userId ?? null,
    atorEmail: dados.ator?.email ?? null,
    tipo: dados.tipo,
    metadata: dados.metadata ?? {},
    ocorridoEmUtc: agoraUtc,
    registradoEmUtc: agoraUtc,
  });
}

/** GET /api/users — lista para a tela de administração. */
export async function listarUsuarios(ctx: ContextoOauth): Promise<Response> {
  const sessao = await exigirDirecao(ctx);
  if (sessao instanceof Response) return sessao;
  const usuarios = await ctx.repo.listarUsuarios(ctx.agoraUtc);
  return jsonOauth({ usuarios, eu: { id: sessao.userId, email: sessao.email } });
}

/** GET /api/users/eventos — histórico de identidade, do mais recente para o mais antigo. */
export async function listarEventosDeUsuarios(ctx: ContextoOauth): Promise<Response> {
  const sessao = await exigirDirecao(ctx);
  if (sessao instanceof Response) return sessao;
  const eventos = await ctx.repo.listarEventos(60);
  return jsonOauth({ eventos });
}

/** POST /api/users — cria conta e devolve a senha provisória UMA vez. */
export async function criarUsuario(ctx: ContextoOauth): Promise<Response> {
  const sessao = await exigirDirecao(ctx);
  if (sessao instanceof Response) return sessao;

  let corpo: unknown;
  try {
    corpo = await ctx.request.json();
  } catch {
    return erro(400, "CORPO_INVALIDO", "Envie nome, e-mail e papel.");
  }

  const analisado = esquemaNovoUsuario.safeParse(corpo);
  if (!analisado.success) {
    return erro(400, "DADOS_INVALIDOS", "Confira nome, e-mail e papel: algum campo está fora do formato.");
  }
  if (await ctx.repo.emailJaUsado(analisado.data.email)) {
    return erro(409, "EMAIL_EM_USO", "Já existe uma conta com este e-mail.");
  }

  const senhaProvisoria = gerarSenhaProvisoria();
  const armazenada = await criarSenha(senhaProvisoria);
  const id = crypto.randomUUID();

  await ctx.repo.criarUsuario(
    {
      id,
      email: analisado.data.email,
      nome: analisado.data.nome,
      papel: analisado.data.papel,
      senhaHash: armazenada.hash,
      senhaSalt: armazenada.salt,
      senhaIteracoes: armazenada.iteracoes,
      criadoPorUserId: sessao.userId,
    },
    ctx.agoraUtc,
  );
  await registrar(ctx.repo, ctx.agoraUtc, {
    userId: id,
    ator: sessao,
    tipo: "CONTA_CRIADA",
    metadata: { email: analisado.data.email, papel: analisado.data.papel },
  });

  const criado = await ctx.repo.buscarParaListagemPorId(id, ctx.agoraUtc);
  // A senha provisória aparece uma única vez, aqui. Não é recuperável depois — redefinir gera outra.
  return jsonOauth({ usuario: criado, senha_provisoria: senhaProvisoria }, 201);
}

/** PATCH /api/users/:id — troca papel e/ou ativa/desativa. */
export async function alterarUsuario(ctx: ContextoOauth, id: string): Promise<Response> {
  const sessao = await exigirDirecao(ctx);
  if (sessao instanceof Response) return sessao;

  let corpo: unknown;
  try {
    corpo = await ctx.request.json();
  } catch {
    return erro(400, "CORPO_INVALIDO", "Envie papel e/ou ativo.");
  }
  const analisado = esquemaAlteracao.safeParse(corpo);
  if (!analisado.success || (analisado.data.papel === undefined && analisado.data.ativo === undefined)) {
    return erro(400, "DADOS_INVALIDOS", "Informe um papel válido ou o novo estado da conta.");
  }

  const alvo = await ctx.repo.buscarParaListagemPorId(id, ctx.agoraUtc);
  if (!alvo) return erro(404, "USUARIO_NAO_ENCONTRADO", "Conta não encontrada.");

  const impedimento = validarAlteracao({
    alvoId: alvo.id,
    alvoPapelAtual: alvo.papel,
    alvoAtivoAtual: alvo.ativo,
    autorId: sessao.userId,
    direcoesAtivas: await ctx.repo.contarDirecoesAtivas(),
    novoPapel: analisado.data.papel,
    novoAtivo: analisado.data.ativo,
  });
  if (impedimento) return erro(impedimento.status, impedimento.codigo, impedimento.mensagem);

  if (analisado.data.papel && analisado.data.papel !== alvo.papel) {
    await ctx.repo.alterarPapel(alvo.id, analisado.data.papel, ctx.agoraUtc);
    // O token do MCP carrega o papel da conta: trocar o papel sem derrubar a sessão do
    // assistente deixaria um token antigo trabalhando com permissão antiga.
    await ctx.repo.revogarTokensDoUsuario(alvo.id, ctx.agoraUtc);
    await registrar(ctx.repo, ctx.agoraUtc, {
      userId: alvo.id,
      ator: sessao,
      tipo: "PAPEL_ALTERADO",
      metadata: { de: alvo.papel, para: analisado.data.papel },
    });
  }

  if (analisado.data.ativo !== undefined && analisado.data.ativo !== alvo.ativo) {
    await ctx.repo.definirAtivo(alvo.id, analisado.data.ativo, ctx.agoraUtc);
    if (!analisado.data.ativo) await ctx.repo.revogarTokensDoUsuario(alvo.id, ctx.agoraUtc);
    await registrar(ctx.repo, ctx.agoraUtc, {
      userId: alvo.id,
      ator: sessao,
      tipo: analisado.data.ativo ? "CONTA_REATIVADA" : "CONTA_DESATIVADA",
    });
  }

  return jsonOauth({ usuario: await ctx.repo.buscarParaListagemPorId(alvo.id, ctx.agoraUtc) });
}

/** POST /api/users/:id/senha — Direção redefine a senha de alguém e recebe a provisória uma vez. */
export async function redefinirSenha(ctx: ContextoOauth, id: string): Promise<Response> {
  const sessao = await exigirDirecao(ctx);
  if (sessao instanceof Response) return sessao;

  const alvo = await ctx.repo.buscarParaListagemPorId(id, ctx.agoraUtc);
  if (!alvo) return erro(404, "USUARIO_NAO_ENCONTRADO", "Conta não encontrada.");

  const senhaProvisoria = gerarSenhaProvisoria();
  const armazenada = await criarSenha(senhaProvisoria);
  await ctx.repo.definirSenha(alvo.id, armazenada, true, ctx.agoraUtc);
  // Redefinir senha encerra o que estava conectado em nome da pessoa: é o que se espera de
  // "redefinir a senha de alguém" — inclusive quando o motivo é suspeita de acesso indevido.
  await ctx.repo.revogarTokensDoUsuario(alvo.id, ctx.agoraUtc);
  await registrar(ctx.repo, ctx.agoraUtc, { userId: alvo.id, ator: sessao, tipo: "SENHA_REDEFINIDA" });

  return jsonOauth({ usuario: await ctx.repo.buscarParaListagemPorId(alvo.id, ctx.agoraUtc), senha_provisoria: senhaProvisoria });
}

/** POST /api/me/senha — qualquer pessoa logada troca a própria senha, conferindo a atual. */
export async function trocarPropriaSenha(ctx: ContextoOauth): Promise<Response> {
  const sessao = await sessaoAtual(ctx);
  if (!sessao) return erro(401, "NAO_AUTENTICADO", "Entre com sua conta para trocar a senha.");

  let corpo: unknown;
  try {
    corpo = await ctx.request.json();
  } catch {
    return erro(400, "CORPO_INVALIDO", "Envie a senha atual e a nova.");
  }
  const analisado = esquemaTrocaDeSenha.safeParse(corpo);
  if (!analisado.success) {
    return erro(400, "SENHA_CURTA", `A nova senha precisa de pelo menos ${TAMANHO_MINIMO_SENHA} caracteres.`);
  }

  const usuario = await ctx.repo.buscarUsuarioPorId(sessao.userId);
  if (!usuario) return erro(401, "NAO_AUTENTICADO", "Sessão inválida. Entre novamente.");

  const confere = await conferirSenha(analisado.data.senha_atual, {
    hash: usuario.senhaHash,
    salt: usuario.senhaSalt,
    iteracoes: usuario.senhaIteracoes,
  });
  if (!confere) return erro(401, "SENHA_ATUAL_INCORRETA", "A senha atual não confere.");
  if (analisado.data.senha_nova === analisado.data.senha_atual) {
    return erro(400, "SENHA_REPETIDA", "A nova senha precisa ser diferente da atual.");
  }

  const armazenada = await criarSenha(analisado.data.senha_nova);
  await ctx.repo.definirSenha(usuario.id, armazenada, false, ctx.agoraUtc);
  await registrar(ctx.repo, ctx.agoraUtc, { userId: usuario.id, ator: sessao, tipo: "SENHA_TROCADA" });

  return jsonOauth({ trocada: true });
}

/** Gera uma senha para uso em teste ou script sem duplicar o alfabeto. */
export function senhaAleatoriaForte(): string {
  return segredoAleatorio(18);
}
