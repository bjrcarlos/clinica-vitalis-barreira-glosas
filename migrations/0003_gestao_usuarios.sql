-- 0003: administração de contas pela interface.
--
-- A 0002 criou a conta e o login; criar ou desligar alguém ainda exigia rodar script no
-- terminal, o que não serve para uma clínica. Esta migração acrescenta o que falta para a
-- Direção administrar contas pela tela, com registro de quem fez o quê.
--
-- Três coisas entram:
--
-- 1. senha provisória — a Direção cria a conta, o sistema mostra uma senha uma única vez e a
--    pessoa é obrigada a trocá-la no primeiro acesso;
-- 2. defesa contra tentativa repetida de senha, por conta;
-- 3. `user_events`, append-only, para a pergunta "quem criou/desativou/mudou o papel de quem,
--    e quando" ter resposta — a mesma disciplina de `workflow_events`, que não serve aqui
--    porque toda linha dele exige um protocolo.

ALTER TABLE users ADD COLUMN senha_provisoria INTEGER NOT NULL DEFAULT 0 CHECK (senha_provisoria IN (0, 1));
ALTER TABLE users ADD COLUMN ultimo_acesso_utc TEXT NULL;
ALTER TABLE users ADD COLUMN criado_por_user_id TEXT NULL;
ALTER TABLE users ADD COLUMN tentativas_falhas INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN bloqueado_ate_utc TEXT NULL;

-- Histórico de identidade. Nunca sofre UPDATE nem DELETE: correção entra como evento novo.
CREATE TABLE user_events (
  id                TEXT PRIMARY KEY NOT NULL,
  user_id           TEXT NOT NULL,
  -- Quem executou. NULL quando foi o próprio sistema (ex.: bloqueio automático por tentativas).
  actor_user_id     TEXT NULL,
  actor_email       TEXT NULL,
  event_type        TEXT NOT NULL
    CHECK (event_type IN (
      'CONTA_CRIADA', 'PAPEL_ALTERADO', 'CONTA_DESATIVADA', 'CONTA_REATIVADA',
      'SENHA_REDEFINIDA', 'SENHA_TROCADA', 'CONTA_BLOQUEADA', 'ACESSO_REALIZADO'
    )),
  metadata_json     TEXT NOT NULL,
  occurred_at_utc   TEXT NOT NULL,
  recorded_at_utc   TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE INDEX idx_user_events_usuario ON user_events (user_id, recorded_at_utc);
