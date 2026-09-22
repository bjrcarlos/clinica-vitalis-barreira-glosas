-- 0002: identidade individual e OAuth 2.1 para o MCP.
--
-- Até aqui o MCP autenticava por dois Bearer fixos (um por área) e a interface usava um cookie
-- de identidade funcional escolhido na tela. Isso responde "qual área", nunca "quem". Esta
-- migração introduz a conta individual e o fluxo OAuth que o cliente de IA executa sozinho:
-- a pessoa entra com e-mail e senha, autoriza o cliente, e o papel do token passa a ser o papel
-- da conta — nunca um parâmetro de tool.
--
-- Os Bearer fixos continuam aceitos como atalho de demonstração (decisão do dono do produto).

-- users: quem entra no sistema. O papel é a fonte da verdade da permissão, no MCP e na interface.
CREATE TABLE users (
  id                TEXT PRIMARY KEY NOT NULL,
  email             TEXT NOT NULL UNIQUE,
  nome              TEXT NOT NULL,
  papel             TEXT NOT NULL
    CHECK (papel IN ('SECRETARIA', 'FINANCEIRO', 'DIRECAO')),
  -- PBKDF2-SHA256 (WebCrypto). Senha nunca é gravada em claro, nem aqui nem em log.
  senha_hash        TEXT NOT NULL,
  senha_salt        TEXT NOT NULL,
  senha_iteracoes   INTEGER NOT NULL,
  ativo             INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  created_at_utc    TEXT NOT NULL,
  updated_at_utc    TEXT NOT NULL
);

CREATE INDEX idx_users_email ON users (email);

-- oauth_clients: cliente registrado dinamicamente (RFC 7591). São clientes públicos: sem secret,
-- PKCE obrigatório. É o que permite ao Claude Code / Codex se registrarem sem ninguém copiar nada.
CREATE TABLE oauth_clients (
  id                          TEXT PRIMARY KEY NOT NULL,
  client_name                 TEXT NOT NULL,
  redirect_uris_json          TEXT NOT NULL,
  grant_types_json            TEXT NOT NULL,
  token_endpoint_auth_method  TEXT NOT NULL
    CHECK (token_endpoint_auth_method IN ('none')),
  created_at_utc              TEXT NOT NULL
);

-- oauth_authorization_codes: código de autorização de uso único, ligado ao desafio PKCE.
-- Guardamos o HASH do código, nunca o código — vazamento de banco não vira sessão.
CREATE TABLE oauth_authorization_codes (
  code_hash              TEXT PRIMARY KEY NOT NULL,
  client_id              TEXT NOT NULL,
  user_id                TEXT NOT NULL,
  redirect_uri           TEXT NOT NULL,
  code_challenge         TEXT NOT NULL,
  code_challenge_method  TEXT NOT NULL CHECK (code_challenge_method IN ('S256')),
  scope                  TEXT NOT NULL,
  resource               TEXT NULL,
  expires_at_utc         TEXT NOT NULL,
  used_at_utc            TEXT NULL,
  created_at_utc         TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES oauth_clients (id),
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE INDEX idx_oauth_codes_expira ON oauth_authorization_codes (expires_at_utc);

-- oauth_tokens: access e refresh, também guardados por hash. Revogação é marcação, não DELETE —
-- mesma disciplina de histórico do resto do sistema.
CREATE TABLE oauth_tokens (
  token_hash        TEXT PRIMARY KEY NOT NULL,
  tipo              TEXT NOT NULL CHECK (tipo IN ('ACCESS', 'REFRESH')),
  client_id         TEXT NOT NULL,
  user_id           TEXT NOT NULL,
  scope             TEXT NOT NULL,
  expires_at_utc    TEXT NOT NULL,
  revoked_at_utc    TEXT NULL,
  created_at_utc    TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES oauth_clients (id),
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE INDEX idx_oauth_tokens_usuario ON oauth_tokens (user_id, tipo);
CREATE INDEX idx_oauth_tokens_expira ON oauth_tokens (expires_at_utc);
