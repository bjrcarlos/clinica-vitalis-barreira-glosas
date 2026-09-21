import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import styles from "./Sidebar.module.css";

interface SidebarProps {
  /** Contador de pendências ao lado de "Minhas pendências". `undefined` esconde a pílula. */
  readonly contadorPendencias?: number;
  /** Rodapé da sidebar — a identidade da demonstração (ex.: <TrocaDePapel />). */
  readonly rodape?: ReactNode;
}

interface ItemNav {
  readonly rota: string;
  readonly rotulo: string;
  readonly fimExato?: boolean;
  readonly icone: ReactNode;
}

const ICONE_RELATORIO = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 19V5M4 15l5-5 4 4 7-7" />
  </svg>
);
const ICONE_GUIAS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M8 9h8M8 13h8M8 17h5" />
  </svg>
);
const ICONE_PENDENCIAS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4l3 2" />
  </svg>
);
const ICONE_IMPORTAR = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 4v12M7 11l5 5 5-5M5 20h14" />
  </svg>
);
const ICONE_NOVA_GUIA = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const ICONE_REGRAS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 4h9l4 4v12H6z" />
    <path d="M9 13h6M9 17h6" />
  </svg>
);

/** Navegação principal fixada em docs/PRD-SDD.md §12.1 — não é dado, não vem de props. */
const ITENS: readonly ItemNav[] = [
  { rota: "/", rotulo: "Relatório", fimExato: true, icone: ICONE_RELATORIO },
  { rota: "/guias", rotulo: "Todas as guias", icone: ICONE_GUIAS },
  { rota: "/pendencias", rotulo: "Minhas pendências", icone: ICONE_PENDENCIAS },
  { rota: "/importar", rotulo: "Importar", icone: ICONE_IMPORTAR },
  { rota: "/nova-guia", rotulo: "Nova guia", icone: ICONE_NOVA_GUIA },
  { rota: "/regras", rotulo: "Regras", icone: ICONE_REGRAS },
];

/** Coluna de navegação de 236px — item ativo em mint, contador de pendências em pílula âmbar. */
export function Sidebar({ contadorPendencias, rodape }: SidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.marca}>
        <span className={styles.marcaIcone} aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--cor-verde-sobre-escuro)" strokeWidth="2.4" strokeLinecap="round">
            <path d="M4 12h5l2-5 3 10 2-5h4" />
          </svg>
        </span>
        Vitalis
      </div>
      <nav className={styles.nav} aria-label="Navegação principal">
        {ITENS.map((item) => (
          <NavLink
            key={item.rota}
            to={item.rota}
            end={item.fimExato}
            className={({ isActive }) => `${styles.link} ${isActive ? styles.ativo : ""}`}
          >
            {item.icone}
            {item.rotulo}
            {item.rota === "/pendencias" && typeof contadorPendencias === "number" ? (
              <span className={styles.contador}>{contadorPendencias}</span>
            ) : null}
          </NavLink>
        ))}
      </nav>
      {rodape ? <div className={styles.rodape}>{rodape}</div> : null}
    </aside>
  );
}
