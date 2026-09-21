import { Link } from "react-router-dom";
import { formatarCentavos } from "../../lib/format";
import type { RelatorioResposta } from "./tipos";
import styles from "./BlocoDestinoRisco.module.css";

interface BlocoDestinoRiscoProps {
  readonly to: string;
  readonly tratado: RelatorioResposta["risco_tratado_cents"];
  readonly pendente: RelatorioResposta["risco_pendente_cents"];
}

/**
 * Quarto bloco do relatório (RF-14/§27.4): tratado × pendente, com a barra proporcional.
 * `protocol_numbers.length` de cada métrica dá a contagem de guias sem inventar outro campo.
 */
export function BlocoDestinoRisco({ to, tratado, pendente }: BlocoDestinoRiscoProps) {
  const total = tratado.valor + pendente.valor;
  const percentualTratado = total > 0 ? (tratado.valor / total) * 100 : 0;
  const semRisco = total === 0;

  return (
    <Link to={to} className={styles.bloco}>
      <span className={styles.seta} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 17 17 7M9 7h8v8" />
        </svg>
      </span>
      <span className={styles.rotulo}>4 · Destino do risco</span>
      <span className={styles.numeros}>
        <span className={`${styles.valor} num ${styles.tratado}`}>{formatarCentavos(tratado.valor)}</span>
        <span className={`${styles.valor} num ${styles.pendente}`}>{formatarCentavos(pendente.valor)}</span>
      </span>
      <span className={styles.trilho} aria-hidden="true">
        {semRisco ? (
          <i className={styles.neutro} style={{ width: "100%" }} />
        ) : (
          <>
            <i className={styles.tratadoBarra} style={{ width: `${percentualTratado}%` }} />
            <i className={styles.pendenteBarra} style={{ flexGrow: 1 }} />
          </>
        )}
      </span>
      <span className={styles.legenda}>
        <span>tratado · {tratado.protocol_numbers.length} guias</span>
        <span>ainda pendente · {pendente.protocol_numbers.length}</span>
      </span>
    </Link>
  );
}
