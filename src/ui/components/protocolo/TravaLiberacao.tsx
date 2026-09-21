import { Card } from "../Card";
import type { TravaLiberacaoWire } from "../../../http/contracts";
import styles from "./TravaLiberacao.module.css";

interface TravaLiberacaoProps {
  readonly trava: TravaLiberacaoWire;
}

/**
 * Explica por que a liberação está bloqueada (PRD §12.2, item 3; RF-09). O servidor já decidiu
 * `pode_liberar` e cada requisito — este componente só exibe; nunca recalcula a trava no cliente.
 * O pai só monta este componente quando `!trava.pode_liberar` (nada a explicar quando liberável).
 */
export function TravaLiberacao({ trava }: TravaLiberacaoProps) {
  return (
    <Card className={styles.cartao}>
      <h2 className={styles.titulo}>Trava de liberação</h2>
      <p className={styles.motivo}>{trava.motivo ?? "Ainda falta um requisito para liberar esta guia."}</p>
      <ul className={styles.lista}>
        {trava.requisitos.map((requisito) => (
          <li key={requisito.codigo} className={requisito.atendido ? styles.atendido : styles.pendente}>
            <span aria-hidden="true" className={styles.icone}>
              {requisito.atendido ? "✓" : "✗"}
            </span>
            <span>
              <b>{requisito.atendido ? "Atendido: " : "Pendente: "}</b>
              {requisito.descricao}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
