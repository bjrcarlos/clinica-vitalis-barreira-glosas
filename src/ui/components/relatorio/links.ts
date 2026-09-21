import type { Area } from "../../../domain/statuses";

/**
 * Hrefs de "/guias" que reconciliam com os números do relatório (PRD §27: "cada cálculo
 * retorna também os IDs que compõem o número; o clique usa esses IDs/filtros").
 *
 * SUPOSIÇÃO DECLARADA (20/09/2026): o contrato fixado de `GET /api/protocols`
 * (`esquemaListaProtocolosConsulta` em `src/http/contracts.ts`) filtra por campo
 * (`status_validacao`, `status_fluxo`, `area`, csv quando a lista aceita mais de um valor) —
 * não existe um filtro por lista literal de `numero_protocolo`. Como cada bloco do relatório é
 * um único link (não uma lista de IDs por bloco), a reconciliação exata é feita pelo filtro de
 * campo que reproduz o MESMO conjunto de protocolos que compôs o número (ex.: "exigem atenção"
 * é sempre `status_validacao != OK`, e nenhum protocolo `OK` carrega risco nesta fase — ver
 * `docs/PROGRESS/phase-1-handoff.md` §3.2), não por reconstruir a lista de IDs na URL.
 */
export const LINK_TODAS_AS_GUIAS = "/guias";

/** Mesmo conjunto de protocolos que soma "exigem atenção" e "detectado em risco" (RF-14). */
export const LINK_EXIGEM_ATENCAO = "/guias?status_validacao=CORRIGIR,REVISAO_HUMANA,NAO_FATURAR_CONVENIO";

/** Protocolos cujo risco ainda não chegou a um destino final (RF-09: ainda `EM_TRATAMENTO`). */
export const LINK_RISCO_PENDENTE = "/guias?status_fluxo=EM_TRATAMENTO";

/** Link para as guias de uma área responsável específica (cartão "Quem resolve"). */
export function linkPorArea(area: Area): string {
  return `/guias?area=${area}`;
}
