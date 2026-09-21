import type { ManipuladorRota } from "../routes";
import { ErroDominio, lerCorpoJson } from "../routes";
import {
  esquemaNumeroProtocolo,
  esquemaCriarVersaoEntrada,
  esquemaCriarVersaoResposta,
  type CriarVersaoResposta,
  type DiffCampoWire,
  type VersaoProtocoloWire,
} from "../contracts";
import { normalizarGuia } from "../../domain/normalize";
import type { GuiaNormalizada } from "../../domain/guide";
import type { FluxoStatus } from "../../domain/statuses";
import { validarGuia as validarGuiaMotor } from "../../rules/engine";
import { validarGuia as executarValidacao } from "../../application/validate-guide";
import type { PapelSessao } from "../../infrastructure/auth/session";
import { criarRepositoriosD1 } from "../../infrastructure/d1/repositories";
import { GeradorIdCrypto } from "../../infrastructure/id";
import { RelogioReal } from "../../infrastructure/clock";
import { buscarResumoWire, carregarRegrasAtivas } from "./create-protocol";

/**
 * POST /api/protocols/:numero/versions — RF-10, papel SECRETARIA. A correção nunca altera a
 * versão anterior: cria uma nova linha em `guide_versions`, calcula o diff campo a campo,
 * revalida com o motor (reaproveitando `validarGuia` de `src/application/validate-guide.ts`,
 * Fase 1) e grava um evento `CORRECAO`. Rejeita justificativa vazia (Zod, `esquemaCriarVersaoEntrada`)
 * e correção que não muda nenhum campo.
 *
 * Nenhuma porta de `application/ports.ts` cobre "criar versão N+1" ou "ler a versão atual" —
 * só existiam para a v1 (Fase 1). Este handler grava a nova `guide_versions` e atualiza
 * `protocols.current_version_id` diretamente via SQL, no mesmo padrão de
 * `src/infrastructure/d1/protocols.ts` (FK `current_version_id` é DEFERRABLE, então o INSERT
 * da versão e o UPDATE do protocolo cabem no mesmo `db.batch`).
 *
 * `ocorrido_em_utc` da nova versão/evento é o instante do próprio pedido: o contrato fixado
 * (`esquemaCriarVersaoEntrada`) não expõe um campo separado para "quando o fato ocorreu"
 * distinto de "quando foi registrado" — suposição declarada, dado que estender o contrato
 * está fora do escopo desta tarefa.
 */

const ESTADOS_FLUXO_CORRIGIVEIS: readonly FluxoStatus[] = ["EM_TRATAMENTO", "LIBERADA_PARA_ENVIO"];

const CAMPOS_GUIA_NORMALIZADA: readonly (keyof GuiaNormalizada)[] = [
  "id_guia",
  "unidade",
  "data_atendimento",
  "paciente",
  "convenio",
  "carteirinha",
  "cid",
  "procedimento_codigo",
  "procedimento_descricao",
  "numero_autorizacao",
  "autorizacao_validade",
  "autorizacao_sessoes_limite",
  "sessao_numero_na_autorizacao",
  "profissional",
  "profissional_registro",
  "valor_cents",
  "observacao_recepcao",
  "data_lancamento",
];

/** `JSON.stringify(NaN) === "null"` (nota de desvio de `src/domain/normalize.ts`) — o diff usa a mesma convenção do restante do fio: NaN nunca virou um dado inventado, então também nunca vira o texto literal "NaN" na tela. */
function paraTextoDiff(valor: string | number | null): string | null {
  if (valor === null) return null;
  if (typeof valor === "number") return Number.isNaN(valor) ? null : String(valor);
  return valor;
}

function camposIguais(a: string | number | null, b: string | number | null): boolean {
  if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) return true;
  return a === b;
}

/** Diff campo a campo entre a versão anterior e a nova (RF-10: "antes → depois", só os campos alterados). */
export function calcularDiff(anterior: GuiaNormalizada, nova: GuiaNormalizada): DiffCampoWire[] {
  const diffs: DiffCampoWire[] = [];
  for (const campo of CAMPOS_GUIA_NORMALIZADA) {
    const valorAnterior = anterior[campo] as string | number | null;
    const valorNovo = nova[campo] as string | number | null;
    if (!camposIguais(valorAnterior, valorNovo)) {
      diffs.push({ campo, valor_anterior: paraTextoDiff(valorAnterior), valor_novo: paraTextoDiff(valorNovo) });
    }
  }
  return diffs;
}

interface LinhaProtocoloMinima {
  readonly id: string;
  readonly current_version_id: string;
  readonly workflow_status: string;
}

interface LinhaVersaoAtual {
  readonly normalized_payload_json: string;
  readonly version_number: number;
}

/** Núcleo testável, sem `Request`/`Response`. */
export async function criarVersaoProtocolo(
  db: D1Database,
  papel: PapelSessao,
  numeroProtocoloBruto: string,
  corpoBruto: unknown,
): Promise<CriarVersaoResposta> {
  if (papel !== "SECRETARIA") {
    throw new ErroDominio("ROLE_NOT_ALLOWED", "Somente a Secretaria pode corrigir guias.");
  }

  const numeroProtocolo = esquemaNumeroProtocolo.parse(numeroProtocoloBruto);
  const entrada = esquemaCriarVersaoEntrada.parse(corpoBruto);

  const protocoloLinha = await db
    .prepare(`SELECT id, current_version_id, workflow_status FROM protocols WHERE protocol_number = ?`)
    .bind(numeroProtocolo)
    .first<LinhaProtocoloMinima>();
  if (protocoloLinha === null) {
    throw new ErroDominio("PROTOCOLO_NAO_ENCONTRADO", "Protocolo não encontrado.", 404);
  }

  const fluxoAtual = protocoloLinha.workflow_status as FluxoStatus;
  if (!ESTADOS_FLUXO_CORRIGIVEIS.includes(fluxoAtual)) {
    throw new ErroDominio(
      "INVALID_STATE_TRANSITION",
      "Protocolo não pode receber nova versão neste estado de fluxo.",
      409,
    );
  }

  const versaoAtualLinha = await db
    .prepare(`SELECT normalized_payload_json, version_number FROM guide_versions WHERE id = ?`)
    .bind(protocoloLinha.current_version_id)
    .first<LinhaVersaoAtual>();
  if (versaoAtualLinha === null) {
    throw new Error(`Versão atual (${protocoloLinha.current_version_id}) não encontrada (inconsistência interna).`);
  }

  const guiaAnterior = JSON.parse(versaoAtualLinha.normalized_payload_json) as GuiaNormalizada;
  const { guia: guiaNova, avisos: avisosNormalizacao } = normalizarGuia(entrada.guia);
  const diff = calcularDiff(guiaAnterior, guiaNova);

  if (diff.length === 0) {
    throw new ErroDominio("NENHUMA_ALTERACAO", "Nenhum campo foi alterado em relação à versão atual.", 422);
  }

  const regras = await carregarRegrasAtivas(db);
  const ids = new GeradorIdCrypto();
  const relogio = new RelogioReal();
  const repos = criarRepositoriosD1(db, ids, relogio);

  const agoraUtc = relogio.agoraUtc();
  const novaVersaoId = ids.novo();
  const novoNumeroVersao = versaoAtualLinha.version_number + 1;
  // Uma correção liberada volta a EM_TRATAMENTO: a leitura de "pronta para envio" que gerou a
  // liberação não vale mais para dados que acabaram de mudar (RF-09/RF-10 combinados — decisão
  // desta tarefa, já que nenhum código anterior decide isso).
  const novoFluxoStatus: FluxoStatus = fluxoAtual === "LIBERADA_PARA_ENVIO" ? "EM_TRATAMENTO" : fluxoAtual;

  await db.batch([
    db
      .prepare(
        `INSERT INTO guide_versions (
           id, protocol_id, version_number, raw_payload_json, normalized_payload_json,
           diff_json, change_reason, created_by_role, created_by_principal,
           occurred_at_utc, recorded_at_utc
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        novaVersaoId,
        protocoloLinha.id,
        novoNumeroVersao,
        JSON.stringify(entrada.guia),
        JSON.stringify(guiaNova),
        JSON.stringify(diff),
        entrada.motivo,
        "SECRETARIA",
        "secretaria@vitalis",
        agoraUtc,
        agoraUtc,
      ),
    db
      .prepare(`UPDATE protocols SET current_version_id = ?, workflow_status = ?, updated_at_utc = ? WHERE id = ?`)
      .bind(novaVersaoId, novoFluxoStatus, agoraUtc, protocoloLinha.id),
  ]);

  // A revalidação (abaixo) grava um `validation_run`/`validation_issues`/`tasks` NOVOS para
  // esta versão, mas nada em Fase 1 jamais resolve os antigos (`RepositorioValidacoesD1` só
  // insere). Sem isto, um protocolo já corrigido nunca teria "nenhum problema/tarefa aberta"
  // de novo — a trava de liberação (RF-09) nunca fecharia. Resolve-se aqui, antes de criar a
  // nova execução, tudo que ainda estava aberto de execuções anteriores deste protocolo.
  await db.batch([
    db
      .prepare(
        `UPDATE validation_issues
         SET status = 'RESOLVIDO', resolved_at_utc = ?
         WHERE status = 'ABERTO'
           AND validation_run_id IN (SELECT id FROM validation_runs WHERE protocol_id = ?)`,
      )
      .bind(agoraUtc, protocoloLinha.id),
    db
      .prepare(`UPDATE tasks SET status = 'RESOLVIDA', resolved_at_utc = ? WHERE status = 'ABERTA' AND protocol_id = ?`)
      .bind(agoraUtc, protocoloLinha.id),
  ]);

  const candidatosBrutos = await repos.versoes.listarCandidatosDuplicidade(guiaNova);
  // Mesmo cuidado de `create-protocol.ts`/`imports.ts` (ver comentário lá): exclui o próprio
  // protocolo da lista de candidatos a duplicidade antes de repassar ao motor. Aqui o
  // `protocoloId` já é conhecido, então a exclusão é direta por identidade, não por igualdade
  // estrutural do payload.
  const candidatosDuplicidade = candidatosBrutos.filter((candidato) => candidato.protocoloId !== protocoloLinha.id);

  const validacao = await executarValidacao(
    {
      protocoloId: protocoloLinha.id,
      guiaVersaoId: novaVersaoId,
      guia: guiaNova,
      regras,
      candidatosDuplicidade,
      origem: "UI",
    },
    {
      motor: validarGuiaMotor,
      validacoes: repos.validacoes,
      tarefas: repos.tarefas,
      eventos: repos.eventos,
      relogio,
    },
  );

  await repos.eventos.registrar({
    protocoloId: protocoloLinha.id,
    guiaVersaoId: novaVersaoId,
    evento: {
      tipo: "CORRECAO",
      ator: "secretaria@vitalis",
      papel: "SECRETARIA",
      origem: "UI",
      ocorrido_em_utc: agoraUtc,
      registrado_em_utc: agoraUtc,
      motivo: entrada.motivo,
      metadata: {
        numero_versao_anterior: versaoAtualLinha.version_number,
        numero_versao_nova: novoNumeroVersao,
        campos_alterados: diff.map((d) => d.campo),
      },
    },
  });

  const protocoloWire = await buscarResumoWire(db, numeroProtocolo);
  const versaoWire: VersaoProtocoloWire = {
    id: novaVersaoId,
    numero_versao: novoNumeroVersao,
    guia: guiaNova,
    guia_bruta: entrada.guia,
    diff,
    avisos_normalizacao: avisosNormalizacao,
    motivo_alteracao: entrada.motivo,
    criado_por_papel: "SECRETARIA",
    criado_por_principal: "secretaria@vitalis",
    ocorrido_em_utc: agoraUtc,
    registrado_em_utc: agoraUtc,
  };

  // Sem anotação de tipo aqui de propósito: `validacao.resultado.problemas` (e
  // `.regras_aplicadas.referencias`) são `readonly` no domínio (`src/domain/validation.ts`), e
  // o tipo do fio (`z.infer`) espera array mutável — `esquemaCriarVersaoResposta.parse` abaixo
  // já revalida em runtime, então a checagem de tipo mora ali, não numa cópia manual.
  const corpo = {
    protocolo: protocoloWire,
    versao: versaoWire,
    resultado_validacao: {
      status: validacao.resultado.status,
      resumo: validacao.resultado.resumo,
      problemas: validacao.resultado.problemas,
      risco_cents: validacao.resultado.risco_cents,
      regras_aplicadas: validacao.resultado.regras_aplicadas,
    },
  };

  return esquemaCriarVersaoResposta.parse(corpo);
}

export const manipularCriacaoVersaoProtocolo: ManipuladorRota = async (ctx) => {
  const corpoBruto = await lerCorpoJson(ctx.request);
  const corpo = await criarVersaoProtocolo(ctx.env.DB, ctx.papel, ctx.params.numero, corpoBruto);
  return Response.json(corpo, { status: 201 });
};
