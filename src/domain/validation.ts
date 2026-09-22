import type { Area, ValidacaoStatus } from "./statuses";
import type { GuiaNormalizada } from "./guide";

/** Código estável de um problema detectado pelo motor. */
export type CodigoProblema =
  | "CONVENIO_DESCONHECIDO"
  | "PROCEDIMENTO_DESCONHECIDO"
  | "CAMPO_OBRIGATORIO_AUSENTE"
  | "PROCEDIMENTO_NAO_COBERTO"
  | "AUTORIZACAO_VENCIDA"
  /** Mantido para ler históricos antigos; não é emitido sem data de concessão. */
  | "AUTORIZACAO_VALIDADE_ACIMA_DO_MAXIMO"
  | "PRAZO_ENVIO_EXCEDIDO"
  | "LIMITE_SESSOES_EXCEDIDO"
  | "DESCRICAO_DIVERGENTE"
  | "VALOR_DIVERGENTE"
  | "DATA_FORA_DO_PADRAO"
  | "POSSIVEL_DUPLICIDADE"
  | "OBSERVACAO_NAO_INTERPRETADA";

const ROTULOS_CODIGO_PROBLEMA: Readonly<Record<CodigoProblema, string>> = {
  CONVENIO_DESCONHECIDO: "Convênio desconhecido",
  PROCEDIMENTO_DESCONHECIDO: "Procedimento desconhecido",
  CAMPO_OBRIGATORIO_AUSENTE: "Campo obrigatório ausente",
  PROCEDIMENTO_NAO_COBERTO: "Procedimento não coberto",
  AUTORIZACAO_VENCIDA: "Autorização vencida",
  AUTORIZACAO_VALIDADE_ACIMA_DO_MAXIMO: "Validade de autorização acima do máximo (legado)",
  PRAZO_ENVIO_EXCEDIDO: "Prazo de envio excedido",
  LIMITE_SESSOES_EXCEDIDO: "Limite de sessões excedido",
  DESCRICAO_DIVERGENTE: "Descrição divergente",
  VALOR_DIVERGENTE: "Valor divergente",
  DATA_FORA_DO_PADRAO: "Data fora do padrão",
  POSSIVEL_DUPLICIDADE: "Possível duplicidade",
  OBSERVACAO_NAO_INTERPRETADA: "Observação ainda não interpretada",
};

/** Rótulo genérico de um código para telas que agregam por motivo. */
export function apresentarCodigoProblema(codigo: CodigoProblema): string {
  return ROTULOS_CODIGO_PROBLEMA[codigo];
}

/** Uma evidência ou verificação específica dentro de um problema. */
export interface Subproblema {
  readonly rotulo: string;
  readonly valor: string;
}

/** Área que pode efetivamente resolver um problema de validação. */
export type AreaResponsavelProblema = Extract<Area, "SECRETARIA" | "FINANCEIRO">;

/** Um problema encontrado numa validação, com ação e evidências explicáveis. */
export interface Problema {
  readonly codigo: CodigoProblema;
  readonly titulo: string;
  readonly acao_recomendada: "CORRIGIR" | "REVISAR" | "NAO_FATURAR";
  readonly area_responsavel: AreaResponsavelProblema;
  readonly subproblemas: readonly Subproblema[];
  readonly referencia_regra: string;
}

/** Uma pendência operacional acionável, que pode impedir a liberação. */
export interface Tarefa {
  readonly tipo: string;
  readonly titulo: string;
  readonly area: Area;
  readonly bloqueante: boolean;
}

/** Saída completa e determinística de uma execução do motor. */
export interface ResultadoValidacao {
  readonly status: ValidacaoStatus;
  readonly resumo: string;
  readonly problemas: readonly Problema[];
  readonly tarefas: readonly Tarefa[];
  readonly risco_cents: number;
  readonly regras_aplicadas: {
    readonly versao: string;
    readonly sha256: string;
    readonly referencias: readonly string[];
  };
}

/** Protocolo já existente que combina com a chave de duplicidade de uma guia nova. */
export interface CandidatoDuplicidade {
  readonly protocoloId: string;
  readonly numeroProtocolo: string;
  readonly guia: GuiaNormalizada;
}
