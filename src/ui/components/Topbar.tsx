import { useEffect, useState } from "react";
import { formatarDataCurta } from "../lib/format";
import styles from "./Topbar.module.css";

interface RegraAtivaResumo {
  readonly rotulo: string;
}

interface TopbarProps {
  readonly busca: string;
  readonly aoMudarBusca: (valor: string) => void;
  /** Selo "Regras agosto/2026 ativas" (`GET /api/rules`). `undefined`/`null` esconde o selo. */
  readonly regraAtiva?: RegraAtivaResumo | null;
}

const FUSO_BRASILIA = "America/Sao_Paulo";

function diaDaSemanaCapitalizado(data: Date): string {
  const bruto = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: FUSO_BRASILIA }).format(data);
  const semSufixo = bruto.replace("-feira", "");
  return semSufixo.charAt(0).toUpperCase() + semSufixo.slice(1);
}

function horaComRotulo(data: Date): string {
  const hora = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: FUSO_BRASILIA,
  }).format(data);
  return `${hora} · horário de Brasília`;
}

/** Barra superior: busca, selo da regra ativa e relógio com data por extenso (docs/DESIGN.md). */
export function Topbar({ busca, aoMudarBusca, regraAtiva }: TopbarProps) {
  const [agora, setAgora] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className={styles.topo}>
      <label className={styles.busca}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={busca}
          onChange={(evento) => aoMudarBusca(evento.target.value)}
          placeholder="Buscar protocolo, id da guia, paciente…"
          aria-label="Buscar protocolo, id da guia ou paciente"
        />
      </label>
      {regraAtiva ? (
        <span className={styles.selo}>
          <i aria-hidden="true" />
          {regraAtiva.rotulo}
        </span>
      ) : null}
      <div className={styles.relogio}>
        <b>
          {diaDaSemanaCapitalizado(agora)}, {formatarDataCurta(agora.toISOString())}
        </b>
        <br />
        {horaComRotulo(agora)}
      </div>
    </header>
  );
}
