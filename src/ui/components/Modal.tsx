import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./Modal.module.css";

interface ModalProps {
  readonly aberto: boolean;
  readonly titulo: string;
  readonly aoFechar: () => void;
  readonly children: ReactNode;
  /** "padrao" (~480px, diálogos curtos), "medio" (~880px, formulário em etapas) ou "largo" (~1080px, várias colunas). */
  readonly tamanho?: "padrao" | "medio" | "largo";
}

const SELETOR_FOCAVEL =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal genérico e acessível, reutilizável por qualquer tela (docs/DESIGN.md, requisito de
 * acessibilidade da tarefa). Monta num portal (`document.body`) para nunca ficar preso pelo
 * `overflow`/posicionamento de um card ancestral.
 *
 * - `role="dialog"` + `aria-modal="true"` + `aria-labelledby` ligado ao título.
 * - Foco move para dentro ao abrir (primeiro elemento focável, ou o painel) e fica **preso**
 *   nele (Tab/Shift+Tab ciclam só entre os elementos focáveis do diálogo).
 * - Esc e clique no fundo fecham; ao fechar, o foco volta exatamente para o elemento que tinha
 *   foco antes de abrir (o botão que abriu o modal).
 * - Rolagem do fundo é bloqueada enquanto o modal está aberto.
 * - Só anima `opacity`/`transform` (docs/DESIGN.md); `prefers-reduced-motion` já é tratado
 *   globalmente em `src/ui/styles/global.css` (zera a duração de toda animação/transição).
 */
export function Modal({ aberto, titulo, aoFechar, children, tamanho = "padrao" }: ModalProps) {
  const tituloId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const focoAnteriorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!aberto) return;

    focoAnteriorRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const overflowOriginal = document.body.style.overflow;
    document.body.style.overflow = "hidden";

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
      document.body.style.overflow = overflowOriginal;
      focoAnteriorRef.current?.focus();
    };
  }, [aberto, aoFechar]);

  if (!aberto) return null;

  return createPortal(
    <div className={styles.sobreposicao} onMouseDown={(evento) => evento.target === evento.currentTarget && aoFechar()}>
      <div
        ref={containerRef}
        className={`${styles.painel} ${tamanho === "largo" ? styles.largo : ""} ${tamanho === "medio" ? styles.medio : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
      >
        <div className={styles.cabecalho}>
          <h2 id={tituloId} className={styles.titulo}>
            {titulo}
          </h2>
          <button type="button" className={styles.fechar} onClick={aoFechar} aria-label="Fechar">
            ×
          </button>
        </div>
        <div className={styles.corpo}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
