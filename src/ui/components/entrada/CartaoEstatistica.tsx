import styles from "./CartaoEstatistica.module.css";

interface CartaoEstatisticaProps {
  readonly rotulo: string;
  readonly valor: string | number;
  readonly descricao?: string;
  /** Par de cor — reaproveita os tokens de estado de validação do docs/DESIGN.md. */
  readonly tom?: "neutro" | "positivo" | "atencao" | "negativo" | "info";
}

const CLASSE_POR_TOM: Record<NonNullable<CartaoEstatisticaProps["tom"]>, string> = {
  neutro: styles.neutro,
  positivo: styles.positivo,
  atencao: styles.atencao,
  negativo: styles.negativo,
  info: styles.info,
};

/** Bloco pequeno "rótulo + número grande + descrição" — resumo da importação (design-reference/Importar.dc.html `.stat`). */
export function CartaoEstatistica({ rotulo, valor, descricao, tom = "neutro" }: CartaoEstatisticaProps) {
  return (
    <div className={`${styles.cartao} ${CLASSE_POR_TOM[tom]}`}>
      <span className={styles.rotulo}>{rotulo}</span>
      <span className={`${styles.valor} num`}>{valor}</span>
      {descricao ? <span className={styles.descricao}>{descricao}</span> : null}
    </div>
  );
}
