import { PRECEDENCIA_VALIDACAO_STATUS, apresentarArea, type ValidacaoStatus } from "../domain/statuses";
import type { GuiaNormalizada } from "../domain/guide";
import type { ConjuntoRegras } from "../domain/rule-set";
import type { CandidatoDuplicidade, Problema, ResultadoValidacao, Tarefa } from "../domain/validation";
import { localizarConvenioEProcedimento, verificarCobertura } from "./coverage";
import { verificarCamposObrigatorios } from "./required-fields";
import { verificarAutorizacao } from "./authorization";
import { verificarPrazoEnvio } from "./dispatch-deadline";
import { verificarLimiteSessoes } from "./sessions";
import { verificarProcedimento } from "./procedure";
import { verificarDuplicidade } from "./duplicates";
import { verificarObservacao, type InterpretacaoObservacaoIA } from "./observation";

export type { InterpretacaoObservacaoIA } from "./observation";

const MAPA_ACAO_STATUS: Readonly<Record<Problema["acao_recomendada"], ValidacaoStatus>> = {
  NAO_FATURAR: "NAO_FATURAR_CONVENIO",
  REVISAR: "REVISAO_HUMANA",
  CORRIGIR: "CORRIGIR",
};

/** Estado principal pela precedência RN-06/PRECEDENCIA_VALIDACAO_STATUS: o mais grave presente entre os problemas vence. */
function comporStatus(problemas: readonly Problema[]): ValidacaoStatus {
  const statusPresentes = new Set(problemas.map((p) => MAPA_ACAO_STATUS[p.acao_recomendada]));
  for (const status of PRECEDENCIA_VALIDACAO_STATUS) {
    if (status === "OK" || statusPresentes.has(status)) return status;
  }
  return "OK";
}

/**
 * Uma tarefa por problema encontrado. Nesta fase, todo problema é impeditivo para liberação
 * (RF-09: "não existe problema aberto" é condição obrigatória para liberar, qualquer que seja
 * a ação recomendada) — por isso `bloqueante` é sempre `true` aqui.
 */
function gerarTarefas(problemas: readonly Problema[]): readonly Tarefa[] {
  return problemas.map((problema) => ({
    tipo: problema.codigo,
    titulo: problema.titulo,
    area: problema.area_responsavel,
    bloqueante: true,
  }));
}

function montarResumo(
  status: ValidacaoStatus,
  problemas: readonly Problema[],
  tarefas: readonly Tarefa[],
): string {
  if (status === "OK") {
    return "Guia sem pendências: campos, cobertura, autorização e sessões conferem com a regra vigente. Pronta para liberação.";
  }

  const quantidade = problemas.length;
  const rotuloQuantidade = quantidade === 1 ? "1 problema" : `${quantidade} problemas`;
  const areas = Array.from(new Set(tarefas.map((t) => apresentarArea(t.area))));
  const rotuloAreas = areas.length > 0 ? areas.join(" e ") : "a área responsável";

  if (status === "NAO_FATURAR_CONVENIO") {
    return `Encontrado ${rotuloQuantidade}: o procedimento não é coberto por este convênio, então não pode ser faturado a ele. Próximo passo: ${rotuloAreas} decide entre faturar como particular ou cancelar.`;
  }
  if (status === "REVISAO_HUMANA") {
    return `Encontrado ${rotuloQuantidade} que dependem de julgamento humano. Próximo passo: ${rotuloAreas} revisa o caso antes de decidir.`;
  }
  return `Encontrado ${rotuloQuantidade} que impedem a liberação. Próximo passo: ${rotuloAreas} corrige os campos indicados e o sistema revalida.`;
}

/**
 * Motor determinístico de validação (§21.1/§21.3 do PRD-SDD). Puro: mesma guia normalizada +
 * mesma versão de regra + mesmos candidatos de duplicidade + mesma interpretação de IA (ou
 * ausência dela) sempre produzem o mesmo `ResultadoValidacao` — sem relógio, rede ou banco.
 *
 * `interpretacaoIA` é opcional: quando ausente/nula e a observação da recepção não estiver
 * vazia, `observation.ts` emite `OBSERVACAO_NAO_INTERPRETADA` em vez de adivinhar o conteúdo.
 * A Fase 4 é quem passa a interpretação real.
 */
export function validarGuia(
  guia: GuiaNormalizada,
  ruleSet: ConjuntoRegras,
  candidatosDuplicidade: readonly CandidatoDuplicidade[],
  interpretacaoIA?: InterpretacaoObservacaoIA | null,
): ResultadoValidacao {
  const problemas: Problema[] = [];

  // 2. existência do convênio e do procedimento.
  const localizacao = localizarConvenioEProcedimento(guia, ruleSet);
  problemas.push(...localizacao.problemas);

  // 3. campos obrigatórios — só quando o convênio é conhecido.
  if (localizacao.convenio) {
    problemas.push(...verificarCamposObrigatorios(guia, localizacao.convenio));
  }

  // 4. cobertura — só quando convênio e procedimento são conhecidos.
  if (localizacao.convenio && localizacao.procedimento) {
    problemas.push(...verificarCobertura(localizacao.convenio, localizacao.procedimento));
  }

  // 5. autorização e prazo — só o vencimento final e o prazo de envio são verificáveis no recorte.
  if (localizacao.convenio) {
    problemas.push(...verificarAutorizacao(guia));
    problemas.push(...verificarPrazoEnvio(guia, localizacao.convenio));
  }

  // 6. sessões — só quando o convênio é conhecido (precisa do limite oficial dele).
  if (localizacao.convenio) {
    problemas.push(...verificarLimiteSessoes(guia, localizacao.convenio));
  }

  // 7. descrição e valor — só quando o procedimento é conhecido.
  if (localizacao.procedimento) {
    problemas.push(...verificarProcedimento(guia, localizacao.procedimento));
  }

  // 8. duplicidade.
  problemas.push(...verificarDuplicidade(guia, candidatosDuplicidade));

  // 9. interpretação da observação.
  problemas.push(...verificarObservacao(guia, interpretacaoIA));

  // 10. composição da próxima ação e tarefas.
  const status = comporStatus(problemas);
  const tarefas = gerarTarefas(problemas);

  // RN-05: valor da guia contado uma única vez, nunca somado por problema.
  const contaRisco = status !== "OK" || tarefas.some((t) => t.bloqueante);
  const risco_cents = contaRisco ? guia.valor_cents : 0;

  const referencias = Array.from(new Set(problemas.map((p) => p.referencia_regra)));

  return {
    status,
    resumo: montarResumo(status, problemas, tarefas),
    problemas,
    tarefas,
    risco_cents,
    regras_aplicadas: {
      versao: ruleSet.versao,
      sha256: ruleSet.sha256,
      referencias,
    },
  };
}
