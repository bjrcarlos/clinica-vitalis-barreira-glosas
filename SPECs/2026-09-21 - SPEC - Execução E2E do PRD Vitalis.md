# SPEC — Execução E2E do PRD Vitalis

## 1. Resumo da missão

Executar o software da Clínica Vitalis de ponta a ponta conforme `docs/PRD-SDD.md`, respeitando as seis fases do plano, suas portas de saída, a linha de corte e os critérios de segurança. A execução será conduzida em ciclos Ralph: ler o estado, definir a menor próxima ação, implementar, verificar, registrar evidências e repetir até o gate da fase passar.

Cada fase começará com um pacote de contexto mínimo e novo: PRD, arquivos de handoff da fase anterior, estado do repositório e critérios da própria fase. Ao terminar uma fase, será produzido um handoff objetivo; a sessão seguinte não reutilizará as notas de raciocínio da anterior.

## 2. Decisão conceitual

Tratar o PRD + SDD como fonte de verdade e executar uma entrega vertical incremental. O sistema só avançará de fase quando a porta de saída estiver comprovada por código, testes, build, evidência de execução e documentação. Regras ambíguas serão convertidas em revisão humana documentada; não serão inventados dados.

O pedido de “sessão nova e zerada de contexto” será atendido operacionalmente por isolamento explícito entre fases: pacote de entrada reduzido, handoff versionado, checklist próprio e auditoria independente. A ferramenta disponível permite delegar tarefas a subagentes, mas não expõe um comando nativo chamado `ralph` nem um executor literal de `/workflows`; portanto, o ciclo Ralph e os workflows serão registrados e executados como artefatos operacionais do repositório, sem alegar uma sessão técnica inexistente.

## 3. Escopo obrigatório

- Fase 0 — Fundação e proteção: projeto executável, `.gitignore`, materiais oficiais, estrutura, Worker/bindings, migração D1, documentação de variáveis e secrets.
- Fase 1 — Núcleo determinístico e dados: parser, normalização, regras versionadas, motor puro, modelo de dados, seed das 80 guias, testes críticos e baseline reconciliada.
- Fase 2 — Produto utilizável: relatório, lista/filtros, detalhe, timeline, nova versão/diff, formulário, CSV/XLSX, travas e fluxo relatório → detalhe → correção → revalidação.
- Fase 3 — Governança, evidência e merge: eventos ocorrido/registrado, R2/hash, links temporários, envio condicionado a comprovante, particular/cancelamento, duplicidades conhecidas e merge auditável.
- Fase 4 — IA e MCP: saída estruturada, persistência de contexto/modelo/resultado, fallback humano, MCP stateless, autenticação por área, cinco tools, links assinados e Skill operacional sem invenção de dados.
- Fase 5 — Entrega e demonstração: testes finais, deploy autorizado, README, empacotamento da Skill, roteiro, validação de links/MCP e auditoria de Git, secrets e material privado.
- Um workflow por fase, com entrada, ações, verificações, artefatos, riscos e decisão de gate.
- Ciclos Ralph até estabilização do gate; falhas devem voltar ao ciclo da fase, não ser mascaradas.
- Delegação a subagentes em tarefas laterais bem delimitadas, especialmente auditoria do PRD, revisão de testes, segurança e documentação; toda alteração delegada será revisada no contexto principal.
- Preservação das alterações existentes no worktree. Nenhum reset destrutivo, descarte de trabalho ou publicação externa sem autorização específica.

## 4. Arquivos/áreas afetadas

- Fonte de requisitos: `docs/PRD-SDD.md`.
- Código de aplicação: `src/`, configurações do Worker e bindings.
- Testes: `tests/` e verificações de contrato, integração e demonstração.
- Dados e persistência: migrações D1, seed, adapters R2 e arquivos de configuração necessários.
- Evidências de execução: `docs/PROGRESS/`, handoffs e workflows por fase.
- Esta SPEC e demais artefatos em `SPECs/`.
- README, Skill do operador e roteiro de demonstração na Fase 5.
- `.dev.vars` e secrets somente como configuração local; valores secretos não serão lidos para exibição, commitados ou registrados em logs.

## 5. Regras de implementação

- Usar o PRD como contrato; qualquer mudança material deve ser registrada como decisão antes de alterar comportamento.
- Manter a fonte única do motor determinístico entre interface, MCP e Skill.
- Preservar imutabilidade histórica: nova versão e nova validação não alteram versões ou decisões anteriores.
- Não expor evidência privada, token, cookie, chave ou conteúdo sensível em saída de terminal, screenshot, fixture público ou commit.
- Validar cada fase com testes direcionados, suíte relevante, typecheck/build e inspeção de diff quando aplicável.
- Para cada fase, registrar: contexto de entrada, ações realizadas, comandos/verificações, evidências, pendências e decisão de gate.
- Não fazer deploy remoto, criar recurso pago ou alterar serviço externo sem autorização explícita; a Fase 5 pode preparar e validar o caminho localmente até haver essa autorização.
- Respeitar a linha de corte do PRD: cortar acabamento visual, merges genéricos, filtros secundários, preview embutido e XLSX avançado antes de cortar regras, auditoria, bloqueios, evidências, MCP, Skill, README ou segurança.

## 6. Ordem

1. Inventariar o estado atual, o PRD e as mudanças já existentes sem sobrescrever o worktree.
2. Executar e auditar a Fase 0; registrar handoff e gate.
3. Iniciar uma sessão operacional limpa com apenas o pacote da Fase 1; implementar/verificar e registrar gate.
4. Repetir o mesmo padrão para Fases 2, 3 e 4.
5. Executar a Fase 5 somente depois dos gates anteriores, separando preparo local de qualquer publicação remota.
6. Ao final, rodar a demonstração ponta a ponta, consolidar evidências e atualizar o status da missão.

## 7. Criteria

- Fase 0: aplicação local abre; testes/build executam; material privado não aparece no índice Git; bindings/migração/documentação existem.
- Fase 1: 80 guias carregadas; casos conhecidos retornam motivos esperados; risco não duplica uma guia; baseline fecha.
- Fase 2: fluxo relatório → detalhe → correção → nova validação funciona; lista sem filtro mostra tudo; bloqueio de liberação explica o motivo.
- Fase 3: datas ocorrido/registrado aparecem; envio sem evidência não conclui; hash/link temporário funcionam; merge preserva as duas origens.
- Fase 4: `consultar_regra` informa fonte/versão; `verificar_guia` coincide com o motor; autorização por área é respeitada; tools não executam ações proibidas; Skill não inventa dados.
- Fase 5: suíte final, build, auditoria de secrets/Git, README e roteiro passam; caso normal, correção, revisão humana, evidência, merge e MCP são demonstráveis; deploy só é marcado como concluído se autorizado e verificável.
- Critério global: nenhuma afirmação de concluído sem evidência rastreável no handoff da fase correspondente.

## 8. Anti-patterns

- Simular que uma sessão nova ocorreu apenas mudando o título da tarefa, sem redefinir o contexto de entrada.
- Marcar gate por leitura de código sem executar testes, build ou demonstração exigidos.
- Reimplementar regras separadamente na UI, MCP ou Skill.
- Corrigir histórico em vez de criar versão/evento novo.
- Logar tokens, cookies, chaves, URLs privadas ou conteúdo de evidência.
- Fazer merge automático de duplicidades ou liberar/enviar com pendências bloqueantes.
- Aumentar o escopo com OAuth, integração clínica, notificações ou deploy remoto não previsto.
- Usar subagentes sem escopo delimitado, duplicar trabalho ou integrar patch sem revisão.

## 9. Decisões pendentes/lacunas

- Não foi encontrado no repositório um executor literal chamado `ralph` ou uma pasta/comando `/workflows`; os workflows serão materializados nos artefatos de progresso e executados por ciclos verificáveis.
- A plataforma expõe subagentes, mas não garante que cada subagente seja uma sessão independente do modelo principal; a independência exigida será preservada por pacotes de contexto mínimos e handoffs, com subagentes usados para tarefas isoladas.
- É necessário auditar o estado real de cada fase antes de reimplementar; a Fase 2 já possui histórico de implementação no worktree e deve ser comprovada, não refeita às cegas.
- O deploy da Fase 5 depende de autorização e credenciais disponíveis no ambiente; sem isso, o resultado será “preparado e bloqueado por autoridade externa”, nunca falsamente “publicado”.
- As observações mais recentes sobre validade e prazo de envio alteram o entendimento do PRD; elas devem permanecer registradas no PRD/handoff e ser usadas como regra vigente na validação.

## 10. Delegation package

- Auditor de requisitos: comparar cada fase com o PRD e listar lacunas objetivas, sem editar código.
- Auditor de testes: revisar os gates da fase e propor/implementar testes faltantes em escopo disjunto.
- Auditor de segurança: verificar secrets, cookies, links assinados, R2 privado, logs e autorização por papel.
- Auditor de documentação/demonstração: conferir handoff, README, roteiro e rastreabilidade das evidências.
- O agente principal mantém a integração, decisões de escopo, resolução de conflitos, execução dos gates e decisão final de aceite.

Posso iniciar a MISSÃO?
