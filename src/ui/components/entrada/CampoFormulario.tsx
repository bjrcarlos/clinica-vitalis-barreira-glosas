import type { ReactNode } from "react";
import styles from "./CampoFormulario.module.css";

interface CampoFormularioProps {
  readonly idCampo: string;
  readonly rotulo: string;
  readonly obrigatorio?: boolean;
  /** Texto de apoio abaixo do campo — formato esperado ou observação da regra do convênio. */
  readonly dica?: ReactNode;
  /** `atencao`/`alerta` colorem a borda (docs/DESIGN.md `.f.warn`/`.f.bad`) — vem de fato já conferido, nunca decidido aqui. */
  readonly estado?: "normal" | "atencao" | "alerta";
  /** `<input>`, `<select>` ou `<textarea>` já com `id={idCampo}`. */
  readonly children: ReactNode;
  readonly className?: string;
}

const CLASSE_POR_ESTADO: Record<NonNullable<CampoFormularioProps["estado"]>, string> = {
  normal: "",
  atencao: styles.atencao,
  alerta: styles.alerta,
};

/** Rótulo + campo + dica, no padrão de formulário da tela "Nova guia" (design-reference/NovaGuia.dc.html `.f`). */
export function CampoFormulario({
  idCampo,
  rotulo,
  obrigatorio = false,
  dica,
  estado = "normal",
  children,
  className,
}: CampoFormularioProps) {
  return (
    <div className={[styles.campo, CLASSE_POR_ESTADO[estado], className].filter(Boolean).join(" ")}>
      <label htmlFor={idCampo}>
        {rotulo}
        {obrigatorio ? (
          <i className={styles.obrigatorio} aria-label="obrigatório">
            *
          </i>
        ) : null}
      </label>
      {children}
      {dica ? <span className={styles.dica}>{dica}</span> : null}
    </div>
  );
}
