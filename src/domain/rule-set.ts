import type { GuiaNormalizada } from "./guide";

/** Textos de glossário do conjunto de regras, explicando os critérios que o motor aplica. */
export interface DefinicoesRegras {
  readonly autorizacao_valida: string;
  readonly sessao_numero_na_autorizacao: string;
  readonly prazo_envio_dias: string;
  readonly valor: string;
}

/** Regra de cobertura e valor de referência de um procedimento, comum a todos os convênios. */
export interface RegraProcedimento {
  readonly codigo: string;
  readonly descricao: string;
  /** Valor de referência em centavos inteiros — nunca float. */
  readonly valor_referencia_cents: number;
}

/** Exigências de um convênio específico: campos obrigatórios, prazos e procedimentos cobertos. */
export interface RegraConvenio {
  readonly nome: string;
  readonly campos_obrigatorios: ReadonlyArray<keyof GuiaNormalizada>;
  readonly validade_maxima_autorizacao_dias: number;
  readonly limite_sessoes_por_autorizacao: number;
  /** Códigos de `RegraProcedimento.codigo` cobertos por este convênio. */
  readonly procedimentos_cobertos: readonly string[];
  readonly prazo_envio_dias: number;
  readonly observacao: string;
}

/**
 * Uma versão completa e íntegra das regras oficiais (`regras_convenio.json`), identificada
 * por versão e hash — fonte única da verdade para o motor de validação (RN-01).
 */
export interface ConjuntoRegras {
  readonly versao: string;
  readonly sha256: string;
  readonly convenios: readonly RegraConvenio[];
  readonly procedimentos: readonly RegraProcedimento[];
  readonly definicoes: DefinicoesRegras;
}
