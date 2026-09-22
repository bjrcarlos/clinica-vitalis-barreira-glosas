/**
 * Identificadores de estado do domínio "Barreira de Glosas". ASCII, estáveis, nunca
 * renomeados — a tradução para português com acento vive só nas funções de apresentação
 * deste arquivo, nunca nos identificadores em si.
 */

export const VALIDACAO_STATUS_VALORES = [
  "OK",
  "CORRIGIR",
  "REVISAO_HUMANA",
  "NAO_FATURAR_CONVENIO",
] as const;

/** Resultado da validação determinística (e, quando aplicável, da IA) de uma versão de guia. */
export type ValidacaoStatus = (typeof VALIDACAO_STATUS_VALORES)[number];

/** Confirma, em tempo de execução, se um texto arbitrário é um `ValidacaoStatus` válido. */
export function isValidacaoStatus(valor: string): valor is ValidacaoStatus {
  return (VALIDACAO_STATUS_VALORES as readonly string[]).includes(valor);
}

export const FLUXO_STATUS_VALORES = [
  "EM_TRATAMENTO",
  "LIBERADA_PARA_ENVIO",
  "ENVIADA",
  "ENCERRADA_PARTICULAR",
  "ENCERRADA_CANCELADA",
  "MESCLADA",
] as const;

/** Estado operacional do protocolo dentro do fluxo de trabalho — onde ele está, não o que foi encontrado nele. */
export type FluxoStatus = (typeof FLUXO_STATUS_VALORES)[number];

/** Confirma, em tempo de execução, se um texto arbitrário é um `FluxoStatus` válido. */
export function isFluxoStatus(valor: string): valor is FluxoStatus {
  return (FLUXO_STATUS_VALORES as readonly string[]).includes(valor);
}

export const AREA_VALORES = ["SECRETARIA", "FINANCEIRO", "SISTEMA"] as const;

/** Área funcional responsável por um ator, evento, problema ou tarefa. */
export type Area = (typeof AREA_VALORES)[number];

/** Confirma, em tempo de execução, se um texto arbitrário é uma `Area` válida. */
export function isArea(valor: string): valor is Area {
  return (AREA_VALORES as readonly string[]).includes(valor);
}

export const ORIGEM_VALORES = ["UI", "MCP", "IMPORTACAO", "SISTEMA"] as const;

/** Canal pelo qual uma ação chegou ao sistema. */
export type Origem = (typeof ORIGEM_VALORES)[number];

/** Confirma, em tempo de execução, se um texto arbitrário é uma `Origem` válida. */
export function isOrigem(valor: string): valor is Origem {
  return (ORIGEM_VALORES as readonly string[]).includes(valor);
}

/**
 * Ordem de gravidade usada para compor o estado principal de validação a partir dos problemas
 * encontrados: o primeiro status desta lista presente entre os problemas vence (RN-06).
 */
export const PRECEDENCIA_VALIDACAO_STATUS: readonly ValidacaoStatus[] = [
  "NAO_FATURAR_CONVENIO",
  "REVISAO_HUMANA",
  "CORRIGIR",
  "OK",
];

const ROTULOS_VALIDACAO_STATUS: Readonly<Record<ValidacaoStatus, string>> = {
  OK: "OK",
  CORRIGIR: "Corrigir",
  REVISAO_HUMANA: "Revisão humana",
  NAO_FATURAR_CONVENIO: "Não faturar ao convênio",
};

/** Rótulo em português, com acento, para exibir um `ValidacaoStatus` na interface. */
export function apresentarValidacaoStatus(status: ValidacaoStatus): string {
  return ROTULOS_VALIDACAO_STATUS[status];
}

const ROTULOS_FLUXO_STATUS: Readonly<Record<FluxoStatus, string>> = {
  EM_TRATAMENTO: "Em tratamento",
  LIBERADA_PARA_ENVIO: "Liberada para envio",
  ENVIADA: "Enviada",
  ENCERRADA_PARTICULAR: "Encerrada como particular",
  ENCERRADA_CANCELADA: "Encerrada como cancelada",
  MESCLADA: "Mesclada",
};

/** Rótulo em português, com acento, para exibir um `FluxoStatus` na interface. */
export function apresentarFluxoStatus(status: FluxoStatus): string {
  return ROTULOS_FLUXO_STATUS[status];
}

const ROTULOS_AREA: Readonly<Record<Area, string>> = {
  SECRETARIA: "Secretaria",
  FINANCEIRO: "Financeiro",
  SISTEMA: "Sistema",
};

/** Rótulo em português para exibir uma `Area` na interface. */
export function apresentarArea(area: Area): string {
  return ROTULOS_AREA[area];
}

const ROTULOS_ORIGEM: Readonly<Record<Origem, string>> = {
  UI: "Interface",
  MCP: "MCP",
  IMPORTACAO: "Importação",
  SISTEMA: "Sistema",
};

/** Rótulo em português para exibir uma `Origem` na interface. */
export function apresentarOrigem(origem: Origem): string {
  return ROTULOS_ORIGEM[origem];
}
