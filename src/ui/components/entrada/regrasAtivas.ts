import { obterRegraAtiva } from "../../lib/api";
import type { RegraConvenioWire, RegraProcedimentoWire, RegrasAtivasResposta } from "../../../http/contracts";

/**
 * Conteúdo do conjunto de regras (convênios, procedimentos, definições) para EXIBIÇÃO nas
 * telas "Nova guia" e "Regras" — nunca para decisão; a decisão real roda sempre no servidor.
 *
 * Corrigido na auditoria da Fase 2: a versão anterior importava `montarConjuntoRegras` de
 * `src/rules/rule-set.ts` e embutia `regras_convenio.json.txt` inteiro (`?raw`) no bundle do
 * cliente — violava a regra de dependência do CLAUDE.md (`ui → application → domain+rules`,
 * nunca `ui → rules` direto) e duplicava a fonte da verdade do catálogo. Agora tudo vem de
 * `GET /api/rules` (`src/http/handlers/rules.ts`, que já lê `rule_sets.source_json` pelo mesmo
 * `carregarRegrasAtivas` da validação) — uma única implementação de regras, exposta pela API.
 */

/** Fatia de regra aplicável a um par convênio+procedimento — só para a dica de tela mostrar cobertura/limites, nunca para decidir. */
export interface RegraAplicavelParaExibicao {
  readonly convenio: string;
  readonly procedimento: RegraProcedimentoWire | null;
  readonly procedimento_coberto: boolean;
  readonly campos_obrigatorios: readonly string[];
  readonly validade_maxima_autorizacao_dias: number;
  readonly limite_sessoes_por_autorizacao: number;
  readonly prazo_envio_dias: number;
  readonly observacao: string;
}

/** `RegrasAtivasResposta` (fio) mais os três buscadores que as telas usam — construídos em memória a partir da própria resposta, nunca de uma segunda fonte. */
export interface RegrasParaExibicao extends RegrasAtivasResposta {
  /** Busca por nome de convênio ignorando acento/caixa ("saude interior" resolve "Saúde Interior") — só comparação de texto para achar a linha certa na tela, não é regra de negócio. */
  convenioPorNome(nome: string): RegraConvenioWire | null;
  procedimentoPorCodigo(codigo: string): RegraProcedimentoWire | null;
  regraAplicavel(convenioNome: string, procedimentoCodigo: string): RegraAplicavelParaExibicao | null;
}

function chaveNormalizada(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function construirIndice(resposta: RegrasAtivasResposta): RegrasParaExibicao {
  const porNome = new Map(resposta.convenios.map((convenio) => [chaveNormalizada(convenio.nome), convenio]));
  const porCodigo = new Map(resposta.procedimentos.map((procedimento) => [procedimento.codigo, procedimento]));

  return {
    ...resposta,
    convenioPorNome: (nome) => porNome.get(chaveNormalizada(nome)) ?? null,
    procedimentoPorCodigo: (codigo) => porCodigo.get(codigo) ?? null,
    regraAplicavel(convenioNome, procedimentoCodigo) {
      const convenio = porNome.get(chaveNormalizada(convenioNome)) ?? null;
      if (convenio === null) return null;
      const procedimento = porCodigo.get(procedimentoCodigo) ?? null;
      return {
        convenio: convenio.nome,
        procedimento,
        procedimento_coberto: procedimento !== null && convenio.procedimentos_cobertos.includes(procedimento.codigo),
        campos_obrigatorios: convenio.campos_obrigatorios,
        validade_maxima_autorizacao_dias: convenio.validade_maxima_autorizacao_dias,
        limite_sessoes_por_autorizacao: convenio.limite_sessoes_por_autorizacao,
        prazo_envio_dias: convenio.prazo_envio_dias,
        observacao: convenio.observacao,
      };
    },
  };
}

let emCache: RegrasParaExibicao | null = null;

/** Busca (e cacheia em memória, por hash) o conjunto de regras ativo para exibição via `GET /api/rules`. */
export async function obterRegrasParaExibicao(signal?: AbortSignal): Promise<RegrasParaExibicao> {
  const resposta = await obterRegraAtiva<RegrasAtivasResposta>(signal);
  if (emCache !== null && emCache.sha256 === resposta.sha256) return emCache;
  emCache = construirIndice(resposta);
  return emCache;
}
