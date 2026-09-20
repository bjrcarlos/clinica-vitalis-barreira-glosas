# Protocolo de handoff entre fases

Cada fase termina escrevendo `phase-N-handoff.md` com exatamente estas seções:

1. **O que ficou pronto** — arquivos criados/alterados e o que cada um faz, em uma linha.
2. **Como verificar** — comandos exatos e o que deve aparecer.
3. **Contratos publicados** — assinaturas, tipos, rotas, tabelas ou códigos estáveis que as fases seguintes vão consumir.
4. **Decisões tomadas** — escolhas técnicas e o porquê, incluindo versões fixadas.
5. **Dívidas e lacunas** — o que ficou faltando e por quê.
6. **Porta de saída** — cada critério da fase no PRD, com o resultado real medido.

O handoff é escrito para quem chega sem nenhum contexto. Nada de "como combinamos" ou "conforme discutido".
