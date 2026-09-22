# Handoff — Fase 4 (IA e MCP)

## Entregas

- `POST /mcp` é stateless e valida JSON-RPC, Bearer e as cinco tools.
- Tokens Secretaria/Financeiro são comparados por hash e o papel não é input da tool.
- `consultar_regra` lê a regra ativa; `verificar_guia` aceita `id_guia` ou guia estruturada sem
  persistir; `registrar_guia` é exclusivo da Secretaria e idempotente por origem.
- `minhas_pendencias` deriva a área da credencial e emite links HMAC de revisão com área,
  finalidade, recurso, expiração e nonce.
- `consultar_historico` filtra por papel e não retorna binários ou secrets.
- Interpreter IA envia apenas contexto mínimo, valida schema estruturado e persiste status/modelo,
  prompt, input e output na validação de uma guia registrada pelo MCP. Erro/indisponibilidade usa
  fallback conservador para revisão humana.
- Skill `conferir-guia-vitalis` documenta extração fiel, lacunas, exemplos e confirmação explícita.

## Prova MCP local

```text
tools/list: 200, 5 tools
consultar_regra Secretaria: 200
verificar_guia sem persistir: 200
minhas_pendencias Secretaria: 27
minhas_pendencias Financeiro: 43
registrar_guia Financeiro: negado
consultar_historico Financeiro: 200
```

Workers AI ficou indisponível no binding local; isso foi tratado como fallback `FALHOU`, não como
decisão automática.

## Gate

Passou com typecheck, suíte completa e build. A prova remota de Workers AI depende de conta Cloudflare.
