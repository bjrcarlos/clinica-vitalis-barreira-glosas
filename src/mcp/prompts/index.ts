import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ContextoMcp } from "../auth";

/**
 * Skills operacionais servidas pelo PRÓPRIO servidor MCP, como prompts (`prompts/list`,
 * `prompts/get`).
 *
 * Por que aqui e não num arquivo de Skill que cada pessoa instala: quem lê as tools é o modelo do
 * outro lado, e um arquivo que ficou na máquina de alguém não chega até ele. Um assistente
 * conectado somou o estado repetido em cada evento de `consultar_historico` e anunciou contagens
 * que não existem em lugar nenhum — tinha a tool, não tinha a instrução. Servindo as duas juntas,
 * a orientação viaja com a credencial.
 *
 * Os prompts são filtrados pelo papel da credencial, igual às tools: a Direção não recebe o da
 * fila (não tem fila) e Secretaria/Financeiro não recebem o do relatório consolidado.
 */

/** Regras que valem para qualquer uso do MCP — o que causou erro de número e o que a IA não decide. */
const REGRAS_DE_LEITURA = `REGRAS QUE NÃO SE NEGOCIAM

1. Contagem de guias vem de consultar_relatorio. Nunca some o campo
   status_validacao_atual_do_protocolo devolvido por consultar_historico: aquilo é o estado de HOJE
   do protocolo, repetido em cada evento dele. Somar produz número que não existe no banco.
2. Toda resposta paginada traz limite_aplicado e truncado. Se truncado for true, diga que a lista
   está cortada e quantos itens existem no total; não tire conclusão quantitativa de lista cortada.
3. Em minhas_pendencias, total_protocolos e total_tarefas_abertas são coisas diferentes: um
   protocolo pode ter mais de uma tarefa. O risco já vem somado uma vez por protocolo — não
   recalcule somando item a item.
4. Valores estão em centavos (campos terminados em _cents). Converta para reais ao falar com uma
   pessoa, e nunca arredonde para cima.
5. Datas chegam em ISO UTC. Apresente em dd/mm/aaaa, horário de Brasília.
6. O MCP não corrige, não libera, não envia, não encerra e não mescla. Se pedirem qualquer dessas
   ações, recuse e aponte a tela do protocolo. Registrar guia nova só com pedido explícito, e só
   pela Secretaria.
7. Nunca invente valor de campo ausente. Campo que não veio é campo que falta, e isso se diz.

COMO APRESENTAR

8. Pergunta de contagem quase nunca para na contagem. Ao dizer quantas guias estão em um estado,
   já traga na mesma resposta o detalhamento de consultar_relatorio.motivos_por_estado: motivo,
   quantas guias, os números dos protocolos e de quem é a resolução — em tabela. Não espere a
   pessoa pedir "mais detalhes".
9. Uma guia pode ter mais de um motivo, então a soma dos motivos pode passar do total do estado.
   Diga isso quando acontecer, em vez de deixar o leitor achar que a conta está errada.
10. Números de protocolo em tabela, nunca em parágrafo corrido.`;

interface PromptEmbutido {
  readonly nome: string;
  readonly titulo: string;
  readonly descricao: string;
  /** Papéis que enxergam este prompt. Mesma disciplina das tools: papel vem da credencial. */
  readonly papeis: ReadonlyArray<ContextoMcp["papel"]>;
  readonly argumentos?: z.ZodObject<z.ZodRawShape>;
  readonly montar: (argumentos: Record<string, string | undefined>, contexto: ContextoMcp) => string;
}

const PROMPTS: readonly PromptEmbutido[] = [
  {
    nome: "conferir-guia",
    titulo: "Conferir uma guia colada",
    descricao:
      "Recebe os dados de uma guia como a recepção escreveu, organiza sem inventar campo, consulta a regra e verifica — sem salvar nada.",
    papeis: ["SECRETARIA", "FINANCEIRO", "DIRECAO"],
    argumentos: z.object({
      texto_da_guia: z.string().describe("Os dados da guia como a recepção escreveu, em texto livre").default(""),
    }),
    montar: (argumentos) => `Confira esta guia para mim, sem salvar nada.

${argumentos.texto_da_guia ? `Guia colada:\n${argumentos.texto_da_guia}` : "Vou colar a guia na próxima mensagem."}

COMO PROCEDER

1. Extraia só os campos presentes no texto. Preserve os valores como foram escritos.
2. Liste o que está ausente, contraditório ou ambíguo. Não preencha com suposição; se a ambiguidade
   mudar o resultado, pergunte antes de verificar.
3. Chame consultar_regra com o convênio e, se houver, o código do procedimento.
4. Chame verificar_guia passando o objeto guia (nunca id_guia, que é para guia já existente).
   Essa chamada não cria nem altera nada.
5. Responda nesta ordem: estado (OK, CORRIGIR, REVISÃO HUMANA ou NÃO FATURAR AO CONVÊNIO), resumo
   em uma frase, problemas com seus subproblemas, regra e versão aplicadas, campos que faltaram, e
   qual é o próximo passo humano.
6. Termine dizendo, com estas palavras, que nada foi gravado.

${REGRAS_DE_LEITURA}`,
  },
  {
    nome: "minha-fila",
    titulo: "Minha fila de pendências, priorizada",
    descricao:
      "Lista o que a sua área precisa resolver, agrupado por motivo e ordenado por risco e idade, com o próximo passo de cada caso.",
    papeis: ["SECRETARIA", "FINANCEIRO"],
    montar: (_argumentos, contexto) => `Monte minha fila de trabalho.

1. Chame minhas_pendencias sem nenhum argumento de área — ela já deriva da minha credencial
   (você está falando com o perfil ${contexto.papel}).
2. Agrupe os protocolos por motivo, usando os títulos das tarefas.
3. Ordene do mais caro para o mais barato e, em empate, do mais antigo para o mais recente.
4. Para cada grupo, diga em uma frase o que a pessoa precisa fazer, e mostre o link de revisão
   quando existir.
5. Fecha com: quantos protocolos, quantas tarefas abertas e quanto risco existe na fila — usando os
   campos total_protocolos, total_tarefas_abertas e risco_cents, sem recalcular.

Se truncado vier true, diga quantos protocolos existem ao todo e ofereça filtrar por estado ou por
período em vez de listar o resto.

${REGRAS_DE_LEITURA}`,
  },
  {
    nome: "relatorio-da-terca",
    titulo: "Relatório consolidado da semana",
    descricao:
      "Texto pronto para a reunião: o que entrou, o que está travado, onde está o risco e o que mudou desde a última leitura.",
    papeis: ["DIRECAO"],
    argumentos: z.object({
      desde: z.string().describe("Data inicial para a comparação, no formato aaaa-mm-dd").default(""),
    }),
    montar: (argumentos) => `Escreva o relatório da semana para a reunião da Direção.

1. Chame consultar_relatorio. Todos os números do texto saem daí — ele é a mesma fonte da tela de
   relatório, então o que você escrever vai bater com o que a clínica vê.
2. Chame consultar_historico${argumentos.desde ? ` com data_de = ${argumentos.desde}` : " com um recorte de data"} só para
   contar o que ACONTECEU no período (correções feitas, guias liberadas, envios registrados) — e
   nunca para contar guias por estado.
3. Escreva em prosa curta, para leitura em voz alta, nesta ordem:
   - quantas guias foram verificadas e quantas exigem atenção;
   - quanto de risco está pendente, em reais;
   - os três motivos mais frequentes, com quantas guias cada um;
   - como o risco se divide entre Secretaria e Financeiro;
   - as pendências mais antigas, pelo número do protocolo;
   - o que mudou no período, a partir dos eventos.
4. Feche com uma recomendação objetiva de onde agir primeiro, justificada pelo risco.

${REGRAS_DE_LEITURA}`,
  },
  {
    nome: "conferir-lote",
    titulo: "Conferir várias guias antes do envio",
    descricao:
      "Recebe várias guias coladas de uma planilha, verifica uma a uma sem salvar e devolve só o que impede o envio.",
    papeis: ["SECRETARIA", "FINANCEIRO", "DIRECAO"],
    argumentos: z.object({
      linhas: z.string().describe("As guias coladas, uma por linha ou separadas por linha em branco").default(""),
    }),
    montar: (argumentos) => `Confira este lote de guias antes de eu enviar ao convênio.

${argumentos.linhas ? `Guias coladas:\n${argumentos.linhas}` : "Vou colar as guias na próxima mensagem."}

COMO PROCEDER

1. Separe as guias e trate cada uma isoladamente. Se alguma linha não tiver campos suficientes,
   liste-a como "não deu para conferir" com o que falta — não descarte em silêncio.
2. Chame verificar_guia uma vez por guia, sempre com o objeto guia. Nada é gravado.
3. Devolva uma tabela com: identificação da guia, estado, o problema principal e quem resolve.
4. Depois da tabela, some quantas ficaram OK e quantas travam o envio, e diga o risco total em
   reais somando o risco de cada guia que travou.
5. Destaque separadamente as que estouraram o prazo de envio do convênio: elas não são erro de
   preenchimento, e a decisão é do Financeiro.

${REGRAS_DE_LEITURA}`,
  },
];

/** Registra os prompts que o papel da credencial pode ver. */
export function registrarPrompts(server: McpServer, contexto: ContextoMcp): void {
  for (const prompt of PROMPTS) {
    if (!prompt.papeis.includes(contexto.papel)) continue;

    server.registerPrompt(
      prompt.nome,
      {
        title: prompt.titulo,
        description: prompt.descricao,
        ...(prompt.argumentos ? { argsSchema: prompt.argumentos } : {}),
      },
      (argumentos: unknown) => ({
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: prompt.montar((argumentos ?? {}) as Record<string, string | undefined>, contexto),
            },
          },
        ],
      }),
    );
  }
}

/** Exposto para teste: quais prompts um papel enxerga. */
export function nomesDePromptsPara(papel: ContextoMcp["papel"]): readonly string[] {
  return PROMPTS.filter((prompt) => prompt.papeis.includes(papel)).map((prompt) => prompt.nome);
}
