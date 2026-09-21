import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import styles from "./KpiCard.module.css";

export type VarianteKpi = "verde" | "atencao" | "risco" | "claro";

interface KpiCardProps {
  readonly to: string;
  readonly variante: VarianteKpi;
  readonly icone: ReactNode;
  readonly rotulo: string;
  readonly valor: string;
  readonly legenda: string;
}

/** Cartão de KPI do Dashboard — mesmos gradientes tokenizados dos blocos do Relatório. */
export function KpiCard({ to, variante, icone, rotulo, valor, legenda }: KpiCardProps) {
  return (
    <Link to={to} className={`${styles.kpi} ${styles[variante]}`}>
      <span className={styles.icone} aria-hidden="true">
        {icone}
      </span>
      <span className={styles.rotulo}>{rotulo}</span>
      <span className={`${styles.valor} num`}>{valor}</span>
      <span className={styles.legenda}>{legenda}</span>
    </Link>
  );
}
