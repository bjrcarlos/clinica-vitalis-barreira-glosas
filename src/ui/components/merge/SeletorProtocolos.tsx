import { useState, type FormEvent } from "react";
import { Card } from "../Card";
import styles from "./SeletorProtocolos.module.css";

interface SeletorProtocolosProps {
  readonly numeroAInicial: string;
  readonly numeroBInicial: string;
  readonly comparando: boolean;
  readonly erro: string | null;
  readonly aoComparar: (numeroA: string, numeroB: string) => void;
}

/**
 * Entrada manual da comparação (RF-13, PRD §26: "escolhendo dois protocolos"). Os valores
 * iniciais vêm da querystring quando a tela é aberta a partir de um link pronto (ex.: um botão
 * futuro em "possível duplicidade" na página do protocolo — fora do escopo de arquivo desta
 * tarefa); os campos continuam editáveis para comparar qualquer outro par sem sair da tela.
 */
export function SeletorProtocolos({ numeroAInicial, numeroBInicial, comparando, erro, aoComparar }: SeletorProtocolosProps) {
  const [numeroA, setNumeroA] = useState(numeroAInicial);
  const [numeroB, setNumeroB] = useState(numeroBInicial);

  function aoSubmeter(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    aoComparar(numeroA, numeroB);
  }

  return (
    <Card className={styles.cartao}>
      <form className={styles.form} onSubmit={aoSubmeter}>
        <label className={styles.campo}>
          <span>Protocolo A</span>
          <input
            type="text"
            value={numeroA}
            onChange={(evento) => setNumeroA(evento.target.value)}
            placeholder="VT-26-0027"
            pattern="VT-\d{2}-\d{4}"
            title="Formato VT-AA-NNNN"
            maxLength={10}
            required
          />
        </label>
        <label className={styles.campo}>
          <span>Protocolo B</span>
          <input
            type="text"
            value={numeroB}
            onChange={(evento) => setNumeroB(evento.target.value)}
            placeholder="VT-26-0057"
            pattern="VT-\d{2}-\d{4}"
            title="Formato VT-AA-NNNN"
            maxLength={10}
            required
          />
        </label>
        <button type="submit" className={styles.botao} disabled={comparando}>
          {comparando ? "Comparando…" : "Comparar"}
        </button>
      </form>
      {erro ? (
        <p role="alert" className={styles.erro}>
          {erro}
        </p>
      ) : null}
    </Card>
  );
}
