/**
 * Conjunto de `id_guia` de origem já presentes na base — usado só para anotar, na prévia da
 * importação (RF-01), quais linhas aceitas "já existem na base". Não decide nada: a
 * idempotência de verdade é do servidor (`registrarGuia`, Fase 1); isto é só para exibição.
 */
import { listarProtocolos } from "../../lib/api";
import type { ListaProtocolosResposta } from "../../../http/contracts";

const TAMANHO_PAGINA_MAXIMO = 100;

export async function buscarIdsGuiaExistentes(signal?: AbortSignal): Promise<Set<string>> {
  const ids = new Set<string>();

  let pagina = 1;
  let totalPaginas = 1;
  do {
    const resposta = await listarProtocolos<ListaProtocolosResposta>(
      { pagina, tamanho: TAMANHO_PAGINA_MAXIMO },
      signal,
    );
    for (const protocolo of resposta.protocolos) {
      if (protocolo.id_guia_origem !== null) {
        ids.add(protocolo.id_guia_origem);
      }
    }
    totalPaginas = resposta.paginacao.total_paginas;
    pagina += 1;
  } while (pagina <= totalPaginas);

  return ids;
}
