import type { ManipuladorRota } from "../routes";
import { ErroDominio, lerCorpoJson } from "../routes";
import {
  esquemaCadastrarProtocoloEntrada,
  esquemaCadastrarProtocoloResposta,
  type CadastrarProtocoloResposta,
  type ProtocoloResumoWire,
} from "../contracts";
import { normalizarGuia } from "../../domain/normalize";
import { montarConjuntoRegras } from "../../rules/rule-set";
import { validarGuia as validarGuiaMotor } from "../../rules/engine";
import { registrarGuia } from "../../application/register-guide";
import type { Versoes } from "../../application/ports";
import type { PapelSessao } from "../../infrastructure/auth/session";
import { criarRepositoriosD1 } from "../../infrastructure/d1/repositories";
import { GeradorIdCrypto } from "../../infrastructure/id";
import { RelogioReal } from "../../infrastructure/clock";

/**
 * POST /api/protocols — RF-02, papel SECRETARIA. Cadastro manual de uma guia: normaliza,
 * abre protocolo + versão inicial e valida, reutilizando os casos de uso da Fase 1
 * (`registrarGuia`/`validarGuia` em `src/application`) e o motor puro (`src/rules/engine.ts`).
 * Nenhuma regra de negócio nova é decidida aqui — só orquestração de HTTP + persistência.
 *
 * `idGuiaOrigem` é sempre `null` (comentário já fixado em `RegistrarGuiaEntrada.idGuiaOrigem`,
 * `src/application/register-guide.ts`: "null em cadastro manual (RF-02)") — cadastro manual
 * nunca é idempotente por `id_guia` e sempre cria um protocolo novo.
 */

interface LinhaRuleSetAtivo {
  readonly source_json: string;
  readonly source_sha256: string;
}

interface LinhaResumoProtocolo {
  readonly id: string;
  readonly protocol_number: string;
  readonly source_guide_id: string | null;
  readonly validation_status: string;
  readonly workflow_status: string;
  readonly assigned_area: string | null;
  readonly current_risk_cents: number;
  readonly initial_risk_cents: number;
  readonly created_at_utc: string;
  readonly updated_at_utc: string;
  readonly version_number: number;
}

/** Carrega e reconstrói o conjunto de regras ativo (`rule_sets.is_active = 1`) a partir do texto original — mesma convenção de `src/infrastructure/rules/load-rule-set.ts`/`scripts/seed.ts`, nunca a de `d1/rule-sets.ts` (que serializa o objeto tipado, não o texto original; não usada pelo seed real). */
export async function carregarRegrasAtivas(db: D1Database) {
  const linha = await db
    .prepare(`SELECT source_json, source_sha256 FROM rule_sets WHERE is_active = 1 LIMIT 1`)
    .first<LinhaRuleSetAtivo>();
  if (linha === null) {
    throw new Error("Nenhum conjunto de regras ativo em rule_sets.");
  }
  return montarConjuntoRegras(linha.source_json, linha.source_sha256);
}

/** Monta o retrato de protocolo do contrato HTTP (`esquemaProtocoloResumo`) a partir do estado atual em D1 — nenhuma porta de `application/ports.ts` expõe `numero_versao_atual`/timestamps juntos. */
export async function buscarResumoWire(db: D1Database, numeroProtocolo: string): Promise<ProtocoloResumoWire> {
  const linha = await db
    .prepare(
      `SELECT p.id, p.protocol_number, p.source_guide_id, p.validation_status, p.workflow_status,
              p.assigned_area, p.current_risk_cents, p.initial_risk_cents, p.created_at_utc, p.updated_at_utc,
              gv.version_number
       FROM protocols p
       JOIN guide_versions gv ON gv.id = p.current_version_id
       WHERE p.protocol_number = ?`,
    )
    .bind(numeroProtocolo)
    .first<LinhaResumoProtocolo>();
  if (linha === null) {
    throw new Error(`Protocolo ${numeroProtocolo} não encontrado ao montar resumo (inconsistência interna).`);
  }
  return {
    protocolo_id: linha.id,
    numero_protocolo: linha.protocol_number,
    id_guia_origem: linha.source_guide_id,
    status_validacao: linha.validation_status as ProtocoloResumoWire["status_validacao"],
    status_fluxo: linha.workflow_status as ProtocoloResumoWire["status_fluxo"],
    area_responsavel: linha.assigned_area as ProtocoloResumoWire["area_responsavel"],
    risco_atual_cents: linha.current_risk_cents,
    risco_inicial_cents: linha.initial_risk_cents,
    numero_versao_atual: linha.version_number,
    criado_em_utc: linha.created_at_utc,
    atualizado_em_utc: linha.updated_at_utc,
  };
}

/**
 * `registrarGuia` (Fase 1, `src/application/register-guide.ts`) chama
 * `protocolos.criarComVersaoInicial` (grava o protocolo) ANTES de
 * `versoes.listarCandidatosDuplicidade` — contra `RepositorioVersoesD1` real isso faz toda guia
 * nova bater a própria chave composta (paciente+convênio+procedimento+data) contra si mesma e
 * sempre voltar `POSSIVEL_DUPLICIDADE`. Bug documentado em `docs/PROGRESS/phase-1-handoff.md`
 * §8 ("relevante para quem em Fase 2/3 ligar registrarGuia a RepositorioVersoesD1 de
 * verdade" — exatamente esta tarefa). Consertar `register-guide.ts`/`ports.ts`/
 * `d1/versions.ts` está fora do escopo desta tarefa (arquivos de outro agente); este wrapper
 * local filtra o próprio registro (comparação estrutural exata do payload normalizado) antes
 * de repassar candidatos ao motor — não muda a semântica de duplicidade entre protocolos
 * diferentes, só evita o falso positivo contra si mesmo.
 */
export function semAutoDuplicidade(versoes: Versoes): Versoes {
  return {
    async listarCandidatosDuplicidade(guia) {
      const candidatos = await versoes.listarCandidatosDuplicidade(guia);
      const guiaJson = JSON.stringify(guia);
      return candidatos.filter((candidato) => JSON.stringify(candidato.guia) !== guiaJson);
    },
  };
}

/** Núcleo testável, sem `Request`/`Response`. */
export async function cadastrarProtocolo(
  db: D1Database,
  papel: PapelSessao,
  corpoBruto: unknown,
): Promise<CadastrarProtocoloResposta> {
  if (papel !== "SECRETARIA") {
    throw new ErroDominio("ROLE_NOT_ALLOWED", "Somente a Secretaria pode cadastrar guias.");
  }

  const entrada = esquemaCadastrarProtocoloEntrada.parse(corpoBruto);
  const { guia: guiaNormalizada, avisos: avisosNormalizacao } = normalizarGuia(entrada.guia);
  const regras = await carregarRegrasAtivas(db);

  const ids = new GeradorIdCrypto();
  const relogio = new RelogioReal();
  const repos = criarRepositoriosD1(db, ids, relogio);

  const resultado = await registrarGuia(
    {
      idGuiaOrigem: null,
      guiaBruta: entrada.guia,
      guiaNormalizada,
      avisosNormalizacao,
      criadoPorPapel: "SECRETARIA",
      criadoPorPrincipal: "secretaria@vitalis",
      origem: "UI",
      regras,
    },
    {
      protocolos: repos.protocolos,
      versoes: repos.versoes,
      eventos: repos.eventos,
      relogio,
      validarGuiaDependencias: {
        motor: validarGuiaMotor,
        validacoes: repos.validacoes,
        tarefas: repos.tarefas,
        eventos: repos.eventos,
        relogio,
      },
    },
  );

  // `idGuiaOrigem: null` acima garante que `registrarGuia` nunca resolve pelo ramo `jaExistia`.
  if (resultado.jaExistia) {
    throw new Error("Cadastro manual não deveria ser idempotente (inconsistência interna).");
  }

  const protocoloWire = await buscarResumoWire(db, resultado.protocolo.numeroProtocolo);

  // Sem anotação de tipo aqui de propósito: `resultado.validacao.resultado.problemas` (e
  // `.regras_aplicadas.referencias`) são `readonly` no domínio (`src/domain/validation.ts`),
  // e o tipo do fio (`z.infer`) espera array mutável — `esquemaCadastrarProtocoloResposta.parse`
  // abaixo já revalida em runtime, então a checagem de tipo mora ali, não numa cópia manual.
  const corpo = {
    ja_existia: false,
    protocolo: protocoloWire,
    resultado_validacao: {
      status: resultado.validacao.resultado.status,
      resumo: resultado.validacao.resultado.resumo,
      problemas: resultado.validacao.resultado.problemas,
      risco_cents: resultado.validacao.resultado.risco_cents,
      regras_aplicadas: resultado.validacao.resultado.regras_aplicadas,
    },
  };

  return esquemaCadastrarProtocoloResposta.parse(corpo);
}

export const manipularCadastroProtocolo: ManipuladorRota = async (ctx) => {
  const corpoBruto = await lerCorpoJson(ctx.request);
  const corpo = await cadastrarProtocolo(ctx.env.DB, ctx.papel, corpoBruto);
  return Response.json(corpo, { status: 201 });
};
