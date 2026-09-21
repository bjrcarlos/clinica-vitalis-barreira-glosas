import type { FluxoStatus } from "../../domain/statuses";
import { formatarRotuloFluxoStatus } from "../lib/format";
import styles from "./EstadoFluxo.module.css";

interface EstadoFluxoProps {
  readonly status: FluxoStatus;
}

/**
 * docs/DESIGN.md define ponto colorido para 4 tons: cinza em tratamento, verde liberada,
 * escuro enviada, roxo mesclada. Os dois estados de encerramento (particular/cancelada) não
 * têm tom próprio especificado — SUPOSIÇÃO: usam o mesmo cinza neutro de "em tratamento",
 * por serem estados terminais sem mais ação pendente. Revisar se o design system ganhar um
 * tom dedicado para encerramentos.
 */
const TOM_POR_STATUS: Record<FluxoStatus, string> = {
  EM_TRATAMENTO: styles.neutro,
  LIBERADA_PARA_ENVIO: styles.liberada,
  ENVIADA: styles.enviada,
  ENCERRADA_PARTICULAR: styles.neutro,
  ENCERRADA_CANCELADA: styles.neutro,
  MESCLADA: styles.mesclada,
};

/** Texto discreto com ponto colorido — estado operacional do protocolo no fluxo (RF-09). */
export function EstadoFluxo({ status }: EstadoFluxoProps) {
  return (
    <span className={styles.estado}>
      <i className={`${styles.ponto} ${TOM_POR_STATUS[status]}`} aria-hidden="true" />
      {formatarRotuloFluxoStatus(status)}
    </span>
  );
}
