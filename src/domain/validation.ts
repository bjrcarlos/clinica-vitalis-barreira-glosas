import type { Area, ValidacaoStatus } from "./statuses";
import type { GuiaNormalizada } from "./guide";

/** Código estável de um problema detectado pelo motor — o texto pode mudar, o código nunca. */
export type CodigoProblema =
  | "CONVENIO_DESCONHECIDO"
  | "PROCEDIMENTO_DESCONHECIDO"
  | "CAMPO_OBRIGATORIO_AUSENTE"
  | "PROCEDIMENTO_NAO_COBERTO"
  | "AUTORIZACAO_VENCIDA"
  | "AUTORIZACAO_VALIDADE_ACIMA_DO_MAXIMO"
  | "LIMITE_SESSOES_EXCEDIDO"
  | "DESCRICAO_DIVERGENTE"
  | "VALOR_DIVERGENTE"
  | "DATA_FORA_DO_PADRAO"
  | "POSSIVEL_DUPLICIDADE"
  | "OBSERVACAO_NAO_INTERPRETADA";

/** Uma evidência ou verificação específica dentro de um problema (ex.: "limite oficial do convênio: 10"). */
export interface Subproblema {
  readonly rotulo: string;
  readonly valor: string;
}

/** Área que pode efetivamente resolver um problema de validação — nunca o sistema sozinho. */
export type AreaResponsavelProblema = Extract<Area, "SECRETARIA" | "FINANCEIRO">;

/** Um problema encontrado numa validação, com a ação recomendada e as evidências que o sustentam. */
export interface Problema {
  readonly codigo: CodigoProblema;
  readonly titulo: string;
  readonly acao_recomendada: "CORRIGIR" | "REVISAR" | "NAO_FATURAR";
  readonly area_responsavel: AreaResponsavelProblema;
  readonly subproblemas: readonly Subproblema[];
  readonly referencia_regra: string;
}

/** Uma pendência operacional acionável, aberta para uma área, que pode ou não impedir a liberação da guia. */
export interface Tarefa {
  readonly tipo: string;
  readonly titulo: string;
  readonly area: Area;
  readonly bloqueante: boolean;
}

/** Saída completa e determinística de uma execução do motor de validação sobre uma guia. */
export interface ResultadoValidacao {
  readonly status: ValidacaoStatus;
  readonly resumo: string;
  readonly problemas: readonly Problema[];
  readonly tarefas: readonly Tarefa[];
  /** Valor da guia em risco, em centavos — contado uma única vez por protocolo (RN-05). */
  readonly risco_cents: number;
  readonly regras_aplicadas: {
    readonly versao: string;
    readonly sha256: string;
    readonly referencias: readonly string[];
  };
}

/**
 * Um protocolo já existente cuja guia combina com a chave de duplicidade de uma guia nova —
 * terceiro parâmetro do contrato `validateGuide` (§21.1), usado para decidir `POSSIVEL_DUPLICIDADE`.
 */
export interface CandidatoDuplicidade {
  readonly protocoloId: string;
  readonly numeroProtocolo: string;
  readonly guia: GuiaNormalizada;
}
