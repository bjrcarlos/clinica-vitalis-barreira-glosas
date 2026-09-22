import type { AvisoNormalizacao, GuiaBruta, GuiaNormalizada } from "../domain/guide";
import type { ConjuntoRegras } from "../domain/rule-set";
import type { Area, Origem } from "../domain/statuses";
import type { Eventos, ProtocoloCriado, ProtocoloResumo, Protocolos, Relogio, Versoes } from "./ports";
import { validarGuia, type ValidarGuiaDependencias, type ValidarGuiaSaida } from "./validate-guide";

export interface RegistrarGuiaEntrada {
  /** `id_guia` de origem, quando a guia vem de importação — chave de idempotência. `null` em cadastro manual (RF-02). */
  readonly idGuiaOrigem: string | null;
  readonly guiaBruta: GuiaBruta;
  readonly guiaNormalizada: GuiaNormalizada;
  readonly avisosNormalizacao: readonly AvisoNormalizacao[];
  readonly criadoPorPapel: Area;
  readonly criadoPorPrincipal: string;
  readonly origem: Origem;
  readonly regras: ConjuntoRegras;
  readonly interpretacaoIA?: import("./validate-guide").InterpretacaoObservacaoIA | null;
  readonly aiStatus?: "NAO_EXECUTADA" | "CONCLUIDA" | "FALHOU";
  readonly aiModel?: string | null;
  readonly aiPromptVersion?: string | null;
  readonly aiInputJson?: string | null;
  readonly aiOutputJson?: string | null;
}

export interface RegistrarGuiaDependencias {
  readonly protocolos: Protocolos;
  readonly versoes: Versoes;
  readonly eventos: Eventos;
  readonly relogio: Relogio;
  readonly validarGuiaDependencias: ValidarGuiaDependencias;
}

/** Discriminado por `jaExistia`: quando `true`, nada novo foi gravado nesta chamada. */
export type RegistrarGuiaSaida =
  | { readonly jaExistia: true; readonly protocolo: ProtocoloResumo; readonly validacao: null }
  | { readonly jaExistia: false; readonly protocolo: ProtocoloCriado; readonly validacao: ValidarGuiaSaida };

/**
 * Caso de uso "registrar guia": abre protocolo + versão inicial e dispara a validação.
 *
 * Idempotente por `idGuiaOrigem`: se já existe um protocolo com o mesmo `id_guia` de origem,
 * devolve-o sem gravar nada de novo (nem protocolo, nem versão, nem evento, nem validação) —
 * reimportar a mesma guia da mesma importação nunca cria um segundo protocolo nem soma o risco
 * de novo.
 */
export async function registrarGuia(
  entrada: RegistrarGuiaEntrada,
  deps: RegistrarGuiaDependencias,
): Promise<RegistrarGuiaSaida> {
  if (entrada.idGuiaOrigem !== null) {
    const existente = await deps.protocolos.buscarPorIdGuiaOrigem(entrada.idGuiaOrigem);
    if (existente !== null) {
      return { jaExistia: true, protocolo: existente, validacao: null };
    }
  }

  // Consulta os candidatos antes de criar a própria linha do protocolo. Em D1, a busca por
  // chave composta enxergaria a versão recém-criada e marcaria toda guia manual/importada como
  // duplicada dela mesma. O seed em memória escondia esse defeito por comparar identidade de
  // objeto; a ordem correta vale para todos os adapters.
  const candidatosDuplicidade = await deps.versoes.listarCandidatosDuplicidade(entrada.guiaNormalizada);

  const ocorridoEmUtc = deps.relogio.agoraUtc();
  const criado = await deps.protocolos.criarComVersaoInicial({
    idGuiaOrigem: entrada.idGuiaOrigem,
    guiaBruta: entrada.guiaBruta,
    guiaNormalizada: entrada.guiaNormalizada,
    avisosNormalizacao: entrada.avisosNormalizacao,
    criadoPorPapel: entrada.criadoPorPapel,
    criadoPorPrincipal: entrada.criadoPorPrincipal,
    origem: entrada.origem,
    ocorridoEmUtc,
  });

  await deps.eventos.registrar({
    protocoloId: criado.protocoloId,
    guiaVersaoId: criado.versaoId,
    evento: {
      tipo: "CADASTRO",
      ator: entrada.criadoPorPrincipal,
      papel: entrada.criadoPorPapel,
      origem: entrada.origem,
      ocorrido_em_utc: ocorridoEmUtc,
      registrado_em_utc: deps.relogio.agoraUtc(),
      motivo: null,
      metadata: {
        numero_protocolo: criado.numeroProtocolo,
        id_guia_origem: entrada.idGuiaOrigem,
      },
    },
  });

  const validacao = await validarGuia(
    {
      protocoloId: criado.protocoloId,
      guiaVersaoId: criado.versaoId,
      guia: entrada.guiaNormalizada,
      regras: entrada.regras,
      candidatosDuplicidade,
      origem: entrada.origem,
      interpretacaoIA: entrada.interpretacaoIA,
      aiStatus: entrada.aiStatus,
      aiModel: entrada.aiModel,
      aiPromptVersion: entrada.aiPromptVersion,
      aiInputJson: entrada.aiInputJson,
      aiOutputJson: entrada.aiOutputJson,
    },
    deps.validarGuiaDependencias,
  );

  return { jaExistia: false, protocolo: criado, validacao };
}
