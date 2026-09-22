import type { PapelSessao } from "../auth/session";
import { hashSha256 } from "../auth/crypto-texto";

/**
 * Acesso a contas e ao estado do OAuth. Fica separado dos repositórios de domínio porque não é
 * domínio: é identidade e credencial, a camada que decide QUEM está falando antes de qualquer
 * regra de glosa rodar.
 *
 * Regra do arquivo: nenhum segredo trafega ou é gravado em claro. Código de autorização e token
 * entram sempre como hash SHA-256 — os métodos recebem o valor original e hasheiam aqui, para
 * que nenhum chamador precise lembrar disso.
 */

export interface UsuarioComSenha {
  readonly id: string;
  readonly email: string;
  readonly nome: string;
  readonly papel: PapelSessao;
  readonly senhaHash: string;
  readonly senhaSalt: string;
  readonly senhaIteracoes: number;
  /** Senha criada pela Direção: vale para entrar uma vez e obriga a troca antes de qualquer outra coisa. */
  readonly senhaProvisoria: boolean;
  /** Quantas senhas erradas seguidas. Zera no primeiro acerto. */
  readonly tentativasFalhas: number;
  /** Enquanto estiver no futuro, a conta recusa login mesmo com a senha certa. */
  readonly bloqueadoAteUtc: string | null;
}

/** Linha da tela de administração — sem nada de credencial. */
export interface UsuarioParaListagem {
  readonly id: string;
  readonly email: string;
  readonly nome: string;
  readonly papel: PapelSessao;
  readonly ativo: boolean;
  readonly senhaProvisoria: boolean;
  readonly bloqueado: boolean;
  readonly ultimoAcessoUtc: string | null;
  readonly criadoEmUtc: string;
}

export interface NovoUsuario {
  readonly id: string;
  readonly email: string;
  readonly nome: string;
  readonly papel: PapelSessao;
  readonly senhaHash: string;
  readonly senhaSalt: string;
  readonly senhaIteracoes: number;
  readonly criadoPorUserId: string | null;
}

export type TipoEventoUsuario =
  | "CONTA_CRIADA"
  | "PAPEL_ALTERADO"
  | "CONTA_DESATIVADA"
  | "CONTA_REATIVADA"
  | "SENHA_REDEFINIDA"
  | "SENHA_TROCADA"
  | "CONTA_BLOQUEADA"
  | "ACESSO_REALIZADO";

export interface EventoUsuario {
  readonly id: string;
  readonly userId: string;
  readonly nomeUsuario: string;
  readonly tipo: TipoEventoUsuario;
  readonly atorEmail: string | null;
  readonly metadata: Record<string, unknown>;
  readonly ocorridoEmUtc: string;
}

export interface ClienteOauth {
  readonly id: string;
  readonly nome: string;
  readonly redirectUris: readonly string[];
  readonly grantTypes: readonly string[];
}

export interface CodigoAutorizacao {
  readonly clientId: string;
  readonly userId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly scope: string;
  readonly expiraEmUtc: string;
  readonly usadoEmUtc: string | null;
}

export interface TokenOauth {
  readonly tipo: "ACCESS" | "REFRESH";
  readonly clientId: string;
  readonly userId: string;
  readonly scope: string;
  readonly expiraEmUtc: string;
  readonly revogadoEmUtc: string | null;
}

interface LinhaUsuario {
  id: string;
  email: string;
  nome: string;
  papel: string;
  senha_hash: string;
  senha_salt: string;
  senha_iteracoes: number;
  senha_provisoria: number;
  tentativas_falhas: number;
  bloqueado_ate_utc: string | null;
}

const COLUNAS_USUARIO =
  "id, email, nome, papel, senha_hash, senha_salt, senha_iteracoes, senha_provisoria, tentativas_falhas, bloqueado_ate_utc";

export class RepositorioIdentidadeD1 {
  constructor(private readonly db: D1Database) {}

  /** Busca por e-mail normalizado (minúsculas, sem espaço nas pontas). Só contas ativas entram. */
  async buscarUsuarioPorEmail(email: string): Promise<UsuarioComSenha | null> {
    const linha = await this.db
      .prepare(`SELECT ${COLUNAS_USUARIO} FROM users WHERE email = ? AND ativo = 1`)
      .bind(email.trim().toLowerCase())
      .first<LinhaUsuario>();
    return linha ? this.paraUsuario(linha) : null;
  }

  async buscarUsuarioPorId(id: string): Promise<UsuarioComSenha | null> {
    const linha = await this.db
      .prepare(`SELECT ${COLUNAS_USUARIO} FROM users WHERE id = ? AND ativo = 1`)
      .bind(id)
      .first<LinhaUsuario>();
    return linha ? this.paraUsuario(linha) : null;
  }

  private paraUsuario(linha: LinhaUsuario): UsuarioComSenha {
    return {
      id: linha.id,
      email: linha.email,
      nome: linha.nome,
      papel: linha.papel as PapelSessao,
      senhaHash: linha.senha_hash,
      senhaSalt: linha.senha_salt,
      senhaIteracoes: linha.senha_iteracoes,
      senhaProvisoria: linha.senha_provisoria === 1,
      tentativasFalhas: linha.tentativas_falhas,
      bloqueadoAteUtc: linha.bloqueado_ate_utc,
    };
  }

  // --- clientes registrados dinamicamente -------------------------------

  async registrarCliente(cliente: ClienteOauth, agoraUtc: string): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO oauth_clients (id, client_name, redirect_uris_json, grant_types_json, token_endpoint_auth_method, created_at_utc) VALUES (?, ?, ?, ?, 'none', ?)",
      )
      .bind(cliente.id, cliente.nome, JSON.stringify(cliente.redirectUris), JSON.stringify(cliente.grantTypes), agoraUtc)
      .run();
  }

  async buscarCliente(clientId: string): Promise<ClienteOauth | null> {
    const linha = await this.db
      .prepare("SELECT id, client_name, redirect_uris_json, grant_types_json FROM oauth_clients WHERE id = ?")
      .bind(clientId)
      .first<{ id: string; client_name: string; redirect_uris_json: string; grant_types_json: string }>();
    if (!linha) return null;
    return {
      id: linha.id,
      nome: linha.client_name,
      redirectUris: JSON.parse(linha.redirect_uris_json) as string[],
      grantTypes: JSON.parse(linha.grant_types_json) as string[],
    };
  }

  // --- código de autorização --------------------------------------------

  async guardarCodigo(
    codigo: string,
    dados: Omit<CodigoAutorizacao, "usadoEmUtc">,
    agoraUtc: string,
    resource: string | null,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO oauth_authorization_codes
           (code_hash, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, resource, expires_at_utc, created_at_utc)
         VALUES (?, ?, ?, ?, ?, 'S256', ?, ?, ?, ?)`,
      )
      .bind(
        await hashSha256(codigo),
        dados.clientId,
        dados.userId,
        dados.redirectUri,
        dados.codeChallenge,
        dados.scope,
        resource,
        dados.expiraEmUtc,
        agoraUtc,
      )
      .run();
  }

  async buscarCodigo(codigo: string): Promise<CodigoAutorizacao | null> {
    const linha = await this.db
      .prepare(
        "SELECT client_id, user_id, redirect_uri, code_challenge, scope, expires_at_utc, used_at_utc FROM oauth_authorization_codes WHERE code_hash = ?",
      )
      .bind(await hashSha256(codigo))
      .first<{
        client_id: string;
        user_id: string;
        redirect_uri: string;
        code_challenge: string;
        scope: string;
        expires_at_utc: string;
        used_at_utc: string | null;
      }>();
    if (!linha) return null;
    return {
      clientId: linha.client_id,
      userId: linha.user_id,
      redirectUri: linha.redirect_uri,
      codeChallenge: linha.code_challenge,
      scope: linha.scope,
      expiraEmUtc: linha.expires_at_utc,
      usadoEmUtc: linha.used_at_utc,
    };
  }

  /**
   * Marca o código como usado e só afeta a linha que ainda não tinha sido usada. O `UPDATE`
   * condicional é o que dá atomicidade: duas trocas simultâneas do mesmo código resultam em uma
   * bem-sucedida e uma recusada, sem leitura-e-depois-escrita.
   */
  async consumirCodigo(codigo: string, agoraUtc: string): Promise<boolean> {
    const resultado = await this.db
      .prepare("UPDATE oauth_authorization_codes SET used_at_utc = ? WHERE code_hash = ? AND used_at_utc IS NULL")
      .bind(agoraUtc, await hashSha256(codigo))
      .run();
    return (resultado.meta.changes ?? 0) === 1;
  }

  // --- tokens -----------------------------------------------------------

  async guardarToken(token: string, dados: Omit<TokenOauth, "revogadoEmUtc">, agoraUtc: string): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO oauth_tokens (token_hash, tipo, client_id, user_id, scope, expires_at_utc, created_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(await hashSha256(token), dados.tipo, dados.clientId, dados.userId, dados.scope, dados.expiraEmUtc, agoraUtc)
      .run();
  }

  async buscarToken(token: string): Promise<TokenOauth | null> {
    const linha = await this.db
      .prepare("SELECT tipo, client_id, user_id, scope, expires_at_utc, revoked_at_utc FROM oauth_tokens WHERE token_hash = ?")
      .bind(await hashSha256(token))
      .first<{
        tipo: string;
        client_id: string;
        user_id: string;
        scope: string;
        expires_at_utc: string;
        revoked_at_utc: string | null;
      }>();
    if (!linha) return null;
    return {
      tipo: linha.tipo as "ACCESS" | "REFRESH",
      clientId: linha.client_id,
      userId: linha.user_id,
      scope: linha.scope,
      expiraEmUtc: linha.expires_at_utc,
      revogadoEmUtc: linha.revoked_at_utc,
    };
  }

  /** Revoga um token específico. Devolve `true` se havia um token vivo para revogar. */
  async revogarToken(token: string, agoraUtc: string): Promise<boolean> {
    const resultado = await this.db
      .prepare("UPDATE oauth_tokens SET revoked_at_utc = ? WHERE token_hash = ? AND revoked_at_utc IS NULL")
      .bind(agoraUtc, await hashSha256(token))
      .run();
    return (resultado.meta.changes ?? 0) === 1;
  }

  /** Revoga toda a sessão do par usuário+cliente — usado na rotação do refresh e em "desconectar". */
  async revogarTokensDoCliente(userId: string, clientId: string, agoraUtc: string): Promise<void> {
    await this.db
      .prepare("UPDATE oauth_tokens SET revoked_at_utc = ? WHERE user_id = ? AND client_id = ? AND revoked_at_utc IS NULL")
      .bind(agoraUtc, userId, clientId)
      .run();
  }

  /** Revoga TODOS os tokens de uma pessoa — usado ao desativar a conta ou trocar o papel dela. */
  async revogarTokensDoUsuario(userId: string, agoraUtc: string): Promise<void> {
    await this.db
      .prepare("UPDATE oauth_tokens SET revoked_at_utc = ? WHERE user_id = ? AND revoked_at_utc IS NULL")
      .bind(agoraUtc, userId)
      .run();
  }

  // --- administração de contas ------------------------------------------

  /** Lista para a tela de administração, inclusive contas desativadas (elas podem ser reativadas). */
  async listarUsuarios(agoraUtc: string): Promise<readonly UsuarioParaListagem[]> {
    const linhas = await this.db
      .prepare(
        "SELECT id, email, nome, papel, ativo, senha_provisoria, bloqueado_ate_utc, ultimo_acesso_utc, created_at_utc FROM users ORDER BY ativo DESC, nome ASC",
      )
      .all<{
        id: string;
        email: string;
        nome: string;
        papel: string;
        ativo: number;
        senha_provisoria: number;
        bloqueado_ate_utc: string | null;
        ultimo_acesso_utc: string | null;
        created_at_utc: string;
      }>();

    return linhas.results.map((linha) => ({
      id: linha.id,
      email: linha.email,
      nome: linha.nome,
      papel: linha.papel as PapelSessao,
      ativo: linha.ativo === 1,
      senhaProvisoria: linha.senha_provisoria === 1,
      bloqueado: linha.bloqueado_ate_utc !== null && Date.parse(linha.bloqueado_ate_utc) > Date.parse(agoraUtc),
      ultimoAcessoUtc: linha.ultimo_acesso_utc,
      criadoEmUtc: linha.created_at_utc,
    }));
  }

  /** Já existe conta com este e-mail, ativa ou não? Dá erro legível antes de esbarrar na chave única. */
  async emailJaUsado(email: string): Promise<boolean> {
    const linha = await this.db
      .prepare("SELECT 1 AS existe FROM users WHERE email = ?")
      .bind(email.trim().toLowerCase())
      .first<{ existe: number }>();
    return linha !== null;
  }

  /** Conta criada pela Direção nasce com senha provisória: serve para entrar uma vez e trocar. */
  async criarUsuario(usuario: NovoUsuario, agoraUtc: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO users (id, email, nome, papel, senha_hash, senha_salt, senha_iteracoes, ativo, senha_provisoria, criado_por_user_id, created_at_utc, updated_at_utc)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`,
      )
      .bind(
        usuario.id,
        usuario.email.trim().toLowerCase(),
        usuario.nome,
        usuario.papel,
        usuario.senhaHash,
        usuario.senhaSalt,
        usuario.senhaIteracoes,
        usuario.criadoPorUserId,
        agoraUtc,
        agoraUtc,
      )
      .run();
  }

  async buscarParaListagemPorId(id: string, agoraUtc: string): Promise<UsuarioParaListagem | null> {
    const todos = await this.listarUsuarios(agoraUtc);
    return todos.find((usuario) => usuario.id === id) ?? null;
  }

  async alterarPapel(userId: string, papel: PapelSessao, agoraUtc: string): Promise<void> {
    await this.db
      .prepare("UPDATE users SET papel = ?, updated_at_utc = ? WHERE id = ?")
      .bind(papel, agoraUtc, userId)
      .run();
  }

  async definirAtivo(userId: string, ativo: boolean, agoraUtc: string): Promise<void> {
    await this.db
      .prepare("UPDATE users SET ativo = ?, updated_at_utc = ? WHERE id = ?")
      .bind(ativo ? 1 : 0, agoraUtc, userId)
      .run();
  }

  /** Redefinição pela Direção: a senha nova nasce provisória e obriga troca no próximo acesso. */
  async definirSenha(
    userId: string,
    senha: { readonly hash: string; readonly salt: string; readonly iteracoes: number },
    provisoria: boolean,
    agoraUtc: string,
  ): Promise<void> {
    await this.db
      .prepare(
        "UPDATE users SET senha_hash = ?, senha_salt = ?, senha_iteracoes = ?, senha_provisoria = ?, tentativas_falhas = 0, bloqueado_ate_utc = NULL, updated_at_utc = ? WHERE id = ?",
      )
      .bind(senha.hash, senha.salt, senha.iteracoes, provisoria ? 1 : 0, agoraUtc, userId)
      .run();
  }

  /** Quantas Direções ativas existem — a regra impede tirar a última (ninguém administraria contas depois). */
  async contarDirecoesAtivas(): Promise<number> {
    const linha = await this.db
      .prepare("SELECT COUNT(*) AS total FROM users WHERE papel = 'DIRECAO' AND ativo = 1")
      .first<{ total: number }>();
    return linha?.total ?? 0;
  }

  // --- tentativas de senha e último acesso -------------------------------

  async registrarAcesso(userId: string, agoraUtc: string): Promise<void> {
    await this.db
      .prepare("UPDATE users SET ultimo_acesso_utc = ?, tentativas_falhas = 0, bloqueado_ate_utc = NULL WHERE id = ?")
      .bind(agoraUtc, userId)
      .run();
  }

  /**
   * Conta a tentativa errada e, ao chegar no limite, bloqueia a conta por um tempo. Devolve se o
   * bloqueio acabou de acontecer, para virar evento de auditoria.
   */
  async registrarFalhaDeSenha(
    userId: string,
    limite: number,
    bloqueioMs: number,
    agoraUtc: string,
  ): Promise<{ readonly bloqueou: boolean; readonly tentativas: number }> {
    const linha = await this.db
      .prepare("SELECT tentativas_falhas FROM users WHERE id = ?")
      .bind(userId)
      .first<{ tentativas_falhas: number }>();
    const tentativas = (linha?.tentativas_falhas ?? 0) + 1;
    const bloqueou = tentativas >= limite;
    await this.db
      .prepare("UPDATE users SET tentativas_falhas = ?, bloqueado_ate_utc = ?, updated_at_utc = ? WHERE id = ?")
      .bind(
        bloqueou ? 0 : tentativas,
        bloqueou ? new Date(Date.parse(agoraUtc) + bloqueioMs).toISOString() : null,
        agoraUtc,
        userId,
      )
      .run();
    return { bloqueou, tentativas };
  }

  // --- histórico de identidade (append-only) -----------------------------

  async registrarEvento(evento: {
    readonly id: string;
    readonly userId: string;
    readonly atorUserId: string | null;
    readonly atorEmail: string | null;
    readonly tipo: TipoEventoUsuario;
    readonly metadata: Record<string, unknown>;
    readonly ocorridoEmUtc: string;
    readonly registradoEmUtc: string;
  }): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO user_events (id, user_id, actor_user_id, actor_email, event_type, metadata_json, occurred_at_utc, recorded_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        evento.id,
        evento.userId,
        evento.atorUserId,
        evento.atorEmail,
        evento.tipo,
        JSON.stringify(evento.metadata),
        evento.ocorridoEmUtc,
        evento.registradoEmUtc,
      )
      .run();
  }

  async listarEventos(limite: number): Promise<readonly EventoUsuario[]> {
    const linhas = await this.db
      .prepare(
        `SELECT e.id, e.user_id, u.nome AS nome_usuario, e.event_type, e.actor_email, e.metadata_json, e.occurred_at_utc
         FROM user_events e JOIN users u ON u.id = e.user_id
         ORDER BY e.recorded_at_utc DESC LIMIT ?`,
      )
      .bind(limite)
      .all<{
        id: string;
        user_id: string;
        nome_usuario: string;
        event_type: string;
        actor_email: string | null;
        metadata_json: string;
        occurred_at_utc: string;
      }>();

    return linhas.results.map((linha) => ({
      id: linha.id,
      userId: linha.user_id,
      nomeUsuario: linha.nome_usuario,
      tipo: linha.event_type as TipoEventoUsuario,
      atorEmail: linha.actor_email,
      metadata: JSON.parse(linha.metadata_json) as Record<string, unknown>,
      ocorridoEmUtc: linha.occurred_at_utc,
    }));
  }
}
