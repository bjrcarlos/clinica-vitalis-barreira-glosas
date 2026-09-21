import type { RelatorioResposta } from "./tipos";
import { EstadoVazio } from "../EstadoVazio";
import styles from "./PrincipaisMotivos.module.css";

interface PrincipaisMotivosProps {
  readonly motivos: RelatorioResposta["principais_motivos"];
}

/** Barras de "principais motivos" (RF-14) — largura proporcional ao maior valor da lista. */
export function PrincipaisMotivos({ motivos }: PrincipaisMotivosProps) {
  if (motivos.length === 0) {
    return <EstadoVazio titulo="Nenhum motivo registrado" descricao="Nenhuma guia verificada tem problema aberto." />;
  }

  const ordenados = [...motivos].sort((a, b) => b.ocorrencias - a.ocorrencias);
  const maior = ordenados[0]?.ocorrencias || 1;

  return (
    <ul className={styles.lista}>
      {ordenados.map((motivo) => (
        <li className={styles.linha} key={motivo.codigo}>
          <span className={styles.rotulo}>{motivo.titulo}</span>
          <span className={styles.trilho}>
            <i style={{ width: `${(motivo.ocorrencias / maior) * 100}%` }} />
          </span>
          <span className={`${styles.contagem} num`}>{motivo.ocorrencias}</span>
        </li>
      ))}
    </ul>
  );
}
