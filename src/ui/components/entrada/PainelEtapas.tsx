import styles from "./PainelEtapas.module.css";

interface PainelEtapasProps {
  readonly etapas: readonly string[];
  /** Índice (0-based) da etapa atual — etapas antes dela contam como concluídas. */
  readonly etapaAtual: number;
}

/** Indicador "1 · 2 · 3" de progresso de um fluxo em passos (design-reference/Importar.dc.html `.step`). */
export function PainelEtapas({ etapas, etapaAtual }: PainelEtapasProps) {
  return (
    <ol className={styles.lista}>
      {etapas.map((rotulo, indice) => {
        const concluida = indice < etapaAtual;
        const atual = indice === etapaAtual;
        return (
          <li
            key={rotulo}
            className={`${styles.etapa} ${concluida ? styles.concluida : ""} ${atual ? styles.atual : ""}`}
          >
            <span className={styles.marcador} aria-hidden="true">
              {concluida ? "✓" : indice + 1}
            </span>
            {rotulo}
          </li>
        );
      })}
    </ol>
  );
}
