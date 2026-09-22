# Handoff — Fase 3 (Governança, evidência e merge)

## Entregas

- Worker registra as nove rotas da Fase 3.
- Upload multipart aceita PDF/JPEG/PNG até 10 MB, calcula SHA-256, sanitiza nome e grava R2
  privado antes dos metadados D1; falha de D1 remove o objeto órfão.
- `GET /api/evidence/:id` sem token emite link HMAC temporário; com token serve o binário privado.
- Invalidação é append-only no objeto, com motivo obrigatório.
- Envio exige estado `LIBERADA_PARA_ENVIO` e evidência válida; o evento separa ocorrido de registrado.
- Encerramento particular/cancelado e decisão de revisão humana preservam eventos e histórico.
- Compare/commit de merge cria nova versão no principal, revalida, registra `protocol_merges`,
  marca a origem como `MESCLADA` e replica vínculos de evidência sem duplicar o arquivo.
- Detalhe agora devolve `evidencias`, `merge` e `envio` sempre, inclusive listas vazias/nulo.

## Prova E2E local

Com o seed oficial e `wrangler dev --local`:

```text
session 200
upload 201
evidencesAfterUpload 1
release 200
send 200
envioPresent true
mergeCompare 200
mergeCommit 201
mergeVisible true
originStatus MESCLADA
linkIssue 200
download 200
```

O banco foi resemeado depois da prova. O script de seed agora limpa links/objetos de evidência e
merges antes de recarregar protocolos, evitando falha de FK ao restaurar a demonstração.

## Gate

Passou com `corepack pnpm typecheck`, `corepack pnpm test` (169/169) e `corepack pnpm build`.
