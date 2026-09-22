import { z, ZodError } from "zod";
import { isArea, isFluxoStatus, isOrigem, isValidacaoStatus, type Area, type FluxoStatus, type Origem, type ValidacaoStatus } from "../domain/statuses";
import type { TipoEvento } from "../domain/events";
import type { CodigoProblema } from "../domain/validation";
import { CABECALHO_GUIA_CSV } from "../domain/parse-csv";
import { isPapelSessao, type PapelSessao } from "../infrastructure/auth/session";

/**
 * Fonte da verdade das entradas e saídas de `/api/*` (PRD-SDD §24, contrato fixado pelo
 * orquestrador da Fase 2). A UI importa os TIPOS daqui — nunca redeclara o formato. Todo
 * handler valida entrada e saída com os `esquema*` exportados; `src/http/routes.ts` converte
 * `ZodError` em `422` automaticamente.
 *
 * Duas notas de serialização, ambas decorrentes de `src/domain/normalize.ts` (nota de desvio
 * deliberado no topo daquele arquivo): quando um campo numérico da guia normalizada não pôde
 * ser interpretado, o domínio usa `NaN` (nunca `0` inventado) — mas `JSON.stringify(NaN)`
 * produz `null`. Por isso `autorizacao_sessoes_limite`, `sessao_numero_na_autorizacao` e
 * `valor_cents` são `nullable()` nos esquemas de guia normalizada abaixo, mesmo o domínio os
 * declarando `number` não anulável. Uma vez persistido em `protocols` (colunas `INTEGER NOT
 * NULL`), o risco em centavos deixa de correr esse risco — por isso `risco_*_cents` de
 * protocolo já persistido são `number` simples, não anuláveis.
 */

// --- Reaproveitamento de enums e guards já existentes no domínio (nunca duplicar a lista). ---

function esquemaDeGuard<T extends string>(guarda: (valor: string) => valor is T, mensagem: string) {
  return z.custom<T>((valor) => typeof valor === "string" && guarda(valor), { message: mensagem });
}

export const esquemaValidacaoStatus = esquemaDeGuard<ValidacaoStatus>(isValidacaoStatus, "Status de validação inválido.");
export const esquemaFluxoStatus = esquemaDeGuard<FluxoStatus>(isFluxoStatus, "Status de fluxo inválido.");
export const esquemaArea = esquemaDeGuard<Area>(isArea, "Área inválida.");
export const esquemaOrigem = esquemaDeGuard<Origem>(isOrigem, "Origem inválida.");
export const esquemaPapelSessao = esquemaDeGuard<PapelSessao>(isPapelSessao, "Papel de sessão inválido.");

/** Área que pode efetivamente resolver um problema — nunca o sistema sozinho (espelha `AreaResponsavelProblema`). */
export const esquemaAreaResponsavel = z.enum(["SECRETARIA", "FINANCEIRO"]);

/** Os doze códigos estáveis de `CodigoProblema` (`src/domain/validation.ts`) — nunca renomear, só documentar aqui. */
const CODIGOS_PROBLEMA = [
  "CONVENIO_DESCONHECIDO",
  "PROCEDIMENTO_DESCONHECIDO",
  "CAMPO_OBRIGATORIO_AUSENTE",
  "PROCEDIMENTO_NAO_COBERTO",
  "AUTORIZACAO_VENCIDA",
  "AUTORIZACAO_VALIDADE_ACIMA_DO_MAXIMO",
  "LIMITE_SESSOES_EXCEDIDO",
  "DESCRICAO_DIVERGENTE",
  "VALOR_DIVERGENTE",
  "DATA_FORA_DO_PADRAO",
  "POSSIVEL_DUPLICIDADE",
  "OBSERVACAO_NAO_INTERPRETADA",
  "PRAZO_ENVIO_EXCEDIDO",
] as const satisfies readonly CodigoProblema[];
export const esquemaCodigoProblema = z.enum(CODIGOS_PROBLEMA);

/** Os nove tipos estáveis de `TipoEvento` (`src/domain/events.ts`). */
const TIPOS_EVENTO = [
  "IMPORTACAO",
  "CADASTRO",
  "VALIDACAO",
  "CORRECAO",
  "REVISAO",
  "LIBERACAO",
  "ENVIO",
  "ENCERRAMENTO",
  "MERGE",
] as const satisfies readonly TipoEvento[];
export const esquemaTipoEvento = z.enum(TIPOS_EVENTO);

/** Número de protocolo no formato fixado (`VT-YY-NNNN`, ver `src/infrastructure/id.ts`). */
export const esquemaNumeroProtocolo = z
  .string()
  .regex(/^VT-\d{2}-\d{4}$/, "Número de protocolo inválido (esperado VT-AA-NNNN).");

/** Data de calendário no formato canônico do domínio (`YYYY-MM-DD`). */
export const esquemaDataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD.");

/**
 * Instante UTC completo, como `Relogio`/`new Date().toISOString()` produz — usado em ações que
 * podem ser retroativas (RF-11: `ocorrido_em_utc` grava quando o fato aconteceu, separado de
 * `registrado_em_utc`, quando foi gravado; Fase 3 introduz o primeiro caso em que o CLIENTE
 * informa um `ocorrido_em_utc`, em `POST /api/protocols/:numero/send`).
 */
export const esquemaInstanteIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/, "Instante deve estar em UTC ISO 8601 (ex.: 2026-09-20T14:00:00.000Z).");

// --- Guia bruta (entrada de cadastro/correção) e guia normalizada (saída). ---

/**
 * Teto deliberado por campo de texto (auditoria, item 4: "string enorme" — nenhum `z.string()`
 * de `esquemaGuiaBruta` tinha `.max()`; confirmado ao vivo que campos de até ~2MB eram aceitos
 * e persistidos sem aviso, e que 5MB derrubava o handler com `500` em vez de recusa limpa).
 * `observacao_recepcao` é o único campo de texto livre da guia (RN, comentário do dono da
 * observação) — os outros 16 são código/identificador/nome curto.
 */
const LIMITE_CAMPO_GUIA_BRUTA_PADRAO = 200;
const LIMITE_OBSERVACAO_RECEPCAO = 2000;

const camposGuiaBruta = Object.fromEntries(
  CABECALHO_GUIA_CSV.map((campo) => [
    campo,
    z.string().max(campo === "observacao_recepcao" ? LIMITE_OBSERVACAO_RECEPCAO : LIMITE_CAMPO_GUIA_BRUTA_PADRAO),
  ]),
) as Record<(typeof CABECALHO_GUIA_CSV)[number], z.ZodString>;

/** Espelha `GuiaBruta` (domínio): os 18 campos de `guias.csv`, todos texto cru, sem normalização. */
export const esquemaGuiaBruta = z.object(camposGuiaBruta);

/** Espelha `GuiaNormalizada` (domínio) como aparece no fio — ver nota de `NaN` → `null` no topo do arquivo. */
export const esquemaGuiaNormalizada = z.object({
  id_guia: z.string(),
  unidade: z.string(),
  data_atendimento: z.string(),
  paciente: z.string(),
  convenio: z.string(),
  carteirinha: z.string(),
  cid: z.string().nullable(),
  procedimento_codigo: z.string(),
  procedimento_descricao: z.string(),
  numero_autorizacao: z.string().nullable(),
  autorizacao_validade: z.string(),
  autorizacao_sessoes_limite: z.number().int().nullable(),
  sessao_numero_na_autorizacao: z.number().int().nullable(),
  profissional: z.string(),
  profissional_registro: z.string().nullable(),
  valor_cents: z.number().int().nullable(),
  observacao_recepcao: z.string(),
  data_lancamento: z.string(),
});

/** Espelha `AvisoNormalizacao` (domínio). */
export const esquemaAvisoNormalizacao = z.object({
  campo: z.string(),
  valor_original: z.string(),
  valor_normalizado: z.string(),
  motivo: z.string(),
});

// --- Problemas, subproblemas, tarefas, eventos, regras aplicadas, diff de versão. ---

/** Espelha `Subproblema` (domínio). */
export const esquemaSubproblema = z.object({
  rotulo: z.string(),
  valor: z.string(),
});

/** Espelha `Problema` (domínio): um problema de uma execução de validação, sem estado de ciclo de vida. */
export const esquemaProblema = z.object({
  codigo: esquemaCodigoProblema,
  titulo: z.string(),
  acao_recomendada: z.enum(["CORRIGIR", "REVISAR", "NAO_FATURAR"]),
  area_responsavel: esquemaAreaResponsavel,
  subproblemas: z.array(esquemaSubproblema),
  referencia_regra: z.string(),
});

/**
 * `Problema` com o estado de ciclo de vida que só existe persistido (`validation_issues`) — usado
 * no detalhe do protocolo, que mostra abertos e resolvidos de todas as versões (PRD §12.2/RF-07).
 * `INVALIDADO` foi acrescentado na Fase 3 (PRD §19.5 já documentava os três valores de
 * `validation_issues.status`: "aberto, resolvido ou invalidado") — é o destino de um problema em
 * `REVISAO_HUMANA` que `POST /api/protocols/:numero/review-decisions` decide como falso positivo,
 * sem passar por nova versão de guia. `resolvido_em_utc` cobre os dois fechamentos (resolvido por
 * correção ou invalidado por decisão humana); não há uma segunda coluna de motivo aqui — o motivo
 * da invalidação fica no evento `REVISAO` associado (`workflow_events.reason`), não no problema.
 */
export const esquemaProblemaHistorico = esquemaProblema.extend({
  id: z.string(),
  numero_versao_origem: z.number().int().positive(),
  status: z.enum(["ABERTO", "RESOLVIDO", "INVALIDADO"]),
  resolvido_em_utc: z.string().nullable(),
});

/** Espelha `Tarefa` (domínio), sem estado de ciclo de vida. */
export const esquemaTarefa = z.object({
  tipo: z.string(),
  titulo: z.string(),
  area: esquemaArea,
  bloqueante: z.boolean(),
});

/** `Tarefa` com o estado que só existe persistido (`tasks`). */
export const esquemaTarefaComEstado = esquemaTarefa.extend({
  id: z.string(),
  issue_id: z.string().nullable(),
  status: z.enum(["ABERTA", "RESOLVIDA"]),
  criada_em_utc: z.string(),
  resolvida_em_utc: z.string().nullable(),
});

/** Espelha `EventoFluxo` (domínio) mais o identificador persistido. */
export const esquemaEvento = z.object({
  id: z.string(),
  tipo: esquemaTipoEvento,
  ator: z.string(),
  papel: esquemaArea,
  origem: esquemaOrigem,
  guia_versao_id: z.string().nullable(),
  ocorrido_em_utc: z.string(),
  registrado_em_utc: z.string(),
  motivo: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

/** Espelha `ResultadoValidacao.regras_aplicadas` (domínio). */
export const esquemaRegrasAplicadas = z.object({
  versao: z.string(),
  sha256: z.string(),
  referencias: z.array(z.string()),
});

/** Um campo alterado entre a versão anterior e a versão atual de uma guia (RF-10: "antes → depois"). */
export const esquemaDiffCampo = z.object({
  campo: z.string(),
  valor_anterior: z.string().nullable(),
  valor_novo: z.string().nullable(),
});

/** Uma versão histórica completa de guia dentro de um protocolo, com diff e avisos de normalização. */
export const esquemaVersaoProtocolo = z.object({
  id: z.string(),
  numero_versao: z.number().int().positive(),
  guia: esquemaGuiaNormalizada,
  guia_bruta: esquemaGuiaBruta,
  diff: z.array(esquemaDiffCampo),
  avisos_normalizacao: z.array(esquemaAvisoNormalizacao),
  motivo_alteracao: z.string().nullable(),
  criado_por_papel: esquemaArea,
  criado_por_principal: z.string(),
  ocorrido_em_utc: z.string(),
  registrado_em_utc: z.string(),
});

// --- Trava de liberação (RF-09): calculada e explicada pelo servidor, nunca pela interface. ---

const CODIGOS_REQUISITO_LIBERACAO = [
  "VALIDACAO_ATUAL_OK",
  "SEM_PROBLEMA_ABERTO",
  "SEM_REVISAO_HUMANA_PENDENTE",
  "SEM_TAREFA_BLOQUEANTE_ABERTA",
] as const;
export const esquemaCodigoRequisitoLiberacao = z.enum(CODIGOS_REQUISITO_LIBERACAO);

/** Um item do checklist de liberação, com o veredito já calculado no servidor. */
export const esquemaRequisitoLiberacao = z.object({
  codigo: esquemaCodigoRequisitoLiberacao,
  descricao: z.string(),
  atendido: z.boolean(),
});

/** Explica se o protocolo pode ser liberado para envio e, quando não pode, por quê — a interface só exibe. */
export const esquemaTravaLiberacao = z.object({
  pode_liberar: z.boolean(),
  motivo: z.string().nullable(),
  requisitos: z.array(esquemaRequisitoLiberacao),
});

// --- Resumo e listagem de protocolo. ---

/** Retrato resumido de um protocolo, comum a várias respostas (cadastro, correção, liberação, detalhe). */
export const esquemaProtocoloResumo = z.object({
  protocolo_id: z.string(),
  numero_protocolo: esquemaNumeroProtocolo,
  id_guia_origem: z.string().nullable(),
  status_validacao: esquemaValidacaoStatus,
  status_fluxo: esquemaFluxoStatus,
  area_responsavel: esquemaArea.nullable(),
  risco_atual_cents: z.number().int(),
  risco_inicial_cents: z.number().int(),
  numero_versao_atual: z.number().int().positive(),
  criado_em_utc: z.string(),
  atualizado_em_utc: z.string(),
});

/** Uma linha da listagem "Todas as guias" (RF-14, tela `design-reference/Guias.dc.html`). */
export const esquemaProtocoloListagemItem = z.object({
  numero_protocolo: esquemaNumeroProtocolo,
  id_guia_origem: z.string().nullable(),
  unidade: z.string(),
  data_atendimento: z.string(),
  paciente: z.string(),
  convenio: z.string(),
  carteirinha: z.string(),
  procedimento_codigo: z.string(),
  procedimento_descricao: z.string(),
  status_validacao: esquemaValidacaoStatus,
  resumo_validacao: z.string(),
  status_fluxo: esquemaFluxoStatus,
  area_responsavel: esquemaArea.nullable(),
  risco_cents: z.number().int(),
  numero_versao_atual: z.number().int().positive(),
  atualizado_em_utc: z.string(),
});

/** Resumo de resultado de validação embutido em respostas de mutação (cadastro/correção) — não é o detalhe completo. */
export const esquemaResultadoValidacaoResumo = z.object({
  status: esquemaValidacaoStatus,
  resumo: z.string(),
  problemas: z.array(esquemaProblema),
  risco_cents: z.number().int(),
  regras_aplicadas: esquemaRegrasAplicadas,
});

// --- GET /api/report ---

/** Um número do relatório sempre vem com os `protocol_numbers` que o compõem (PRD §27: clique reconcilia com o detalhe). */
function esquemaMetricaComProtocolos<T extends z.ZodTypeAny>(valor: T) {
  return z.object({ valor, protocol_numbers: z.array(esquemaNumeroProtocolo) });
}

export const esquemaMotivoPrincipal = z.object({
  codigo: esquemaCodigoProblema,
  titulo: z.string(),
  ocorrencias: z.number().int().nonnegative(),
  protocol_numbers: z.array(esquemaNumeroProtocolo),
});

export const esquemaDistribuicaoArea = z.object({
  area: esquemaArea,
  quantidade_tarefas_abertas: z.number().int().nonnegative(),
  risco_cents: z.number().int(),
  pendencia_mais_antiga_utc: z.string().nullable(),
  protocol_numbers: z.array(esquemaNumeroProtocolo),
});

/**
 * Uma fatia da distribuição por estado de validação (rosca "Estado das guias" do Dashboard) —
 * mesmo universo de `guias_verificadas` (protocolo não mesclado com validação concluída), uma
 * linha por `ValidacaoStatus`, sempre as quatro presentes mesmo quando a contagem é zero.
 */
export const esquemaDistribuicaoEstadoValidacao = z.object({
  status_validacao: esquemaValidacaoStatus,
  quantidade: z.number().int().nonnegative(),
  risco_cents: z.number().int().nonnegative(),
});

export const esquemaPendenciaAntiga = z.object({
  numero_protocolo: esquemaNumeroProtocolo,
  id_guia_origem: z.string().nullable(),
  unidade: z.string(),
  status_validacao: esquemaValidacaoStatus,
  resumo: z.string(),
  area_responsavel: esquemaArea.nullable(),
  risco_cents: z.number().int(),
  aberta_desde_utc: z.string(),
});

export const esquemaRelatorioResposta = z.object({
  gerado_em_utc: z.string(),
  regras_aplicadas: z.object({ versao: z.string(), sha256: z.string() }),
  guias_verificadas: esquemaMetricaComProtocolos(z.number().int().nonnegative()),
  exigem_atencao: esquemaMetricaComProtocolos(z.number().int().nonnegative()),
  risco_inicial_cents: esquemaMetricaComProtocolos(z.number().int().nonnegative()),
  risco_tratado_cents: esquemaMetricaComProtocolos(z.number().int().nonnegative()),
  risco_pendente_cents: esquemaMetricaComProtocolos(z.number().int().nonnegative()),
  principais_motivos: z.array(esquemaMotivoPrincipal),
  distribuicao_por_area: z.array(esquemaDistribuicaoArea),
  distribuicao_por_estado_validacao: z.array(esquemaDistribuicaoEstadoValidacao),
  pendencias_mais_antigas: z.array(esquemaPendenciaAntiga),
});
export type RelatorioResposta = z.infer<typeof esquemaRelatorioResposta>;

// --- GET /api/protocols ---

/** Aceita lista separada por vírgula num único parâmetro de query (`?status_validacao=CORRIGIR,REVISAO_HUMANA`). */
function esquemaListaCsv<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess((valor) => {
    if (typeof valor !== "string" || valor.trim() === "") return undefined;
    return valor
      .split(",")
      .map((parte) => parte.trim())
      .filter((parte) => parte.length > 0);
  }, z.array(item).optional());
}

export const esquemaListaProtocolosConsulta = z.object({
  status_validacao: esquemaListaCsv(esquemaValidacaoStatus),
  status_fluxo: esquemaListaCsv(esquemaFluxoStatus),
  area: esquemaListaCsv(esquemaArea),
  unidade: z.string().trim().min(1).optional(),
  convenio: z.string().trim().min(1).optional(),
  data_atendimento_inicio: esquemaDataIso.optional(),
  data_atendimento_fim: esquemaDataIso.optional(),
  busca: z.string().trim().min(1).optional(),
  pagina: z.coerce.number().int().positive().default(1),
  tamanho: z.coerce.number().int().positive().max(100).default(20),
});
export type ListaProtocolosConsulta = z.infer<typeof esquemaListaProtocolosConsulta>;

export const esquemaListaProtocolosResposta = z.object({
  protocolos: z.array(esquemaProtocoloListagemItem),
  paginacao: z.object({
    pagina: z.number().int().positive(),
    tamanho: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    total_paginas: z.number().int().nonnegative(),
  }),
});
export type ListaProtocolosResposta = z.infer<typeof esquemaListaProtocolosResposta>;

// --- Evidências, merge e envio (RF-09/RF-12/RF-13, PRD §19.8-19.10/§25/§26) — building blocks ---
// --- definidos aqui porque `esquemaProtocoloDetalheResposta`, logo abaixo, já os embute. ---

/** Os três tipos MIME aceitos para evidência (RF-12, PRD §25.2). */
export const TIPOS_MIME_EVIDENCIA_ACEITOS = ["application/pdf", "image/jpeg", "image/png"] as const;
export const esquemaTipoMimeEvidencia = z.enum(TIPOS_MIME_EVIDENCIA_ACEITOS);

/**
 * Limite de tamanho por arquivo de evidência, em bytes (RF-12: "até 10 MB"). O handler de
 * `POST /api/protocols/:numero/evidence` confere isto ANTES de começar a ler o corpo e DE NOVO
 * durante a leitura (streaming) — nunca confiando isoladamente no cabeçalho `Content-Length`
 * nem em `file.size` do multipart (PRD §25.2).
 */
export const LIMITE_EVIDENCIA_BYTES = 10 * 1024 * 1024;

/** Espelha `evidence_objects` (PRD §19.8) como aparece no detalhe do protocolo — metadados de exibição, nunca o binário. */
export const esquemaEvidenciaWire = z.object({
  id: z.string(),
  nome_exibicao: z.string(),
  tipo_mime: esquemaTipoMimeEvidencia,
  tamanho_bytes: z.number().int().positive().max(LIMITE_EVIDENCIA_BYTES),
  sha256: z.string(),
  anexado_por_papel: esquemaArea,
  anexado_por_principal: z.string(),
  anexado_em_utc: z.string(),
  invalidada_em_utc: z.string().nullable(),
  motivo_invalidacao: z.string().nullable(),
});

/**
 * Uma escolha de campo dentro de um merge (RF-13, PRD §26.2): o valor do lado escolhido, ou
 * `null` quando o campo vazio é a escolha. Serve tanto para gravar (`protocol_merges.
 * field_resolution_json`) quanto para o corpo de `POST /api/merges/commit`.
 */
export const esquemaResolucaoCampoMerge = z.object({
  campo: z.string(),
  valor_escolhido: z.string().nullable(),
});

/** Espelha `protocol_merges` (PRD §19.10) como aparece no detalhe do protocolo principal. */
export const esquemaMergeWire = z.object({
  id: z.string(),
  protocolo_origem_id: z.string(),
  numero_protocolo_origem: esquemaNumeroProtocolo,
  protocolo_principal_id: z.string(),
  numero_protocolo_principal: esquemaNumeroProtocolo,
  numero_versao_resultante: z.number().int().positive(),
  resolucao_campos: z.array(esquemaResolucaoCampoMerge),
  motivo: z.string(),
  executado_por_principal: z.string(),
  executado_em_utc: z.string(),
});

/** Estado de envio ao convênio (RF-09/RN-04): `ocorrido_em_utc` pode ser retroativo, `registrado_em_utc` nunca é — a interface mostra os dois quando divergem. */
export const esquemaEnvioWire = z.object({
  ocorrido_em_utc: z.string(),
  registrado_em_utc: z.string(),
  evidence_id: z.string(),
  registrado_por_principal: z.string(),
});

// --- GET /api/protocols/:numero ---

export const esquemaProtocoloDetalheResposta = z.object({
  protocolo: esquemaProtocoloResumo,
  resultado_validacao_atual: esquemaResultadoValidacaoResumo,
  versoes: z.array(esquemaVersaoProtocolo),
  problemas: z.array(esquemaProblemaHistorico),
  tarefas: z.array(esquemaTarefaComEstado),
  eventos: z.array(esquemaEvento),
  trava_liberacao: esquemaTravaLiberacao,
  // --- Fase 3: acrescentados sem remover nenhum campo da Fase 2 (§4 do handoff da Fase 2).
  // `.optional()` de propósito: nenhum agente desta leva foi designado para tocar
  // `src/http/handlers/protocol-detail.ts` (fora da lista de arquivos autorizados desta tarefa,
  // que é só `contracts.ts`+`routes.ts`) — tornar os três obrigatórios quebraria o typecheck do
  // Worker imediatamente, porque aquele handler (Fase 2) ainda constrói a resposta sem eles.
  // Quem estender `protocol-detail.ts` para popular evidência/merge/envio deve preencher os três
  // sempre (nunca omitir por preguiça) e só então esta nota fica obsoleta. ---
  evidencias: z.array(esquemaEvidenciaWire),
  merge: esquemaMergeWire.nullable(),
  envio: esquemaEnvioWire.nullable(),
});
export type ProtocoloDetalheResposta = z.infer<typeof esquemaProtocoloDetalheResposta>;

// --- POST /api/protocols (RF-02, papel SECRETARIA) ---

export const esquemaCadastrarProtocoloEntrada = z.object({
  guia: esquemaGuiaBruta,
});
export type CadastrarProtocoloEntrada = z.infer<typeof esquemaCadastrarProtocoloEntrada>;

export const esquemaCadastrarProtocoloResposta = z.object({
  ja_existia: z.boolean(),
  protocolo: esquemaProtocoloResumo,
  resultado_validacao: esquemaResultadoValidacaoResumo.nullable(),
});
export type CadastrarProtocoloResposta = z.infer<typeof esquemaCadastrarProtocoloResposta>;

// --- POST /api/protocols/:numero/versions (RF-10, papel SECRETARIA) ---

export const esquemaCriarVersaoEntrada = z.object({
  guia: esquemaGuiaBruta,
  motivo: z.string().trim().min(1, "Motivo da correção é obrigatório.").max(1000, "Motivo da correção muito longo (máximo 1000 caracteres)."),
});
export type CriarVersaoEntrada = z.infer<typeof esquemaCriarVersaoEntrada>;

export const esquemaCriarVersaoResposta = z.object({
  protocolo: esquemaProtocoloResumo,
  versao: esquemaVersaoProtocolo,
  resultado_validacao: esquemaResultadoValidacaoResumo,
});
export type CriarVersaoResposta = z.infer<typeof esquemaCriarVersaoResposta>;

// --- POST /api/protocols/:numero/release (RF-09, papel FINANCEIRO) ---

/** Corpo vazio por contrato — a decisão de liberar depende só do estado do protocolo, nunca de dado enviado pelo cliente. */
export const esquemaLiberarProtocoloEntrada = z.object({}).strict();
export type LiberarProtocoloEntrada = z.infer<typeof esquemaLiberarProtocoloEntrada>;

export const esquemaLiberarProtocoloResposta = z.object({
  protocolo: esquemaProtocoloResumo,
});
export type LiberarProtocoloResposta = z.infer<typeof esquemaLiberarProtocoloResposta>;

// --- POST /api/imports (RF-01, papel SECRETARIA) ---

export const esquemaImportarGuiasEntrada = z.discriminatedUnion("formato", [
  z.object({
    formato: z.literal("csv"),
    nome_arquivo: z.string().trim().min(1),
    // Teto deliberado (auditoria, item 4): ~3MB de texto cobre um CSV real de milhares de
    // linhas com folga; recusa com 422 antes da zona onde o runtime/D1 quebrava com 500 cru.
    conteudo_csv: z.string().min(1).max(3_000_000, "Arquivo CSV muito grande (máximo ~3 MB)."),
  }),
  z.object({
    formato: z.literal("json"),
    nome_arquivo: z.string().trim().min(1),
    linhas: z.array(esquemaGuiaBruta).min(1).max(2000, "Máximo de 2000 linhas por importação."),
  }),
]);
export type ImportarGuiasEntrada = z.infer<typeof esquemaImportarGuiasEntrada>;

export const esquemaLinhaRejeitadaImportacao = z.object({
  numero_linha: z.number().int().positive(),
  motivo: z.string(),
});

export const esquemaProtocoloDaImportacao = z.object({
  numero_protocolo: esquemaNumeroProtocolo,
  id_guia_origem: z.string(),
});

export const esquemaImportarGuiasResposta = z.object({
  linhas_aceitas: z.number().int().nonnegative(),
  linhas_rejeitadas: z.array(esquemaLinhaRejeitadaImportacao),
  protocolos_criados: z.array(esquemaProtocoloDaImportacao),
  protocolos_ja_existentes: z.array(esquemaProtocoloDaImportacao),
});
export type ImportarGuiasResposta = z.infer<typeof esquemaImportarGuiasResposta>;

// --- GET /api/rules ---

/** Espelha `RegraProcedimento` (domínio `src/domain/rule-set.ts`) — só para exibição (RN-01). */
export const esquemaRegraProcedimentoWire = z.object({
  codigo: z.string(),
  descricao: z.string(),
  valor_referencia_cents: z.number().int(),
});

/** Espelha `RegraConvenio` (domínio). `campos_obrigatorios` é texto solto no fio (rótulo de tela, não decisão — quem decide é o motor no servidor). */
export const esquemaRegraConvenioWire = z.object({
  nome: z.string(),
  campos_obrigatorios: z.array(z.string()),
  validade_maxima_autorizacao_dias: z.number().int().positive(),
  limite_sessoes_por_autorizacao: z.number().int().positive(),
  procedimentos_cobertos: z.array(z.string()),
  prazo_envio_dias: z.number().int().positive(),
  observacao: z.string(),
});

/** Espelha `DefinicoesRegras` (domínio). */
export const esquemaDefinicoesRegrasWire = z.object({
  autorizacao_valida: z.string(),
  sessao_numero_na_autorizacao: z.string(),
  prazo_envio_dias: z.string(),
  valor: z.string(),
});

/**
 * `convenios`/`procedimentos`/`definicoes` foram acrescentados na Fase 2 (auditoria — item de
 * dependência: a UI lia `regras_convenio.json.txt` e `src/rules/rule-set.ts` direto no bundle
 * do cliente para montar "Nova guia"/"Regras", violando `ui → application → domain+rules`
 * do CLAUDE.md). Agora o catálogo para EXIBIÇÃO vem só daqui — a mesma leitura de
 * `rule_sets.source_json` que `src/http/handlers/create-protocol.ts` (`carregarRegrasAtivas`)
 * já fazia para validar, nunca uma segunda fonte da verdade.
 */
export const esquemaRegrasAtivasResposta = z.object({
  versao: z.string(),
  sha256: z.string(),
  /** Nome do arquivo de origem das regras oficiais (RN-01: "as regras oficiais vêm de regras_convenio.json"). */
  origem: z.string(),
  importada_em_utc: z.string(),
  ativada_em_utc: z.string().nullable(),
  convenios: z.array(esquemaRegraConvenioWire),
  procedimentos: z.array(esquemaRegraProcedimentoWire),
  definicoes: esquemaDefinicoesRegrasWire,
});
export type RegrasAtivasResposta = z.infer<typeof esquemaRegrasAtivasResposta>;
export type RegraConvenioWire = z.infer<typeof esquemaRegraConvenioWire>;
export type RegraProcedimentoWire = z.infer<typeof esquemaRegraProcedimentoWire>;

// --- POST /api/session ---

export const esquemaTrocarSessaoEntrada = z.object({
  papel: esquemaPapelSessao,
});
export type TrocarSessaoEntrada = z.infer<typeof esquemaTrocarSessaoEntrada>;

export const esquemaTrocarSessaoResposta = z.object({
  papel: esquemaPapelSessao,
  expira_em_utc: z.string(),
});
export type TrocarSessaoResposta = z.infer<typeof esquemaTrocarSessaoResposta>;

// --- POST /api/protocols/:numero/evidence (RF-12, papel SECRETARIA ou FINANCEIRO) ---

/**
 * Multipart/form-data, não JSON — o handler lê `request.formData()`, pega o campo `arquivo` (um
 * `File` do runtime, nunca bufferizado inteiro por Zod) e valida os METADADOS extraídos com este
 * esquema antes de calcular SHA-256 e gravar no R2 (chave `evidence/{protocol-id}/{event-id}/
 * {uuid}-{safe-filename}` — o nome enviado nunca é a chave, só metadado de exibição, PRD §25.1).
 * Tipo e tamanho são checados de novo pelo handler durante a leitura do corpo — nunca confiar só
 * em `file.type`/`file.size` do multipart nem no cabeçalho `Content-Length` (PRD §25.2).
 */
export const esquemaMetadadosArquivoEvidencia = z.object({
  nome_original: z
    .string()
    .trim()
    .min(1, "Nome do arquivo é obrigatório.")
    .max(255, "Nome do arquivo muito longo (máximo 255 caracteres)."),
  tipo_mime: esquemaTipoMimeEvidencia,
  tamanho_bytes: z.number().int().positive().max(LIMITE_EVIDENCIA_BYTES, "Arquivo excede o limite de 10 MB."),
});
export type MetadadosArquivoEvidencia = z.infer<typeof esquemaMetadadosArquivoEvidencia>;

export const esquemaAnexarEvidenciaResposta = z.object({
  evidencia: esquemaEvidenciaWire,
});
export type AnexarEvidenciaResposta = z.infer<typeof esquemaAnexarEvidenciaResposta>;

// --- GET /api/evidence/:id (RF-12, PRD §25.3 — link assinado, temporário, finalidade única) ---

/**
 * O download é autorizado por um token HMAC de curta duração na query string (finalidade única,
 * expiração, nonce) — nunca só pelo cookie de sessão. Assinar/verificar o token é infraestrutura
 * (fora deste arquivo); aqui só se fixa que a rota exige `?token=` e que a resposta bem-sucedida
 * é o arquivo (com `Content-Disposition` seguro e `X-Content-Type-Options: nosniff`), nunca JSON.
 */
export const esquemaBaixarEvidenciaConsulta = z.object({
  token: z.string().min(1, "Token de download é obrigatório."),
});
export type BaixarEvidenciaConsulta = z.infer<typeof esquemaBaixarEvidenciaConsulta>;

// --- POST /api/evidence/:id/invalidate (RF-12, papel SECRETARIA ou FINANCEIRO) ---
//
// Caminho não estava nos 8 fixados pelo orquestrador para esta fase (só anexar e baixar) — mas
// RF-12 exige invalidação com motivo obrigatório ("uma evidência incorreta pode ser invalidada
// com motivo e substituída por outra") e a tarefa desta fase pede explicitamente o esquema
// pronto. Suposição declarada: mesmo arquivo de handler de `GET /api/evidence/:id`
// (`src/http/handlers/evidence.ts`), método POST porque muda estado, mesmo papel de quem anexa.

export const esquemaInvalidarEvidenciaEntrada = z.object({
  motivo: z
    .string()
    .trim()
    .min(1, "Motivo da invalidação é obrigatório.")
    .max(1000, "Motivo da invalidação muito longo (máximo 1000 caracteres)."),
});
export type InvalidarEvidenciaEntrada = z.infer<typeof esquemaInvalidarEvidenciaEntrada>;

export const esquemaInvalidarEvidenciaResposta = z.object({
  evidencia: esquemaEvidenciaWire,
});
export type InvalidarEvidenciaResposta = z.infer<typeof esquemaInvalidarEvidenciaResposta>;

// --- POST /api/protocols/:numero/review-decisions (RN-06, papel FINANCEIRO) ---

/**
 * Decide um problema em `REVISAO_HUMANA` (PRD §19.5: `validation_issues.status` vira `ABERTO`,
 * `RESOLVIDO` ou `INVALIDADO`). `CONFIRMAR_PROBLEMA` registra a decisão como evento `REVISAO`
 * sem fechar o problema (ele continua bloqueando liberação); `INVALIDAR_PROBLEMA` fecha como
 * falso positivo (`status` vira `INVALIDADO`, deixa de bloquear `SEM_REVISAO_HUMANA_PENDENTE`).
 */
const DECISOES_REVISAO_HUMANA = ["CONFIRMAR_PROBLEMA", "INVALIDAR_PROBLEMA"] as const;
export const esquemaDecisaoRevisaoHumana = z.enum(DECISOES_REVISAO_HUMANA);

export const esquemaDecidirRevisaoEntrada = z.object({
  problema_id: z.string().min(1, "Identificador do problema é obrigatório."),
  decisao: esquemaDecisaoRevisaoHumana,
  motivo: z
    .string()
    .trim()
    .min(1, "Motivo da decisão é obrigatório.")
    .max(1000, "Motivo da decisão muito longo (máximo 1000 caracteres)."),
});
export type DecidirRevisaoEntrada = z.infer<typeof esquemaDecidirRevisaoEntrada>;

export const esquemaDecidirRevisaoResposta = z.object({
  protocolo: esquemaProtocoloResumo,
  problema: esquemaProblemaHistorico,
});
export type DecidirRevisaoResposta = z.infer<typeof esquemaDecidirRevisaoResposta>;

// --- POST /api/protocols/:numero/send (RF-09/RN-04, papel FINANCEIRO) ---

/**
 * Liberar não é enviar (RF-09). Exige protocolo em `LIBERADA_PARA_ENVIO`, `ocorrido_em_utc`
 * (pode ser retroativo) e `evidence_id` de uma evidência válida (não invalidada) já vinculada a
 * este protocolo — sem evidência, o handler recusa com `EVIDENCE_REQUIRED` (já mapeado para 409
 * em `src/http/routes.ts`). O evento grava `ocorrido_em_utc` e `registrado_em_utc` separados; a
 * interface mostra os dois quando divergem. `ocorrido_em_utc` normaliza para o padrão `_utc` já
 * usado em `esquemaEvento`/`esquemaVersaoProtocolo` neste arquivo (o orquestrador citou o campo
 * como "ocorrido_em" em prosa, sem fixar a grafia exata).
 */
export const esquemaRegistrarEnvioEntrada = z.object({
  ocorrido_em_utc: esquemaInstanteIso,
  evidence_id: z.string().min(1, "Evidência do envio é obrigatória."),
});
export type RegistrarEnvioEntrada = z.infer<typeof esquemaRegistrarEnvioEntrada>;

export const esquemaRegistrarEnvioResposta = z.object({
  protocolo: esquemaProtocoloResumo,
  envio: esquemaEnvioWire,
});
export type RegistrarEnvioResposta = z.infer<typeof esquemaRegistrarEnvioResposta>;

// --- POST /api/protocols/:numero/close-private e /close-cancelled (RN-07, papel FINANCEIRO) ---

/**
 * Mesmo formato para os dois destinos finais — RN-07 exige motivo por extenso em ambos. A rota
 * chamada (não um campo no corpo) decide qual `FluxoStatus` resulta: `ENCERRADA_PARTICULAR` ou
 * `ENCERRADA_CANCELADA`.
 */
export const esquemaEncerrarProtocoloEntrada = z.object({
  motivo: z
    .string()
    .trim()
    .min(1, "Motivo do encerramento é obrigatório.")
    .max(2000, "Motivo do encerramento muito longo (máximo 2000 caracteres)."),
});
export type EncerrarProtocoloEntrada = z.infer<typeof esquemaEncerrarProtocoloEntrada>;

export const esquemaEncerrarProtocoloResposta = z.object({
  protocolo: esquemaProtocoloResumo,
});
export type EncerrarProtocoloResposta = z.infer<typeof esquemaEncerrarProtocoloResposta>;

// --- POST /api/merges/compare (RF-13, PRD §26, papel FINANCEIRO) ---

export const esquemaCompararMergeEntrada = z.object({
  numero_protocolo_a: esquemaNumeroProtocolo,
  numero_protocolo_b: esquemaNumeroProtocolo,
});
export type CompararMergeEntrada = z.infer<typeof esquemaCompararMergeEntrada>;

/** Identifica um dos dois lados da comparação — só o suficiente para a tela e para `commit` referenciar de volta, nunca o protocolo completo. */
export const esquemaProtocoloReferenciaMerge = z.object({
  protocolo_id: z.string(),
  numero_protocolo: esquemaNumeroProtocolo,
  id_guia_origem: z.string().nullable(),
});

/** Um campo comparado entre os dois protocolos (PRD §26.2: campos iguais mantidos automaticamente, divergentes exigem escolha explícita no `commit`). */
export const esquemaCampoComparadoMerge = z.object({
  campo: z.string(),
  valor_a: z.string().nullable(),
  valor_b: z.string().nullable(),
  igual: z.boolean(),
});

export const esquemaCompararMergeResposta = z.object({
  protocolo_a: esquemaProtocoloReferenciaMerge,
  protocolo_b: esquemaProtocoloReferenciaMerge,
  campos_iguais: z.array(esquemaCampoComparadoMerge),
  campos_divergentes: z.array(esquemaCampoComparadoMerge),
  suspeita_duplicidade_aberta: z.boolean(),
});
export type CompararMergeResposta = z.infer<typeof esquemaCompararMergeResposta>;

// --- POST /api/merges/commit (RF-13, PRD §26, papel FINANCEIRO) ---

/**
 * Pré-condições revalidadas pelo handler na hora (nunca confiar no que `compare` devolveu antes):
 * dois protocolos ativos e distintos, nenhum já mesclado, escolha explícita do principal, e
 * suspeita aberta OU esta justificativa manual. `resolucao_campos` cobre só os campos
 * divergentes que `compare` apontou — campos iguais nunca aparecem aqui porque são mantidos
 * automaticamente (PRD §26.2).
 */
export const esquemaExecutarMergeEntrada = z.object({
  numero_protocolo_principal: esquemaNumeroProtocolo,
  numero_protocolo_origem: esquemaNumeroProtocolo,
  resolucao_campos: z.array(esquemaResolucaoCampoMerge),
  motivo: z
    .string()
    .trim()
    .min(1, "Justificativa do merge é obrigatória.")
    .max(2000, "Justificativa do merge muito longa (máximo 2000 caracteres)."),
});
export type ExecutarMergeEntrada = z.infer<typeof esquemaExecutarMergeEntrada>;

export const esquemaExecutarMergeResposta = z.object({
  protocolo_principal: esquemaProtocoloResumo,
  merge: esquemaMergeWire,
});
export type ExecutarMergeResposta = z.infer<typeof esquemaExecutarMergeResposta>;

// --- Formato de erro comum a toda rota (CLAUDE.md: sem stack trace, mensagem curta em PT-BR). ---

export const esquemaRespostaErro = z.object({
  erro: z.object({
    codigo: z.string(),
    mensagem: z.string(),
  }),
});
export type RespostaErro = z.infer<typeof esquemaRespostaErro>;

// --- Tipos compartilhados derivados (para quem só quer o tipo, sem reconstruir o schema). ---

export type GuiaBrutaWire = z.infer<typeof esquemaGuiaBruta>;
export type GuiaNormalizadaWire = z.infer<typeof esquemaGuiaNormalizada>;
export type AvisoNormalizacaoWire = z.infer<typeof esquemaAvisoNormalizacao>;
export type SubproblemaWire = z.infer<typeof esquemaSubproblema>;
export type ProblemaWire = z.infer<typeof esquemaProblema>;
export type ProblemaHistoricoWire = z.infer<typeof esquemaProblemaHistorico>;
export type TarefaWire = z.infer<typeof esquemaTarefa>;
export type TarefaComEstadoWire = z.infer<typeof esquemaTarefaComEstado>;
export type EventoWire = z.infer<typeof esquemaEvento>;
export type DiffCampoWire = z.infer<typeof esquemaDiffCampo>;
export type VersaoProtocoloWire = z.infer<typeof esquemaVersaoProtocolo>;
export type RequisitoLiberacaoWire = z.infer<typeof esquemaRequisitoLiberacao>;
export type TravaLiberacaoWire = z.infer<typeof esquemaTravaLiberacao>;
export type ProtocoloResumoWire = z.infer<typeof esquemaProtocoloResumo>;
export type ProtocoloListagemItemWire = z.infer<typeof esquemaProtocoloListagemItem>;
export type ResultadoValidacaoResumoWire = z.infer<typeof esquemaResultadoValidacaoResumo>;
export type EvidenciaWire = z.infer<typeof esquemaEvidenciaWire>;
export type ResolucaoCampoMergeWire = z.infer<typeof esquemaResolucaoCampoMerge>;
export type MergeWire = z.infer<typeof esquemaMergeWire>;
export type EnvioWire = z.infer<typeof esquemaEnvioWire>;
export type ProtocoloReferenciaMergeWire = z.infer<typeof esquemaProtocoloReferenciaMerge>;
export type CampoComparadoMergeWire = z.infer<typeof esquemaCampoComparadoMerge>;

// Reexportado para quem monta o roteador precisar reconhecer erro de validação de entrada sem
// importar `zod` de novo só por causa do tipo do erro.
export { ZodError };
