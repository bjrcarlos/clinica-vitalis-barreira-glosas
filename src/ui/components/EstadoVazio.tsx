import type { ReactNode } from "react";
import styles from "./EstadoVazio.module.css";

interface EstadoVazioProps {
  readonly titulo: string;
  readonly descricao?: string;
  /** Ação secundária, ex.: um botão "Limpar filtros" real. */
  readonly acao?: ReactNode;
}

/** Mensagem para lista ou seção sem resultados (ex.: filtro que não bate com nenhuma guia). */
export function EstadoVazio({ titulo, descricao, acao }: EstadoVazioProps) {
  return (
    <div className={styles.vazio} role="status">
      <p className={styles.titulo}>{titulo}</p>
      {descricao ? <p className={styles.descricao}>{descricao}</p> : null}
      {acao ? <div className={styles.acao}>{acao}</div> : null}
    </div>
  );
}
