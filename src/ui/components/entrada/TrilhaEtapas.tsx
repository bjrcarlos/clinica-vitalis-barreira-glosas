import styles from "./TrilhaEtapas.module.css";

export interface ItemTrilha {
  readonly rotulo: string;
  readonly legenda: string;
}

interface TrilhaEtapasProps {
  readonly etapas: readonly ItemTrilha[];
  /** Índice (0-based) da etapa atual — as anteriores contam como concluídas. */
  readonly etapaAtual: number;
  /** Volta para uma etapa já concluída. Etapa à frente nunca é clicável: pular exige validar a atual. */
  readonly aoVoltarPara: (indice: number) => void;
}

/**
 * Trilha vertical de etapas de um formulário longo: número, nome e uma linha do que a etapa cobre.
 * Diferente de `PainelEtapas` (faixa horizontal "1 · 2 · 3" da importação), esta ocupa a coluna
 * lateral e mostra o caminho inteiro — o que dá a quem preenche a noção de quanto falta.
 */
export function TrilhaEtapas({ etapas, etapaAtual, aoVoltarPara }: TrilhaEtapasProps) {
  return (
    <ol className={styles.trilha}>
      {etapas.map((etapa, indice) => {
        const concluida = indice < etapaAtual;
        const atual = indice === etapaAtual;
        const classe = [styles.item, concluida ? styles.concluida : "", atual ? styles.atual : ""]
          .filter(Boolean)
          .join(" ");
        const conteudo = (
          <>
            <span className={styles.marcador} aria-hidden="true">
              {concluida ? "✓" : indice + 1}
            </span>
            <span className={styles.textos}>
              <span className={styles.rotulo}>{etapa.rotulo}</span>
              <span className={styles.legenda}>{etapa.legenda}</span>
            </span>
          </>
        );

        return (
          <li key={etapa.rotulo} className={classe} aria-current={atual ? "step" : undefined}>
            {concluida ? (
              <button type="button" className={styles.botaoItem} onClick={() => aoVoltarPara(indice)}>
                {conteudo}
                <span className={styles.voltarDica}>Editar</span>
              </button>
            ) : (
              <div className={styles.conteudoItem}>{conteudo}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
