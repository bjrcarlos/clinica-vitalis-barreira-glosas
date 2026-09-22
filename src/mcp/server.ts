import { z } from "zod";
import { carregarRegrasAtivas, buscarResumoWire } from "../http/handlers/create-protocol";
import { normalizarGuia } from "../domain/normalize";
import { esquemaGuiaBruta, esquemaNumeroProtocolo } from "../http/contracts";
import { validarGuia as motorValidacao } from "../rules/engine";
import { criarRepositoriosD1 } from "../infrastructure/d1/repositories";
import { GeradorIdCrypto } from "../infrastructure/id";
import { RelogioReal } from "../infrastructure/clock";
import { interpretarObservacao, type AiLike } from "../infrastructure/ai/interpreter";
import { registrarGuia } from "../application/register-guide";
import { assinarLink } from "../infrastructure/signing/links";
import type { Env } from "../worker/index";

interface ContextoMcp { readonly papel: "SECRETARIA" | "FINANCEIRO"; readonly principal: string; }

const schemaRegra = z.object({ convenio: z.string().trim().min(1), procedimento_codigo: z.string().trim().min(1).optional() });
const schemaVerificar = z.union([
  z.object({ id_guia: z.string().trim().min(1), guia: z.never().optional() }),
  z.object({ guia: esquemaGuiaBruta, id_guia: z.never().optional() }),
]);
const schemaRegistrar = z.object({ id_guia_origem: z.string().trim().min(1).max(200), guia: esquemaGuiaBruta });
const schemaPendencias = z.object({ data_de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), data_ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), estado: z.string().optional(), limite: z.number().int().min(1).max(100).default(50) });
const schemaHistorico = z.object({ protocolo: esquemaNumeroProtocolo.optional(), id_guia: z.string().trim().min(1).optional(), data_de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), data_ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), evento: z.string().optional(), estado: z.string().optional(), limite: z.number().int().min(1).max(200).default(100) });

const FERRAMENTAS = [
  { name: "consultar_regra", description: "Consulta a regra oficial de um convênio e procedimento.", inputSchema: { type: "object", properties: { convenio: { type: "string" }, procedimento_codigo: { type: "string" } }, required: ["convenio"] } },
  { name: "verificar_guia", description: "Verifica uma guia existente ou um objeto estruturado sem persistir.", inputSchema: { type: "object", properties: { id_guia: { type: "string" }, guia: { type: "object" } }, additionalProperties: false } },
  { name: "registrar_guia", description: "Registra uma nova guia pela Secretaria, com idempotência de origem.", inputSchema: { type: "object", properties: { id_guia_origem: { type: "string" }, guia: { type: "object" } }, required: ["id_guia_origem", "guia"] } },
  { name: "minhas_pendencias", description: "Lista pendências da área derivada da credencial e links temporários de revisão.", inputSchema: { type: "object", properties: { data_de: { type: "string" }, data_ate: { type: "string" }, estado: { type: "string" }, limite: { type: "integer" } } } },
  { name: "consultar_historico", description: "Consulta eventos do histórico respeitando a área autenticada.", inputSchema: { type: "object", properties: { protocolo: { type: "string" }, id_guia: { type: "string" }, data_de: { type: "string" }, data_ate: { type: "string" }, evento: { type: "string" }, estado: { type: "string" }, limite: { type: "integer" } } } },
] as const;

function resposta(id: unknown, result: unknown) { return { jsonrpc: "2.0", id, result }; }
function erro(id: unknown, code: number, message: string) { return { jsonrpc: "2.0", id, error: { code, message } }; }

async function hashToken(token: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}

async function tokenIgual(token: string, esperado: string): Promise<boolean> {
  const atual = await hashToken(token);
  const hashEsperado = await hashToken(esperado);
  const chave = await crypto.subtle.importKey("raw", hashEsperado, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const assinaturaEsperada = new Uint8Array(await crypto.subtle.sign("HMAC", chave, hashEsperado));
  return crypto.subtle.verify("HMAC", chave, assinaturaEsperada, atual);
}

async function autenticar(request: Request, env: Env): Promise<ContextoMcp | null> {
  const valor = request.headers.get("authorization");
  if (valor === null || !valor.startsWith("Bearer ")) return null;
  const token = valor.slice("Bearer ".length).trim();
  if (env.MCP_SECRETARIA_TOKEN && await tokenIgual(token, env.MCP_SECRETARIA_TOKEN)) return { papel: "SECRETARIA", principal: "secretaria@mcp" };
  if (env.MCP_FINANCEIRO_TOKEN && await tokenIgual(token, env.MCP_FINANCEIRO_TOKEN)) return { papel: "FINANCEIRO", principal: "financeiro@mcp" };
  return null;
}

function aiDoAmbiente(env: Env): AiLike | undefined {
  return env.AI as unknown as AiLike | undefined;
}

async function guiaPorId(db: D1Database, idGuia: string) {
  const linha = await db.prepare(`SELECT p.id AS protocol_id, p.protocol_number, gv.raw_payload_json, gv.normalized_payload_json FROM protocols p JOIN guide_versions gv ON gv.id = p.current_version_id WHERE p.source_guide_id = ?`).bind(idGuia).first<{ protocol_id: string; protocol_number: string; raw_payload_json: string; normalized_payload_json: string }>();
  if (linha === null) throw new Error("Guia não encontrada na base da prova.");
  return { ...linha, guiaBruta: esquemaGuiaBruta.parse(JSON.parse(linha.raw_payload_json)), guia: JSON.parse(linha.normalized_payload_json) };
}

async function verificarGuia(env: Env, args: unknown) {
  const entrada = schemaVerificar.parse(args);
  const regras = await carregarRegrasAtivas(env.DB);
  const ids = new GeradorIdCrypto();
  const relogio = new RelogioReal();
  const repos = criarRepositoriosD1(env.DB, ids, relogio);
  let guiaBruta: z.infer<typeof esquemaGuiaBruta>;
  let guia: ReturnType<typeof normalizarGuia>["guia"];
  let protocoloId: string | undefined;
  if ("id_guia" in entrada && typeof entrada.id_guia === "string") {
    const existente = await guiaPorId(env.DB, entrada.id_guia);
    guiaBruta = existente.guiaBruta;
    guia = existente.guia;
    protocoloId = existente.protocol_id;
  } else {
    guiaBruta = entrada.guia;
    guia = normalizarGuia(guiaBruta).guia;
  }
  const candidatos = (await repos.versoes.listarCandidatosDuplicidade(guia)).filter((candidato) => candidato.protocoloId !== protocoloId);
  const interpretacao = await interpretarObservacao(aiDoAmbiente(env), guia, regras);
  const resultado = motorValidacao(guia, regras, candidatos, interpretacao.interpretacao);
  return {
    status: resultado.status,
    resumo: resultado.resumo,
    problemas: resultado.problemas,
    regras_aplicadas: resultado.regras_aplicadas,
    ai: { status: interpretacao.status, modelo: interpretacao.modelo, prompt_version: interpretacao.promptVersion },
    persistiu: false,
    id_guia: guiaBruta.id_guia,
  };
}

async function chamarTool(env: Env, contexto: ContextoMcp, nome: string, args: unknown): Promise<unknown> {
  if (nome === "consultar_regra") {
    const entrada = schemaRegra.parse(args);
    const regras = await carregarRegrasAtivas(env.DB);
    const convenio = regras.convenios.find((item) => item.nome === entrada.convenio);
    if (!convenio) throw new Error("Convênio não encontrado na regra ativa.");
    const procedimento = entrada.procedimento_codigo ? regras.procedimentos.find((item) => item.codigo === entrada.procedimento_codigo) ?? null : null;
    return { versao: regras.versao, sha256: regras.sha256, origem: "regras_convenio.json.txt", convenio, procedimento, referencia_fonte: "rule_sets.source_json" };
  }
  if (nome === "verificar_guia") return verificarGuia(env, args);
  if (nome === "registrar_guia") {
    if (contexto.papel !== "SECRETARIA") throw new Error("Somente a Secretaria pode registrar_guia.");
    const entrada = schemaRegistrar.parse(args);
    const regras = await carregarRegrasAtivas(env.DB);
    const normalizada = normalizarGuia(entrada.guia);
    const interpretacao = await interpretarObservacao(aiDoAmbiente(env), normalizada.guia, regras);
    const ids = new GeradorIdCrypto(); const relogio = new RelogioReal(); const repos = criarRepositoriosD1(env.DB, ids, relogio);
    const registro = await registrarGuia({
      idGuiaOrigem: entrada.id_guia_origem, guiaBruta: entrada.guia, guiaNormalizada: normalizada.guia,
      avisosNormalizacao: normalizada.avisos, criadoPorPapel: "SECRETARIA", criadoPorPrincipal: contexto.principal,
      origem: "MCP", regras, interpretacaoIA: interpretacao.interpretacao, aiStatus: interpretacao.status,
      aiModel: interpretacao.modelo, aiPromptVersion: interpretacao.promptVersion, aiInputJson: interpretacao.inputJson, aiOutputJson: interpretacao.outputJson,
    }, { protocolos: repos.protocolos, versoes: repos.versoes, eventos: repos.eventos, relogio, validarGuiaDependencias: { motor: motorValidacao, validacoes: repos.validacoes, tarefas: repos.tarefas, eventos: repos.eventos, relogio } });
    const resumo = await buscarResumoWire(env.DB, registro.protocolo.numeroProtocolo);
    return { ja_existia: registro.jaExistia, protocolo: resumo, resultado_validacao: registro.validacao?.resultado ?? null, url_revisao: `/protocolos/${encodeURIComponent(registro.protocolo.numeroProtocolo)}` };
  }
  if (nome === "minhas_pendencias") {
    const entrada = schemaPendencias.parse(args ?? {});
    const area = contexto.papel;
    const condicoes = ["t.assigned_area = ?", "t.status = 'ABERTA'", "p.workflow_status != 'MESCLADA'"];
    const valores: (string | number)[] = [area];
    if (entrada.data_de) { condicoes.push("substr(t.created_at_utc, 1, 10) >= ?"); valores.push(entrada.data_de); }
    if (entrada.data_ate) { condicoes.push("substr(t.created_at_utc, 1, 10) <= ?"); valores.push(entrada.data_ate); }
    if (entrada.estado) { condicoes.push("p.validation_status = ?"); valores.push(entrada.estado); }
    const linhas = await env.DB.prepare(`SELECT p.protocol_number, p.validation_status, p.workflow_status, p.current_risk_cents, t.title, t.created_at_utc FROM tasks t JOIN protocols p ON p.id = t.protocol_id WHERE ${condicoes.join(" AND ")} ORDER BY t.created_at_utc ASC LIMIT ?`).bind(...valores, entrada.limite).all<{ protocol_number: string; validation_status: string; workflow_status: string; current_risk_cents: number; title: string; created_at_utc: string }>();
    const totais = await env.DB.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(risco_cents), 0) AS total_valor_cents FROM (SELECT t.id AS task_id, p.id, p.current_risk_cents AS risco_cents FROM tasks t JOIN protocols p ON p.id = t.protocol_id WHERE ${condicoes.join(" AND ")} GROUP BY t.id, p.id)`).bind(...valores).first<{ total: number; total_valor_cents: number }>();
    const agora = new Date().toISOString();
    const itens = await Promise.all(linhas.results.map(async (linha) => {
      const link = env.LINK_SIGNING_KEY ? await assinarLink({ finalidade: "review", recursoId: linha.protocol_number, area }, env.LINK_SIGNING_KEY, agora, new GeradorIdCrypto()) : null;
      return { numero_protocolo: linha.protocol_number, status_validacao: linha.validation_status, status_fluxo: linha.workflow_status, risco_cents: linha.current_risk_cents, titulo: linha.title, aberta_desde_utc: linha.created_at_utc, url_revisao: link ? `/protocolos/${encodeURIComponent(linha.protocol_number)}?token=${encodeURIComponent(link.token)}` : null, expira_em_utc: link?.payload.expiraEmUtc ?? null };
    }));
    return { area, total: totais?.total ?? 0, total_valor_cents: totais?.total_valor_cents ?? 0, itens };
  }
  if (nome === "consultar_historico") {
    const entrada = schemaHistorico.parse(args ?? {});
    const condicoes = ["(p.assigned_area = ? OR p.assigned_area IS NULL)"]; const valores: (string | number)[] = [contexto.papel];
    if (entrada.protocolo) { condicoes.push("p.protocol_number = ?"); valores.push(entrada.protocolo); }
    if (entrada.id_guia) { condicoes.push("p.source_guide_id = ?"); valores.push(entrada.id_guia); }
    if (entrada.data_de) { condicoes.push("substr(e.occurred_at_utc, 1, 10) >= ?"); valores.push(entrada.data_de); }
    if (entrada.data_ate) { condicoes.push("substr(e.occurred_at_utc, 1, 10) <= ?"); valores.push(entrada.data_ate); }
    if (entrada.evento) { condicoes.push("e.event_type = ?"); valores.push(entrada.evento); }
    if (entrada.estado) { condicoes.push("p.validation_status = ?"); valores.push(entrada.estado); }
    const linhas = await env.DB.prepare(`SELECT p.protocol_number, p.source_guide_id, p.validation_status, p.workflow_status, e.event_type, e.actor_role, e.source, e.reason, e.occurred_at_utc, e.recorded_at_utc, e.metadata_json FROM workflow_events e JOIN protocols p ON p.id = e.protocol_id WHERE ${condicoes.join(" AND ")} ORDER BY e.recorded_at_utc DESC LIMIT ?`).bind(...valores, entrada.limite).all<{ protocol_number: string; source_guide_id: string | null; validation_status: string; workflow_status: string; event_type: string; actor_role: string; source: string; reason: string | null; occurred_at_utc: string; recorded_at_utc: string; metadata_json: string }>();
    return { total: linhas.results.length, eventos: linhas.results.map((linha) => ({ ...linha, metadata: JSON.parse(linha.metadata_json) })) };
  }
  throw new Error(`Tool MCP desconhecida: ${nome}`);
}

export async function manipularMcp(request: Request, env: Env): Promise<Response> {
  const contexto = await autenticar(request, env);
  let mensagem: { id?: unknown; method?: string; params?: Record<string, unknown> };
  try { mensagem = JSON.parse(await request.text()) as typeof mensagem; } catch { return Response.json(erro(null, -32700, "JSON inválido."), { status: 400 }); }
  if (!contexto) return Response.json(erro(mensagem.id, -32001, "Autenticação Bearer inválida ou ausente."), { status: 401 });
  if (mensagem.method === "initialize") return Response.json(resposta(mensagem.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "vitalis-mcp", version: "1.0.0" } }));
  if (mensagem.method === "notifications/initialized") return new Response(null, { status: 204 });
  if (mensagem.method === "tools/list") return Response.json(resposta(mensagem.id, { tools: FERRAMENTAS }));
  if (mensagem.method !== "tools/call") return Response.json(erro(mensagem.id, -32601, "Método MCP não suportado."), { status: 400 });
  const nome = mensagem.params?.name; const args = mensagem.params?.arguments ?? {};
  if (typeof nome !== "string") return Response.json(erro(mensagem.id, -32602, "Nome da tool é obrigatório."), { status: 400 });
  try { return Response.json(resposta(mensagem.id, { content: [{ type: "text", text: JSON.stringify(await chamarTool(env, contexto, nome, args)) }] })); }
  catch (falha) { return Response.json(erro(mensagem.id, -32602, falha instanceof Error ? falha.message : "Entrada MCP inválida."), { status: 400 }); }
}
