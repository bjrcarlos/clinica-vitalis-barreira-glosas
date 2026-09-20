# Migrations D1

Regra única e não negociável: **migração já aplicada nunca é editada.**

Qualquer mudança de schema — mesmo pequena — entra como um novo arquivo numerado
sequencialmente (`0002_*.sql`, `0003_*.sql`, ...), nunca como alteração retroativa
de um arquivo existente. Isso vale mesmo antes do primeiro deploy real: o hábito
é o que evita corromper o histórico depois.

Aplicação local: `pnpm db:migrate:local` (ver `CLAUDE.md` na raiz do projeto).
