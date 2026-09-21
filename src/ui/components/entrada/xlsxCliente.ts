/**
 * Leitura de XLSX no NAVEGADOR (RF-01, CLAUDE.md: "XLSX é parseado no cliente e enviado
 * normalizado; nunca colocar SheetJS no bundle do Worker"). Este arquivo só entra no bundle
 * do cliente (Vite), nunca no do Worker (`src/worker`, `src/http`) — não é importado de lá.
 *
 * Decisão registrada (20/09/2026): dependência `read-excel-file@9.3.10` (exata, cliente),
 * import `read-excel-file/browser` carregado com `import()` dinâmico só quando um `.xlsx` é
 * de fato selecionado — quem só usa CSV nunca baixa este código. Medido com `pnpm build`
 * (ver resposta da tarefa) antes de aceitar o custo.
 *
 * Em vez de reimplementar o parser de guias para um formato de entrada novo, a planilha é
 * convertida para texto CSV e devolvida a `parseCsv` (`src/domain/parse-csv.ts`,
 * Fase 1) — mesma validação de cabeçalho e mesma rejeição linha a linha do CSV, um só código
 * para os dois formatos.
 */

/** Uma célula como `read-excel-file` devolve: texto, número, booleano, `Date` ou vazia. */
type CelulaXlsx = string | number | boolean | Date | null | undefined;

function celulaParaTexto(celula: CelulaXlsx): string {
  if (celula === null || celula === undefined) return "";
  if (celula instanceof Date) {
    // Célula de data do Excel: célula não tem fuso horário, então usa-se UTC para não
    // deslocar o dia por causa do fuso do navegador de quem está importando.
    const ano = String(celula.getUTCFullYear()).padStart(4, "0");
    const mes = String(celula.getUTCMonth() + 1).padStart(2, "0");
    const dia = String(celula.getUTCDate()).padStart(2, "0");
    return `${ano}-${mes}-${dia}`;
  }
  if (typeof celula === "boolean") return celula ? "TRUE" : "FALSE";
  return String(celula);
}

/** Aspas duplas apenas quando o campo contém vírgula, aspas ou quebra de linha — CSV padrão. */
function escaparCampoCsv(campo: string): string {
  if (/[",\n]/.test(campo)) {
    return `"${campo.replace(/"/g, '""')}"`;
  }
  return campo;
}

/**
 * Lê a primeira planilha de um `.xlsx` e devolve o texto já no formato CSV que
 * `parseCsv` espera. Números de célula (ex.: carteirinha só de dígitos) perdem zero à
 * esquerda se a planilha não formatou a coluna como texto — limitação do formato XLSX, não
 * deste leitor; por isso a tela avisa isso explicitamente perto do envio.
 */
export async function lerXlsxComoTextoCsv(arquivo: File): Promise<string> {
  const { readSheet } = await import("read-excel-file/browser");
  const linhas = await readSheet(arquivo);
  return linhas
    .map((linha) => linha.map((celula) => escaparCampoCsv(celulaParaTexto(celula as CelulaXlsx))).join(","))
    .join("\n");
}
