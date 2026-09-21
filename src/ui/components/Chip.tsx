import type { ReactNode } from "react";
import styles from "./Chip.module.css";

interface ChipProps {
  readonly children: ReactNode;
  /** Contagem embutida na pílula (ex.: "OK 49"). */
  readonly contagem?: number;
  /** Chip de filtro ativo inverte para verde escuro (docs/DESIGN.md). */
  readonly ativo?: boolean;
  readonly disabled?: boolean;
  readonly onClick?: () => void;
  /** Obrigatório quando o chip só tem ícone (ex.: seta de paginação). */
  readonly ariaLabel?: string;
}

/** Pílula clicável com contagem opcional — filtro, seletor de página ou ação secundária. Sempre `<button>`. */
export function Chip({ children, contagem, ativo = false, disabled = false, onClick, ariaLabel }: ChipProps) {
  return (
    <button
      type="button"
      className={`${styles.chip} ${ativo ? styles.ativo : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={ativo}
      aria-label={ariaLabel}
    >
      {children}
      {typeof contagem === "number" && <span className={styles.contagem}>{contagem}</span>}
    </button>
  );
}
