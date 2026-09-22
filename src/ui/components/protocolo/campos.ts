/**
 * Rótulos de tela para os campos de guia (brutos e normalizados) — usado pelo formulário de
 * correção, pela grade "Dados da versão atual" e pelo diff do histórico. Fonte única para não
 * cada componente inventar seu próprio texto para o mesmo campo (`docs/PRD-SDD.md` §12.3:
 * evitar jargão técnico, sempre a mesma frase para a mesma coisa).
 *
 * `valor` (bruto, `CABECALHO_GUIA_CSV`) e `valor_cents` (normalizado) são o mesmo campo de
 * negócio com nomes diferentes no fio — por isso os dois apontam para o mesmo rótulo aqui, e
 * `normalizarNomeCampoDiff` trata os dois como equivalentes ao comparar diff contra a grade.
 */
export { ROTULO_CAMPO_GUIA, apresentarCampoGuia as rotuloCampoGuia } from "../../../domain/apresentacao";

/** Trata `valor`/`valor_cents` como o mesmo campo ao comparar um nome vindo do diff contra a grade normalizada. */
export function normalizarNomeCampoDiff(campo: string): string {
  return campo === "valor" ? "valor_cents" : campo;
}

/**
 * `YYYY-MM-DD` → `dd/MM/yyyy` por manipulação de string (data de calendário, nunca instante).
 * Implementação única em `src/domain/apresentacao.ts`, compartilhada com o MCP.
 */
export { formatarDataCalendario } from "../../../domain/apresentacao";

/** Rótulo em português do tipo de evento da linha do tempo — fonte única em `src/domain/apresentacao.ts`. */
export { apresentarTipoEvento } from "../../../domain/apresentacao";
