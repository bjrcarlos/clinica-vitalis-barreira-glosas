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

  const candidatosDuplicidade = await deps.versoes.listarCandidatosDuplicidade(entrada.guiaNormalizada);

  const validacao = await validarGuia(
    {
      protocoloId: criado.protocoloId,
      guiaVersaoId: criado.versaoId,
      guia: entrada.guiaNormalizada,
      regras: entrada.regras,
      candidatosDuplicidade,
      origem: entrada.origem,
    },
    deps.validarGuiaDependencias,
  );

  return { jaExistia: false, protocolo: criado, validacao };
}
