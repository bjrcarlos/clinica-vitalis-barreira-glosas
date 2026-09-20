# SPEC - Barreira de Glosas da Clínica Vitalis

**Data:** 2026-09-20  
**Solicitante:** Carlos Bomfim  
**Responsável pela execução:** Orquestrador  
**Status:** pronta para aprovação  
**Prioridade:** alta

---

## 1. Resumo da missão

Construir, publicar e documentar uma aplicação Cloudflare que examine as 80 guias fictícias da Clínica Vitalis antes do envio aos convênios, mostre o que precisa ser corrigido, encaminhe ambiguidades para revisão humana e dê ao Dr. Renato um relatório semanal simples sobre volume verificado, pendências e dinheiro em risco.

A solução deverá aceitar guias por upload de CSV/XLSX, formulário individual e MCP; preservar versões e decisões; armazenar evidências; expor ferramentas MCP estreitas; e demonstrar claramente o que é regra determinística, interpretação de IA e decisão humana.

O resultado esperado é uma barreira operacional anterior à glosa, não um substituto para o sistema atual da clínica e não um dashboard complexo.

---

## 2. Decisão conceitual

O problema aparece no financeiro e na glosa, mas mora entre o lançamento da recepção e o envio ao convênio.

O fluxo principal será:

`secretaria registra/corrige → sistema verifica → financeiro revisa/libera → envio é comprovado → Dr. Renato acompanha`

Princípios:

- a secretaria é responsável por dados, autorizações, documentos e correções;
- o financeiro é responsável por revisão, duplicidades, destino da cobrança, liberação e registro do envio;
- código determinístico decide regras objetivas;
- IA lê observações e identifica contexto ou contradições, mas nunca aprova, corrige campos ou conclui uma decisão humana;
- nenhuma guia pode ser liberada enquanto a versão atual tiver requisito reprovado ou revisão aberta;
- a interface mostrará a próxima ação útil, sem esconder os problemas e subproblemas associados;
- cada decisão importante será reproduzível por protocolo, versão, regra, evidência, ator e data.

---

## 3. Escopo obrigatório

Esta missão deve alterar/criar/produzir:

- aplicação publicada em Cloudflare Workers com Static Assets;
- banco D1 com protocolos, versões de guia, validações, problemas, subproblemas, tarefas, eventos, decisões e metadados de evidências;
- bucket R2 privado para PDFs, JPGs e PNGs de até 10 MB;
- motor determinístico versionado pelas regras oficiais de `agosto/2026`;
- interpretação controlada das observações com Workers AI e fallback conservador;
- importação de CSV/XLSX, cadastro individual e entrada via MCP;
- relatório do Dr. Renato com quatro áreas: guias verificadas, guias que exigem atenção, valor inicialmente em risco e destino do risco tratado/pendente;
- listas detalhadas abertas pelos números do relatório; sem filtro, a listagem deve mostrar todas as guias;
- página individual da guia com dados completos, problemas, subproblemas, evidências, linha do tempo, versões e diff;
- protocolo interno único e imutável, separado do `id_guia` de origem;
- merge auditável de possíveis duplicidades, com escolha do protocolo principal e resolução dos campos divergentes;
- trilha de eventos com `ocorrido_em` e `registrado_em`;
- MCP autenticado por área, com pendências específicas e links assinados para a tela exata de revisão;
- README público, testes, Skill operacional, roteiro de demonstração e material necessário para a entrega da prova;
- verificação final de segurança, deploy, links e ausência de material privado no repositório.

Esta missão não deve alterar:

- o sistema atual de gestão da clínica;
- o prontuário existente;
- o processo de envio real aos convênios;
- as fontes oficiais de regras fornecidas pela prova;
- registros históricos por sobrescrita ou exclusão destrutiva.

Ficam deliberadamente fora do escopo:

- OAuth completo e cadastro individual de funcionários;
- integração real com o sistema da clínica ou com convênios;
- notificações corporativas e envio automático do relatório;
- OCR, antivírus próprio, assinatura digital certificada e classificação automática de documentos;
- treinamento ou ajuste fino de modelo;
- editor administrativo de regras;
- mecanismo genérico de merge e reversão automática de merge;
- Durable Objects, Queues e Workflows, enquanto não houver necessidade comprovada.

---

## 4. Arquivos e áreas afetadas

### Áreas principais

- interface web pública de demonstração;
- Worker HTTP e MCP;
- regras de negócio e testes;
- D1, R2, Workers AI e Workers Secrets;
- documentação, Skill e roteiro de demonstração;
- configuração de deploy e segurança do repositório.

### Arquivos especialmente críticos

- `.gitignore`
- `README.md`
- `wrangler.jsonc`
- `package.json`
- `src/` para aplicação, regras e MCP
- `migrations/` para o esquema D1
- `tests/` para regras críticas
- `public/` ou diretório equivalente de ativos
- `skill/` para a Skill entregue na prova
- `SPECs/2026-09-20 - SPEC - Barreira de Glosas Vitalis.md`

Materiais privados já existentes no workspace devem continuar ignorados pelo Git e não podem aparecer em código, logs, documentação pública ou exemplos.

---

## 5. Regras de implementação

### 5.1 Arquitetura Cloudflare

- Um projeto TypeScript hospedado em Workers com Static Assets.
- D1 para dados relacionais, filtros e auditoria.
- R2 privado para arquivos; D1 guardará metadados, hash SHA-256 e vínculos.
- Workers AI somente para texto livre.
- MCP stateless com `createMcpHandler`; não usar o `McpAgent` descontinuado.
- Secrets distintos para as identidades funcionais `secretaria` e `financeiro`, além da assinatura dos links temporários.
- Não adicionar Durable Objects, Queues ou serviços externos sem requisito novo.

### 5.2 Identidade e protocolo

- Cada caso terá um `numero_protocolo` único, legível e imutável.
- O `id_guia` original será preservado como identificador da fonte.
- Todas as versões, validações, eventos, tarefas, decisões, merges e evidências apontarão para o protocolo.
- A versão corrente será derivada do histórico; versões anteriores permanecerão imutáveis.

### 5.3 Datas e horários

- Armazenar instantes em UTC e preservar o fuso relevante.
- Usar `America/Sao_Paulo` como fuso operacional.
- Exibir `dd/MM/aaaa HH:mm:ss`, informando “horário de Brasília”.
- Pesquisas da interface e do MCP aceitarão datas brasileiras e intervalos.
- Em registros retroativos, separar `ocorrido_em` de `registrado_em`.
- Datas inequívocas em outro formato serão preservadas como valor original e normalizadas internamente, com aviso não bloqueante.

### 5.4 Validação e estados

Resultados de validação:

- `OK`
- `CORRIGIR`
- `REVISÃO HUMANA`
- `NÃO FATURAR AO CONVÊNIO`

Estados de fluxo:

- em tratamento;
- liberada para envio;
- enviada;
- encerrada como particular;
- encerrada com cobrança cancelada;
- mesclada em outro protocolo.

Uma guia só poderá ser liberada quando a versão atual estiver `OK`, sem problema aberto, sem revisão pendente e com as evidências obrigatórias satisfeitas. A liberação não equivale ao envio. O envio será outro evento e, por ocorrer fora do sistema, exigirá comprovante ou protocolo.

### 5.5 Problemas e subproblemas

- Um problema poderá conter vários subproblemas ou evidências técnicas.
- Exemplo: “limite de sessões excedido” poderá mostrar sessão registrada, limite informado na guia e limite oficial do convênio.
- O dinheiro em risco será contado uma vez por protocolo, mesmo quando houver vários problemas.
- A próxima ação principal será exibida na listagem; todos os problemas permanecerão acessíveis na página da guia.

### 5.6 Regras determinísticas

Aplicar, no mínimo:

- campos obrigatórios por convênio;
- validade inclusiva da autorização na data do atendimento;
- limite de sessões;
- cobertura do procedimento;
- coerência entre código, descrição e valor de referência;
- normalização estrutural de datas e valores;
- suspeita de duplicidade por chave composta explicável;
- bloqueio de liberação enquanto houver requisito aberto;
- versionamento da regra utilizada em cada execução.

O prazo de envio e outros eventos externos só serão afirmados quando houver data e evidência correspondentes. Lacunas retroativas gerarão tarefas para a área responsável, sem inventar aprovação.

### 5.7 IA

Fluxo:

`observação + contexto mínimo da guia + regras relevantes → classificação estruturada → revisão humana`

A IA poderá:

- identificar autorização nova ainda não cadastrada;
- reconhecer autorização verbal ou protocolo;
- detectar intenção de faturamento particular;
- identificar divergência entre procedimento realizado e lançado;
- resumir por que a observação exige atenção.

A IA não poderá:

- alterar campos;
- liberar guia;
- decidir faturamento;
- ignorar uma regra determinística;
- executar merge;
- registrar decisão financeira.

Se a IA falhar ou estiver indisponível, o motor determinístico continuará funcionando e a observação não interpretada será encaminhada para revisão humana.

### 5.8 Evidências

- Evidência será obrigatória para afirmações sobre ações externas e para decisões que contrariem um resultado automático.
- Ações internas serão comprovadas pelo log imutável do sistema.
- Arquivos serão privados, vinculados a protocolo, versão e evento, com hash, autor e timestamps.
- Arquivos não poderão ser sobrescritos ou apagados pela interface; poderão ser invalidados com justificativa e substituídos por nova evidência.
- Documentos já existentes no prontuário poderão ser referenciados em produção; a prova usará arquivos fictícios no R2.
- Links de acesso serão temporários e assinados.

### 5.9 Merge

- Somente o financeiro poderá confirmar merge.
- O usuário escolherá o protocolo principal.
- Campos idênticos serão preservados automaticamente; divergências exigirão escolha explícita.
- O merge criará uma nova versão no protocolo principal e um evento de relacionamento no protocolo incorporado.
- Histórico e evidências das duas origens permanecerão visíveis e identificados.
- O resultado será validado novamente.
- Reversão de merge ficará documentada como evolução, sempre preservando o histórico.

### 5.10 MCP

Ferramentas propostas:

- `consultar_regra`: leitura de regra por convênio e procedimento;
- `verificar_guia`: validação sem persistência, com decisão e motivos;
- `registrar_guia`: escrita explícita, restrita à secretaria; cria protocolo e dispara validação;
- `minhas_pendencias`: leitura limitada à área autenticada, com datas, valores e links de revisão;
- `consultar_historico`: leitura por protocolo, período, evento e área.

O papel virá da credencial da conexão, nunca de um parâmetro informado pelo agente. Decisões humanas continuarão restritas à interface visual.

### 5.11 Interface e relatório

- Visual simples, responsivo e orientado a relatório.
- Quatro áreas narrativas no topo, sem excesso de gráficos.
- Cada número será um link para a lista filtrada correspondente.
- Sem filtro, a lista mostrará todas as guias.
- A página da guia mostrará próxima ação, problemas, subproblemas, dados, evidências, histórico, versões e diff.
- Diffs mostrarão somente campos alterados; um link abrirá a versão completa.
- Botões e travas explicarão por que uma ação está indisponível.

### 5.12 Segurança e privacidade

- Dados da prova são fictícios; nenhuma evidência de demonstração conterá dado real de saúde.
- Nenhum secret será enviado ao cliente, logado ou commitado.
- Uploads terão validação de tipo e limite de 10 MB.
- Objetos do R2 não terão acesso público permanente.
- Links de revisão e evidência serão assinados e temporários.
- O repositório será auditado antes da publicação.

---

## 6. Ordem recomendada de execução

1. Inicializar o projeto e confirmar proteção dos materiais privados.
2. Baixar e preservar os três materiais oficiais da prova.
3. Criar o esquema D1, migrações, protocolo e seed das 80 guias.
4. Implementar o motor determinístico isolado e seus testes.
5. Implementar a linha do tempo, eventos e versões.
6. Construir relatório, listagem, filtros e página da guia.
7. Implementar formulário, importação CSV/XLSX e criação da segunda versão.
8. Implementar revisão, liberação, envio, destinos fora do convênio e travas.
9. Implementar R2, evidências e links temporários.
10. Implementar detecção e merge das duplicidades.
11. Integrar Workers AI com saída estruturada e fallback.
12. Implementar e proteger o MCP por área.
13. Criar a Skill operacional e exemplos de uso.
14. Executar testes, auditoria de segurança e validação dos casos de demonstração.
15. Publicar, escrever o README e preparar o roteiro/vídeo de até cinco minutos.

---

## 7. Critérios de aceite

A missão estará pronta quando:

- [ ] As 80 guias estiverem disponíveis na aplicação publicada.
- [ ] Uma nova guia puder entrar por upload, formulário e MCP.
- [ ] As regras determinísticas estiverem separadas da interpretação de IA.
- [ ] Cada resultado informar dados, regra, versão, motivo e horário.
- [ ] Nenhuma guia incompleta puder ser liberada.
- [ ] Correções criarem versões imutáveis com diff.
- [ ] O relatório contar uma história clara por meio das quatro áreas aprovadas.
- [ ] Cada número do relatório abrir seu detalhamento e a listagem sem filtro mostrar tudo.
- [ ] Pendências forem atribuídas à secretaria ou ao financeiro.
- [ ] `minhas_pendencias` respeitar a área autenticada e devolver links exatos.
- [ ] Decisões humanas só puderem ser concluídas visualmente.
- [ ] Evidências fictícias puderem ser anexadas, verificadas e visualizadas com segurança.
- [ ] Os dois pares suspeitos puderem ser comparados e mesclados sem perda de histórico.
- [ ] O sistema demonstrar caso normal, correção, exceção humana, decisão explicada, regra de origem e benefício operacional.
- [ ] O MCP expuser pelo menos `consultar_regra` e `verificar_guia`, além das ferramentas operacionais definidas.
- [ ] Testes cobrirem regras críticas, limites, datas inclusivas, duplicidade, versionamento e travas.
- [ ] README, configuração, Skill e roteiro de demonstração estiverem completos.
- [ ] Deploy, MCP, links, secrets e Git forem verificados antes da entrega.
- [ ] Nenhum material privado estiver rastreado ou exposto.

---

## 8. Anti-padrões a evitar

Não fazer:

- transformar a solução em um dashboard extenso;
- usar IA para if/else, cálculo, cobertura ou validação estrutural;
- permitir que a IA aprove, edite, mescle ou registre decisão humana;
- sobrescrever versões, decisões ou evidências;
- contar a mesma guia várias vezes no dinheiro em risco;
- tratar a data de registro retroativo como data do evento;
- pedir novo upload quando um documento existente puder ser referenciado;
- marcar “enviada” sem evidência externa;
- expor objetos R2, tokens, chaves ou dados sensíveis;
- aceitar o papel do usuário como argumento de uma tool MCP;
- criar infraestrutura sem requisito, incluindo Durable Objects, Queues ou Workflows;
- trocar o sistema atual ou impor um novo prontuário;
- criar abstrações genéricas antes de uma necessidade comprovada;
- publicar qualquer conteúdo privado usado apenas como contexto.

---

## 9. Decisões pendentes

Não há decisão de negócio bloqueante.

Decisões operacionais que serão fechadas durante a implementação:

- nome técnico do projeto e URL pública;
- modelo disponível no Workers AI no momento da implementação;
- biblioteca de leitura XLSX compatível com o bundle;
- duração exata dos links assinados;
- credenciais e identificadores da conta Cloudflare;
- respostas posteriores do recrutador sobre usuário principal e tolerância a falsos positivos, que poderão ajustar a SPEC sem apagar as decisões atuais.

---

## 10. Pacote de delegação

**Missão:** Barreira de Glosas da Clínica Vitalis  
**Agente responsável:** Orquestrador  
**Skill principal:** `spec`  
**Skills auxiliares:** `cloudflare`, `agents-sdk`, `workers-best-practices`, `wrangler`; `frontend-design`, `turnstile-spin` ou `cloudflare-email-service` somente se um requisito aprovado realmente as exigir.

### Contexto

- BrandDNA: não aplicável como arquivo público; princípios privados de posicionamento foram usados apenas para orientar simplicidade, linguagem e foco no problema real.
- Objetivo: impedir que inconsistências de guias cheguem ao convênio sem correção ou decisão humana.
- Produto/oferta: prova técnica funcional para a Expert Integrado.
- ICP: secretaria, financeiro e direção da Clínica Vitalis.
- Canal: aplicação web e MCP remoto.
- Restrições: Cloudflare, custo zero para a Expert, dados fictícios, seis horas sugeridas, solução explicável e repositório público seguro.

### Entrega esperada

- Formato: aplicação publicada, MCP, Skill, código, migrações, testes, README e roteiro de demonstração.
- Pasta: raiz do projeto atual.
- Nome do arquivo: estrutura definida pelo scaffold; esta SPEC permanece em `SPECs/`.
- O que deve vir primeiro: banco e motor determinístico testável.
- O que deve vir depois: interface, evidências, IA, MCP, deploy e documentação.

### Dependências

- Recebe de: `guias.csv`, `regras_convenio.json`, dicionário oficial e decisões desta conversa.
- Entrega para: avaliadores da Expert Integrado e usuários fictícios da Clínica Vitalis.
- Pode executar em paralelo com: redação incremental do README e preparação dos casos de demonstração, sem delegação automática.
- Precisa esperar: aprovação explícita desta SPEC antes de qualquer implementação.

### Critérios de qualidade

- decisões reproduzíveis e auditáveis;
- experiência simples com próxima ação evidente;
- regras de negócio localizáveis, testadas e separadas da IA;
- nenhuma autonomia desnecessária;
- segurança proporcional à prova e limitações declaradas;
- demonstração compreensível em até cinco minutos.
