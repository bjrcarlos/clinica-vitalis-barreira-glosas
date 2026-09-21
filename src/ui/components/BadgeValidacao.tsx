import type { ValidacaoStatus } from "../../domain/statuses";
import { formatarRotuloValidacaoStatus } from "../lib/format";
import styles from "./BadgeValidacao.module.css";

interface BadgeValidacaoProps {
  readonly status: ValidacaoStatus;
}

const CLASSE_POR_STATUS: Record<ValidacaoStatus, string> = {
  OK: styles.ok,
  CORRIGIR: styles.corrigir,
  REVISAO_HUMANA: styles.revisao,
  NAO_FATURAR_CONVENIO: styles.naoFaturar,
};

/** Pílula de estado de validação — os quatro estados do RF-08, com o par de cor fixado em docs/DESIGN.md. */
export function BadgeValidacao({ status }: BadgeValidacaoProps) {
  return <span className={`${styles.badge} ${CLASSE_POR_STATUS[status]}`}>{formatarRotuloValidacaoStatus(status)}</span>;
}
