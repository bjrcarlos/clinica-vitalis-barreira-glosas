# Workflow Ralph — Fase 3

Entrada limpa: PRD §33/Fase 3, handoff da Fase 2 e schema de evidências/merge.

Loop executado: armazenamento R2/hash → rotas reais → detalhe enriquecido → envio condicionado →
encerramento/revisão → comparação/merge → Worker local → reseed de restauração → testes/build.

Gate: aprovado na prova local. O Worker demonstrou upload `201`, liberação/envio `200`, detalhe
com evidência/envio, download assinado `200`, comparação `200`, commit de merge `201`, origem em
`MESCLADA` e merge visível no protocolo principal.

Evidências: `phase-3-handoff.md`, `src/http/handlers/evidence.ts`, `merges.ts`, `tests/*` de
evidência/links/envio e saída E2E registrada no handoff.
