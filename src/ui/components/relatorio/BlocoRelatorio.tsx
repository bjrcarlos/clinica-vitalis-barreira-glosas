import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import styles from "./BlocoRelatorio.module.css";

export type VarianteBlocoRelatorio = "verificadas" | "atencao" | "risco";

interface BlocoRelatorioProps {
  readonly to: string;
  readonly variante: VarianteBlocoRelatorio;
  readonly indice: number;
  readonly titulo: string;
  readonly children: ReactNode;
}

function Raiz({ to, variante, indice, titulo, children }: BlocoRelatorioProps) {
  return (
    <Link to={to} className={`${styles.bloco} ${styles[variante]}`}>
      <span className={styles.seta} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 17 17 7M9 7h8v8" />
        </svg>
      </span>
      <span className={styles.rotulo}>
        {indice} · {titulo}
      </span>
      {children}
    </Link>
  );
}

function Valor({ children, tamanho = "grande" }: { readonly children: ReactNode; readonly tamanho?: "grande" | "media" }) {
  return <span className={`${styles.valor} num ${tamanho === "media" ? styles.valorMedia : ""}`}>{children}</span>;
}

function Descricao({ children }: { readonly children: ReactNode }) {
  return <span className={styles.descricao}>{children}</span>;
}

/**
 * Bloco narrativo do relatório (RF-14): gradiente, número grande, link real para "/guias" já
 * filtrado. `docs/DESIGN.md`: "é um link para a lista filtrada; hover levanta 2px".
 */
export const BlocoRelatorio = Object.assign(Raiz, { Valor, Descricao });
