import type { ReactNode } from "react";
import styles from "./Card.module.css";

interface CardProps {
  readonly children: ReactNode;
  /** Remove o padding interno — para conteúdo que já controla o próprio espaçamento (ex.: uma Tabela). */
  readonly semPadding?: boolean;
  readonly className?: string;
}

/** Superfície branca com borda e cantos arredondados — base de painéis, listas e blocos (docs/DESIGN.md). */
export function Card({ children, semPadding = false, className }: CardProps) {
  const classes = [styles.card, semPadding ? styles.semPadding : "", className].filter(Boolean).join(" ");
  return <div className={classes}>{children}</div>;
}
