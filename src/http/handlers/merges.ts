import type { ManipuladorRota } from "../routes";
import { ErroDominio, lerCorpoJson } from "../routes";
import {
  esquemaCompararMergeEntrada,
  esquemaCompararMergeResposta,
  esquemaExecutarMergeEntrada,
  esquemaExecutarMergeResposta,
  esquemaNumeroProtocolo,
  type CampoComparadoMergeWire,
  type GuiaBrutaWire,
  type ProtocoloReferenciaMergeWire,
} from "../contracts";
import { normalizarGuia } from "../../domain/normalize";
import type { GuiaNormalizada } from "../../domain/guide";
import { validarGuia as motorValidacao } from "../../rules/engine";
import { validarGuia as executarValidacao } from "../../application/validate-guide";
import { criarRepositoriosD1 } from "../../infrastructure/d1/repositories";
import { GeradorIdCrypto } from "../../infrastructure/id";
import { RelogioReal } from "../../infrastructure/clock";
import { carregarRegrasAtivas, buscarResumoWire } from "./create-protocol";
import { calcularDiff } from "./create-version";
import type { PapelSessao } from "../../infrastructure/auth/session";

const CAMPOS_COMPARAVEIS: readonly (keyof GuiaNormalizada)[] = [
  "unidade", "data_atendimento", "paciente", "convenio", "carteirinha", "cid",
  "procedimento_codigo", "procedimento_descricao", "numero_autorizacao", "autorizacao_validade",
  "autorizacao_sessoes_limite", "sessao_numero_na_autorizacao", "profissional", "profissional_registro",
  "valor_cents", "observacao_recepcao", "data_lancamento",
];

interface LinhaLado {
  readonly id: string;
  readonly protocol_number: string;
  readonly source_guide_id: string | null;
  readonly workflow_status: string;
  readonly current_version_id: string;
  readonly version_number: number;
  readonly raw_payload_json: string;
  readonly normalized_payload_json: string;
}

function texto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "number" && Number.isNaN(valor)) return null;
  return String(valor);
}

function buscarValor(guia: GuiaNormalizada, campo: keyof GuiaNormalizada): string | null {
  return texto(guia[campo]);
}

async function buscarLado(db: D1Database, numeroBruto: string): Promise<LinhaLado> {
  const numero = esquemaNumeroProtocolo.parse(numeroBruto);
  const linha = await db.prepare(`
    SELECT p.id, p.protocol_number, p.source_guide_id, p.workflow_status, p.current_version_id,
           gv.version_number, gv.raw_payload_json, gv.normalized_payload_json
    FROM protocols p JOIN guide_versions gv ON gv.id = p.current_version_id
    WHERE p.protocol_number = ?
  `).bind(numero).first<LinhaLado>();
  if (linha === null) throw new ErroDominio("PROTOCOLO_NAO_ENCONTRADO", "Protocolo não encontrado.", 404);
  return linha;
}

function referencia(lado: LinhaLado): ProtocoloReferenciaMergeWire {
  return { protocolo_id: lado.id, numero_protocolo: lado.protocol_number, id_guia_origem: lado.source_guide_id };
}

function comparar(a: GuiaNormalizada, b: GuiaNormalizada): CampoComparadoMergeWire[] {
  return CAMPOS_COMPARAVEIS.map((campo) => {
    const valorA = buscarValor(a, campo);
    const valorB = buscarValor(b, campo);
    return { campo, valor_a: valorA, valor_b: valorB, igual: valorA === valorB };
  });
}

async function existeSuspeitaAberta(db: D1Database, ids: readonly string[]): Promise<boolean> {
  const placeholders = ids.map(() => "?").join(",");
  const linha = await db.prepare(`
    SELECT vi.id FROM validation_issues vi
    JOIN validation_runs vr ON vr.id = vi.validation_run_id
    WHERE vr.protocol_id IN (${placeholders}) AND vi.code = 'POSSIVEL_DUPLICIDADE' AND vi.status = 'ABERTO'
    LIMIT 1
  `).bind(...ids).first<{ id: string }>();
  return linha !== null;
}

export async function compararMerge(db: D1Database, papel: PapelSessao, corpoBruto: unknown) {
  if (papel !== "FINANCEIRO") throw new ErroDominio("ROLE_NOT_ALLOWED", "Somente o Financeiro pode comparar duplicidades.");
  const entrada = esquemaCompararMergeEntrada.parse(corpoBruto);
  if (entrada.numero_protocolo_a === entrada.numero_protocolo_b) throw new ErroDominio("DUPLICATE_MERGE_CONFLICT", "Escolha dois protocolos diferentes.", 409);
  const [a, b] = await Promise.all([buscarLado(db, entrada.numero_protocolo_a), buscarLado(db, entrada.numero_protocolo_b)]);
  if (a.id === b.id || a.workflow_status === "MESCLADA" || b.workflow_status === "MESCLADA") {
    throw new ErroDominio("DUPLICATE_MERGE_CONFLICT", "Os dois protocolos precisam estar ativos e não mesclados.", 409);
  }
  const campos = comparar(JSON.parse(a.normalized_payload_json) as GuiaNormalizada, JSON.parse(b.normalized_payload_json) as GuiaNormalizada);
  return esquemaCompararMergeResposta.parse({
    protocolo_a: referencia(a), protocolo_b: referencia(b),
    campos_iguais: campos.filter((campo) => campo.igual),
    campos_divergentes: campos.filter((campo) => !campo.igual),
    suspeita_duplicidade_aberta: await existeSuspeitaAberta(db, [a.id, b.id]),
  });
}

export async function executarMerge(db: D1Database, papel: PapelSessao, corpoBruto: unknown) {
  if (papel !== "FINANCEIRO") throw new ErroDominio("ROLE_NOT_ALLOWED", "Somente o Financeiro pode executar merges.");
  const entrada = esquemaExecutarMergeEntrada.parse(corpoBruto);
  if (entrada.numero_protocolo_principal === entrada.numero_protocolo_origem) throw new ErroDominio("DUPLICATE_MERGE_CONFLICT", "Escolha dois protocolos diferentes.", 409);
  const [principal, origem] = await Promise.all([buscarLado(db, entrada.numero_protocolo_principal), buscarLado(db, entrada.numero_protocolo_origem)]);
  if (principal.id === origem.id || principal.workflow_status === "MESCLADA" || origem.workflow_status === "MESCLADA") {
    throw new ErroDominio("DUPLICATE_MERGE_CONFLICT", "Os dois protocolos precisam estar ativos e não mesclados.", 409);
  }

  const guiaPrincipal = JSON.parse(principal.normalized_payload_json) as GuiaNormalizada;
  const guiaOrigem = JSON.parse(origem.normalized_payload_json) as GuiaNormalizada;
  const camposDivergentes = comparar(guiaPrincipal, guiaOrigem).filter((campo) => !campo.igual);
  const divergentesPorNome = new Map(camposDivergentes.map((campo) => [campo.campo, campo]));
  const resolucoes = new Map(entrada.resolucao_campos.map((campo) => [campo.campo, campo.valor_escolhido]));
  for (const campo of entrada.resolucao_campos) {
    if (!divergentesPorNome.has(campo.campo)) throw new ErroDominio("DUPLICATE_MERGE_CONFLICT", `O campo ${campo.campo} não diverge entre os protocolos.`, 409);
  }
  for (const campo of camposDivergentes) {
    if (!resolucoes.has(campo.campo)) throw new ErroDominio("DUPLICATE_MERGE_CONFLICT", `Escolha explicitamente o valor do campo ${campo.campo}.`, 409);
  }
  if (!(await existeSuspeitaAberta(db, [principal.id, origem.id]))) {
    throw new ErroDominio("DUPLICATE_MERGE_CONFLICT", "Não há suspeita de duplicidade aberta para estes protocolos.", 409);
  }

  const rawPrincipal = JSON.parse(principal.raw_payload_json) as Record<string, string>;
  const guiaBruta = { ...rawPrincipal } as Record<string, string>;
  for (const campo of camposDivergentes) {
    if (campo.campo === "id_guia") continue;
    guiaBruta[campo.campo] = resolucoes.get(campo.campo) ?? "";
  }
  const { guia: guiaMesclada, avisos: avisosNormalizacao } = normalizarGuia(guiaBruta as GuiaBrutaWire);
  const ids = new GeradorIdCrypto();
  const relogio = new RelogioReal();
  const agora = relogio.agoraUtc();
  const repos = criarRepositoriosD1(db, ids, relogio);
  const regras = await carregarRegrasAtivas(db);
  const candidatos = (await repos.versoes.listarCandidatosDuplicidade(guiaMesclada)).filter((candidato) => candidato.protocoloId !== principal.id && candidato.protocoloId !== origem.id);
  const novaVersaoId = ids.novo();
  const mergeId = ids.novo();
  const novoNumeroVersao = principal.version_number + 1;
  const diff = calcularDiff(guiaPrincipal, guiaMesclada);

  await db.batch([
    db.prepare(`INSERT INTO guide_versions (
      id, protocol_id, version_number, raw_payload_json, normalized_payload_json, diff_json,
      change_reason, created_by_role, created_by_principal, occurred_at_utc, recorded_at_utc
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'FINANCEIRO', ?, ?, ?)`)
      .bind(novaVersaoId, principal.id, novoNumeroVersao, JSON.stringify(guiaBruta), JSON.stringify(guiaMesclada), JSON.stringify(diff), `Merge com ${origem.protocol_number}: ${entrada.motivo}`, "financeiro@vitalis", agora, agora),
    db.prepare(`UPDATE validation_issues SET status = 'RESOLVIDO', resolved_at_utc = ? WHERE status = 'ABERTO' AND validation_run_id IN (SELECT id FROM validation_runs WHERE protocol_id IN (?, ?))`).bind(agora, principal.id, origem.id),
    db.prepare(`UPDATE tasks SET status = 'RESOLVIDA', resolved_at_utc = ? WHERE status = 'ABERTA' AND protocol_id IN (?, ?)`).bind(agora, principal.id, origem.id),
    db.prepare(`UPDATE protocols SET current_version_id = ?, workflow_status = 'EM_TRATAMENTO', updated_at_utc = ? WHERE id = ?`).bind(novaVersaoId, agora, principal.id),
  ]);

  const validacao = await executarValidacao({ protocoloId: principal.id, guiaVersaoId: novaVersaoId, guia: guiaMesclada, regras, candidatosDuplicidade: candidatos, origem: "UI" }, {
    motor: motorValidacao, validacoes: repos.validacoes, tarefas: repos.tarefas, eventos: repos.eventos, relogio,
  });
  const eventoPrincipal = await repos.eventos.registrar({ protocoloId: principal.id, guiaVersaoId: novaVersaoId, evento: {
    tipo: "MERGE", ator: "financeiro@vitalis", papel: "FINANCEIRO", origem: "UI", ocorrido_em_utc: agora, registrado_em_utc: agora,
    motivo: entrada.motivo, metadata: { merge_id: mergeId, protocolo_origem: origem.protocol_number, protocolo_principal: principal.protocol_number, avisos_normalizacao: avisosNormalizacao.length },
  } });
  await repos.eventos.registrar({ protocoloId: origem.id, guiaVersaoId: origem.current_version_id, evento: {
    tipo: "MERGE", ator: "financeiro@vitalis", papel: "FINANCEIRO", origem: "UI", ocorrido_em_utc: agora, registrado_em_utc: agora,
    motivo: entrada.motivo, metadata: { merge_id: mergeId, mesclado_em: principal.protocol_number },
  } });

  await db.batch([
    db.prepare(`INSERT INTO protocol_merges (
      id, source_protocol_id, target_protocol_id, target_version_id, field_resolution_json,
      reason, performed_by_principal, performed_at_utc
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(mergeId, origem.id, principal.id, novaVersaoId, JSON.stringify(entrada.resolucao_campos), entrada.motivo, "financeiro@vitalis", agora),
    db.prepare(`UPDATE protocols SET workflow_status = 'MESCLADA', merged_into_protocol_id = ?, assigned_area = NULL, current_risk_cents = 0, updated_at_utc = ? WHERE id = ?`).bind(principal.id, agora, origem.id),
    db.prepare(`INSERT OR IGNORE INTO evidence_links (evidence_id, protocol_id, event_id, guide_version_id, relation_type, origin_protocol_id)
      SELECT evidence_id, ?, ?, guide_version_id, 'merge', origin_protocol_id FROM evidence_links WHERE protocol_id = ?`).bind(principal.id, eventoPrincipal, origem.id),
  ]);

  const resumo = await buscarResumoWire(db, principal.protocol_number);
  return esquemaExecutarMergeResposta.parse({
    protocolo_principal: resumo,
    merge: {
      id: mergeId, protocolo_origem_id: origem.id, numero_protocolo_origem: origem.protocol_number,
      protocolo_principal_id: principal.id, numero_protocolo_principal: principal.protocol_number,
      numero_versao_resultante: novoNumeroVersao, resolucao_campos: entrada.resolucao_campos,
      motivo: entrada.motivo, executado_por_principal: "financeiro@vitalis", executado_em_utc: agora,
    },
    validacao: validacao.resultado.status,
  });
}

export const manipularCompararMerge: ManipuladorRota = async (ctx) => Response.json(await compararMerge(ctx.env.DB, ctx.papel, await lerCorpoJson(ctx.request)));
export const manipularExecutarMerge: ManipuladorRota = async (ctx) => Response.json(await executarMerge(ctx.env.DB, ctx.papel, await lerCorpoJson(ctx.request)), { status: 201 });
