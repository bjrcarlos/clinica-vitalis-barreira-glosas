import type { Area, Origem, ValidacaoStatus, FluxoStatus } from "../domain/statuses";
import type { GuiaBruta, GuiaNormalizada, AvisoNormalizacao } from "../domain/guide";
import type { ConjuntoRegras } from "../domain/rule-set";
import type { ResultadoValidacao, CandidatoDuplicidade, Tarefa } from "../domain/validation";
import type { EventoFluxo } from "../domain/events";

/** Relógio único e injetável: toda leitura de "agora" passa por aqui, nunca por `Date.now()` implícito. */
export interface Relogio {
  agoraUtc(): string;
}

/** Gerador único e injetável de identificadores internos (protocolo, versão, execução, evidência etc.). */
export interface GeradorId {
  novo(): string;
}

/** Dados necessários para abrir um protocolo novo já com sua primeira versão de guia. */
export interface NovoProtocolo {
  readonly idGuiaOrigem: string | null;
  readonly guiaBruta: GuiaBruta;
  readonly guiaNormalizada: GuiaNormalizada;
  readonly avisosNormalizacao: readonly AvisoNormalizacao[];
  readonly criadoPorPapel: Area;
  readonly criadoPorPrincipal: string;
  readonly origem: Origem;
  readonly ocorridoEmUtc: string;
}

/** Identificadores do protocolo e da versão inicial recém-criados. */
export interface ProtocoloCriado {
  readonly protocoloId: string;
  readonly numeroProtocolo: string;
  readonly versaoId: string;
}

/** Retrato mínimo de um protocolo existente: o suficiente para localizá-lo e saber seu estado atual. */
export interface ProtocoloResumo {
  readonly protocoloId: string;
  readonly numeroProtocolo: string;
  readonly idGuiaOrigem: string | null;
  readonly versaoAtualId: string;
  readonly statusValidacao: ValidacaoStatus;
  readonly statusFluxo: FluxoStatus;
  readonly riscoAtualCents: number;
  readonly riscoInicialCents: number;
}

/** Porta do agregado Protocolo: abertura atômica com versão inicial e busca por identificadores conhecidos. */
export interface Protocolos {
  criarComVersaoInicial(dados: NovoProtocolo): Promise<ProtocoloCriado>;
  buscarPorNumero(numeroProtocolo: string): Promise<ProtocoloResumo | null>;
  buscarPorIdGuiaOrigem(idGuiaOrigem: string): Promise<ProtocoloResumo | null>;
}

/** Porta de versões de guia: hoje, só a consulta de candidatos a duplicidade que o motor precisa. */
export interface Versoes {
  listarCandidatosDuplicidade(guia: GuiaNormalizada): Promise<readonly CandidatoDuplicidade[]>;
}

/** Dados de uma execução completa do motor de validação, prontos para persistência. */
export interface ExecucaoValidacao {
  readonly protocoloId: string;
  readonly guiaVersaoId: string;
  readonly resultado: ResultadoValidacao;
  readonly iniciadoEmUtc: string;
  readonly concluidoEmUtc: string;
}

/** Identificadores atribuídos pelo armazenamento à execução e a cada problema, na ordem de `resultado.problemas`. */
export interface ExecucaoSalva {
  readonly validationRunId: string;
  readonly issueIds: readonly string[];
}

/** Porta de execuções de validação: grava a execução com seus problemas de forma atômica. */
export interface Validacoes {
  salvarExecucao(execucao: ExecucaoValidacao): Promise<ExecucaoSalva>;
}

/** Uma tarefa pronta para ser gravada, ligada ao protocolo e, quando originada de um problema, a ele. */
export interface NovaTarefa {
  readonly protocoloId: string;
  readonly issueId: string | null;
  readonly tarefa: Tarefa;
}

/** Porta de tarefas operacionais: grava em lote as tarefas resultantes de uma execução de validação. */
export interface Tarefas {
  criarEmLote(tarefas: readonly NovaTarefa[]): Promise<readonly string[]>;
}

/** Um evento pronto para ser gravado, já ligado ao protocolo (e, quando aplicável, à versão) de origem. */
export interface RegistroEvento {
  readonly protocoloId: string;
  readonly guiaVersaoId: string | null;
  readonly evento: EventoFluxo;
}

/** Porta da trilha de auditoria: apenas registra um evento novo — nunca corrige nem apaga um existente. */
export interface Eventos {
  registrar(registro: RegistroEvento): Promise<string>;
}

/** Porta de conjuntos de regras: ativa (persistindo se necessário) a versão vigente das regras de convênio. */
export interface ConjuntosDeRegras {
  ativar(conjunto: ConjuntoRegras): Promise<void>;
}
