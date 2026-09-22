import type { Area, ValidacaoStatus } from "../../../domain/statuses";
import type { CodigoProblema } from "../../../domain/validation";

/**
 * Espelha `RelatorioResposta` de `src/http/contracts.ts` (`GET /api/report`, RF-14/§27) — por
 * tipo local, não por import direto do arquivo.
 *
 * SUPOSIÇÃO/ACHADO DECLARADO (20/09/2026): `src/http/contracts.ts` importa
 * `src/infrastructure/auth/session.ts`, que hoje não compila sob `tsconfig.app.json`
 * (`crypto.subtle.verify` recebe `Uint8Array<ArrayBufferLike>` onde a lib DOM mais nova exige
 * `BufferSource`/`ArrayBuffer` — TS2345). Isso não aparece em `tsconfig.worker.json` (lib
 * `@cloudflare/workers-types`, mais permissiva) nem em nenhum arquivo hoje sob `src/ui`, porque
 * nada em `src/ui` importava `contracts.ts` até esta tarefa. Corrigir `session.ts` está fora do
 * escopo desta tarefa (arquivo de outro agente). Em vez de importar o tipo de lá e herdar essa
 * quebra, este arquivo replica a forma exata do schema (`esquemaRelatorioResposta`,
 * `esquemaMotivoPrincipal`, `esquemaDistribuicaoArea`, `esquemaPendenciaAntiga`), reaproveitando
 * só os tipos de domínio puro (`Area`, `ValidacaoStatus`, `CodigoProblema`) que já são a fonte
 * da verdade dos identificadores estáveis. Se o formato do relatório mudar, este arquivo precisa
 * mudar junto — mas não há hoje um jeito de importar o tipo de `contracts.ts` sem também herdar
 * a falha de compilação de `session.ts`.
 */

interface MetricaComProtocolos {
  readonly valor: number;
  readonly protocol_numbers: readonly string[];
}

interface MotivoPrincipal {
  readonly codigo: CodigoProblema;
  readonly titulo: string;
  readonly ocorrencias: number;
  readonly protocol_numbers: readonly string[];
}

interface DistribuicaoArea {
  readonly area: Area;
  readonly quantidade_tarefas_abertas: number;
  readonly risco_cents: number;
  readonly pendencia_mais_antiga_utc: string | null;
  readonly protocol_numbers: readonly string[];
}

interface DistribuicaoEstadoValidacao {
  readonly status_validacao: ValidacaoStatus;
  readonly quantidade: number;
  readonly risco_cents: number;
}

interface PendenciaAntiga {
  readonly numero_protocolo: string;
  readonly id_guia_origem: string | null;
  readonly unidade: string;
  readonly status_validacao: ValidacaoStatus;
  readonly resumo: string;
  readonly area_responsavel: Area | null;
  readonly risco_cents: number;
  readonly aberta_desde_utc: string;
}

export interface RelatorioResposta {
  readonly gerado_em_utc: string;
  readonly regras_aplicadas: { readonly versao: string; readonly sha256: string };
  readonly guias_verificadas: MetricaComProtocolos;
  readonly exigem_atencao: MetricaComProtocolos;
  readonly risco_inicial_cents: MetricaComProtocolos;
  readonly risco_tratado_cents: MetricaComProtocolos;
  readonly risco_pendente_cents: MetricaComProtocolos;
  readonly principais_motivos: readonly MotivoPrincipal[];
  readonly distribuicao_por_area: readonly DistribuicaoArea[];
  readonly distribuicao_por_estado_validacao: readonly DistribuicaoEstadoValidacao[];
  readonly pendencias_mais_antigas: readonly PendenciaAntiga[];
}
