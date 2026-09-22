import { ZodError } from "zod";
import type { Env } from "../worker/index";
import { lerPapelDaRequisicao, type PapelSessao } from "../infrastructure/auth/session";

/**
 * Roteador HTTP interno (PRD-SDD §24) — sem framework novo. Casa método + padrão de caminho,
 * extrai parâmetros (`:nome`), resolve o papel da sessão uma única vez por requisição (a partir
 * do cookie assinado, nunca do corpo ou de um cabeçalho livre) e injeta tudo em `ContextoRota`
 * antes de delegar ao handler registrado.
 *
 * Trata `404` (nenhum padrão bate o caminho) e `405` (caminho reconhecido, método não) direto no
 * despacho. Qualquer erro lançado por um handler — `ZodError` de validação de entrada ou
 * `ErroDominio` de regra de negócio — é convertido aqui em `{ erro: { codigo, mensagem } }` com
 * o status HTTP correto; `500` é reservado para o que sobrar (erro realmente inesperado), e
 * nunca inclui stack trace na resposta.
 *
 * Este arquivo não implementa handler de negócio nenhum — só a mecânica de roteamento. Handlers
 * reais (Fase 2, outros agentes) importam `ContextoRota`, `ManipuladorRota` e os `esquema*` de
 * `./contracts` e são registrados na composição feita por `src/worker/index.ts`.
 */

export type MetodoHttp = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Tudo que um handler recebe: a requisição crua, os bindings do Worker, a URL já parseada, os parâmetros de caminho e o papel já resolvido do cookie assinado. */
export interface ContextoRota {
  readonly request: Request;
  readonly env: Env;
  readonly url: URL;
  readonly params: Readonly<Record<string, string>>;
  readonly papel: PapelSessao;
}

export type ManipuladorRota = (ctx: ContextoRota) => Promise<Response>;

interface RotaRegistrada {
  readonly metodo: MetodoHttp;
  readonly padrao: string;
  readonly segmentos: readonly string[];
  readonly manipulador: ManipuladorRota;
}

function segmentosDoPadrao(padrao: string): readonly string[] {
  return padrao.split("/").filter((segmento) => segmento.length > 0);
}

function segmentosDoCaminho(pathname: string): readonly string[] {
  return pathname
    .split("/")
    .filter((segmento) => segmento.length > 0)
    .map((segmento) => decodeURIComponent(segmento));
}

/** Casa um caminho contra um padrão segmento a segmento; `:nome` captura, o resto precisa bater literalmente. Devolve `null` quando não bate. */
function casarSegmentos(
  padrao: readonly string[],
  caminho: readonly string[],
): Record<string, string> | null {
  if (padrao.length !== caminho.length) return null;

  const params: Record<string, string> = {};
  for (let indice = 0; indice < padrao.length; indice++) {
    const segmentoPadrao = padrao[indice];
    const segmentoCaminho = caminho[indice];
    if (segmentoPadrao.startsWith(":")) {
      params[segmentoPadrao.slice(1)] = segmentoCaminho;
    } else if (segmentoPadrao !== segmentoCaminho) {
      return null;
    }
  }
  return params;
}

/** Erro de domínio pronto para virar resposta HTTP: `codigo` é um dos estáveis do CLAUDE.md (ou outro que o handler declare), `mensagem` é curta e em português, sem detalhe técnico. */
export class ErroDominio extends Error {
  readonly codigo: string;
  /** Status HTTP explícito, quando o padrão por código (`STATUS_HTTP_POR_CODIGO_DOMINIO`) não servir (ex.: um "não encontrado" específico de uma rota). */
  readonly status?: number;

  constructor(codigo: string, mensagem: string, status?: number) {
    super(mensagem);
    this.name = "ErroDominio";
    this.codigo = codigo;
    this.status = status;
  }
}

/** Mapeamento fixo dos códigos estáveis de erro de domínio (CLAUDE.md) para status HTTP. */
const STATUS_HTTP_POR_CODIGO_DOMINIO: Readonly<Record<string, number>> = {
  ROLE_NOT_ALLOWED: 403,
  INVALID_STATE_TRANSITION: 409,
  OPEN_BLOCKING_TASKS: 409,
  GUIDE_NOT_READY: 409,
  EVIDENCE_REQUIRED: 409,
  DUPLICATE_MERGE_CONFLICT: 409,
  AI_REVIEW_REQUIRED: 409,
};

/** Um código de domínio sem mapeamento explícito ainda é um erro de negócio esperado, não um 500 — vira conflito de estado (409), nunca erro inesperado. */
const STATUS_HTTP_PADRAO_ERRO_DOMINIO = 409;

/** Monta a resposta JSON de erro no formato fixado: `{ erro: { codigo, mensagem } }`, sem stack trace. */
export function respostaJsonErro(status: number, codigo: string, mensagem: string): Response {
  return Response.json({ erro: { codigo, mensagem } }, { status });
}

/**
 * Lê e faz o parse do corpo de uma requisição de mutação. `Request.json()`/`JSON.parse` lançam
 * `SyntaxError` (não `ZodError`, não `ErroDominio`) para corpo malformado — sem este wrapper,
 * `respostaDeErro` trata isso como imprevisto e devolve `500 ERRO_INESPERADO` para uma entrada
 * de fronteira comum, nunca validada por Zod (achado da auditoria, item 4: "todas as entradas
 * passam por Zod?"). Corpo vazio também vira este mesmo erro estável — cada handler decide via
 * Zod se um corpo vazio é ou não aceitável para a rota.
 */
export async function lerCorpoJson(request: Request): Promise<unknown> {
  const texto = await request.text();
  try {
    return texto.trim() === "" ? undefined : JSON.parse(texto);
  } catch {
    throw new ErroDominio("VALIDATION_ERROR", "Corpo da requisição não é JSON válido.", 422);
  }
}

function primeiraMensagemDeValidacao(erro: ZodError): string {
  const primeiro = erro.issues[0];
  if (!primeiro) return "Entrada inválida.";
  const caminho = primeiro.path.length > 0 ? primeiro.path.join(".") : "corpo";
  return `${caminho}: ${primeiro.message}`;
}

/** Converte o que um handler lançou em resposta HTTP. `500` só para o que não é `ZodError` nem `ErroDominio` — o que sobra é, por definição, inesperado. */
export function respostaDeErro(erro: unknown): Response {
  if (erro instanceof ZodError) {
    return respostaJsonErro(422, "VALIDATION_ERROR", primeiraMensagemDeValidacao(erro));
  }
  if (erro instanceof ErroDominio) {
    const status = erro.status ?? STATUS_HTTP_POR_CODIGO_DOMINIO[erro.codigo] ?? STATUS_HTTP_PADRAO_ERRO_DOMINIO;
    return respostaJsonErro(status, erro.codigo, erro.message);
  }
  return respostaJsonErro(500, "ERRO_INESPERADO", "Erro interno inesperado.");
}

/** Roteador simples: registra padrões, despacha requisições, cuida de 404/405 e da conversão de erro. */
export class Roteador {
  private readonly rotas: RotaRegistrada[] = [];

  registrar(metodo: MetodoHttp, padrao: string, manipulador: ManipuladorRota): this {
    this.rotas.push({ metodo, padrao, segmentos: segmentosDoPadrao(padrao), manipulador });
    return this;
  }

  get(padrao: string, manipulador: ManipuladorRota): this {
    return this.registrar("GET", padrao, manipulador);
  }

  post(padrao: string, manipulador: ManipuladorRota): this {
    return this.registrar("POST", padrao, manipulador);
  }

  async despachar(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const segmentosCaminho = segmentosDoCaminho(url.pathname);
    const metodo = request.method.toUpperCase() as MetodoHttp;

    let caminhoReconhecido = false;

    for (const rota of this.rotas) {
      const params = casarSegmentos(rota.segmentos, segmentosCaminho);
      if (params === null) continue;
      caminhoReconhecido = true;
      if (rota.metodo !== metodo) continue;

      try {
        const agoraUtc = new Date().toISOString();
        const papel = await lerPapelDaRequisicao(request, env.LINK_SIGNING_KEY, agoraUtc);
        return await rota.manipulador({ request, env, url, params, papel });
      } catch (erro) {
        return respostaDeErro(erro);
      }
    }

    if (caminhoReconhecido) {
      return respostaJsonErro(405, "METODO_NAO_PERMITIDO", "Método não permitido para esta rota.");
    }
    return respostaJsonErro(404, "ROTA_NAO_ENCONTRADA", "Rota não encontrada.");
  }
}

/**
 * As 8 rotas novas da Fase 3 (evidência, revisão, envio, encerramento, merge — PRD-SDD §24,
 * contrato fixado pelo orquestrador) e os handlers que cada uma espera. Os 5 arquivos de handler
 * (`src/http/handlers/{evidence,review-decision,send,close,merges}.ts`) são escritos por outros
 * agentes desta mesma fase, em paralelo a este arquivo — por isso `registrarRotasFase3` recebe os
 * handlers já resolvidos (injeção), em vez deste módulo importar aqueles arquivos diretamente:
 * um `import` estático de um arquivo que ainda não existe quebraria a carga de QUALQUER módulo
 * que importe `src/http/routes.ts` (inclusive `tests/http-contracts.test.ts`, hoje 100% verde),
 * não só o build final. Quando os 5 handlers existirem, `src/worker/index.ts` os importa e chama:
 *
 * ```ts
 * import { manipularAnexarEvidencia, manipularBaixarEvidencia, manipularInvalidarEvidencia } from "../http/handlers/evidence";
 * import { manipularDecidirRevisao } from "../http/handlers/review-decision";
 * import { manipularRegistrarEnvio } from "../http/handlers/send";
 * import { manipularEncerrarParticular, manipularEncerrarCancelado } from "../http/handlers/close";
 * import { manipularCompararMerge, manipularExecutarMerge } from "../http/handlers/merges";
 * import { registrarRotasFase3 } from "../http/routes";
 *
 * registrarRotasFase3(roteador, {
 *   anexarEvidencia: manipularAnexarEvidencia,
 *   baixarEvidencia: manipularBaixarEvidencia,
 *   invalidarEvidencia: manipularInvalidarEvidencia,
 *   decidirRevisao: manipularDecidirRevisao,
 *   registrarEnvio: manipularRegistrarEnvio,
 *   encerrarParticular: manipularEncerrarParticular,
 *   encerrarCancelado: manipularEncerrarCancelado,
 *   compararMerge: manipularCompararMerge,
 *   executarMerge: manipularExecutarMerge,
 * });
 * ```
 *
 * `invalidarEvidencia` (`POST /api/evidence/:id/invalidate`) não estava nos 8 caminhos fixados
 * pelo orquestrador (só anexar e baixar) — acrescentado porque RF-12 exige invalidação de
 * evidência com motivo obrigatório e `src/http/contracts.ts` já define o esquema; suposição
 * declarada, mesmo arquivo de handler de `GET /api/evidence/:id`.
 */
export interface ManipuladoresFase3 {
  readonly anexarEvidencia: ManipuladorRota;
  readonly baixarEvidencia: ManipuladorRota;
  readonly invalidarEvidencia: ManipuladorRota;
  readonly decidirRevisao: ManipuladorRota;
  readonly registrarEnvio: ManipuladorRota;
  readonly encerrarParticular: ManipuladorRota;
  readonly encerrarCancelado: ManipuladorRota;
  readonly compararMerge: ManipuladorRota;
  readonly executarMerge: ManipuladorRota;
}

/** Registra as 8 rotas novas da Fase 3 num `Roteador` já existente (ex.: o mesmo que já tem as 9 rotas da Fase 2), devolvendo-o para encadeamento. */
export function registrarRotasFase3(roteador: Roteador, handlers: ManipuladoresFase3): Roteador {
  return roteador
    .post("/api/protocols/:numero/evidence", handlers.anexarEvidencia)
    .get("/api/evidence/:id", handlers.baixarEvidencia)
    .post("/api/evidence/:id/invalidate", handlers.invalidarEvidencia)
    .post("/api/protocols/:numero/review-decisions", handlers.decidirRevisao)
    .post("/api/protocols/:numero/send", handlers.registrarEnvio)
    .post("/api/protocols/:numero/close-private", handlers.encerrarParticular)
    .post("/api/protocols/:numero/close-cancelled", handlers.encerrarCancelado)
    .post("/api/merges/compare", handlers.compararMerge)
    .post("/api/merges/commit", handlers.executarMerge);
}
