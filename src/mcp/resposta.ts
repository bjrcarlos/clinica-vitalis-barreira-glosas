import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/server";

/**
 * Forma única de resposta das tools do MCP.
 *
 * Toda tool devolve DOIS conteúdos do mesmo fato:
 *
 * - `content[0].text`: Markdown pronto para a pessoa ler — valores em reais, datas em horário de
 *   Brasília, rótulos em português, tabelas onde há lista. É o que o assistente do outro lado
 *   deve reproduzir, não reinterpretar. Quanto mais pronto o texto, menos o modelo inventa
 *   conversão, arredondamento ou soma.
 * - `structuredContent`: o mesmo dado como objeto, validado contra o `outputSchema` anunciado em
 *   `tools/list`. É o que um cliente programático ou um modelo que precisa cruzar campos usa.
 *
 * Os dois nascem da mesma variável na tool; não existe caminho em que o texto diga uma coisa e
 * o objeto outra.
 */
export function responder(texto: string, estruturado: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: texto }], structuredContent: estruturado };
}

/**
 * Erro de tool com código estável na frente da mensagem (`[ROLE_NOT_ALLOWED] ...`), no mesmo
 * espírito dos códigos de erro de domínio do CLAUDE.md. O cliente MCP recebe `isError: true`;
 * o código é o que permite a um assistente explicar o motivo sem adivinhar.
 */
export type CodigoErroTool =
  | "ROLE_NOT_ALLOWED"
  | "CONVENIO_DESCONHECIDO"
  | "PROCEDIMENTO_DESCONHECIDO"
  | "GUIA_NAO_ENCONTRADA"
  | "ENTRADA_INVALIDA";

export function erroTool(codigo: CodigoErroTool, mensagem: string): Error {
  return new Error(`[${codigo}] ${mensagem}`);
}

/** Tabela Markdown. Células recebem `|` escapado e quebra de linha achatada para não quebrar a grade. */
export function tabela(cabecalhos: readonly string[], linhas: ReadonlyArray<ReadonlyArray<string | number>>): string {
  const celula = (valor: string | number): string => String(valor).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const cabecalho = `| ${cabecalhos.map(celula).join(" | ")} |`;
  const separador = `| ${cabecalhos.map(() => "---").join(" | ")} |`;
  const corpo = linhas.map((linha) => `| ${linha.map(celula).join(" | ")} |`);
  return [cabecalho, separador, ...corpo].join("\n");
}

/** Hints de comportamento (MCP `ToolAnnotations`): leitura pura, sem efeito no mundo, repetível. */
export const SOMENTE_LEITURA: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** Escrita explícita e idempotente por chave de origem (`registrar_guia`). */
export const ESCRITA_IDEMPOTENTE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** Aviso padrão de lista cortada — mesma frase em toda tool paginada. */
export function avisoTruncado(mostrados: number, total: number, unidade: string): string {
  if (mostrados >= total) return "";
  return `\n\n> **Lista cortada:** mostrando ${mostrados} de ${total} ${unidade}. Não tire conclusão de quantidade desta lista; filtre por estado ou período para ver o restante.`;
}
