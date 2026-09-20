-- 0001_init.sql
-- Migração base do D1 — Barreira de Glosas Vitalis.
-- Fonte: docs/PRD-SDD.md §19 (modelo de dados) e §20 (índices).
-- Migração já aplicada nunca é editada; mudança futura entra como novo arquivo numerado
-- (ver migrations/README.md).
--
-- Convenções gerais:
--   * Datas canônicas: TEXT ISO 8601 UTC.
--   * Dinheiro: INTEGER em centavos.
--   * Booleano: INTEGER 0/1.
--   * JSON serializado: TEXT.
--   * Nenhum ON DELETE CASCADE em tabela histórica (protocolos, versões, eventos, evidências):
--     histórico nunca é apagado em cascata.

-- rule_sets: um conjunto de regras oficiais do convênio por versão (ex.: agosto/2026).
CREATE TABLE rule_sets (
  id                TEXT PRIMARY KEY NOT NULL,
  version           TEXT NOT NULL UNIQUE,
  source_json       TEXT NOT NULL,
  source_sha256     TEXT NOT NULL,
  imported_at_utc   TEXT NOT NULL,
  activated_at_utc  TEXT NULL,
  is_active         INTEGER NOT NULL CHECK (is_active IN (0, 1))
);

-- protocols: um caso (protocolo) rastreado de ponta a ponta, com seu estado corrente.
CREATE TABLE protocols (
  id                     TEXT PRIMARY KEY NOT NULL,
  protocol_number        TEXT NOT NULL UNIQUE,
  source_guide_id        TEXT NULL,
  current_version_id     TEXT NOT NULL,
  validation_status      TEXT NOT NULL
    CHECK (validation_status IN ('OK', 'CORRIGIR', 'REVISAO_HUMANA', 'NAO_FATURAR_CONVENIO')),
  workflow_status        TEXT NOT NULL
    CHECK (workflow_status IN (
      'EM_TRATAMENTO', 'LIBERADA_PARA_ENVIO', 'ENVIADA',
      'ENCERRADA_PARTICULAR', 'ENCERRADA_CANCELADA', 'MESCLADA'
    )),
  assigned_area          TEXT NULL
    CHECK (assigned_area IS NULL OR assigned_area IN ('SECRETARIA', 'FINANCEIRO', 'SISTEMA')),
  current_risk_cents     INTEGER NOT NULL,
  initial_risk_cents     INTEGER NOT NULL,
  merged_into_protocol_id TEXT NULL,
  created_at_utc         TEXT NOT NULL,
  updated_at_utc         TEXT NOT NULL,
  FOREIGN KEY (current_version_id) REFERENCES guide_versions (id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (merged_into_protocol_id) REFERENCES protocols (id)
);

-- guide_versions: cada versão histórica dos dados de uma guia dentro de um protocolo (append-only por versão).
CREATE TABLE guide_versions (
  id                        TEXT PRIMARY KEY NOT NULL,
  protocol_id               TEXT NOT NULL,
  version_number            INTEGER NOT NULL,
  raw_payload_json          TEXT NOT NULL,
  normalized_payload_json   TEXT NOT NULL,
  diff_json                 TEXT NOT NULL,
  change_reason             TEXT NULL,
  created_by_role           TEXT NOT NULL
    CHECK (created_by_role IN ('SECRETARIA', 'FINANCEIRO', 'SISTEMA')),
  created_by_principal      TEXT NOT NULL,
  occurred_at_utc           TEXT NOT NULL,
  recorded_at_utc           TEXT NOT NULL,
  CHECK (version_number = 1 OR change_reason IS NOT NULL),
  FOREIGN KEY (protocol_id) REFERENCES protocols (id)
);

-- validation_runs: uma execução do motor de validação (determinístico + IA) sobre uma versão de guia.
CREATE TABLE validation_runs (
  id                  TEXT PRIMARY KEY NOT NULL,
  protocol_id         TEXT NOT NULL,
  guide_version_id    TEXT NOT NULL,
  rule_set_id         TEXT NOT NULL,
  result_status       TEXT NOT NULL
    CHECK (result_status IN ('OK', 'CORRIGIR', 'REVISAO_HUMANA', 'NAO_FATURAR_CONVENIO')),
  summary             TEXT NOT NULL,
  ai_status           TEXT NOT NULL
    CHECK (ai_status IN ('NAO_EXECUTADA', 'CONCLUIDA', 'FALHOU')),
  ai_model            TEXT NULL,
  ai_prompt_version   TEXT NULL,
  ai_input_json       TEXT NULL,
  ai_output_json      TEXT NULL,
  started_at_utc      TEXT NOT NULL,
  finished_at_utc     TEXT NOT NULL,
  FOREIGN KEY (protocol_id) REFERENCES protocols (id),
  FOREIGN KEY (guide_version_id) REFERENCES guide_versions (id),
  FOREIGN KEY (rule_set_id) REFERENCES rule_sets (id)
);

-- validation_issues: cada problema apontado por uma execução de validação, com sua ação recomendada.
CREATE TABLE validation_issues (
  id                    TEXT PRIMARY KEY NOT NULL,
  validation_run_id     TEXT NOT NULL,
  code                  TEXT NOT NULL,
  title                 TEXT NOT NULL,
  recommended_action    TEXT NOT NULL,
  owner_area            TEXT NOT NULL
    CHECK (owner_area IN ('SECRETARIA', 'FINANCEIRO')),
  status                TEXT NOT NULL,
  subproblems_json      TEXT NOT NULL,
  rule_reference_json   TEXT NOT NULL,
  created_at_utc        TEXT NOT NULL,
  resolved_at_utc       TEXT NULL,
  FOREIGN KEY (validation_run_id) REFERENCES validation_runs (id)
);

-- tasks: pendência operacional acionável, aberta para uma área a partir de um problema (ou diretamente).
CREATE TABLE tasks (
  id               TEXT PRIMARY KEY NOT NULL,
  protocol_id      TEXT NOT NULL,
  issue_id         TEXT NULL,
  assigned_area    TEXT NOT NULL
    CHECK (assigned_area IN ('SECRETARIA', 'FINANCEIRO', 'SISTEMA')),
  task_type        TEXT NOT NULL,
  title            TEXT NOT NULL,
  status           TEXT NOT NULL,
  blocking         INTEGER NOT NULL CHECK (blocking IN (0, 1)),
  created_at_utc   TEXT NOT NULL,
  resolved_at_utc  TEXT NULL,
  FOREIGN KEY (protocol_id) REFERENCES protocols (id),
  FOREIGN KEY (issue_id) REFERENCES validation_issues (id)
);

-- workflow_events: trilha de auditoria append-only de tudo que aconteceu com um protocolo.
-- Nunca sofre UPDATE ou DELETE; correção de fato gerado vira novo evento, nunca edição do anterior.
CREATE TABLE workflow_events (
  id                TEXT PRIMARY KEY NOT NULL,
  protocol_id       TEXT NOT NULL,
  guide_version_id  TEXT NULL,
  event_type        TEXT NOT NULL,
  actor_role        TEXT NOT NULL
    CHECK (actor_role IN ('SECRETARIA', 'FINANCEIRO', 'SISTEMA')),
  actor_principal   TEXT NOT NULL,
  source            TEXT NOT NULL
    CHECK (source IN ('UI', 'MCP', 'IMPORTACAO', 'SISTEMA')),
  reason            TEXT NULL,
  metadata_json     TEXT NOT NULL,
  occurred_at_utc   TEXT NOT NULL,
  recorded_at_utc   TEXT NOT NULL,
  FOREIGN KEY (protocol_id) REFERENCES protocols (id),
  FOREIGN KEY (guide_version_id) REFERENCES guide_versions (id)
);

-- evidence_objects: metadados de cada arquivo de evidência privado guardado no R2.
CREATE TABLE evidence_objects (
  id                    TEXT PRIMARY KEY NOT NULL,
  r2_key                TEXT NOT NULL UNIQUE,
  original_filename     TEXT NOT NULL,
  content_type          TEXT NOT NULL,
  size_bytes            INTEGER NOT NULL,
  sha256                TEXT NOT NULL,
  uploaded_by_role      TEXT NOT NULL
    CHECK (uploaded_by_role IN ('SECRETARIA', 'FINANCEIRO', 'SISTEMA')),
  uploaded_by_principal TEXT NOT NULL,
  uploaded_at_utc       TEXT NOT NULL,
  invalidated_at_utc    TEXT NULL,
  invalidation_reason   TEXT NULL,
  CHECK (invalidated_at_utc IS NULL OR invalidation_reason IS NOT NULL)
);

-- evidence_links: liga uma evidência a um protocolo (e, opcionalmente, a um evento/versão),
-- permitindo que o mesmo objeto apareça em protocolos unidos sem duplicar o arquivo.
CREATE TABLE evidence_links (
  evidence_id         TEXT NOT NULL,
  protocol_id         TEXT NOT NULL,
  event_id            TEXT NULL,
  guide_version_id    TEXT NULL,
  relation_type       TEXT NOT NULL,
  origin_protocol_id  TEXT NOT NULL,
  PRIMARY KEY (evidence_id, protocol_id, relation_type),
  FOREIGN KEY (evidence_id) REFERENCES evidence_objects (id),
  FOREIGN KEY (protocol_id) REFERENCES protocols (id),
  FOREIGN KEY (event_id) REFERENCES workflow_events (id),
  FOREIGN KEY (guide_version_id) REFERENCES guide_versions (id),
  FOREIGN KEY (origin_protocol_id) REFERENCES protocols (id)
);

-- protocol_merges: registro histórico de cada fusão de protocolo duplicado no principal.
CREATE TABLE protocol_merges (
  id                      TEXT PRIMARY KEY NOT NULL,
  source_protocol_id      TEXT NOT NULL,
  target_protocol_id      TEXT NOT NULL,
  target_version_id       TEXT NOT NULL,
  field_resolution_json   TEXT NOT NULL,
  reason                  TEXT NOT NULL,
  performed_by_principal  TEXT NOT NULL,
  performed_at_utc        TEXT NOT NULL,
  FOREIGN KEY (source_protocol_id) REFERENCES protocols (id),
  FOREIGN KEY (target_protocol_id) REFERENCES protocols (id),
  FOREIGN KEY (target_version_id) REFERENCES guide_versions (id)
);

-- Índices (PRD §20). protocols(protocol_number) não é duplicado aqui: a UNIQUE
-- constraint acima já cria o índice equivalente.
CREATE INDEX idx_protocols_source_guide_id ON protocols (source_guide_id);
CREATE INDEX idx_protocols_status ON protocols (validation_status, workflow_status);
CREATE INDEX idx_protocols_assigned_area ON protocols (assigned_area);

CREATE INDEX idx_guide_versions_protocol_version ON guide_versions (protocol_id, version_number);

CREATE INDEX idx_validation_runs_version_finished ON validation_runs (guide_version_id, finished_at_utc);

CREATE INDEX idx_validation_issues_run_status ON validation_issues (validation_run_id, status);

CREATE INDEX idx_tasks_area_status_created ON tasks (assigned_area, status, created_at_utc);

CREATE INDEX idx_workflow_events_protocol_recorded ON workflow_events (protocol_id, recorded_at_utc);
CREATE INDEX idx_workflow_events_type_occurred ON workflow_events (event_type, occurred_at_utc);

CREATE INDEX idx_evidence_links_protocol ON evidence_links (protocol_id);
