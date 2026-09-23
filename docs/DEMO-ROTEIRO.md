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
5. Abrir uma guia com procedimento fora do convênio (`NÃO FATURAR AO CONVÊNIO`) e mostrar que ela
   não segue para liberação normal; pela identidade Financeiro, encerrar como particular ou como
   cobrança cancelada informando o motivo, e conferir que o protocolo sai da lista de pendências.

## Conectar um assistente por OAuth

1. Abrir `/conectar`, copiar o texto do Claude Code e colar no assistente; ele registra o
   servidor sozinho e abre o login.
2. Entrar como `secretaria@vitalis.example`; mostrar a tela de autorização com o nome da pessoa,
   o papel e a lista do que o assistente poderá fazer.
3. Pedir "minhas pendências" ao assistente e mostrar que vêm as 27 da Secretaria, sem nenhum
   parâmetro de área.
4. Sair, entrar como `direcao@vitalis.example`, reconectar e repetir o pedido: a mesma tool
   responde que a Direção não tem fila e aponta `consultar_relatorio`.
5. Mostrar em `/conectar` que a tabela de permissões corresponde ao que acabou de acontecer.

## MCP (Bearer fixo, atalho de demonstração)

1. Com o Bearer da Secretaria, chamar `tools/list`, `consultar_regra`, `verificar_guia` e
   `minhas_pendencias`; destacar que a última deriva a área da credencial.
2. Chamar `verificar_guia` com uma guia real e mostrar `persistiu: false`.
3. Tentar `registrar_guia` com o Bearer Financeiro e mostrar a negativa.
4. Com a Secretaria, registrar uma guia nova somente após confirmar os dados; repetir a mesma origem
   para demonstrar idempotência.
5. Prazo de envio excedido (RN-09): nenhuma das 80 guias da amostra de agosto dispara essa regra —
   a maior distância entre `data_lancamento` e `data_atendimento` na base é de 3 dias, e os prazos
   dos convênios são de 30 e 45 dias. A regra existe, é determinística e tem teste de borda, mas é
   estruturalmente inerte com esses dados; por isso ela é demonstrada com uma guia colada, nunca
   pela lista das 80. Chamar `verificar_guia` com um objeto `guia` (não `id_guia`) do convênio
   Vitalcard, com `data_atendimento` no início de agosto (ex.: `2026-08-05`) e `data_lancamento`
   bem depois do prazo de 30 dias do convênio (ex.: `2026-09-20`), mantendo os demais campos
   completos e coerentes (autorização válida, procedimento coberto). O retorno é `REVISÃO HUMANA`
   com o problema `PRAZO_ENVIO_EXCEDIDO` e seus quatro subproblemas — atendimento, lançamento, data
   limite e prazo do convênio — e `persistiu: false`: a conferência não cria protocolo nem toca na
   base das 80 guias.

## Skill operacional

1. Num agente com a Skill `conferir-guia-vitalis` carregada, colar uma guia como a recepção
   escreveria (texto livre, não JSON) — ex.: "id G-TEST-01, unidade Centro, atendimento
   2026-08-10, paciente P-1, convênio Vitalcard, procedimento 50000470, autorização AUT-1 válida
   até 2026-09-10, valor 120,00, lançamento 2026-08-10." Mostrar que a Skill lista os campos
   ausentes sem inventá-los, chama `consultar_regra`/`verificar_guia` e devolve a resposta no
   formato fixo (estado, resumo, problemas, regra e versão aplicadas, próximo passo e o aviso de
   que nada foi gravado).
2. Colar uma guia claramente incompleta (ex.: "Paciente Maria, Vitalcard, fez fisioterapia
   ontem.") e mostrar que a Skill pede os campos obrigatórios em vez de adivinhar, sem chamar
   `registrar_guia`.
3. Pedir explicitamente "registre esta guia" sobre a guia completa do passo 1 e mostrar que a
   Skill só chama `registrar_guia` depois de confirmar o `id_guia_origem` idempotente.

## Fechamento

Mostrar o README, os handoffs em `docs/PROGRESS/`, a Skill do operador e os gates:
`corepack pnpm typecheck`, `corepack pnpm test` e `corepack pnpm build`. Explicar que deploy remoto e
configuração de produção exigem decisão do proprietário.
