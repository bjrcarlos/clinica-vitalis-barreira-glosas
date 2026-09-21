import { BadgeValidacao } from "../BadgeValidacao";
import { EstadoFluxo } from "../EstadoFluxo";
import { Card } from "../Card";
import { formatarCentavos, formatarDataHoraBrasilia } from "../../lib/format";
import { apresentarValidacaoStatus } from "../../../domain/statuses";
import type { ProtocoloResumoWire, ResultadoValidacaoResumoWire, TravaLiberacaoWire } from "../../../http/contracts";
import styles from "./CabecalhoProtocolo.module.css";

interface CabecalhoProtocoloProps {
  readonly protocolo: ProtocoloResumoWire;
  readonly unidade: string;
  readonly resultado: ResultadoValidacaoResumoWire;
  readonly trava: TravaLiberacaoWire;
}

/** Uma das quatro cores de estado de validação, ou "atencao" para o caso raro de OK travado. */
type TomBanner = "OK" | "CORRIGIR" | "REVISAO_HUMANA" | "NAO_FATURAR_CONVENIO" | "ATENCAO";

const CLASSE_TOM: Record<TomBanner, string> = {
  OK: styles.tomOk,
  CORRIGIR: styles.tomCorrigir,
  REVISAO_HUMANA: styles.tomRevisao,
  NAO_FATURAR_CONVENIO: styles.tomNaoFaturar,
  ATENCAO: styles.tomCorrigir,
};

/**
 * Texto e tom da "próxima ação" (PRD §12.2, item 2): quando a validação não está OK, o próprio
 * `resumo` do motor já é a frase pronta com o próximo passo (RN mostrado em `docs/BASELINE.md`
 * §3.2 — "Próximo passo: ..."). Quando está OK, a próxima ação depende só da trava de liberação,
 * que o servidor já calculou (RF-09) — a interface nunca decide isso sozinha.
 */
function proximaAcao(
  resultado: ResultadoValidacaoResumoWire,
  trava: TravaLiberacaoWire,
): { texto: string; tom: TomBanner } {
  if (resultado.status !== "OK") {
    return { texto: resultado.resumo, tom: resultado.status };
  }
  if (trava.pode_liberar) {
    return { texto: "Sem pendências abertas. Esta guia está pronta para liberação.", tom: "OK" };
  }
  return { texto: trava.motivo ?? "Validação OK, mas ainda falta um requisito para liberar.", tom: "ATENCAO" };
}

/** Cabeçalho do protocolo: número e estado, próxima ação e valor em risco (PRD §12.2, itens 1–2). */
export function CabecalhoProtocolo({ protocolo, unidade, resultado, trava }: CabecalhoProtocoloProps) {
  const acao = proximaAcao(resultado, trava);
  const rotuloValidacao =
    protocolo.numero_versao_atual > 1
      ? `${apresentarValidacaoStatus(protocolo.status_validacao)} na versão ${protocolo.numero_versao_atual}`
      : apresentarValidacaoStatus(protocolo.status_validacao);
  const reduziu = protocolo.risco_atual_cents < protocolo.risco_inicial_cents;

  return (
    <Card className={styles.cartao}>
      <div className={styles.linhaTitulo}>
        <h1 className={`${styles.numero} num`}>{protocolo.numero_protocolo}</h1>
        <span className={styles.estadoValidacao}>
          <BadgeValidacao status={protocolo.status_validacao} />
          {protocolo.numero_versao_atual > 1 && <span className={styles.sufixoVersao}>{rotuloValidacao}</span>}
        </span>
        <EstadoFluxo status={protocolo.status_fluxo} />
        <span className={styles.meta}>
          id de origem <b className="num">{protocolo.id_guia_origem ?? "—"}</b> · {unidade} · criada em{" "}
          {formatarDataHoraBrasilia(protocolo.criado_em_utc)}
        </span>
      </div>

      <div className={styles.linhaAcao}>
        <div className={`${styles.banner} ${CLASSE_TOM[acao.tom]}`}>
          <p className={styles.bannerTitulo}>Próxima ação</p>
          <p className={styles.bannerTexto}>{acao.texto}</p>
        </div>
        <div className={styles.risco}>
          <span className={styles.riscoRotulo}>Valor em risco</span>
          <span className={`${styles.riscoValor} num`}>{formatarCentavos(protocolo.risco_atual_cents)}</span>
          <span className={styles.riscoNota}>
            {reduziu
              ? `contado uma vez · reduzido de ${formatarCentavos(protocolo.risco_inicial_cents)}`
              : "contado uma vez por protocolo"}
          </span>
        </div>
      </div>
    </Card>
  );
}
