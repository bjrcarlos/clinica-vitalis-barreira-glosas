# Barreira de Glosas — Clínica Vitalis

**Aplicação no ar:** <https://vitalis-barreira-glosas.bjrcarlos04.workers.dev>
**Endpoint MCP:** `POST https://vitalis-barreira-glosas.bjrcarlos04.workers.dev/mcp` (OAuth 2.1, ou Bearer por área)

Cloudflare Workers + React para conferir guias antes do envio ao convênio, bloquear liberações
inseguras, preservar versões e evidências, e expor consulta controlada por MCP a um assistente de
IA. Publicada em 22/09/2026 com D1 (`vitalis-glosas`), R2 (`vitalis-evidencias`) e Workers AI. As
80 guias da prova foram carregadas pela própria rota de importação: 80 aceitas, nenhuma rejeitada.

## Problema

A Clínica Vitalis fatura ~R$ 452 mil/mês em convênios e estima 8% disso em glosa, dos quais 40%
(~R$ 14,5 mil/mês) vêm de erro evitável: preenchimento incorreto ou autorização vencida que só
aparece quando o convênio devolve a cobrança, 45 a 90 dias depois. O erro nasce no intervalo entre
o lançamento da guia pela secretaria e o envio pelo financeiro — hoje sem verificação nenhuma
nesse meio. O produto atua exatamente aí: aplica as regras do convênio logo após o lançamento,
encaminha ambiguidade para quem decide e bloqueia o avanço enquanto houver pendência — sem
substituir o sistema atual da clínica. Detalhe completo do problema e da hipótese em
[`docs/PRD-SDD.md`](docs/PRD-SDD.md) §1–4.

## Decisões de produto

Três escolhas que definem o que este produto é. Nenhuma é neutra, e cada uma custa alguma coisa.

### 1. É uma barreira da recepção, não uma revisão do financeiro

A conferência roda **no momento do lançamento**, guia a guia, e não numa revisão do lote antes do
envio. O erro nasce ali: quem digita é quem tem o contexto do atendimento na cabeça, e é ali que
corrigir custa um minuto em vez de uma investigação semanas depois.

O Financeiro não some do produto — ele recebe uma **fila de exceções** (`minhas_pendencias`,
tela "Minhas pendências") com o que a barreira não pode decidir sozinha: procedimento fora de
cobertura, prazo de envio estourado, ambiguidade que exige julgamento humano. É por isso que o
Financeiro aparece com mais pendências (43) do que a Secretaria (27) na amostra de agosto: o que
sobra para ele é o que exige decisão, não digitação.

Custo da escolha: a recepção sente o atrito primeiro, e todo dia. A alternativa — revisar em lote
antes do envio — daria menos incômodo diário, mas empurraria a correção para quando ninguém mais
lembra do caso.

Onde isso está: `POST /api/protocols` e `POST /api/imports` validam na entrada
(`src/application/register-guide.ts`, `src/rules/engine.ts`); a trava de liberação é do Financeiro
(`src/http/handlers/release.ts`).

### 2. Entre os dois erros, o sistema bloqueia

Preferimos **segurar uma guia correta a deixar passar uma problemática**.

Os dois erros não custam a mesma coisa. Bloquear uma guia boa custa minutos da recepção, com o
motivo na tela e o caminho para resolver. Liberar uma guia ruim custa uma glosa que volta em 45 a
90 dias, quando o atendimento já saiu da memória de todo mundo — e ainda consome o tempo de quem
vai recorrer.

Por isso: pendência bloqueante impede a liberação (`OPEN_BLOCKING_TASKS`), a IA **nunca** produz
`OK` por conta própria, e qualquer falha ou saída fora do schema dela vira `REVISÃO HUMANA` em vez
de passar batido.

Para o bloqueio não virar parede burra, três contrapesos: o botão de liberar **continua visível**
com o motivo do bloqueio ao lado (esconder ação ensina a pessoa a duvidar do sistema);
`REVISÃO HUMANA` existe justamente para o que é ambíguo, em vez de reprovar por precaução; e toda
decisão humana de invalidar um apontamento exige motivo e evidência, ficando registrada.

Custo da escolha: falso positivo gera trabalho para a recepção. Aceitamos, porque o erro contrário
é irreversível dentro do mês.

### 3. A interface principal é desktop

Recepção e financeiro trabalham sentados, em computador da clínica, com o sistema de gestão aberto
ao lado. As telas que resolvem o problema são densas por natureza: lista com filtros e valores,
comparação de versões lado a lado, merge de duplicidade campo a campo.

O layout sobrevive a telas menores (as páginas viram coluna única a partir de 860px), mas mobile
não é o alvo: tratar celular como principal exigiria redesenhar lista, diff e merge com menos
informação por tela, e a decisão que essas telas sustentam precisa da informação junta.

O MCP é a resposta para o caso em que a pessoa não está na tela — perguntar ao assistente, de onde
estiver, sem precisar da interface.

## Decisão de arquitetura

Cloudflare Workers foi escolhido para hospedar interface, API e servidor MCP num único runtime.
D1 guarda protocolos/versões/eventos (dados relacionais com filtros e auditoria); R2 guarda
evidências e importações (arquivos, não linhas); Workers AI interpreta apenas texto livre da
recepção — nunca decide um estado de validação sozinho, e sua falha degrada para revisão humana
sem travar as regras determinísticas. Durable Objects, Queues, Workflows e KV foram
deliberadamente descartados: nenhum coordena concorrência, fila ou execução longa que justifique
o custo conceitual no volume desta prova (80 guias). Racional completo, com o que foi descartado e
por quê, em [`docs/PRD-SDD.md`](docs/PRD-SDD.md) §16–18.

## Como as regras leem os dados da prova

Três pontos em que o CSV limita o que dá para verificar, e a escolha feita em cada um:

- **Validade da autorização:** o CSV traz só a data final, não a de concessão. A verificação é a
  data final contra a **data do atendimento**, inclusiva — vence no próprio dia, ainda vale
  (`src/rules/authorization.ts`).
- **Prazo de envio:** conta a partir da **data do atendimento**, e a conferência simula o momento
  do lançamento (a guia acabou de ser lançada e ainda não foi enviada). Estourou o prazo do
  convênio, vira `REVISÃO HUMANA` com tarefa bloqueante do Financeiro
  (`src/rules/dispatch-deadline.ts`).
- **Limite de sessões:** as 80 guias são o recorte de agosto, não o histórico das autorizações.
  Por isso a regra confere **o que a guia declara** (`sessao_numero_na_autorizacao`) contra o
  limite oficial do convênio, sem contar ocorrências na base (`src/rules/sessions.ts`).

## Entrar no sistema

Cada pessoa entra com a própria conta em `/entrar`; o perfil da conta (Secretaria, Financeiro ou
Direção) define o que ela vê na tela **e** o que o assistente de IA dela consegue consultar.

A Direção administra contas em `/pessoas`: criar (com senha provisória mostrada uma única vez),
trocar perfil, desativar, reativar e redefinir senha. Cada pessoa troca a própria senha em
`/minha-conta`. Não há autoatendimento por e-mail — não existe provedor de e-mail configurado,
então quem esquece a senha pede à Direção. Detalhes e parâmetros em
[`docs/CONFIG.md`](docs/CONFIG.md).

Sem login, a aplicação continua navegável com a **identidade funcional de demonstração** (seletor
no rodapé da barra lateral), que existe para a prova e não dá acesso a administrar contas.

## Executar localmente

```powershell
corepack pnpm install --frozen-lockfile
copy .dev.vars.example .dev.vars   # gere valores próprios (openssl rand -hex 32); nunca commite .dev.vars
corepack pnpm db:migrate:local
corepack pnpm seed:local
node scripts/criar-usuarios.mjs contas.sql --senha "uma-senha-de-teste"
corepack pnpm exec wrangler d1 execute vitalis-glosas --local --file contas.sql
corepack pnpm dev --local --port 8787
```

`.dev.vars` é ignorado pelo Git — sem esse passo, o login, a troca de identidade e toda chamada
MCP falham, porque `LINK_SIGNING_KEY` e os tokens ficam indefinidos. `.dev.vars.example` já
documenta como gerar cada valor.

`scripts/criar-usuarios.mjs` serve para semear o ambiente e para recuperar o acesso se não sobrar
nenhuma conta de Direção; o dia a dia é pela tela `/pessoas`.

## Verificação

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

250 testes. O seed oficial carrega 80 guias e pode ser repetido; ele também limpa evidências e
merges locais antes de recarregar o domínio, permitindo restaurar o estado da demonstração.

## MCP

`POST /mcp`, stateless. Duas formas de credencial:

1. **OAuth 2.1** — o cliente de IA se conecta sozinho: `401` devolve `WWW-Authenticate` com
   `resource_metadata` (RFC 9728), o cliente lê os documentos de descoberta, registra-se em
   `/oauth/register` (RFC 7591) e leva a pessoa ao login. PKCE S256 obrigatório, código de uso
   único, refresh rotacionado. O papel do token é o papel da conta.
2. **Bearer fixo por área** — um secret por área, mantido como atalho de demonstração.

A tela `/conectar` traz o texto pronto para colar no assistente (Claude Code, Codex ou outro) e a
tabela de quem pode o quê.

| Tool | Secretaria | Financeiro | Direção |
|---|---|---|---|
| `consultar_regra` | sim | sim | sim |
| `verificar_guia` (não persiste) | sim | sim | sim |
| `consultar_historico` | sua área | sua área | tudo |
| `minhas_pendencias` | sim | sim | não tem fila |
| `registrar_guia` | sim | não | não |
| `consultar_relatorio` | não | não | sim |

### Formato das respostas

Toda tool devolve o mesmo fato duas vezes, e as duas nascem da mesma variável:

- **`content[0].text`** — Markdown pronto para a pessoa ler: valores em reais, datas em horário de
  Brasília, rótulos em português, tabela onde há lista, aviso de "lista cortada" quando o limite
  cortou, e a frase "nada foi gravado" nas tools de leitura. O assistente do outro lado deve
  reproduzir esse texto, não reinterpretar o JSON.
- **`structuredContent`** — o mesmo dado como objeto, validado pelo servidor contra o
  `outputSchema` que `tools/list` anuncia. Centavos continuam inteiros (`*_cents`) ao lado do
  valor já formatado.

Cada tool também anuncia `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`):
só `registrar_guia` escreve, e é idempotente por `id_guia_origem`. Erro de tool vem com código
estável na frente da mensagem (`[ROLE_NOT_ALLOWED]`, `[CONVENIO_DESCONHECIDO]`,
`[PROCEDIMENTO_DESCONHECIDO]`, `[GUIA_NAO_ENCONTRADA]`), e o erro de convênio lista os nomes
válidos para o assistente não escolher um por semelhança.

Os prompts embutidos (`prompts/list`) carregam a regra 11: reproduzir o texto que a tool devolveu,
sem reconstruir tabela, reconverter valor ou somar linha.

A Skill operacional está em
[`skills/conferir-guia-vitalis/SKILL.md`](skills/conferir-guia-vitalis/SKILL.md) e exige
confirmação explícita antes de registrar uma guia.

## Limites importantes

- IA só interpreta observação e retorna schema validado; falha vira revisão humana.
- MCP não corrige, libera, envia, encerra ou mescla — decisão humana é só da interface.
- Evidências ficam no R2 privado, com hash e links HMAC temporários.
- O histórico Git inicial contém um screenshot privado no commit `14335e2`; o arquivo não está no
  índice atual, mas a remoção histórica precisa ser decidida pelo dono antes de tornar o
  repositório público. Não reescreva o histórico sem autorização explícita.

## Não implementado nesta prova

Não objetivos declarados desde o PRD (`docs/PRD-SDD.md` §8): substituição do sistema de
gestão/prontuário, envio automático de guia ao convênio, decisão financeira automatizada, ERP ou
dashboard analítico amplo, treino de modelo com o feedback coletado, OCR/assinatura
certificada/antivírus próprio, envio automático do relatório semanal, e reversão de merge.

Fora de escopo por falta de provedor de e-mail: convite por e-mail, recuperação de senha
automática e cadastro aberto ao público.

Gaps conhecidos desta execução, para o próximo a mexer no código:

- `POST /api/merges/commit` (`src/http/handlers/merges.ts`) não tem teste de integração dedicado —
  só há teste de schema/roteamento. A sequência grava a nova versão e revalida fora de uma única
  transação D1 atômica; falha no meio deixaria o protocolo principal com versão nova mas sem o
  registro de merge.
- A amostra de agosto não contém nenhuma guia com `data_lancamento` além do prazo do convênio
  (RN-09); a regra existe, é determinística e testada, mas só é demonstrável com uma guia colada
  via `verificar_guia` — ver [`docs/DEMO-ROTEIRO.md`](docs/DEMO-ROTEIRO.md).

## Como fiz

**Ferramentas e por quê.** Toda a stack é Cloudflare: Workers hospeda interface, API e MCP no
mesmo lugar, D1 guarda os dados e o histórico, R2 guarda as evidências e Workers AI interpreta a
observação da recepção. Já vinha tudo pronto para o que o problema pedia, e a hospedagem é gratuita
com limite generoso. Aplicação em TypeScript e React, testes em Vitest, deploy com Wrangler.
Usei Claude Code e Codex como parceiros de código, revisão e documentação, e o Codex também como o
"cliente real" do MCP nos testes.

**O que a IA gerou e o que mudei na mão.** A IA escreveu a maior parte do código, dos testes e dos
documentos a partir do PRD. As decisões abaixo foram minhas, e várias contrariam o que a IA propôs:

1. **MCP com conta de pessoa, em vez de API sem usuário.** A IA tinha decidido não ter sistema de
   usuários, por ser um MVP. Mas um MCP exige saber quem está do outro lado: Secretaria, Financeiro
   e Direção não podem ver nem fazer a mesma coisa. Criei login e senha, administração de contas e
   OAuth. O assistente pede o login sozinho, identifica o perfil e entrega só as ferramentas e os
   dados daquela área.
2. **Skill embutida no MCP.** Pela minha experiência, a instalação que parece levar cinco minutos
   leva duas horas para uma pessoa leiga, que desiste no meio. Por isso a Skill vem do próprio
   servidor, e a tela "Conectar" traz uma mensagem pronta: a pessoa copia, cola no assistente e ele
   faz o resto.
3. **Merge com a diferença visível antes de confirmar.** Guia duplicada é decisão difícil. Mostrar
   os campos lado a lado, na mesma tela da decisão, evita pular entre telas e reduz o esforço de
   decidir.
4. **Rastro por data e prova de envio.** Pesquisa por data na interface e no MCP, evidência anexada
   (print, PDF ou digitalização) que prova quando a guia foi enviada, e histórico que nunca é
   apagado: correção cria versão nova. Isso deixa cada decisão explicável e forma uma base que,
   depois de curada, pode treinar um agente mais autônomo.
5. **IA só interpreta texto.** Cobertura, prazos, valores e limites são regras determinísticas. A IA
   nunca libera guia nem altera dado, e se falhar a guia vai para revisão humana.

As três decisões de produto no início deste README também são minhas: barreira na recepção,
bloquear na dúvida e interface desktop.

**O que ficou de fora e por quê.** Está listado em "Não implementado nesta prova". Em resumo, quis
provar a barreira de conferência sem substituir o processo da clínica. Por isso não há integração
com o sistema de gestão, envio automático ao convênio nem decisão financeira automática. Recursos
como OCR e assinatura certificada não eram necessários para demonstrar o fluxo. O feedback humano
fica registrado, mas o treino de modelo com ele não acontece nesta versão.

**Como testei.** Rodei typecheck, build e 250 testes automatizados, que cobrem regras,
permissões, OAuth, MCP e a consistência entre banco, tela e MCP. Carreguei as 80 guias da prova
pela rota de importação e conferi o relatório contra o banco. Em produção, conectei o Codex por
OAuth com cada perfil e usei o MCP como uma pessoa usaria. Foi assim que apareceu uma divergência
de números: o assistente somava eventos do histórico como se fossem guias. Corrigi na origem, com
nomes de campo explícitos, contagem oficial vinda do relatório e respostas já formatadas. O roteiro
em [`docs/DEMO-ROTEIRO.md`](docs/DEMO-ROTEIRO.md) cobre os casos principais de ponta a ponta.

**Tempo.** Cerca de 8 horas corridas.

## Demonstração

Roteiro completo (menos de cinco minutos, todos os casos do PRD §30.4) em
[`docs/DEMO-ROTEIRO.md`](docs/DEMO-ROTEIRO.md): relatório, liberação normal, correção com diff,
revisão humana, guia fora do convênio, duplicidade com merge, conexão de um assistente por OAuth,
as tools do MCP e a Skill.

## Evidência da execução faseada

- [Estado](docs/PROGRESS/STATE.md)
- [Fase 0](docs/PROGRESS/phase-0-handoff.md) · [Fase 1](docs/PROGRESS/phase-1-handoff.md) ·
  [Fase 2](docs/PROGRESS/phase-2-handoff.md) · [Fase 3](docs/PROGRESS/phase-3-handoff.md) ·
  [Fase 4](docs/PROGRESS/phase-4-handoff.md) · [Fase 5](docs/PROGRESS/phase-5-handoff.md)

Publicação, OAuth do MCP e administração de contas vieram depois da Fase 5 e estão registrados nos
commits e em [`docs/CONFIG.md`](docs/CONFIG.md).
