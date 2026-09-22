import type { ProtocoloReferenciaMergeWire } from "../../../http/contracts";
import { Card } from "../Card";
import styles from "./SeletorPrincipalMerge.module.css";

/** Qual dos dois lados da comparação (`protocolo_a`/`protocolo_b`) uma escolha se refere. */
export type LadoProtocolo = "A" | "B";

interface SeletorPrincipalMergeProps {
  readonly protocoloA: ProtocoloReferenciaMergeWire;
  readonly protocoloB: ProtocoloReferenciaMergeWire;
  readonly escolhido: LadoProtocolo | null;
  readonly aoEscolher: (lado: LadoProtocolo) => void;
}

function textoPapel(lado: LadoProtocolo, escolhido: LadoProtocolo | null): string {
  if (escolhido === lado) return "Fica como principal — recebe a nova versão.";
  if (escolhido !== null) return "Vira MESCLADA — histórico e evidências continuam acessíveis pelo principal.";
  return "Escolha um dos dois lados para continuar.";
}

/**
 * Escolha do protocolo principal (RF-13, PRD §26 passo 3) — sempre explícita, nunca
 * pré-selecionada por adivinhação: `escolhido` chega `null` e só muda por clique da pessoa.
 */
export function SeletorPrincipalMerge({ protocoloA, protocoloB, escolhido, aoEscolher }: SeletorPrincipalMergeProps) {
  return (
    <Card className={styles.cartao}>
      <fieldset className={styles.fieldset}>
        <legend className={styles.legenda}>Qual protocolo fica como principal?</legend>
        <div className={styles.opcoes}>
          {([
            ["A", protocoloA],
            ["B", protocoloB],
          ] as const).map(([lado, protocolo]) => (
            <label key={lado} className={`${styles.opcao} ${escolhido === lado ? styles.escolhida : ""}`}>
              <input type="radio" name="merge-principal" checked={escolhido === lado} onChange={() => aoEscolher(lado)} />
              <span className={styles.textoOpcao}>
                <b className="num">{protocolo.numero_protocolo}</b>
                <small className={styles.idOrigem}>{protocolo.id_guia_origem ?? "sem id de origem"}</small>
                <small className={styles.papel}>{textoPapel(lado, escolhido)}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </Card>
  );
}
