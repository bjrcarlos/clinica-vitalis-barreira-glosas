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
export const ROTULO_CAMPO_GUIA: Readonly<Record<string, string>> = {
  id_guia: "ID da guia (origem)",
  unidade: "Unidade",
  data_atendimento: "Data do atendimento",
  paciente: "Paciente",
  convenio: "Convênio",
  carteirinha: "Carteirinha",
  cid: "CID",
  procedimento_codigo: "Código do procedimento",
  procedimento_descricao: "Procedimento",
  numero_autorizacao: "Nº autorização",
  autorizacao_validade: "Validade da autorização",
  autorizacao_sessoes_limite: "Limite de sessões",
  sessao_numero_na_autorizacao: "Sessão nº",
  profissional: "Profissional",
  profissional_registro: "Registro profissional",
  valor: "Valor",
  valor_cents: "Valor",
  observacao_recepcao: "Observação da recepção",
  data_lancamento: "Data de lançamento",
};

/** Rótulo de tela para um nome de campo; para um nome não catalogado, converte `snake_case` em texto legível. */
export function rotuloCampoGuia(campo: string): string {
  const conhecido = ROTULO_CAMPO_GUIA[campo];
  if (conhecido) return conhecido;
  const texto = campo.replace(/_/g, " ");
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Trata `valor`/`valor_cents` como o mesmo campo ao comparar um nome vindo do diff contra a grade normalizada. */
export function normalizarNomeCampoDiff(campo: string): string {
  return campo === "valor" ? "valor_cents" : campo;
}

/**
 * `YYYY-MM-DD` → `dd/MM/yyyy`, por manipulação de string — nunca via `Date`/fuso.
 *
 * `data_atendimento`, `autorizacao_validade` e `data_lancamento` são datas de calendário puras
 * (`src/domain/guide.ts`: "formato YYYY-MM-DD"), não instantes UTC. Passá-las por
 * `formatarDataCurta`/`formatarDataHoraBrasilia` (`src/ui/lib/format.ts`) as interpretaria como
 * meia-noite UTC e as exibiria um dia antes ao converter para `America/Sao_Paulo` (UTC-3) — por
 * isso este arquivo usa seu próprio formatador, sem `Date`, para os três campos de calendário.
 * Reaproveitado por `Guias.tsx` (coluna "Atendimento") pelo mesmo motivo.
 */
export function formatarDataCalendario(dataIso: string): string {
  const partes = dataIso.split("-");
  if (partes.length !== 3) return dataIso;
  const [ano, mes, dia] = partes;
  return `${dia}/${mes}/${ano}`;
}

/** Rótulo em português do tipo de evento da linha do tempo (`src/domain/events.ts`). */
export const ROTULO_TIPO_EVENTO: Readonly<Record<string, string>> = {
  IMPORTACAO: "Protocolo criado por importação",
  CADASTRO: "Protocolo cadastrado",
  VALIDACAO: "Validação executada",
  CORRECAO: "Nova versão criada",
  REVISAO: "Revisão registrada",
  LIBERACAO: "Liberado para envio",
  ENVIO: "Envio registrado",
  ENCERRAMENTO: "Protocolo encerrado",
  MERGE: "Protocolos mesclados",
};
