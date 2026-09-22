# Workflow Ralph — Fase 2

Entrada limpa: PRD §33/Fase 2, handoff da Fase 1 e contrato HTTP/UI.

Loop executado: rotas → relatório/lista/detalhe → correção/diff → importação CSV/XLSX → sessão
assinada → typecheck/test/build → demonstração relatório → detalhe → correção → revalidação.

Gate: aprovado funcionalmente e reconfirmado com o portão verde. Ressalvas documentadas: UI de
ações de governança pertence à Fase 3 e deploy público à Fase 5.

Evidências: `phase-2-handoff.md`, `tests/write-handlers.test.ts`, `tests/report.test.ts`.
