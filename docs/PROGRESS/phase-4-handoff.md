# Handoff — Fase 4 (IA e MCP)

## Entregas

- `POST /mcp` é stateless e valida JSON-RPC, Bearer e as cinco tools, via `createMcpHandler`
  (ver "Migração do transporte MCP" abaixo — o desvio anterior para JSON-RPC escrito à mão foi
  corrigido, não é mais o estado atual).
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

## Migração do transporte MCP para `createMcpHandler` (22/09/2026)

O `src/mcp/server.ts` original era um dispatcher JSON-RPC escrito à mão — funcionava, mas
divergia do CLAUDE.md/PRD §17/§23, que exigem `createMcpHandler` do Agents SDK sobre o MCP SDK
oficial e proíbem `McpAgent` (Durable Object, descontinuado para este uso). Migrado nesta
sessão, sem mudar contrato de tool, autenticação ou regra de negócio.

**O que mudou:**

- `src/mcp/server.ts` ficou fino: autentica o Bearer (`src/mcp/auth.ts`, extraído do arquivo
  antigo) e delega para `createMcpHandler` (`agents/mcp/server`), que constrói uma `McpServer`
  nova (`@modelcontextprotocol/server`) a cada requisição — nenhuma sessão nem estado sobrevive
  entre chamadas, conforme §23.1.
- As cinco tools foram extraídas para `src/mcp/tools/*.ts` (estrutura vazia que o PRD §18 já
  previa), uma por arquivo, cada uma registrando seu próprio schema Zod como `inputSchema` da
  tool (a SDK gera o JSON Schema de `tools/list` a partir dele).
- `schemaVerificar` (antes um `z.union` de duas formas) virou um `z.object(...).refine(...)` —
  o `inputSchema` de uma tool MCP precisa ser um schema de objeto; a exclusividade
  `id_guia` XOR `guia` continua garantida em runtime pelo `.refine`.

**Dependências instaladas (exatas, sem `^`/`~`):** `agents@0.24.0`,
`@modelcontextprotocol/server@2.0.0`. `zod` continuou em `4.6.5` (já fixado) — compatível com o
peer `^4.0.0` de `agents` e a dependência `^4.2.0` de `@modelcontextprotocol/server`; nenhuma
troca de versão de zod foi necessária. `@modelcontextprotocol/client@2.0.0` e
`@modelcontextprotocol/sdk@1.30.0` entraram sozinhos via peer dependency (`autoInstallPeers`) do
próprio `agents`, sem entrar no `package.json` — não são usados em runtime por
`agents/mcp/server` (só o tipo `ClientOptions` de `@modelcontextprotocol/client`, referenciado
pelo `.d.ts`; nenhum import em tempo de execução).

**Divergência de comportamento observada, aceita como consequência correta de usar a SDK
oficial:** erro de tool (papel errado, convênio desconhecido, args inválidos) antes voltava como
erro de protocolo JSON-RPC (HTTP 400, `error.code`); agora volta como resultado de tool com
`isError: true` dentro de uma resposta JSON-RPC de sucesso (HTTP 200) — é assim que a SDK v2
trata falha de `tools/call` (erro de protocolo fica reservado para método inexistente/JSON
malformado). O texto da mensagem de erro é o mesmo; só o envelope de transporte mudou. A
autenticação em si continua checada ANTES de qualquer parsing de JSON-RPC, e requisição sem
Bearer ou com Bearer inválido continua recusada com HTTP 401.

**Bundle do Worker:** medido com `wrangler deploy --dry-run --outdir=...`.

| | antes | depois | delta |
|---|---|---|---|
| raw | 977.943 bytes (955,02 KiB) | 1.429.871 bytes (1396,36 KiB) | +451.928 bytes (+46%) |
| gzip | 164.494 bytes (160,51 KiB) | 254.896 bytes (248,77 KiB) | +90.402 bytes (+55%) |

O crescimento vem do SDK MCP v2 em si (framing JSON-RPC completo, conversão Zod→JSON Schema,
transporte streamable-HTTP, compatibilidade com a era legada do protocolo) — confirmado
inspecionando o bundle final: nenhuma biblioteca não relacionada (scheduler, websockets, tasks,
chat, x402 do resto do Agents SDK) aparece nele, porque o import é do subpath estreito
`agents/mcp/server`, não `agents/mcp`. Não há como cumprir "usar `createMcpHandler` do Agents SDK
com o MCP SDK oficial" com um custo de bundle menor que esse.

**Prova manual (`pnpm dev`, tokens de `.dev.vars`, `node --eval` com `fetch`):** sem Bearer → 401;
`initialize` e `tools/list` → 200 com as cinco tools; `consultar_regra` (Vitalcard/50000470) → 200
com a regra real; `verificar_guia` estruturada → `persistiu:false`, confirmado por
`registrar_guia` na sequência criar do zero (`ja_existia:false`) em vez de achar algo já
persistido; `registrar_guia` com token Financeiro → recusado (`isError:true`, "Somente a
Secretaria..."); `registrar_guia` com token Secretaria → cria `VT-26-0081`; repetir a mesma
`id_guia_origem` → `ja_existia:true`, mesmo `numero_protocolo` (idempotência); `minhas_pendencias`
com os dois tokens → áreas e listas diferentes, mesmo passando `area` no argumento (o schema não
tem esse campo — é sempre ignorado). Banco local restaurado com `pnpm run seed:local` ao final
(80 protocolos confirmados); servidor de dev derrubado.

Testes novos em `tests/mcp.test.ts` cobrem os mesmos invariantes com um D1 fake em memória
(mesmo adaptador sobre `node:sqlite` de `tests/repositories.test.ts`), para não depender de
`wrangler dev` no gate normal (`pnpm test`).
