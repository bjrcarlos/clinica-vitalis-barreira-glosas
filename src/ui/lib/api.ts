/**
 * Cliente HTTP tipado para as rotas internas em `/api` (contrato fixado pelo orquestrador
 * da Fase 2; ver docs/PRD-SDD.md §24 e §27).
 *
 * SUPOSIÇÃO DECLARADA (20/09/2026): a tarefa pede tipos vindos de `src/http/contracts.ts`,
 * mas esse arquivo não existe nesta sessão — está sendo escrito em paralelo por outro agente
 * desta mesma fase (`src/http/handlers/` já existe, vazio). Não é seguro inventar nomes de
 * tipos de um arquivo que não li. Por isso cada função abaixo aceita um parâmetro de tipo
 * genérico para a resposta esperada (default `unknown`, nunca `any`), e os filtros de busca
 * usam os enums reais do domínio (`ValidacaoStatus`/`FluxoStatus`/`Area`, já verificados
 * nesta sessão em `src/domain/statuses.ts`) em vez de campos inventados. Quando
 * `src/http/contracts.ts` existir, cada chamador troca o genérico solto por um tipo
 * importado de lá; a assinatura das funções não deveria precisar mudar.
 */
import type { Area, FluxoStatus, ValidacaoStatus } from "../../domain/statuses";

/** Envelope de erro estável (CLAUDE.md): `{ erro: { codigo, mensagem } }`, mensagem curta em português. */
export interface ErroApi {
  readonly codigo: string;
  readonly mensagem: string;
}

/**
 * Códigos de erro estáveis já fixados para esta fase (CLAUDE.md). Lista fechada apenas para
 * referência/`switch`; o servidor pode devolver outros códigos estáveis fora desta fase
 * (merge, IA) — por isso `ErroApi.codigo` continua tipado como `string`, não como este union.
 */
export const CODIGOS_ERRO_CONHECIDOS = [
  "ROLE_NOT_ALLOWED",
  "INVALID_STATE_TRANSITION",
  "OPEN_BLOCKING_TASKS",
  "GUIDE_NOT_READY",
  "EVIDENCE_REQUIRED",
] as const;

/** Erro lançado por toda chamada deste cliente — sempre carrega `codigo` e uma `mensagem` exibível. */
export class ApiError extends Error {
  readonly codigo: string;

  constructor(erro: ErroApi) {
    super(erro.mensagem);
    this.name = "ApiError";
    this.codigo = erro.codigo;
  }
}

function isErroEnvelope(valor: unknown): valor is { erro: ErroApi } {
  if (typeof valor !== "object" || valor === null || !("erro" in valor)) return false;
  const erro = (valor as { erro: unknown }).erro;
  return (
    typeof erro === "object" &&
    erro !== null &&
    typeof (erro as { codigo?: unknown }).codigo === "string" &&
    typeof (erro as { mensagem?: unknown }).mensagem === "string"
  );
}

interface OpcoesRequisicao {
  readonly method: "GET" | "POST" | "PATCH";
  readonly corpo?: unknown;
  readonly signal?: AbortSignal;
}

async function requisitar<T>(caminho: string, opcoes: OpcoesRequisicao): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(`/api${caminho}`, {
      method: opcoes.method,
      credentials: "same-origin",
      signal: opcoes.signal,
      headers: opcoes.corpo === undefined ? undefined : { "Content-Type": "application/json" },
      body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
    });
  } catch {
    throw new ApiError({
      codigo: "FALHA_DE_REDE",
      mensagem: "Não foi possível conectar ao servidor. Verifique a conexão e tente novamente.",
    });
  }

  const texto = await resposta.text();
  let corpo: unknown = null;
  if (texto.length > 0) {
    try {
      corpo = JSON.parse(texto);
    } catch {
      throw new ApiError({
        codigo: "RESPOSTA_INVALIDA",
        mensagem: "O servidor respondeu em um formato inesperado.",
      });
    }
  }

  if (!resposta.ok) {
    if (isErroEnvelope(corpo)) throw new ApiError(corpo.erro);
    throw new ApiError({ codigo: "ERRO_HTTP", mensagem: `Falha inesperada (HTTP ${resposta.status}).` });
  }

  return corpo as T;
}

/** Camada genérica — usar diretamente quando nenhuma das funções nomeadas abaixo servir. */
export const api = {
  get: <T = unknown>(caminho: string, signal?: AbortSignal): Promise<T> =>
    requisitar<T>(caminho, { method: "GET", signal }),
  post: <T = unknown>(caminho: string, corpo?: unknown, signal?: AbortSignal): Promise<T> =>
    requisitar<T>(caminho, { method: "POST", corpo, signal }),
  patch: <T = unknown>(caminho: string, corpo?: unknown, signal?: AbortSignal): Promise<T> =>
    requisitar<T>(caminho, { method: "PATCH", corpo, signal }),
};

/** Papel funcional da identidade da demonstração (PRD §8: OAuth fora de escopo). DIRECAO é só leitura. */
export type PapelSessao = "SECRETARIA" | "FINANCEIRO" | "DIRECAO";

/** Quem está logado nesta aba (`GET /api/me`). Sem login, `autenticado: false` — a interface cai na identidade funcional da demonstração. */
export interface UsuarioAtual {
  readonly autenticado: boolean;
  readonly nome?: string;
  readonly email?: string;
  readonly papel?: PapelSessao;
  readonly expira_em_utc?: string;
}

/** `GET /api/me` — conta real por trás da sessão, quando alguém entrou por `/entrar` ou pelo fluxo OAuth. */
export function obterUsuarioAtual(signal?: AbortSignal): Promise<UsuarioAtual> {
  return api.get<UsuarioAtual>("/me", signal);
}

/** `POST /api/session` — troca a identidade funcional da demonstração (cookie HttpOnly assinado). */
export function trocarSessao(papel: PapelSessao): Promise<void> {
  return api.post<void>("/session", { papel });
}

/** `GET /api/report` — quatro blocos do RF-14, motivos, distribuição por área, pendências antigas. */
export function obterRelatorio<T = unknown>(signal?: AbortSignal): Promise<T> {
  return api.get<T>("/report", signal);
}

/** Filtros de `GET /api/protocols` — campos fixados no contrato da Fase 2. Sem filtros, devolve as 80. */
export interface FiltrosProtocolos {
  readonly statusValidacao?: ValidacaoStatus;
  readonly statusFluxo?: FluxoStatus;
  readonly area?: Area;
  readonly unidade?: string;
  readonly convenio?: string;
  readonly atendimentoDe?: string;
  readonly atendimentoAte?: string;
  readonly busca?: string;
  readonly pagina?: number;
  readonly tamanho?: number;
}

const CHAVE_QUERY_POR_FILTRO: Record<keyof FiltrosProtocolos, string> = {
  statusValidacao: "status_validacao",
  statusFluxo: "status_fluxo",
  area: "area",
  unidade: "unidade",
  convenio: "convenio",
  atendimentoDe: "atendimento_de",
  atendimentoAte: "atendimento_ate",
  busca: "busca",
  pagina: "pagina",
  tamanho: "tamanho",
};

function paraQueryString(filtros: FiltrosProtocolos): string {
  const parametros = new URLSearchParams();
  for (const chave of Object.keys(filtros) as (keyof FiltrosProtocolos)[]) {
    const valor = filtros[chave];
    if (valor === undefined || valor === null || valor === "") continue;
    parametros.set(CHAVE_QUERY_POR_FILTRO[chave], String(valor));
  }
  const query = parametros.toString();
  return query.length > 0 ? `?${query}` : "";
}

/** `GET /api/protocols` — sem filtro, devolve todos os protocolos (RF-14). */
export function listarProtocolos<T = unknown>(filtros: FiltrosProtocolos = {}, signal?: AbortSignal): Promise<T> {
  return api.get<T>(`/protocols${paraQueryString(filtros)}`, signal);
}

/** `GET /api/protocols/:numero` — detalhe completo do protocolo. */
export function obterProtocolo<T = unknown>(numeroProtocolo: string, signal?: AbortSignal): Promise<T> {
  return api.get<T>(`/protocols/${encodeURIComponent(numeroProtocolo)}`, signal);
}

/** `POST /api/protocols` — cadastro individual (papel SECRETARIA, verificado pelo servidor via cookie). */
export function cadastrarProtocolo<TResposta = unknown, TDados = unknown>(dados: TDados): Promise<TResposta> {
  return api.post<TResposta>("/protocols", dados);
}

/** `POST /api/protocols/:numero/versions` — correção: nova versão, diff e revalidação (papel SECRETARIA). */
export function corrigirProtocolo<TResposta = unknown, TDados = unknown>(
  numeroProtocolo: string,
  dados: TDados,
): Promise<TResposta> {
  return api.post<TResposta>(`/protocols/${encodeURIComponent(numeroProtocolo)}/versions`, dados);
}

/** `POST /api/protocols/:numero/release` — libera para envio (papel FINANCEIRO), só se a trava permitir. */
export function liberarProtocolo<T = unknown>(numeroProtocolo: string): Promise<T> {
  return api.post<T>(`/protocols/${encodeURIComponent(numeroProtocolo)}/release`);
}

/** `POST /api/imports` — importação de CSV (papel SECRETARIA). */
export function importarArquivo<TResposta = unknown, TDados = unknown>(dados: TDados): Promise<TResposta> {
  return api.post<TResposta>("/imports", dados);
}

/** `GET /api/rules` — regra ativa, versão, hash e origem. */
export function obterRegraAtiva<T = unknown>(signal?: AbortSignal): Promise<T> {
  return api.get<T>("/rules", signal);
}

/** Decide um problema de revisão humana pelo Financeiro. */
export function decidirRevisao<TResposta = unknown, TDados = unknown>(numeroProtocolo: string, dados: TDados): Promise<TResposta> {
  return api.post<TResposta>("/protocols/" + encodeURIComponent(numeroProtocolo) + "/review-decisions", dados);
}

/** Invalida uma evidência de forma append-only, sempre com motivo. */
export function invalidarEvidencia<TResposta = unknown>(evidenciaId: string, dados: unknown): Promise<TResposta> {
  return api.post<TResposta>("/evidence/" + encodeURIComponent(evidenciaId) + "/invalidate", dados);
}

/** Compara dois protocolos marcados como possível duplicidade. */
export function compararMerge<TResposta = unknown>(dados: unknown): Promise<TResposta> {
  return api.post<TResposta>("/merges/compare", dados);
}

/** Executa o merge depois das escolhas explícitas da interface Financeiro. */
export function executarMerge<TResposta = unknown>(dados: unknown): Promise<TResposta> {
  return api.post<TResposta>("/merges/commit", dados);
}

/**
 * Administração de contas (`/api/users`, telas "Pessoas com acesso" e "Minha conta"). Exige
 * sessão de login real (cookie `vitalis_login`) — nunca a identidade funcional da demonstração.
 * Os nomes de campo espelham exatamente `UsuarioParaListagem`/`EventoUsuario`
 * (`src/infrastructure/d1/identity.ts`), já verificados nesta sessão.
 */
export interface Usuario {
  readonly id: string;
  readonly email: string;
  readonly nome: string;
  readonly papel: PapelSessao;
  readonly ativo: boolean;
  readonly senhaProvisoria: boolean;
  readonly bloqueado: boolean;
  readonly ultimoAcessoUtc: string | null;
  readonly criadoEmUtc: string;
}

export interface ListaUsuariosResposta {
  readonly usuarios: readonly Usuario[];
  readonly eu: { readonly id: string; readonly email: string };
}

export interface CriarUsuarioEntrada {
  readonly nome: string;
  readonly email: string;
  readonly papel: PapelSessao;
}

export interface CriarUsuarioResposta {
  readonly usuario: Usuario;
  readonly senha_provisoria: string;
}

export interface AlterarUsuarioEntrada {
  readonly papel?: PapelSessao;
  readonly ativo?: boolean;
}

export interface AlterarUsuarioResposta {
  readonly usuario: Usuario;
}

export interface RedefinirSenhaResposta {
  readonly usuario: Usuario;
  readonly senha_provisoria: string;
}

/** Os oito tipos estáveis de evento de identidade (`GET /api/users/eventos`). */
export type TipoEventoUsuario =
  | "CONTA_CRIADA"
  | "PAPEL_ALTERADO"
  | "CONTA_DESATIVADA"
  | "CONTA_REATIVADA"
  | "SENHA_REDEFINIDA"
  | "SENHA_TROCADA"
  | "CONTA_BLOQUEADA"
  | "ACESSO_REALIZADO";

export interface EventoUsuario {
  readonly id: string;
  readonly userId: string;
  readonly nomeUsuario: string;
  readonly tipo: TipoEventoUsuario;
  readonly atorEmail: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly ocorridoEmUtc: string;
}

export interface ListaEventosResposta {
  readonly eventos: readonly EventoUsuario[];
}

/** `GET /api/users` — lista de contas para a tela "Pessoas com acesso" (papel DIRECAO). */
export function listarUsuarios(signal?: AbortSignal): Promise<ListaUsuariosResposta> {
  return api.get<ListaUsuariosResposta>("/users", signal);
}

/** `GET /api/users/eventos` — histórico de identidade (criação, papel, bloqueio, senha). */
export function listarEventosDeUsuarios(signal?: AbortSignal): Promise<ListaEventosResposta> {
  return api.get<ListaEventosResposta>("/users/eventos", signal);
}

/** `POST /api/users` — cria conta e devolve a senha provisória uma única vez. */
export function criarUsuario(dados: CriarUsuarioEntrada, signal?: AbortSignal): Promise<CriarUsuarioResposta> {
  return api.post<CriarUsuarioResposta>("/users", dados, signal);
}

/** `PATCH /api/users/:id` — troca papel e/ou ativa/desativa uma conta. */
export function alterarUsuario(
  id: string,
  dados: AlterarUsuarioEntrada,
  signal?: AbortSignal,
): Promise<AlterarUsuarioResposta> {
  return api.patch<AlterarUsuarioResposta>(`/users/${encodeURIComponent(id)}`, dados, signal);
}

/** `POST /api/users/:id/senha` — Direção redefine a senha de alguém e recebe a provisória uma vez. */
export function redefinirSenhaUsuario(id: string, signal?: AbortSignal): Promise<RedefinirSenhaResposta> {
  return api.post<RedefinirSenhaResposta>(`/users/${encodeURIComponent(id)}/senha`, undefined, signal);
}

/** `POST /api/me/senha` — a própria pessoa troca a senha, conferindo a atual. */
export function trocarPropriaSenha(
  dados: { readonly senha_atual: string; readonly senha_nova: string },
  signal?: AbortSignal,
): Promise<{ readonly trocada: true }> {
  return api.post<{ readonly trocada: true }>("/me/senha", dados, signal);
}
