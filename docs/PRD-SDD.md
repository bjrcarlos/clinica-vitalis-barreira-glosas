# PRD + SDD — Barreira de Glosas da Clínica Vitalis

**Versão:** 1.2  
**Data:** 20/09/2026  
**Responsável pelo produto:** Carlos Bomfim  
**Responsável técnico:** Codex  
**Status:** pronto para revisão  
**Documento de origem:** `SPECs/2026-09-20 - SPEC - Barreira de Glosas Vitalis.md`

**Revisão 1.2:** a orientação atualizada do recrutador torna obrigatórias duas tools — `consultar_regra` e `verificar_guia` — e uma Skill para conferir dados colados, sem eliminar as capacidades operacionais já aprovadas. O MCP mantém registro de guia, pendências por área, histórico e links de revisão. Decisões humanas continuam exclusivas da interface visual.

---

# Parte I — PRD: Product Requirements Document

## 1. Visão do produto

A Barreira de Glosas da Clínica Vitalis verifica guias antes do envio aos convênios, identifica inconsistências, informa o que precisa ser corrigido e impede que uma guia avance enquanto existirem requisitos pendentes.

O produto atua no ponto em que o problema realmente nasce: entre o lançamento feito pela secretaria e o envio realizado pelo financeiro. Ele não substitui o sistema atual da clínica. Funciona como uma camada de verificação, decisão e prova.

O produto também oferece:

- relatório semanal enxuto para o Dr. Renato;
- histórico de versões semelhante a commits;
- evidências vinculadas às ações externas;
- pendências separadas por área;
- MCP com as duas ferramentas obrigatórias de consulta e verificação, além de ferramentas operacionais estreitas já aprovadas;
- Skill operacional para conferir uma guia a partir dos dados colados como a recepção escreveu;
- uso de IA apenas na interpretação de texto livre.

## 2. Contexto do negócio

A Clínica Vitalis possui três unidades e processa aproximadamente 900 guias por mês. Dos R$ 780 mil de faturamento mensal, 58% vêm de convênios. A glosa estimada é de 8% do faturamento de convênios, e a clínica estima que 40% dessas perdas estejam relacionadas a preenchimento incorreto ou autorização vencida.

Estimativa mensal:

- faturamento de convênios: R$ 452.400;
- valor glosado: R$ 36.192;
- parcela potencialmente ligada a erros evitáveis: R$ 14.476,80.

Atualmente, a secretaria lança as guias enquanto atende outros canais. O financeiro confere os registros no fim do mês, e parte dos erros só aparece quando o convênio devolve a cobrança semanas depois.

## 3. Problema

### 3.1 Onde o problema aparece

- no fechamento mensal do financeiro;
- na glosa recebida 45 a 90 dias depois;
- na dificuldade de explicar quanto dinheiro está em risco;
- na dependência de conferência manual e memória individual.

### 3.2 Onde o problema mora

- ausência de verificação no intervalo entre lançamento e envio;
- regras dos convênios não aplicadas de modo consistente;
- observações livres que podem contradizer os campos;
- falta de uma trilha que conecte guia, correção, decisão, evidência e envio;
- dados incompletos sobre ações executadas fora do sistema.

## 4. Hipótese do produto

Se a clínica aplicar regras objetivas logo após o lançamento, encaminhar ambiguidades à pessoa responsável e bloquear o avanço enquanto existirem pendências, então reduzirá a quantidade e o valor de guias que chegam incorretas ao convênio.

O produto não promete eliminar todas as glosas. Ele promete tornar visíveis e tratáveis, antes do envio, os riscos que podem ser encontrados com os dados e regras disponíveis.

## 5. Usuários e responsabilidades

### 5.1 Secretaria

Objetivo: registrar e corrigir uma guia sem precisar memorizar regras de cada convênio.

Responsabilidades:

- importar ou cadastrar guias;
- corrigir campos;
- conferir documentos e autorizações;
- criar uma nova versão após correção;
- anexar ou referenciar evidências da sua área.

Não pode:

- liberar guia para envio;
- concluir decisão financeira;
- executar merge de protocolos.

### 5.2 Financeiro

Objetivo: revisar exceções, decidir o destino da cobrança e enviar somente guias completas.

Responsabilidades:

- revisar ambiguidades;
- decidir faturamento particular ou cancelamento;
- tratar possíveis duplicidades;
- executar merge;
- liberar a guia;
- registrar o envio e anexar o comprovante.

### 5.3 Dr. Renato

Objetivo: entender, em poucos minutos, o que foi verificado, quanto dinheiro esteve em risco, quanto foi tratado e o que permanece pendente.

Responsabilidades:

- consultar o relatório;
- abrir os detalhamentos quando necessário;
- não participar do tratamento operacional diário.

### 5.4 Agente conectado ao MCP

Objetivo: consultar regras, verificar ou registrar guias e localizar pendências da área autenticada, sem receber autonomia para concluir decisões humanas.

O MCP é uma camada controlada sobre regras, guias e pendências. Escritas ficam limitadas ao registro explícito de uma nova guia pela secretaria; correções, liberações, encerramentos e merges permanecem visuais.

### 5.5 Operador usando a Skill

Objetivo: colar os dados de uma guia como foram escritos pela recepção e receber uma conferência compreensível, sem precisar conhecer o schema técnico do MCP.

A Skill deve:

- preservar o texto original colado;
- extrair apenas informações explicitamente presentes;
- não inventar valores ausentes;
- pedir os dados indispensáveis que não puderem ser identificados;
- consultar a regra aplicável pelo MCP;
- verificar a guia pelo MCP;
- devolver estado, motivos, evidências e próximos passos em linguagem operacional;
- deixar claro quando é necessária revisão humana.

## 6. Princípios do produto

1. Regra objetiva vira código, não prompt.
2. IA interpreta texto; não aprova nem altera registros.
3. Nenhuma alteração histórica é silenciosa.
4. Uma guia só avança quando todos os requisitos aplicáveis estiverem satisfeitos.
5. O sistema mostra a próxima ação útil, sem esconder os motivos.
6. O relatório conta uma história; não tenta mostrar tudo ao mesmo tempo.
7. Um arquivo não substitui uma decisão, e uma decisão não substitui uma evidência externa.
8. O processo atual só será alterado onde houver uma lacuna necessária para prevenir ou provar uma decisão.

## 7. Objetivos

### 7.1 Objetivos de produto

- Verificar as 80 guias da prova com resultados explicáveis.
- Permitir entrada persistida por upload, formulário e MCP, além de conferência sem persistência pela Skill.
- Evitar que uma guia com pendência seja liberada.
- Direcionar cada pendência à secretaria ou ao financeiro.
- Preservar versões, decisões, evidências e timestamps.
- Entregar ao Dr. Renato uma visão agregada com acesso ao detalhe.
- Demonstrar IA com autonomia limitada e fallback seguro.

### 7.2 Objetivos da prova

- Mostrar entendimento do processo antes da tecnologia.
- Separar regra, interpretação e decisão humana.
- Demonstrar um caso normal, uma correção, uma exceção e uma recusa de autonomia.
- Expor MCP funcional e útil para a operação.
- Publicar uma solução simples de explicar e reproduzir.

## 8. Não objetivos

- Substituir o sistema de gestão ou o prontuário.
- Enviar guias diretamente aos convênios.
- Automatizar decisões financeiras.
- Construir um ERP, workflow corporativo ou dashboard analítico amplo.
- Autoatendimento de conta: cadastro aberto ao público, convite por e-mail e "esqueci minha
  senha" por e-mail. **Nada disso existe porque não há provedor de e-mail configurado** — quem
  cria conta é a Direção, e quem esquece a senha pede à Direção para redefinir.
  **OAuth e administração de contas saíram deste item em 22/09/2026, por decisão do dono:** o
  login individual, o OAuth 2.1 do MCP (§23.2) e a tela de administração (§23.5) foram
  implementados.
- Treinar um modelo com os feedbacks coletados.
- Implementar OCR, assinatura certificada ou antivírus próprio.
- Enviar automaticamente o relatório de terça-feira.
- Resolver todos os cenários de merge ou desfazer merge nesta versão.

## 9. Escopo funcional

### RF-01 — Importar guias

O sistema deve aceitar CSV e XLSX, validar a estrutura, preservar o arquivo original como evidência da importação e apresentar um resumo antes de confirmar.

Critérios:

- informar linhas aceitas, rejeitadas e duplicadas no arquivo;
- não criar protocolos parcialmente sem explicar o erro;
- preservar valor original e valor normalizado;
- registrar ator, arquivo, hash e horário da importação.

### RF-02 — Cadastrar uma guia individual

A secretaria deve cadastrar uma guia por formulário. Ao salvar, o sistema cria protocolo, versão inicial, validação e tarefas correspondentes.

### RF-03 — Registrar pelo MCP e conferir pela Skill

A Skill `conferir-guia-vitalis` deve permitir que a pessoa operadora cole os dados da guia como a recepção escreveu. A Skill organiza os dados sem inventar campos, consulta a regra aplicável e chama `verificar_guia`.

A verificação feita pela Skill não cria nem altera protocolo. Quando a secretaria decidir persistir a guia, poderá usar upload, formulário ou a tool explícita `registrar_guia`.

Não haverá uma API pública de integração separada. Os endpoints HTTP internos existem apenas para a interface e o transporte MCP.

### RF-04 — Criar protocolo único

Cada caso deve receber um número de protocolo legível e imutável. O `id_guia` de origem será preservado separadamente.

O protocolo conectará:

- versões;
- validações;
- problemas e subproblemas;
- tarefas;
- decisões;
- eventos;
- evidências;
- merges.

### RF-05 — Validar deterministicamente

O sistema deve verificar:

- campos obrigatórios;
- validade da autorização na data do atendimento, inclusive no último dia;
- prazo de envio contado da data do atendimento, conferido na data de lançamento da guia;
- limite de sessões;
- cobertura do procedimento;
- código, descrição e valor de referência;
- formatos e normalizações;
- possível duplicidade;
- requisitos necessários para liberação.

### RF-06 — Interpretar observações

Workers AI deve receber apenas o contexto mínimo necessário e retornar saída estruturada.

Categorias iniciais:

- nova autorização ainda não cadastrada;
- autorização verbal ou protocolo;
- faturamento particular;
- procedimento lançado diferente do realizado;
- remarcação com possível conflito de validade;
- sem informação operacional relevante.

Qualquer observação relevante ou falha da IA encaminha a guia para revisão; nunca produz `OK` por conta própria.

### RF-07 — Exibir problemas e subproblemas

Uma guia pode ter vários problemas. Um problema pode reunir subproblemas ou evidências técnicas relacionadas.

Exemplo:

```text
Problema: limite de sessões excedido
├── sessão registrada: 15
├── limite informado na guia: 10
└── limite oficial do convênio: 10
```

O valor da guia será contado uma vez no risco, independentemente do número de problemas.

### RF-08 — Aplicar estados de validação

- `OK`
- `CORRIGIR`
- `REVISÃO HUMANA`
- `NÃO FATURAR AO CONVÊNIO`

O estado principal representa a próxima ação útil. Todos os problemas continuam visíveis no detalhe.

### RF-09 — Controlar o fluxo

Estados operacionais:

- `EM_TRATAMENTO`
- `LIBERADA_PARA_ENVIO`
- `ENVIADA`
- `ENCERRADA_PARTICULAR`
- `ENCERRADA_CANCELADA`
- `MESCLADA`

O botão `Liberar para envio` só fica disponível quando:

- a versão atual está `OK`;
- não existe problema aberto;
- não existe revisão humana pendente;
- todas as evidências obrigatórias foram satisfeitas.

Liberar não significa enviar. Registrar envio é outra ação e exige comprovante externo.

### RF-10 — Corrigir por nova versão

A correção nunca altera a versão anterior. Ela cria uma nova versão, registra autor, justificativa e horário, calcula o diff e executa nova validação.

A interface deve mostrar:

- somente os campos alterados no resumo;
- `antes → depois`;
- link para a versão completa;
- linha do tempo semelhante a commits.

### RF-11 — Registrar eventos e datas

Toda ação deve guardar:

- `ocorrido_em`: quando a ação ocorreu no processo;
- `registrado_em`: quando entrou no sistema;
- ator funcional;
- origem: interface, importação, MCP ou sistema;
- protocolo e versão associados;
- justificativa ou metadados aplicáveis.

Datas serão armazenadas como instantes UTC e exibidas em `dd/MM/aaaa HH:mm:ss`, no fuso `America/Sao_Paulo`, identificado como horário de Brasília.

### RF-12 — Anexar evidências

Arquivos aceitos:

- PDF;
- JPG/JPEG;
- PNG;
- até 10 MB por arquivo.

Evidência obrigatória para:

- afirmar envio ao convênio;
- registrar retroativamente ação externa;
- contrariar resultado automático quando o fato depender de documento externo.

Arquivos não serão sobrescritos ou excluídos pela interface. Uma evidência incorreta pode ser invalidada com motivo e substituída por outra.

### RF-13 — Tratar duplicidades por merge

O sistema identifica suspeitas por chave composta explicável. Somente o financeiro executa o merge.

Fluxo:

1. comparar protocolos;
2. escolher o protocolo principal;
3. manter automaticamente valores iguais;
4. escolher valores divergentes;
5. criar nova versão no principal;
6. vincular histórico e evidências das duas origens;
7. marcar a origem como mesclada;
8. validar novamente.

Nenhum histórico será apagado. Reversão fica fora da primeira versão.

### RF-14 — Exibir relatório executivo

O relatório deve apresentar quatro áreas narrativas:

1. guias verificadas;
2. guias que exigem atenção;
3. valor inicialmente detectado em risco;
4. destino do risco: tratado e ainda pendente.

Cada área é clicável e abre a listagem filtrada. A lista sem filtros mostra todas as guias.

Abaixo dos números, mostrar:

- principais motivos;
- distribuição por área responsável;
- pendências mais antigas;
- link para cada protocolo.

### RF-15 — Consultar pendências pelo MCP

A tool `minhas_pendencias` deve derivar a área da credencial e retornar:

- quantidade;
- valor envolvido;
- motivo;
- data da pendência;
- protocolo;
- link exato e temporário para a tela de revisão.

O agente não pode informar outra área como parâmetro.

### RF-16 — Consultar histórico

A interface e a tool `consultar_historico` devem permitir pesquisa por:

- protocolo;
- `id_guia` de origem;
- área;
- tipo de evento;
- intervalo de datas;
- estado atual.

## 10. Requisitos do MCP

`consultar_regra` e `verificar_guia` são as duas tools obrigatórias pedidas pelo recrutador. O MCP também preserva as ferramentas operacionais já aprovadas:

| Tool | Tipo | Permissão | Responsabilidade |
|---|---|---|---|
| `consultar_regra` | leitura | secretaria e financeiro | Consultar exigências de um convênio, opcionalmente filtradas por procedimento. |
| `verificar_guia` | cálculo sem persistência | secretaria e financeiro | Avaliar uma guia cadastrada ou um conjunto estruturado de dados e explicar o resultado. |
| `registrar_guia` | escrita explícita | secretaria | Criar protocolo e versão inicial, disparando a mesma validação da aplicação. |
| `minhas_pendencias` | leitura contextual | área autenticada | Listar somente as pendências da área e devolver links de revisão. |
| `consultar_historico` | leitura contextual | secretaria e financeiro | Pesquisar eventos e versões permitidos ao papel. |

Nenhuma tool poderá corrigir uma versão existente, liberar, enviar, encerrar ou mesclar uma guia.

### 10.1 Contrato da Skill operacional

Nome: `conferir-guia-vitalis`.

Entrada esperada: texto colado pelo operador, mantendo a forma como a recepção registrou a guia.

Fluxo:

1. identificar campos presentes sem preencher lacunas silenciosamente;
2. mostrar os campos interpretados quando houver ambiguidade relevante;
3. pedir somente informações obrigatórias ausentes;
4. chamar `consultar_regra` quando precisar explicar a exigência;
5. chamar `verificar_guia` para obter a decisão determinística;
6. apresentar resultado, motivos, campos a corrigir e necessidade de revisão humana;
7. oferecer `registrar_guia` somente quando a pessoa pedir explicitamente para persistir uma guia nova e estiver autenticada como secretaria;
8. orientar o uso da interface quando a pessoa quiser corrigir ou decidir sobre uma guia existente.

Saída mínima:

- `OK`, `CORRIGIR`, `REVISÃO HUMANA` ou `NÃO FATURAR AO CONVÊNIO`;
- visão geral em uma frase;
- problemas e subproblemas;
- regra e versão aplicadas;
- próximos passos;
- aviso de que a conferência, isoladamente, não gravou nem alterou dados.

## 11. Regras de negócio

### RN-01 — Fonte da verdade

As regras oficiais vêm de `regras_convenio.json`. Cada conjunto terá versão, hash, conteúdo original, data de importação e data de ativação.

### RN-02 — Imutabilidade histórica

Uma nova regra não recalcula ou altera silenciosamente uma decisão antiga. A revalidação, quando solicitada, cria uma nova execução vinculada à nova versão da regra.

### RN-03 — Validade inclusiva

A autorização é válida no próprio dia de vencimento. Como o recorte da prova não contém a
data de concessão, a validação usa somente a data final declarada contra a data do atendimento;
nenhuma janela máxima é inferida a partir dessas duas datas.

### RN-04 — Informação não verificável

O sistema não afirma que uma ação externa aconteceu sem data e evidência. Dados retroativos incompletos geram tarefa para a área responsável.

### RN-09 — Relógio da prova e prazo de envio

As 80 guias da prova representam um recorte de agosto, não o histórico completo de autorizações.
Para evitar que a data corrente do computador altere a prova, a conferência simula o instante em
que cada guia foi lançada: `data_lancamento`. O prazo final é calculado a partir de
`data_atendimento + prazo_envio_dias`, com o próprio dia limite ainda válido.

Quando `data_lancamento` ultrapassa o prazo final, o sistema cria `PRAZO_ENVIO_EXCEDIDO` como
revisão humana para o Financeiro. A tarefa é bloqueante e a guia não pode ser liberada até uma
decisão auditável de exceção, faturamento particular ou cancelamento.

O limite de sessões também usa o número declarado na própria guia. A prova não permite inferir
um histórico completo de autorizações somando outras linhas do CSV.

### RN-05 — Dinheiro em risco

O valor em risco é o valor da versão corrente de cada protocolo que não esteja `OK` ou que permaneça com tarefa impeditiva. Um protocolo é somado uma única vez.

O relatório também preserva o risco inicialmente detectado, mesmo depois da correção.

### RN-06 — Próxima ação principal

A classificação principal deve orientar o trabalho:

- procedimento não coberto: não faturar ao convênio;
- informação contraditória ou exceção: revisão humana;
- erro objetivo corrigível: corrigir;
- nenhum requisito aberto: OK.

### RN-07 — Faturamento fora do convênio

Uma guia que não será faturada ao convênio deve ser encerrada pelo financeiro como:

- particular; ou
- cobrança cancelada.

### RN-08 — Formatos normalizáveis

Datas e valores inequivocamente interpretáveis podem ser normalizados. O valor original permanece guardado. A normalização gera aviso, mas não bloqueia sozinha.

## 12. Experiência do usuário

### 12.1 Navegação principal

- Relatório
- Todas as guias
- Minhas pendências
- Importar
- Nova guia
- Regras

### 12.2 Página do protocolo

Ordem de leitura:

1. número do protocolo e estado;
2. próxima ação;
3. trava de avanço, quando existir;
4. problemas e subproblemas;
5. dados da versão atual;
6. evidências;
7. histórico e diffs;
8. ações permitidas ao papel atual.

### 12.3 Linguagem

- frases curtas;
- motivos concretos;
- evitar jargão técnico na interface;
- sempre dizer o que aconteceu, por que importa e qual é o próximo passo;
- detalhes técnicos ficam em área expansível.

## 13. Métricas de sucesso

### 13.1 Métricas da prova

- 80 de 80 guias importadas e pesquisáveis.
- 100% das decisões reproduzíveis por regra e versão.
- Zero liberação com problema impeditivo aberto.
- Zero decisão humana executada pelo MCP.
- 100% das correções preservando a versão anterior.
- Totais do relatório reconciliados com a listagem detalhada.
- As tools MCP obrigatórias retornam decisões e regras compatíveis com o motor da aplicação.
- Pendências MCP respeitam a área autenticada.
- A Skill transforma texto colado em uma conferência sem inventar dados.
- Demonstração completa em até cinco minutos.

### 13.2 Métricas operacionais futuras

- valor inicialmente em risco;
- valor corrigido antes do envio;
- valor ainda pendente;
- tempo médio entre detecção e correção;
- taxa de guias encaminhadas à revisão humana;
- taxa de reversão das interpretações de IA;
- reincidência por tipo de problema e unidade;
- glosa evitável antes e depois da adoção.

## 14. Baseline da amostra

A análise inicial das 80 guias encontrou ocorrências brutas:

- 13 autorizações vencidas;
- 6 guias acima do limite de sessões;
- 5 procedimentos não cobertos;
- 4 números de autorização ausentes;
- 2 registros profissionais ausentes;
- 2 CIDs obrigatórios ausentes;
- 2 datas fora do padrão;
- 2 pares de possíveis duplicidades;
- 5 observações com impacto operacional.

Essas contagens não são o resultado final do produto. Há sobreposição, subproblemas e casos que dependem de revisão.

O CSV não possui data de concessão da autorização. Portanto, a categoria de “validade máxima”
do conjunto oficial de regras é apenas metadado até que esse campo exista; ela não é uma decisão
do motor nesta prova. A única verificação de validade é a data final contra a data do atendimento.

## 15. Critérios de aceite do produto

- [ ] O relatório abre com os quatro blocos aprovados.
- [ ] Cada bloco abre seu detalhamento e a lista sem filtro mostra tudo.
- [ ] Guia normal pode ser liberada.
- [ ] Guia incompleta não pode ser liberada.
- [ ] Correção cria uma segunda versão e diff.
- [ ] Observação contraditória produz revisão humana.
- [ ] Falha da IA não interrompe as regras determinísticas.
- [ ] Envio exige evidência externa.
- [ ] Particular e cancelamento estão disponíveis como destinos finais.
- [ ] Merge preserva ambos os históricos e cria nova versão.
- [ ] Datas aparecem no padrão brasileiro e no horário de Brasília.
- [ ] Pesquisas por data funcionam na interface e no MCP.
- [ ] O MCP expõe `consultar_regra` e `verificar_guia` como ferramentas obrigatórias.
- [ ] O MCP também registra nova guia, consulta pendências por área e pesquisa histórico conforme as permissões definidas.
- [ ] MCP da secretaria e do financeiro retornam pendências diferentes.
- [ ] MCP entrega link direto de revisão, mas não executa a decisão.
- [ ] A Skill confere uma guia a partir de dados colados como a recepção escreveu.
- [ ] A Skill informa claramente quando apenas conferiu e pede confirmação explícita antes de registrar uma guia nova.

---

# Parte II — SDD: Software Design Document

## 16. Arquitetura

```text
Navegador ───────────────────────────────┐
                                        ├── Cloudflare Worker
Operador → Skill → Cliente MCP → /mcp ──┘      ├── handlers da interface
                                                ├── autenticação por área
                                                ├── motor determinístico
                                                ├── orquestrador de validação
                                                ├── adaptador Workers AI
                                                └── servidor MCP stateless
                                                │
                                                ├── D1: dados, versões e auditoria
                                                ├── R2: evidências e arquivos importados
                                                ├── Workers AI: interpretação de observações
                                                └── Static Assets: aplicação web
```

### 16.1 Produtos Cloudflare escolhidos

| Produto | Uso | Justificativa |
|---|---|---|
| Workers | Backend, rotas internas e MCP | Um runtime para interface e lógica. |
| Workers Static Assets | SPA e ativos | Recomendado para novas aplicações no ecossistema Workers. |
| D1 | Dados relacionais | Filtros, relações e auditoria com semântica SQLite. |
| R2 | Arquivos | Evidências e arquivos importados não pertencem ao banco relacional. |
| Workers AI | Texto livre | Interpretação limitada das observações. |
| Workers Secrets | Tokens e assinatura | Evita secrets no código e no repositório. |

Não usar inicialmente:

- Durable Objects: não existe coordenação concorrente por protocolo que justifique o custo conceitual;
- Queues: o volume da prova é pequeno e o processamento pode ser síncrono;
- Workflows: não há execução longa ou espera durável necessária;
- KV: os dados exigem relações e filtros consistentes;
- Pages: Workers com Static Assets é suficiente para um projeto novo.

## 17. Stack proposta

- TypeScript;
- Cloudflare Workers;
- React + Vite para a interface;
- D1 com migrações SQL explícitas;
- R2 por binding do Worker;
- Workers AI por binding;
- Agents SDK com `createMcpHandler` e MCP SDK v2;
- Zod para schemas de entrada e saída;
- Vitest com ambiente Workers para testes;
- biblioteca XLSX escolhida somente após validação de compatibilidade e tamanho do bundle.

As versões serão fixadas no `package-lock.json`. APIs e nomes de modelos serão confirmados nas documentações atuais durante a implementação.

## 18. Organização lógica

```text
src/
├── domain/
│   ├── guide.ts
│   ├── protocol.ts
│   ├── statuses.ts
│   └── events.ts
├── rules/
│   ├── engine.ts
│   ├── required-fields.ts
│   ├── authorization.ts
│   ├── coverage.ts
│   ├── sessions.ts
│   ├── procedure.ts
│   └── duplicates.ts
├── application/
│   ├── validate-guide.ts
│   ├── create-version.ts
│   ├── release-guide.ts
│   ├── register-send.ts
│   └── merge-protocols.ts
├── infrastructure/
│   ├── d1/
│   ├── r2/
│   ├── ai/
│   ├── auth/
│   └── signing/
├── mcp/
│   ├── server.ts
│   └── tools/
├── http/
│   ├── routes.ts
│   └── handlers/
└── ui/
    ├── pages/
    ├── components/
    └── styles/
```

Regra de dependência:

`UI/MCP → application → domain/rules`

Infraestrutura implementa interfaces da aplicação. O motor de regras não conhece HTTP, D1, R2, Workers AI ou React.

## 19. Modelo de dados

### 19.1 `rule_sets`

| Campo | Tipo | Observação |
|---|---|---|
| `id` | TEXT PK | Identificador interno. |
| `version` | TEXT UNIQUE | Ex.: `agosto/2026`. |
| `source_json` | TEXT | JSON original. |
| `source_sha256` | TEXT | Integridade. |
| `imported_at_utc` | TEXT | Registro técnico. |
| `activated_at_utc` | TEXT NULL | Ativação. |
| `is_active` | INTEGER | 0 ou 1. |

### 19.2 `protocols`

| Campo | Tipo | Observação |
|---|---|---|
| `id` | TEXT PK | UUID/ULID interno. |
| `protocol_number` | TEXT UNIQUE | Identificador humano. |
| `source_guide_id` | TEXT NULL | `id_guia` original. |
| `current_version_id` | TEXT | Versão corrente. |
| `validation_status` | TEXT | Estado calculado atual. |
| `workflow_status` | TEXT | Estado operacional. |
| `assigned_area` | TEXT NULL | Próxima área responsável. |
| `current_risk_cents` | INTEGER | Valor atual sem ponto flutuante. |
| `initial_risk_cents` | INTEGER | Preservado após tratamento. |
| `merged_into_protocol_id` | TEXT NULL | Destino do merge. |
| `created_at_utc` | TEXT | Criação. |
| `updated_at_utc` | TEXT | Atualização técnica. |

### 19.3 `guide_versions`

Contém os campos pesquisáveis da guia, além de:

| Campo | Tipo | Observação |
|---|---|---|
| `id` | TEXT PK | Versão interna. |
| `protocol_id` | TEXT FK | Protocolo pai. |
| `version_number` | INTEGER | Sequencial por protocolo. |
| `raw_payload_json` | TEXT | Entrada original preservada. |
| `normalized_payload_json` | TEXT | Representação canônica. |
| `diff_json` | TEXT | Alterações contra a versão anterior. |
| `change_reason` | TEXT | Obrigatório após v1. |
| `created_by_role` | TEXT | Secretaria, financeiro ou sistema. |
| `created_by_principal` | TEXT | Identidade funcional. |
| `occurred_at_utc` | TEXT | Data informada do evento. |
| `recorded_at_utc` | TEXT | Data de gravação. |

Datas canônicas usam ISO UTC. Valores monetários usam centavos inteiros.

### 19.4 `validation_runs`

| Campo | Tipo | Observação |
|---|---|---|
| `id` | TEXT PK | Execução. |
| `protocol_id` | TEXT FK | Protocolo. |
| `guide_version_id` | TEXT FK | Versão validada. |
| `rule_set_id` | TEXT FK | Regras aplicadas. |
| `result_status` | TEXT | Resultado geral. |
| `summary` | TEXT | Explicação curta. |
| `ai_status` | TEXT | Não executada, concluída ou falhou. |
| `ai_model` | TEXT NULL | Modelo efetivamente usado. |
| `ai_prompt_version` | TEXT NULL | Versão do contrato de interpretação. |
| `ai_input_json` | TEXT NULL | Contexto mínimo enviado. |
| `ai_output_json` | TEXT NULL | Resposta estruturada recebida. |
| `started_at_utc` | TEXT | Início. |
| `finished_at_utc` | TEXT | Fim. |

### 19.5 `validation_issues`

| Campo | Tipo | Observação |
|---|---|---|
| `id` | TEXT PK | Problema. |
| `validation_run_id` | TEXT FK | Execução de origem. |
| `code` | TEXT | Código estável. |
| `title` | TEXT | Linguagem operacional. |
| `recommended_action` | TEXT | Corrigir, revisar ou não faturar. |
| `owner_area` | TEXT | Secretaria ou financeiro. |
| `status` | TEXT | Aberto, resolvido ou invalidado. |
| `subproblems_json` | TEXT | Evidências e verificações relacionadas. |
| `rule_reference_json` | TEXT | Regra e fonte. |
| `created_at_utc` | TEXT | Criação. |
| `resolved_at_utc` | TEXT NULL | Resolução. |

### 19.6 `tasks`

| Campo | Tipo | Observação |
|---|---|---|
| `id` | TEXT PK | Pendência operacional. |
| `protocol_id` | TEXT FK | Protocolo. |
| `issue_id` | TEXT NULL FK | Problema associado. |
| `assigned_area` | TEXT | Área dona. |
| `task_type` | TEXT | Tipo estável. |
| `title` | TEXT | Próxima ação. |
| `status` | TEXT | Aberta ou concluída. |
| `blocking` | INTEGER | Impede liberação. |
| `created_at_utc` | TEXT | Criação. |
| `resolved_at_utc` | TEXT NULL | Conclusão. |

### 19.7 `workflow_events`

Tabela append-only.

| Campo | Tipo | Observação |
|---|---|---|
| `id` | TEXT PK | Evento. |
| `protocol_id` | TEXT FK | Protocolo. |
| `guide_version_id` | TEXT NULL FK | Versão relacionada. |
| `event_type` | TEXT | Importação, correção, revisão, liberação etc. |
| `actor_role` | TEXT | Papel. |
| `actor_principal` | TEXT | Identidade funcional. |
| `source` | TEXT | UI, MCP, importação ou sistema. |
| `reason` | TEXT NULL | Justificativa. |
| `metadata_json` | TEXT | Detalhes. |
| `occurred_at_utc` | TEXT | Evento de negócio. |
| `recorded_at_utc` | TEXT | Gravação no sistema. |

### 19.8 `evidence_objects`

| Campo | Tipo | Observação |
|---|---|---|
| `id` | TEXT PK | Evidência. |
| `r2_key` | TEXT UNIQUE | Objeto privado. |
| `original_filename` | TEXT | Nome original tratado. |
| `content_type` | TEXT | MIME permitido. |
| `size_bytes` | INTEGER | Até 10 MB. |
| `sha256` | TEXT | Integridade. |
| `uploaded_by_role` | TEXT | Área. |
| `uploaded_by_principal` | TEXT | Identidade funcional. |
| `uploaded_at_utc` | TEXT | Upload. |
| `invalidated_at_utc` | TEXT NULL | Invalidação. |
| `invalidation_reason` | TEXT NULL | Obrigatório se invalidada. |

### 19.9 `evidence_links`

Permite que o mesmo objeto apareça em protocolos unidos sem duplicar o arquivo.

| Campo | Tipo | Observação |
|---|---|---|
| `evidence_id` | TEXT FK | Evidência. |
| `protocol_id` | TEXT FK | Protocolo. |
| `event_id` | TEXT NULL FK | Evento comprovado. |
| `guide_version_id` | TEXT NULL FK | Versão relacionada. |
| `relation_type` | TEXT | Importação, autorização, envio etc. |
| `origin_protocol_id` | TEXT | Origem histórica. |

### 19.10 `protocol_merges`

| Campo | Tipo | Observação |
|---|---|---|
| `id` | TEXT PK | Merge. |
| `source_protocol_id` | TEXT FK | Incorporado. |
| `target_protocol_id` | TEXT FK | Principal. |
| `target_version_id` | TEXT FK | Nova versão resultante. |
| `field_resolution_json` | TEXT | Escolhas por campo. |
| `reason` | TEXT | Justificativa. |
| `performed_by_principal` | TEXT | Financeiro. |
| `performed_at_utc` | TEXT | Horário. |

## 20. Índices D1

Criar índices para:

- `protocols(protocol_number)`;
- `protocols(source_guide_id)`;
- `protocols(validation_status, workflow_status)`;
- `protocols(assigned_area)`;
- `guide_versions(protocol_id, version_number)`;
- `validation_runs(guide_version_id, finished_at_utc)`;
- `validation_issues(validation_run_id, status)`;
- `tasks(assigned_area, status, created_at_utc)`;
- `workflow_events(protocol_id, recorded_at_utc)`;
- `workflow_events(event_type, occurred_at_utc)`;
- `evidence_links(protocol_id)`.

Todas as queries recebem parâmetros vinculados. Migrações já aplicadas nunca serão editadas; novas alterações recebem novo arquivo.

## 21. Motor de validação

### 21.1 Contrato

```text
validateGuide(normalizedGuide, ruleSet, duplicateCandidates)
  → validationStatus
  → problemGroups[]
  → tasks[]
  → riskValue
  → auditSummary
```

### 21.2 Propriedades

- puro e determinístico;
- sem acesso direto a banco ou rede;
- mesma entrada + mesma versão de regra = mesmo resultado;
- códigos de problema estáveis;
- mensagens operacionais separadas dos predicados;
- suporte a múltiplas evidências dentro de um problema.

### 21.3 Ordem de avaliação

1. estrutura e normalização;
2. existência do convênio e procedimento;
3. campos obrigatórios;
4. cobertura;
5. autorização;
6. sessões;
7. descrição e valor;
8. duplicidade;
9. interpretação da observação;
10. composição da próxima ação e tarefas.

## 22. Integração com IA

### 22.1 Entrada mínima

- observação da secretaria;
- convênio;
- datas relevantes;
- procedimento informado;
- resumo dos problemas determinísticos;
- fragmento aplicável da regra.

Não enviar campos que não contribuam para a interpretação.

### 22.2 Saída estruturada

```json
{
  "has_operational_signal": true,
  "category": "NEW_AUTHORIZATION_NOT_REGISTERED",
  "summary": "A observação informa nova autorização ainda não cadastrada.",
  "requires_human_review": true,
  "suggested_owner": "SECRETARIA",
  "evidence_excerpt": "autorização nova, número ainda não lançado"
}
```

O schema será validado. Saída inválida ou erro de inferência vira revisão humana com `ai_status = FALHOU`.

### 22.3 Uso futuro do feedback

Decisões humanas formarão uma base auditável, mas não serão enviadas automaticamente a treinamento ou usadas como verdade sem curadoria. Qualquer uso futuro exige análise de qualidade, finalidade e privacidade.

## 23. MCP

### 23.1 Servidor

- endpoint `/mcp`;
- handler stateless com `createMcpHandler`;
- uma instância lógica de servidor por requisição;
- dados persistentes em D1/R2, não na sessão MCP;
- inputs e outputs validados com Zod;
- mensagens de erro compreensíveis e sem stack trace.

### 23.2 Autenticação

Dois caminhos de credencial, conferidos nesta ordem. Em ambos, `principal` e `role` são
derivados da credencial e injetados no handler; nenhuma tool aceita `role` como input.

**1. OAuth 2.1 (caminho normal, desde 22/09/2026).** O cliente de IA se conecta sozinho:

1. `POST /mcp` sem Bearer responde `401` com
   `WWW-Authenticate: Bearer resource_metadata="..."` (RFC 9728);
2. o cliente lê `/.well-known/oauth-protected-resource` e
   `/.well-known/oauth-authorization-server` (RFC 8414);
3. registra-se em `POST /oauth/register` (RFC 7591) como cliente **público**;
4. redireciona a pessoa para `/oauth/authorize`, onde ela entra com e-mail e senha e autoriza;
5. troca o código por token em `POST /oauth/token`, com **PKCE S256 obrigatório**.

O papel do token é o papel da CONTA (`users.papel`): Secretaria, Financeiro ou Direção.
Código de autorização é de uso único (`UPDATE ... WHERE used_at_utc IS NULL`), refresh é
rotacionado a cada uso, e código e token são guardados apenas como hash SHA-256.

**2. Bearer fixo por área (atalho de demonstração).** `MCP_SECRETARIA_TOKEN` e
`MCP_FINANCEIRO_TOKEN` continuam aceitos. Não identificam pessoa: `principal` é a própria área.

Permissão por papel:

| Tool | Secretaria | Financeiro | Direção |
|---|---|---|---|
| `consultar_regra` | sim | sim | sim |
| `verificar_guia` | sim | sim | sim |
| `consultar_historico` | sim (sua área) | sim (sua área) | sim (tudo) |
| `minhas_pendencias` | sim | sim | **não** (sem fila própria) |
| `registrar_guia` | sim | não | não |
| `consultar_relatorio` | não | não | **sim** |

### 23.3 Contratos das tools

`consultar_regra` recebe:

- `convenio`, obrigatório;
- `procedimento_codigo`, opcional.

Retorna a versão da regra, campos obrigatórios, cobertura, limites, prazos, observações e referência de origem.

`verificar_guia` aceita exatamente uma das formas:

- `id_guia`, para consultar e verificar uma guia existente da base da prova; ou
- `guia`, objeto estruturado obtido dos dados colados pelo operador.

Retorna status, visão geral, problemas, subproblemas, regras aplicadas e próximos passos. A execução não persiste nem altera a guia.

`registrar_guia` recebe um objeto de guia estruturado e um identificador idempotente de origem. Somente a secretaria pode chamá-la. A tool cria protocolo e versão inicial, executa a validação e retorna protocolo, resultado e URL da página criada.

`minhas_pendencias` não recebe área. Ela deriva o escopo da credencial e aceita apenas filtros opcionais de data, estado e limite. Retorna **um item por protocolo** (não por tarefa), com `total_protocolos`, `total_tarefas_abertas`, `risco_cents`, `limite_aplicado` e `truncado`, além dos links temporários de revisão.

O risco soma cada protocolo **uma única vez**, mesmo que ele tenha mais de uma tarefa aberta para a área (RN: "risco conta uma vez por protocolo"). Os nomes são longos de propósito: `total` sozinho não dizia se contava guia ou tarefa, e quem lia a resposta escolhia errado.

`consultar_historico` recebe protocolo ou filtros de data e evento. O resultado respeita o papel autenticado e nunca inclui secrets ou conteúdo binário de evidências.

Cada linha é um **evento**, não uma guia: o mesmo protocolo aparece em vários eventos e leva junto o estado ATUAL dele. Por isso os campos se chamam `status_validacao_atual_do_protocolo` e `status_fluxo_atual_do_protocolo`, e a resposta traz `eventos_retornados`, `total_eventos_no_filtro`, `protocolos_distintos`, `limite_aplicado` e `truncado`. Contagem por estado é responsabilidade de `consultar_relatorio` — somar estado por evento produz número que não existe em lugar nenhum.

### 23.5 Administração de contas

Quem administra é a **Direção**, pela tela `/pessoas`. A autorização dessas rotas sai da sessão
de login (conta real), nunca do cookie de identidade funcional da demonstração — se lesse o
cookie funcional, qualquer visitante criaria contas escolhendo "Direção" no seletor.

Ciclo de vida de uma conta:

1. a Direção cria com nome, e-mail e papel; o sistema devolve uma **senha provisória mostrada
   uma única vez**;
2. no primeiro acesso, a pessoa é levada para `/trocar-senha` e define a própria senha antes de
   qualquer outra coisa — inclusive antes de autorizar um assistente de IA;
3. a pessoa troca a própria senha quando quiser, conferindo a atual;
4. a Direção pode trocar o papel, desativar, reativar e redefinir a senha de alguém.

Regras que valem inclusive para a Direção:

- ninguém desativa a própria conta;
- a última Direção ativa não pode ser desativada nem rebaixada — sem ela, ninguém administraria
  contas;
- trocar o papel, desativar a conta ou redefinir a senha **revoga os tokens de MCP** daquela
  pessoa: um token antigo trabalhando com permissão antiga seria um buraco silencioso;
- cinco senhas erradas seguidas bloqueiam a conta por 15 minutos.

Tudo isso vira evento em `user_events`, append-only: quem fez, em quem, quando.

### 23.4 Links de revisão

`minhas_pendencias` pode retornar URL contendo token assinado com:

- protocolo;
- área autorizada;
- finalidade `review`;
- expiração;
- nonce.

O Worker verifica assinatura, finalidade e expiração. O link abre a tela correta; nenhuma decisão ocorre automaticamente.

### 23.5 Skill `conferir-guia-vitalis`

A Skill é a camada de operação em linguagem natural. Ela não replica as regras e não substitui o MCP.

Fluxo técnico:

```text
texto colado
  → extração fiel dos campos
  → confirmação de ambiguidades relevantes
  → consultar_regra
  → verificar_guia
  → resposta operacional
  → registrar_guia somente após pedido explícito
```

A Skill deve conter:

- descrição de quando deve ser acionada;
- formato aceito de entrada livre;
- regra explícita de não inferir dados ausentes;
- mapeamento entre texto e schema de `verificar_guia`;
- exemplos de guia completa, incompleta e contraditória;
- formato obrigatório da resposta;
- tratamento de erro do MCP;
- regra de confirmação explícita antes de chamar `registrar_guia`;
- orientação para usar a interface quando houver necessidade de correção ou decisão humana.

## 24. Interface HTTP interna

Não constitui API pública de integração.

Rotas previstas:

```text
GET    /api/report
GET    /api/protocols
GET    /api/protocols/:id
POST   /api/imports
POST   /api/protocols
POST   /api/protocols/:id/versions
POST   /api/protocols/:id/review-decisions
POST   /api/protocols/:id/release
POST   /api/protocols/:id/send
POST   /api/protocols/:id/close-private
POST   /api/protocols/:id/close-cancelled
POST   /api/protocols/:id/evidence
GET    /api/evidence/:id
POST   /api/merges/compare
POST   /api/merges/commit
GET    /api/rules
```

Todas as mutações:

- validam papel;
- validam estado anterior;
- executam transação D1;
- gravam evento append-only;
- retornam estado resultante e motivos.

## 25. R2 e evidências

### 25.1 Chaves

```text
evidence/{protocol-id}/{event-id}/{uuid}-{safe-filename}
imports/{import-id}/{uuid}-{safe-filename}
```

Nunca usar nome fornecido pelo usuário como chave integral.

### 25.2 Upload

- validar extensão e MIME;
- limitar a 10 MB antes e durante a leitura;
- calcular SHA-256;
- gravar objeto com metadata mínima;
- inserir metadados D1 somente após sucesso no R2;
- compensar upload órfão se a transação D1 falhar.

### 25.3 Download

- bucket privado;
- acesso somente via Worker;
- token HMAC de curta duração;
- `Content-Disposition` seguro;
- `X-Content-Type-Options: nosniff`;
- sem indexação ou cache público de documentos.

## 26. Merge

### 26.1 Pré-condições

- papel financeiro;
- dois protocolos ativos e distintos;
- suspeita de duplicidade aberta ou justificativa manual;
- nenhum dos protocolos já mesclado;
- escolha explícita do principal.

### 26.2 Transação

1. Revalidar pré-condições.
2. Criar nova versão no protocolo principal.
3. Criar registro de merge com resolução dos campos.
4. Marcar protocolo de origem como `MESCLADA`.
5. Vincular evidências sem duplicar objetos.
6. Copiar ou reatribuir tarefas pertinentes com origem preservada.
7. Gravar eventos nos dois protocolos.
8. Executar nova validação da versão resultante.

Se qualquer etapa falhar, a transação relacional é revertida. Operações R2 não fazem parte do merge, pois os objetos já existem e apenas seus vínculos mudam no D1.

## 27. Relatório e cálculos

### 27.1 Guias verificadas

Contagem de protocolos não mesclados com ao menos uma validação concluída no período.

### 27.2 Precisam de atenção

Protocolos cuja versão atual não está `OK` ou possui tarefa impeditiva aberta.

### 27.3 Risco inicial

Soma de `initial_risk_cents`, uma vez por protocolo, para riscos detectados no período.

### 27.4 Tratado e pendente

- tratado: risco inicial cujo protocolo chegou a destino final válido ou foi corrigido e liberado;
- pendente: risco atual dos protocolos ainda em tratamento;
- valores mesclados não podem ser duplicados.

Cada cálculo retorna também os IDs que compõem o número. O clique usa esses IDs/filtros, garantindo reconciliação entre número e detalhe.

## 28. Segurança

- Secrets apenas no ambiente Cloudflare.
- Nenhum token completo em logs ou respostas.
- Comparação de tokens resistente a diferenças de tempo quando suportado.
- Validação de schema em toda fronteira.
- Queries parametrizadas.
- Autorização conferida no servidor, nunca apenas escondida na interface.
- Upload privado e limitado.
- Links assinados, temporários e de finalidade única.
- Dados e documentos da demonstração inteiramente fictícios.
- Pasta privada do workspace ignorada e auditada antes de publicar.
- Sem dados privados em README, fixtures, snapshots ou histórico Git.

## 29. Observabilidade

### 29.1 Auditoria de negócio

`workflow_events` é a fonte da linha do tempo do protocolo.

### 29.2 Logs técnicos

Registrar:

- request ID;
- rota ou tool;
- status;
- duração;
- código de erro;
- protocolo, quando aplicável;
- modelo de IA e duração, sem registrar tokens ou documentos.

### 29.3 Erros esperados

Erros de domínio retornam código estável e mensagem simples:

- `GUIDE_NOT_READY`
- `OPEN_BLOCKING_TASKS`
- `EVIDENCE_REQUIRED`
- `ROLE_NOT_ALLOWED`
- `INVALID_STATE_TRANSITION`
- `DUPLICATE_MERGE_CONFLICT`
- `AI_REVIEW_REQUIRED`

## 30. Testes

### 30.1 Unitários

- data de validade inclusiva;
- autorização vencida;
- campos obrigatórios por convênio;
- limite de sessões e subproblemas;
- procedimento não coberto;
- código, descrição e valor;
- datas e valores normalizáveis;
- prazo de envio no próprio dia limite e após o limite, usando `data_lancamento`;
- composição do estado principal;
- cálculo de risco sem duplicação.

### 30.2 Integração

- importação das 80 guias;
- criação de protocolo e versão;
- correção e diff;
- trava de liberação;
- registro de envio com evidência;
- fechamento particular e cancelado;
- merge e preservação de histórico;
- filtros do relatório;
- expiração de link assinado;
- presença e contrato correto das duas tools obrigatórias;
- permissão de `registrar_guia` somente para secretaria;
- isolamento de `minhas_pendencias` por área;
- equivalência entre o resultado do MCP e o motor usado pela aplicação;
- comportamento da Skill diante de dados ausentes e ambíguos.

### 30.3 Contrato da IA

- saída válida;
- saída fora do schema;
- indisponibilidade;
- observação vazia;
- contradição com campo estruturado;
- garantia de que a IA nunca produz liberação.

### 30.4 Casos de demonstração

- normal: guia correta e liberável;
- correção: autorização vencida, nova versão e diff;
- revisão: observação sobre nova autorização;
- fora do convênio: procedimento não coberto ou faturamento particular;
- duplicidade: comparação e merge;
- MCP obrigatório: `consultar_regra` e `verificar_guia`;
- MCP operacional: registro explícito, pendências por área, histórico e link direto;
- Skill: conferência de uma guia colada como a recepção escreveu.

## 31. Desempenho e confiabilidade

- Paginar listagens, mesmo com apenas 80 registros.
- Evitar chamadas de IA ao reabrir uma validação já concluída.
- Usar hash da entrada, regra e versão do prompt para reconhecer execução equivalente.
- Importações devem ser idempotentes por hash do arquivo mais chave de origem.
- Ações mutáveis devem rejeitar repetição incompatível.
- Falha da IA degrada para revisão humana; não derruba a validação determinística.
- Falha no upload não cria evidência válida no D1.

## 32. Estratégia de deploy

Ambientes:

- local: D1/R2 locais ou bindings de desenvolvimento;
- preview: recursos separados, dados fictícios;
- produção da prova: Worker, D1 e R2 dedicados.

Passos:

1. instalar dependências fixadas;
2. executar testes e build;
3. aplicar migrações remotas;
4. configurar secrets;
5. carregar regras e seed;
6. publicar Worker e ativos;
7. validar interface, MCP e links;
8. executar checklist de segurança;
9. registrar versão e horário do deploy.

Rollback de código não reverte dados D1 ou objetos R2. Mudanças de schema devem ser compatíveis ou possuir migração corretiva explícita.

---

# Parte III — Plano faseado

## 33. Premissa do faseamento

O limite de seis horas exige uma fatia vertical. Cada fase deve deixar o sistema executável e demonstrável. Recursos de acabamento não podem atrasar regras, auditoria, MCP ou deploy.

Orçamento total: **360 minutos**.

## Fase 0 — Fundação e proteção

**Tempo:** 30 minutos  
**Objetivo:** projeto executável, materiais preservados e recursos definidos.

Entregas:

- inicialização do projeto;
- `.gitignore` revisado;
- materiais oficiais salvos;
- estrutura de pastas;
- configuração inicial do Worker e bindings;
- migração base D1;
- documentação das variáveis e secrets.

Porta de saída:

- aplicação local abre;
- material privado não aparece no índice Git;
- testes vazios e build executam.

## Fase 1 — Núcleo determinístico e dados

**Tempo:** 75 minutos  
**Objetivo:** transformar as 80 guias em decisões reproduzíveis.

Entregas:

- parser e normalização;
- conjunto de regras versionado;
- motor puro;
- protocolo, versão, validação, problemas e tarefas;
- seed das 80 guias;
- testes críticos;
- baseline reconciliada.

Porta de saída:

- 80 guias carregadas;
- casos conhecidos retornam motivos esperados;
- uma guia nunca é somada duas vezes no risco.

## Fase 2 — Produto utilizável

**Tempo:** 90 minutos  
**Objetivo:** entregar o caminho completo entre relatório, lista, guia e correção.

Entregas:

- relatório com quatro áreas;
- listagem com filtros e estado vazio;
- página do protocolo;
- linha do tempo;
- criação de nova versão e diff;
- formulário individual;
- importação CSV/XLSX;
- travas e ações visuais principais.

Porta de saída:

- usuário percorre relatório → detalhe → correção → nova validação;
- botão de liberação explica quando está bloqueado;
- lista sem filtro mostra tudo.

## Fase 3 — Governança, evidência e merge

**Tempo:** 70 minutos  
**Objetivo:** provar ações e preservar histórico.

Entregas:

- eventos com ocorrido/registrado;
- upload R2 e hash;
- acesso temporário a evidências;
- envio condicionado a comprovante;
- particular e cancelamento;
- detecção e comparação das duas duplicidades conhecidas;
- merge com seleção de principal e divergências.

Porta de saída:

- uma ação retroativa mostra data do fato e data do registro;
- envio não conclui sem evidência;
- merge mantém acesso às duas origens.

## Fase 4 — IA e MCP

**Tempo:** 55 minutos  
**Objetivo:** demonstrar interpretação limitada, MCP de consulta e Skill operacional.

Entregas:

- Workers AI com schema estruturado;
- persistência do contexto, modelo e saída;
- fallback para revisão humana;
- MCP stateless;
- autenticação de secretaria e financeiro;
- as cinco tools definidas, com destaque demonstrável para `consultar_regra` e `verificar_guia`;
- links assinados para revisão;
- Skill `conferir-guia-vitalis` com exemplos e tratamento de lacunas.

Porta de saída:

- `consultar_regra` explica a fonte e a versão da regra;
- `verificar_guia` devolve o mesmo resultado do motor da aplicação;
- secretaria pode registrar uma guia nova pelo MCP;
- secretaria e financeiro recebem somente as pendências da própria área;
- “quero revisar” devolve o link exato;
- a Skill confere uma guia colada sem inventar dados;
- nenhuma tool consegue corrigir, liberar, enviar, encerrar ou mesclar.

## Fase 5 — Entrega e demonstração

**Tempo:** 40 minutos  
**Objetivo:** publicar e tornar a solução avaliável.

Entregas:

- testes finais;
- deploy;
- README;
- revisão e empacotamento da Skill do operador;
- roteiro do vídeo;
- validação dos links públicos e MCP;
- auditoria de Git, secrets e material privado.

Porta de saída:

- caso normal, correção, revisão humana, evidência, merge e MCP demonstráveis;
- README explica decisões e limites;
- repositório pode ser publicado sem exposição indevida.

## 34. Linha de corte

Se houver atraso, cortar nesta ordem:

1. refinamentos visuais e animações;
2. suporte genérico a merges além dos casos da prova;
3. filtros secundários;
4. preview embutido de PDF, mantendo download protegido;
5. XLSX avançado, mantendo CSV integral e XLSX básico.

Não cortar:

- regras e testes críticos;
- bloqueio de liberação;
- versões e eventos;
- relatório reconciliável;
- evidência de envio;
- duas tools MCP obrigatórias, ferramentas operacionais aprovadas e Skill;
- deploy, README e verificação de segurança.

## 35. Dependências entre fases

```text
Fase 0
  ↓
Fase 1 ───────────────┐
  ↓                   │
Fase 2                │
  ↓                   │
Fase 3                │
  ↓                   │
Fase 4 ← motor da F1 ─┘
  ↓
Fase 5
```

IA e MCP dependem do mesmo motor determinístico da interface. Não haverá uma implementação paralela de regras para cada canal.

## 36. Riscos e respostas

| Risco | Impacto | Resposta |
|---|---|---|
| Escopo exceder seis horas | Alto | Respeitar linha de corte e portas de saída. |
| Modelo de IA indisponível | Médio | Revisão humana conservadora. |
| Biblioteca XLSX incompatível | Médio | Isolar adapter e preservar CSV integral. |
| Falso positivo de duplicidade | Alto | Nunca mesclar automaticamente. |
| Evidência pública por engano | Alto | R2 privado e acesso somente por Worker. |
| Token MCP exposto | Alto | Secrets, não logar token e rotacionar. |
| Regra ambígua | Alto | Não inventar; criar tarefa humana e documentar lacuna. |
| Número agregado não reconciliar | Alto | Cálculo retorna os protocolos que compõem o total. |
| Merge apagar contexto | Alto | Nova versão e eventos nos dois protocolos. |
| Revalidação alterar passado | Alto | Execução nova, nunca mutação da anterior. |

## 37. Evoluções posteriores

- ~~OAuth e identidade individual~~ — entregue em 22/09/2026 (§23.2);
- integração com o sistema da clínica e o prontuário;
- envio programático ao convênio;
- relatório automático de terça-feira;
- notificações por e-mail ou canal corporativo;
- reversão auditável de merge;
- antivírus e políticas de retenção documental;
- métricas históricas de glosa real;
- curadoria do feedback humano para melhorar a interpretação;
- gestão administrativa de novas versões de regras.

## 38. Referências técnicas

- Cloudflare Workers: <https://developers.cloudflare.com/workers/>
- Workers Static Assets: <https://developers.cloudflare.com/workers/static-assets/>
- D1: <https://developers.cloudflare.com/d1/>
- R2: <https://developers.cloudflare.com/r2/>
- Workers AI: <https://developers.cloudflare.com/workers-ai/>
- MCP no Agents SDK: <https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/>
- Segurança de MCP: <https://developers.cloudflare.com/agents/model-context-protocol/guides/securing-mcp-server/>

---

## 39. Aprovação

Ao aprovar este PRD + SDD, ficam autorizadas as fases 0 a 5 dentro da linha de corte definida. Qualquer ampliação material de escopo deve voltar para decisão antes de ser implementada.
