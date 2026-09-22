import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./Dialogo.module.css";

interface DialogoProps {
  readonly aberto: boolean;
  readonly titulo: string;
  readonly aoFechar: () => void;
  readonly children: ReactNode;
}

const SELETOR_FOCAVEL = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Diálogo modal acessível (docs de acessibilidade da tarefa: "foco preso e retorno de foco").
 * Monta num portal (`document.body`) para nunca ficar preso pelo `overflow`/posicionamento de
 * um card ancestral. `role="dialog"` + `aria-modal` + `aria-labelledby` no título; Escape fecha;
 * Tab/Shift+Tab ciclam só entre os elementos focáveis de dentro do diálogo; ao fechar, o foco
 * volta exatamente para o elemento que tinha foco antes de abrir (o botão que abriu o diálogo).
 */
export function Dialogo({ aberto, titulo, aoFechar, children }: DialogoProps) {
  const tituloId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const focoAnteriorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!aberto) return;

    focoAnteriorRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const primeiroFocavel = containerRef.current?.querySelector<HTMLElement>(SELETOR_FOCAVEL);
    (primeiroFocavel ?? containerRef.current)?.focus();

    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") {
        evento.preventDefault();
        aoFechar();
        return;
      }
      if (evento.key !== "Tab" || !containerRef.current) return;
      const focaveis = Array.from(containerRef.current.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL));
      if (focaveis.length === 0) {
        evento.preventDefault();
        return;
      }
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (evento.shiftKey && document.activeElement === primeiro) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primeiro.focus();
      }
    }

    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      focoAnteriorRef.current?.focus();
    };
  }, [aberto, aoFechar]);

  if (!aberto) return null;

  return createPortal(
    <div className={styles.sobreposicao} onMouseDown={(evento) => evento.target === evento.currentTarget && aoFechar()}>
      <div ref={containerRef} className={styles.painel} role="dialog" aria-modal="true" aria-labelledby={tituloId} tabIndex={-1}>
        <div className={styles.cabecalho}>
          <h2 id={tituloId} className={styles.titulo}>
            {titulo}
          </h2>
          <button type="button" className={styles.fechar} onClick={aoFechar} aria-label="Fechar">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
