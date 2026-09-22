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
}

export class RepositorioIdentidadeD1 {
  constructor(private readonly db: D1Database) {}

  /** Busca por e-mail normalizado (minúsculas, sem espaço nas pontas). Só contas ativas entram. */
  async buscarUsuarioPorEmail(email: string): Promise<UsuarioComSenha | null> {
    const linha = await this.db
      .prepare("SELECT id, email, nome, papel, senha_hash, senha_salt, senha_iteracoes FROM users WHERE email = ? AND ativo = 1")
      .bind(email.trim().toLowerCase())
      .first<LinhaUsuario>();
    return linha ? this.paraUsuario(linha) : null;
  }

  async buscarUsuarioPorId(id: string): Promise<UsuarioComSenha | null> {
    const linha = await this.db
      .prepare("SELECT id, email, nome, papel, senha_hash, senha_salt, senha_iteracoes FROM users WHERE id = ? AND ativo = 1")
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
}
