# Skill `conferir-guia-vitalis`

> **Esta Skill também vive dentro do servidor MCP.** Ao conectar, o cliente recebe os mesmos
> passos como prompts (`prompts/list`): `conferir-guia`, `conferir-lote`, `minha-fila` (Secretaria
> e Financeiro) e `relatorio-da-terca` (Direção). Um arquivo de Skill só chega ao modelo se
> alguém instalar; o prompt viaja com a credencial. Este arquivo continua servindo para quem
> quer ler o procedimento fora do cliente.

## Quando usar

Use esta Skill quando a operadora colar os dados de uma guia como a recepção escreveu e pedir
uma conferência. A Skill consulta o MCP e devolve uma leitura operacional; ela não substitui a
interface visual para correção, liberação, envio, encerramento ou merge.

## Fluxo obrigatório

1. Extraia somente os campos presentes no texto colado. Preserve os valores como foram escritos.
2. Liste campos ausentes, contraditórios ou ambíguos. Nunca preencha com suposição.
3. Se houver uma ambiguidade relevante, peça esclarecimento antes de verificar.
4. Chame `consultar_regra` com o convênio e, se disponível, o código do procedimento.
5. Chame `verificar_guia` com `guia`, sem persistir nada.
6. Responda com status, resumo, problemas, regras aplicadas, dados ausentes e próximo passo.
7. Só chame `registrar_guia` depois de pedido explícito como “registre esta guia”, confirmando
   antes o `id_guia_origem` idempotente.

## Mapeamento de entrada

O objeto enviado a `verificar_guia` usa os 18 campos do CSV: `id_guia`, `unidade`,
`data_atendimento`, `paciente`, `convenio`, `carteirinha`, `cid`, `procedimento_codigo`,
`procedimento_descricao`, `numero_autorizacao`, `autorizacao_validade`,
`autorizacao_sessoes_limite`, `sessao_numero_na_autorizacao`, `profissional`,
`profissional_registro`, `valor`, `observacao_recepcao` e `data_lancamento`.

Valores numéricos, datas e códigos não devem ser inventados. Se o texto trouxer “valor não
informado”, deixe o campo ausente e explique que a verificação pode resultar em pendência.

## Formato obrigatório da resposta

```text
Conferência: [OK | Corrigir | Revisão humana | Não faturar ao convênio]
Resumo: [texto devolvido pelo motor]

Problemas:
- [código] [título]
  Subproblemas: [lista fiel]

Regra aplicada: [versão, hash e referência]
Dados não informados: [lista; “nenhum” quando aplicável]
Próximo passo: [correção, revisão humana ou uso da interface]
Persistência: apenas conferi; nada foi registrado.
```

## Exemplos

### Guia completa

Entrada: “id G-TEST-01, unidade Centro, atendimento 2026-08-10, paciente P-1, convênio
Vitalcard, procedimento 50000470, autorização AUT-1 válida até 2026-09-10, valor 120,00,
lançamento 2026-08-10.”

Ação: completar apenas campos realmente fornecidos, apontar os ausentes e chamar
`consultar_regra`/`verificar_guia`. Não transformar “Centro” em endereço ou código.

### Guia incompleta

Entrada: “Paciente Maria, Vitalcard, fez fisioterapia ontem.”

Resposta: pedir data exata, procedimento, unidade, autorização e demais campos obrigatórios;
não chamar `registrar_guia`.

### Guia contraditória

Entrada: “atendimento 03/08/2026” e “data de lançamento 01/08/2026”.

Resposta: apontar a inconsistência e pedir confirmação; não escolher a data mais conveniente.

## Erros e limites

- Se o MCP retornar erro de autenticação, não repetir tokens nem expor credenciais; pedir que a
  sessão seja corrigida.
- Se o MCP recusar a entrada (schema inválido, convênio ou procedimento não encontrado, tool
  desconhecida), mostrar a mensagem de erro tal como veio, sem tentar adivinhar o valor correto
  nem repetir a chamada com um dado inventado; pedir ao operador que confirme ou corrija o campo
  apontado antes de tentar de novo.
- Se `verificar_guia`/`consultar_regra` ficarem indisponíveis (erro de rede, timeout, servidor
  fora do ar), informar que a conferência não pôde ser concluída e não apresentar estado, resumo
  nem problemas como se a verificação tivesse ocorrido.
- Se a IA falhar, aceitar o fallback de revisão humana do motor; não concluir que a observação
  é irrelevante.
- Se for necessária correção, decisão de revisão, particular/cancelamento, envio ou merge,
  encaminhar para a tela do protocolo. As tools MCP não executam essas ações.

## Regras de leitura dos números (valem para qualquer uso do MCP)

1. Contagem de guias sai de `consultar_relatorio`. **Nunca** some `status_validacao_atual_do_protocolo`
   vindo de `consultar_historico`: é o estado de hoje do protocolo, repetido em cada evento dele.
2. Respeite `truncado` e `limite_aplicado`. Lista cortada não sustenta conclusão quantitativa.
3. Em `minhas_pendencias`, `total_protocolos` e `total_tarefas_abertas` são coisas diferentes, e o
   risco já vem somado uma vez por protocolo.
4. Valores em centavos; datas em ISO UTC, apresentadas em horário de Brasília.
