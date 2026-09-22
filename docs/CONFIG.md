# Configuração — Barreira de Glosas Vitalis

Documentação técnica para configuração local e em produção.

## Bindings do Cloudflare Worker

Cada binding conecta o Worker a um recurso Cloudflare ou a uma configuração de ambiente.

### DB (D1)

- **Type:** D1 Database
- **Binding name:** `DB`
- **Database name:** `vitalis-glosas`
- **Uso:** Dados relacionais — protocolos, versões, validações, problemas, tarefas, eventos, regras, histórico.
- **Acesso:** Consulta, insert, update (apenas append-only em `workflow_events`).
- **Fase da prova:** Obrigatório desde a Fase 0.

### EVIDENCE (R2)

- **Type:** R2 Bucket
- **Binding name:** `EVIDENCE`
- **Bucket name:** `vitalis-evidencias`
- **Uso:** Armazenamento de evidências — arquivos anexados durante revisão, comprovantes de envio, arquivos importados na carga inicial.
- **Acesso:** Privado, apenas através do Worker com controle de acesso temporário via token HMAC.
- **Fase da prova:** Obrigatório desde a Fase 3 (evidências). Placeholder na Fase 0.

### AI (Workers AI)

- **Type:** Workers AI Binding
- **Binding name:** `AI`
- **Modelo padrão:** Confirmar durante implementação da Fase 4 (consultar `@cloudflare/ai` docs atuais).
- **Uso:** Interpretação de observações em texto livre — categorização de contexto de guia.
- **Saída:** Estruturada (Zod), nunca autonomia para mudar dados ou tomar decisões.
- **Fase da prova:** Obrigatório desde a Fase 4 (IA). Placeholder na Fase 0.

### ASSETS (Static Assets)

- **Type:** Static Assets (via `wrangler.jsonc`)
- **Path:** `dist/client`
- **Uso:** Servir a aplicação React compilada (SPA).
- **Config:** `wrangler.jsonc` — `assets.directory = dist/client`, `not_found_handling = single-page-application`.
- **Fase da prova:** Obrigatório desde a Fase 2. Placeholder na Fase 0.

## Secrets e Variáveis de Ambiente

Autenticação da prova (§23.2 do PRD): papel derivado da credencial, nunca de parâmetro.

### MCP_SECRETARIA_TOKEN

- **Tipo:** Secret (nunca em `.dev.vars` real ou código).
- **Tamanho mínimo de teste:** 32 bytes hexadecimais.
- **Uso:** Token Bearer para autenticar requisições da área de Secretaria ao endpoint `/mcp`.
- **Comparação:** O Worker compara o hash do token enviado com o hash armazenado; o token completo nunca aparece em log ou resposta.
- **Evolução:** OAuth com identidade individual (Fase 5+).
- **Fase da prova:** Obrigatório desde a Fase 4. Documentado na Fase 0.

### MCP_FINANCEIRO_TOKEN

- **Tipo:** Secret (nunca em `.dev.vars` real ou código).
- **Tamanho mínimo de teste:** 32 bytes hexadecimais.
- **Uso:** Token Bearer para autenticar requisições da área de Financeiro ao endpoint `/mcp`.
- **Comparação:** O Worker compara o hash do token enviado com o hash armazenado; o token completo nunca aparece em log ou resposta.
- **Evolução:** OAuth com identidade individual (Fase 5+).
- **Fase da prova:** Obrigatório desde a Fase 4. Documentado na Fase 0.

### LINK_SIGNING_KEY

- **Tipo:** Secret (nunca em `.dev.vars` real ou código).
- **Tamanho mínimo de teste:** 32 bytes hexadecimais (chave para HMAC-SHA256).
- **Uso:** Assinar e validar links temporários devolvidos por `minhas_pendencias` do MCP. Inclui protocolo, área, nonce e expiração.
- **Formato do link:** `/protocols/{protocol_id}?token={signed_token}`.
- **Expiração:** Definida durante assinatura; verificada antes de abrir a página de revisão.
- **Fase da prova:** Obrigatório desde a Fase 4. Documentado na Fase 0.

## Como rodar localmente

### Pré-requisitos

- Node.js 24+
- pnpm (versão mais recente)
- Wrangler CLI (`pnpm install -g @cloudflare/wrangler`)

### 1. Instalar dependências

```bash
pnpm install
```

Todas as versões de dependências são fixadas pelo `pnpm-lock.yaml`. Nunca use `@latest` ou `@major` — sempre `pacote@X.Y.Z` exata.

### 2. Selecionar a conta Cloudflare para o dev local

O binding `AI` (Workers AI) nunca roda emulado localmente — o Wrangler sempre abre uma
sessão remota de proxy para ele, mesmo que o código da fase não chame o modelo. Se a
máquina tiver mais de uma conta Cloudflare autenticada (`wrangler whoami` lista todas),
o Wrangler não consegue escolher sozinha em modo não interativo e o `pnpm dev` trava
antes de servir qualquer rota.

Defina `CLOUDFLARE_ACCOUNT_ID` como variável de ambiente do shell (não em `.dev.vars` —
esse arquivo só popula bindings do Worker, o Wrangler CLI lê a variável do processo)
antes de rodar `pnpm dev`:

```bash
# Descobrir o Account ID da sua própria conta:
pnpm exec wrangler whoami

# Exportar para a sessão do shell (PowerShell: $env:CLOUDFLARE_ACCOUNT_ID = "...")
export CLOUDFLARE_ACCOUNT_ID=<account_id_da_sua_conta>
```

Isso não cria nem toca nenhum recurso remoto — D1, R2 e Assets continuam em modo
`local`; só o binding `AI` precisa da conta para abrir o proxy. Qual conta usar em
produção é decisão do dono, tomada na Fase 5 (ver `docs/PROGRESS/STATE.md`); para o
dev local qualquer conta autenticada nesta máquina serve. `wrangler.jsonc` não fixa
`account_id` de propósito — o repositório é público e essa variável fica de fora dele.

### 3. Configurar variáveis de desenvolvimento

```bash
cp .dev.vars.example .dev.vars
```

Abra `.dev.vars` e substitua os valores de exemplo por tokens de teste gerados localmente:

```bash
# Gerar um valor de teste para cada secret:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copie o output para cada linha em `.dev.vars` (um comando por token).

**Garantia:** O arquivo `.dev.vars` está no `.gitignore` e NUNCA será versionado. Secrets nunca entram no repositório.

### 4. Migração local do D1

```bash
pnpm db:migrate:local
```

Isto aplica todas as migrações SQL em `migrations/` contra a instância local do D1 (SQLite em `.wrangler/`).

### 5. Seed de dados (dados de teste)

```bash
pnpm seed:local
```

Isto carrega:
- Regras oficiais (`regras_convenio.json`)
- 80 guias de prova (`guias.csv`)

em modo local.

### 6. Rodar aplicação e Workers localmente

```bash
pnpm dev
```

Isto inicia:
- Worker em `http://localhost:8787`
- React SPA em `http://localhost:8787` (servida via Static Assets)
- D1 local em `.wrangler/state/d1/`

Acesso: abra `http://localhost:8787` no navegador.

### 7. Typecheck e testes

```bash
pnpm typecheck   # TypeScript sem emitir
pnpm test        # Vitest, testes unitários e integração
pnpm build       # Build do cliente + verificação do Worker
```

**Portão verde:** `pnpm typecheck && pnpm test && pnpm build` — nenhuma fase encerra vermelha.

## Como configurar em produção

**IMPORTANTE:** Secrets nunca entram em código, log ou commit. Toda credencial vai por `wrangler secret put`.

### 1. Criar instância D1 remota

```bash
wrangler d1 create vitalis-glosas
```

Isto retorna um binding ID. Atualize `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "vitalis-glosas",
    "database_id": "<UUID retornado>"
  }
]
```

### 2. Criar bucket R2 remoto

```bash
wrangler r2 bucket create vitalis-evidencias
```

O binding é automático se declarado em `wrangler.jsonc` com o nome `vitalis-evidencias`.

### 3. Confirmar binding Workers AI

Workers AI não requer bucket ou instância. O binding em `wrangler.jsonc` o conecta automaticamente.

### 4. Configurar secrets remotos

Cada secret é criado uma vez, nunca alterado via CI:

```bash
# Gerar tokens com segurança (ex.: usar gerenciador de senhas ou `openssl rand -hex 32`):
wrangler secret put MCP_SECRETARIA_TOKEN
# (Digitar token quando solicitado — será encriptado em repouso)

wrangler secret put MCP_FINANCEIRO_TOKEN
wrangler secret put LINK_SIGNING_KEY
```

Verifique que foram criados:

```bash
wrangler secret list
```

Ele mostrará os nomes, mas nunca o conteúdo.

### 5. Aplicar migrações remotas

```bash
corepack pnpm exec wrangler d1 migrations apply vitalis-glosas --remote
```

### 6. Carregar as regras e as 80 guias no banco remoto

São dois passos, e a ordem importa.

**6.1 — regra ativa, por SQL.** O conjunto de regras é uma linha isolada, sem dependência entre tabelas:

```bash
pnpm seed:sql                        # gera .wrangler/seed/seed.sql, sem aplicar nada
# extraia o bloco "INSERT INTO rule_sets ...;" para um arquivo e aplique:
pnpm exec wrangler d1 execute vitalis-glosas --remote --file=.wrangler/seed/rule-sets.sql
```

**6.2 — as 80 guias, pela rota de importação.** Não use o `seed.sql` inteiro no banco remoto: `protocols` e `guide_versions` se referenciam mutuamente (o protocolo aponta a versão corrente, a versão aponta o protocolo), e essa checagem só é adiável dentro de uma transação — que o D1 remoto recusa quando vem de arquivo. O caminho que funciona é o mesmo que a secretaria usa no dia a dia:

```bash
node --input-type=module -e "
const BASE = 'https://<seu-worker>.workers.dev';
const fs = await import('node:fs/promises');
const s = await fetch(BASE + '/api/session', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({papel:'SECRETARIA'}) });
const cookie = (s.headers.get('set-cookie')||'').split(';')[0];
const csv = await fs.readFile('guias.csv','utf8');
const r = await fetch(BASE + '/api/imports', { method:'POST', headers:{'content-type':'application/json', cookie}, body: JSON.stringify({formato:'csv', nome_arquivo:'guias.csv', conteudo_csv: csv}) });
console.log(r.status, (await r.text()).slice(0,200));
"
```

A importação é idempotente por `id_guia`: rodar de novo devolve os protocolos existentes em `protocolos_ja_existentes` e não cria duplicata. De quebra, carregar os dados por aqui exercita a própria RF-01 em produção.

### 7. Deploy

```bash
corepack pnpm build
corepack pnpm exec wrangler deploy
```

Isto faz build do Worker e da SPA, publica em produção e vincula os bindings.

**Verificação pós-deploy:**

```bash
curl https://seu-dominio.workers.dev/api/report
# (deve retornar relatório vazio ou existente, nunca erro 500)
```

## Tabela de variáveis e bindings

| Nome | Tipo | Obrigatório | Fase | Valor de Teste | Produção |
|---|---|---|---|---|---|
| `DB` | D1 Binding | Sim | 0+ | `.wrangler/state/d1/` local | instância remota |
| `EVIDENCE` | R2 Binding | Sim | 3+ | placeholder na 0–2 | bucket privado remoto |
| `AI` | Workers AI Binding | Sim | 4+ | placeholder na 0–3 | habilitado em conta |
| `ASSETS` | Static Assets | Sim | 2+ | `dist/client` | `dist/client` |
| `MCP_SECRETARIA_TOKEN` | Secret | Sim | 4+ | gerar com `openssl rand -hex 32` | gerado com `wrangler secret put` |
| `MCP_FINANCEIRO_TOKEN` | Secret | Sim | 4+ | gerar com `openssl rand -hex 32` | gerado com `wrangler secret put` |
| `LINK_SIGNING_KEY` | Secret | Sim | 4+ | gerar com `openssl rand -hex 32` | gerado com `wrangler secret put` |

## Regras de segurança

1. **Secrets nunca em `.dev.vars` real ou `.env`** — apenas em `.dev.vars.example` como template.
2. **Secrets nunca aparecem em log** — Worker valida hash, não token completo.
3. **Secrets nunca em commit** — `.dev.vars` e qualquer `*.local.*` estão no `.gitignore`.
4. **Rotação de secrets expostos** — se descoberto acesso não autorizado, rodar `wrangler secret put` novamente.
5. **D1 e R2 privados** — nenhum dado sensível (evidências, versões) é público; acesso sempre via Worker autenticado.

## Referências

- Plano faseado: `docs/PRD-SDD.md` §33–35.
- Stack técnico: `CLAUDE.md` (dependências, comando, convenções).
- Autenticação MCP: `docs/PRD-SDD.md` §23.2.
- Bindings Cloudflare: consulte documentação Wrangler e [Cloudflare Docs](https://developers.cloudflare.com/workers/).


## Contas de acesso e OAuth do MCP

Desde 22/09/2026 o MCP aceita OAuth 2.1 além dos dois Bearer fixos. O papel do token passa a ser
o papel da conta que fez login — Secretaria, Financeiro ou Direção.

### Criar ou trocar a senha das contas

```bash
node scripts/criar-usuarios.mjs                      # senhas aleatórias, uma por conta
node scripts/criar-usuarios.mjs arquivo.sql --senha S # mesma senha nas três (uso local)
pnpm exec wrangler d1 execute vitalis-glosas --local  --file usuarios.local.sql
pnpm exec wrangler d1 execute vitalis-glosas --remote --file usuarios.local.sql
```

O SQL gerado leva apenas hash PBKDF2, salt e número de iterações — nunca a senha. As senhas em
claro são impressas uma vez e anexadas a `.secrets.local.md` (ignorado pelo Git). O `INSERT` usa
`ON CONFLICT(email) DO UPDATE`: trocar a senha preserva o id da conta e não derruba os tokens
OAuth já emitidos.

As três contas: `secretaria@vitalis.example`, `financeiro@vitalis.example`,
`direcao@vitalis.example`.

### Endpoints de identidade

| Caminho | Para quê |
|---|---|
| `GET /entrar` · `POST /entrar` | login direto no sistema (interface) |
| `POST /sair` | encerra a sessão do navegador (não revoga token de MCP) |
| `GET /api/me` | quem está logado nesta aba |
| `GET /.well-known/oauth-protected-resource` | descoberta: quem autoriza o `/mcp` (RFC 9728) |
| `GET /.well-known/oauth-authorization-server` | descoberta: endereços do fluxo (RFC 8414) |
| `POST /oauth/register` | registro dinâmico do cliente (RFC 7591) |
| `GET/POST /oauth/authorize` | login + autorização (única tela que a pessoa vê) |
| `POST /oauth/token` | troca de código e renovação |
| `POST /oauth/revoke` | revogação (RFC 7009) |

**`run_worker_first` em `wrangler.jsonc` é obrigatório para isso funcionar.** Com
`not_found_handling: "single-page-application"`, qualquer navegação HTML casa com o fallback do
`index.html` e nunca chegaria ao Worker — `/entrar` abriria a SPA numa rota que ela não conhece.
