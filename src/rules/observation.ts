import type { GuiaNormalizada } from "../domain/guide";
import type { AreaResponsavelProblema, Problema } from "../domain/validation";

/**
 * Categorias de interpretação de observação previstas por RF-06. Estáveis como os códigos de
 * problema — o texto de exibição pode mudar, a categoria em si não.
 */
export type CategoriaObservacaoIA =
  | "NEW_AUTHORIZATION_NOT_REGISTERED"
  | "VERBAL_AUTHORIZATION_OR_PROTOCOL"
  | "PRIVATE_BILLING"
  | "PROCEDURE_MISMATCH"
  | "RESCHEDULE_VALIDITY_CONFLICT"
  | "NO_OPERATIONAL_SIGNAL";

/**
 * Saída estruturada da interpretação de IA sobre `observacao_recepcao` (PRD §22.2). A Fase 4
 * é quem produz este objeto de verdade (chamando Workers AI e validando o schema); o motor
 * aqui só traduz o que já vier pronto — nunca decide o conteúdo por conta própria.
 */
export interface InterpretacaoObservacaoIA {
  readonly has_operational_signal: boolean;
  readonly category: CategoriaObservacaoIA;
  readonly summary: string;
  readonly requires_human_review: boolean;
  readonly suggested_owner: AreaResponsavelProblema;
  readonly evidence_excerpt: string;
}

/**
 * Interpreta `observacao_recepcao` (RF-06). Zero heurística de palavra-chave: quando a
 * interpretação de IA não vier (ausente ou nula) e a observação não estiver vazia, o motor
 * emite `OBSERVACAO_NAO_INTERPRETADA` com ação REVISAR — nunca tenta adivinhar o conteúdo.
 * Quando a interpretação vier, ela é apenas traduzida em problema; ausência de sinal
 * operacional (`has_operational_signal: false`) não gera problema nenhum.
 */
export function verificarObservacao(
  guia: GuiaNormalizada,
  interpretacaoIA: InterpretacaoObservacaoIA | null | undefined,
): readonly Problema[] {
  const observacao = guia.observacao_recepcao.trim();
  if (observacao.length === 0) return [];

  if (interpretacaoIA == null) {
    return [
      {
        codigo: "OBSERVACAO_NAO_INTERPRETADA",
        titulo: "Observação da recepção ainda não foi interpretada",
        acao_recomendada: "REVISAR",
        area_responsavel: "FINANCEIRO",
        subproblemas: [{ rotulo: "texto original da observação", valor: guia.observacao_recepcao }],
        referencia_regra: "observacao_recepcao (sem interpretacao de IA)",
      },
    ];
  }

  if (!interpretacaoIA.has_operational_signal) return [];

  return [
    {
      codigo: "OBSERVACAO_NAO_INTERPRETADA",
      titulo: interpretacaoIA.summary,
      acao_recomendada: interpretacaoIA.requires_human_review ? "REVISAR" : "CORRIGIR",
      area_responsavel: interpretacaoIA.suggested_owner,
      subproblemas: [
        { rotulo: "categoria identificada pela IA", valor: interpretacaoIA.category },
        { rotulo: "trecho da observação", valor: interpretacaoIA.evidence_excerpt },
        { rotulo: "texto original da observação", valor: guia.observacao_recepcao },
      ],
      referencia_regra: "observacao_recepcao (interpretacao de IA)",
    },
  ];
}
