/** Registro cru de uma guia exatamente como veio do CSV/XLSX: chave de coluna → texto, sem normalização nenhuma. */
export type GuiaBruta = Readonly<Record<string, string>>;

/**
 * Guia após normalização determinística: mesmos campos do cabeçalho de `guias.csv`, já
 * tipados e prontos para o motor de validação consumir.
 */
export interface GuiaNormalizada {
  readonly id_guia: string;
  readonly unidade: string;
  /** Data de calendário, formato "YYYY-MM-DD". */
  readonly data_atendimento: string;
  readonly paciente: string;
  readonly convenio: string;
  readonly carteirinha: string;
  readonly cid: string | null;
  readonly procedimento_codigo: string;
  readonly procedimento_descricao: string;
  readonly numero_autorizacao: string | null;
  /** Data de calendário, formato "YYYY-MM-DD"; comparação de validade é inclusiva (RN-03). */
  readonly autorizacao_validade: string;
  readonly autorizacao_sessoes_limite: number;
  readonly sessao_numero_na_autorizacao: number;
  readonly profissional: string;
  readonly profissional_registro: string | null;
  /** Valor da guia em centavos inteiros — nunca float. */
  readonly valor_cents: number;
  readonly observacao_recepcao: string;
  /** Data de calendário, formato "YYYY-MM-DD". */
  readonly data_lancamento: string;
}

/**
 * Registra que um campo da guia foi normalizado automaticamente (formato de data, vírgula
 * decimal etc.), preservando o valor original para auditoria — a normalização gera aviso,
 * mas não bloqueia sozinha (RN-08).
 */
export interface AvisoNormalizacao {
  readonly campo: keyof GuiaNormalizada;
  readonly valor_original: string;
  readonly valor_normalizado: string;
  readonly motivo: string;
}
