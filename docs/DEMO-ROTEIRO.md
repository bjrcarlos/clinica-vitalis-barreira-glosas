# Roteiro de demonstração — Clínica Vitalis

## Preparação

1. Aplicar a migração local e executar `corepack pnpm seed:local`.
2. Iniciar `corepack pnpm dev --local --port 8787`.
3. Abrir a SPA e alternar a identidade pela sessão visual: Secretaria, Financeiro e Direção.

## Percurso principal

1. Abrir o relatório e mostrar os quatro blocos de contagem, risco e pendências antigas.
2. Abrir uma guia normal pela lista e mostrar versão, regra aplicada, problemas e trava.
3. Liberar uma guia elegível com a identidade Financeiro.
4. Anexar um comprovante PDF/JPEG/PNG; mostrar hash, autor e download por link temporário.
5. Registrar o envio com data do fato; mostrar no histórico a separação entre ocorrido e registrado.

## Exceções e histórico

1. Tentar liberar uma guia com pendência e mostrar o motivo da trava, sem esconder o botão.
2. Pela Secretaria, criar uma nova versão corrigida; mostrar diff, versão anterior intacta e nova validação.
3. Pela interface/endpoint de revisão, invalidar somente com motivo e evidência; conferir que a guia
   volta a `OK` e que o risco atual é zerado quando não restam pendências.
4. Comparar os dois protocolos marcados como duplicidade, escolher o principal e resolver cada campo
   divergente; executar o merge e abrir o histórico de ambas as origens.

## MCP

1. Com o Bearer da Secretaria, chamar `tools/list`, `consultar_regra`, `verificar_guia` e
   `minhas_pendencias`; destacar que a última deriva a área da credencial.
2. Chamar `verificar_guia` com uma guia real e mostrar `persistiu: false`.
3. Tentar `registrar_guia` com o Bearer Financeiro e mostrar a negativa.
4. Com a Secretaria, registrar uma guia nova somente após confirmar os dados; repetir a mesma origem
   para demonstrar idempotência.

## Fechamento

Mostrar o README, os handoffs em `docs/PROGRESS/`, a Skill do operador e os gates:
`corepack pnpm typecheck`, `corepack pnpm test` e `corepack pnpm build`. Explicar que deploy remoto,
configuração de produção e eventual limpeza do screenshot histórico exigem decisão do proprietário.
