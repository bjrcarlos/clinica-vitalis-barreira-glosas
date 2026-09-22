# Workflow Ralph — Fase 4

Entrada limpa: PRD §22–23, handoff da Fase 3, contratos HTTP e secrets locais.

Loop executado: schema IA/fallback → persistência de contexto/modelo/saída → autenticação Bearer
por área → tools MCP → links de revisão → Skill sem inferência → chamadas MCP com os dois papéis.

Gate: aprovado localmente para o contrato MCP. `tools/list` devolveu 5 tools; `consultar_regra`,
`verificar_guia`, pendências por área, histórico e negação de registro pelo Financeiro passaram.
Workers AI remoto não foi acionado no teste local; sem binding disponível, o fallback `FALHOU`
mantém revisão humana.

Evidências: `phase-4-handoff.md`, `src/mcp/server.ts`, `src/infrastructure/ai/interpreter.ts`,
`skills/conferir-guia-vitalis/SKILL.md`.
