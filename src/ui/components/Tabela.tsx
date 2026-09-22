import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import styles from "./Tabela.module.css";

interface TabelaProps {
  readonly children: ReactNode;
  readonly caption?: string;
  /** `true` quando o texto de `caption` já aparece visualmente em algum lugar ao lado da tabela
   * (ex.: título/subtítulo do card) — a legenda continua no DOM para leitor de tela, só não se
   * repete na tela para quem enxerga. */
  readonly captionOculto?: boolean;
}

function TabelaRaiz({ children, caption, captionOculto }: TabelaProps) {
  return (
    <table className={styles.tabela}>
      {caption ? <caption className={captionOculto ? styles.legendaOculta : styles.legenda}>{caption}</caption> : null}
      {children}
    </table>
  );
}

function Cabecalho({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>;
}

function Corpo({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

function CelulaCabecalho({ children, className, ...resto }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={[styles.th, className].filter(Boolean).join(" ")} {...resto}>
      {children}
    </th>
  );
}

function Celula({ children, className, ...resto }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={[styles.td, className].filter(Boolean).join(" ")} {...resto}>
      {children}
    </td>
  );
}

/** Coluna de valor: alinhada à direita, tabular-nums (docs/DESIGN.md). */
function CelulaNumerica({ children, className, ...resto }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={[styles.td, styles.numerica, "num", className].filter(Boolean).join(" ")} {...resto}>
      {children}
    </td>
  );
}

/**
 * Tabela compartilhada: cabeçalho em caixa alta sobre `--cor-superficie`, linhas com hover
 * e divisória suave, célula numérica tabular à direita. As linhas (`<tr>`) e o conteúdo de
 * cada célula são responsabilidade de cada tela — este componente só dá a casca visual.
 */
export const Tabela = Object.assign(TabelaRaiz, {
  Cabecalho,
  Corpo,
  CelulaCabecalho,
  Celula,
  CelulaNumerica,
});
