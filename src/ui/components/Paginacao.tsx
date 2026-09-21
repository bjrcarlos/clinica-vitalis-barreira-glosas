import styles from "./Paginacao.module.css";

interface PaginacaoProps {
  readonly paginaAtual: number;
  readonly totalPaginas: number;
  readonly aoMudarPagina: (pagina: number) => void;
}

const JANELA_MAXIMA = 5;

/** Janela de páginas ao redor da atual, sem reticências (suficiente para o volume desta fase — 80 guias). */
function paginasVisiveis(atual: number, total: number): number[] {
  if (total <= JANELA_MAXIMA) {
    return Array.from({ length: total }, (_, indice) => indice + 1);
  }
  const inicio = Math.min(Math.max(atual - Math.floor(JANELA_MAXIMA / 2), 1), total - JANELA_MAXIMA + 1);
  return Array.from({ length: JANELA_MAXIMA }, (_, indice) => inicio + indice);
}

/** Navegação de páginas de uma lista — anterior/próxima e números, com a página atual marcada. */
export function Paginacao({ paginaAtual, totalPaginas, aoMudarPagina }: PaginacaoProps) {
  if (totalPaginas <= 1) return null;

  return (
    <nav aria-label="Paginação" className={styles.paginacao}>
      <button
        type="button"
        className={styles.seta}
        aria-label="Página anterior"
        disabled={paginaAtual <= 1}
        onClick={() => aoMudarPagina(paginaAtual - 1)}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m15 6-6 6 6 6" />
        </svg>
      </button>
      {paginasVisiveis(paginaAtual, totalPaginas).map((pagina) => (
        <button
          key={pagina}
          type="button"
          className={`${styles.pagina} num ${pagina === paginaAtual ? styles.atual : ""}`}
          aria-current={pagina === paginaAtual ? "page" : undefined}
          onClick={() => aoMudarPagina(pagina)}
        >
          {pagina}
        </button>
      ))}
      <button
        type="button"
        className={styles.seta}
        aria-label="Próxima página"
        disabled={paginaAtual >= totalPaginas}
        onClick={() => aoMudarPagina(paginaAtual + 1)}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m9 6 6 6-6 6" />
        </svg>
      </button>
    </nav>
  );
}
