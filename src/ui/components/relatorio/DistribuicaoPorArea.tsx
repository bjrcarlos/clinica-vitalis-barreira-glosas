import { Link } from "react-router-dom";
import type { Area } from "../../../domain/statuses";
import { formatarCentavos, formatarHaDias, formatarRotuloArea } from "../../lib/format";
import type { RelatorioResposta } from "./tipos";
import { EstadoVazio } from "../EstadoVazio";
import { linkPorArea } from "./links";
import styles from "./DistribuicaoPorArea.module.css";

interface DistribuicaoPorAreaProps {
  readonly distribuicao: RelatorioResposta["distribuicao_por_area"];
}

const ORDEM_AREA: readonly Area[] = ["SECRETARIA", "FINANCEIRO", "SISTEMA"];

/** Frase curta do que cada área faz com a pendência (PRD §12.3: "motivos concretos"). */
const DESCRICAO_POR_AREA: Readonly<Record<Area, string>> = {
  SECRETARIA: "corrigir campos, anexar autorização, confirmar dados",
  FINANCEIRO: "revisar ambiguidades, decidir destino, tratar duplicidade",
  SISTEMA: "tarefas automáticas pendentes",
};

/** Fundo por área — reaproveita tokens já existentes (docs/DESIGN.md), sem cor nova. */
const FUNDO_POR_AREA: Readonly<Record<Area, string>> = {
  SECRETARIA: "var(--cor-mint)",
  FINANCEIRO: "var(--cor-revisao-bg)",
  SISTEMA: "var(--cor-divisoria-forte)",
};

/** Cartões "Quem resolve": pendências abertas por área responsável (RF-14). */
export function DistribuicaoPorArea({ distribuicao }: DistribuicaoPorAreaProps) {
  if (distribuicao.length === 0) {
    return <EstadoVazio titulo="Nenhuma pendência aberta" descricao="Todas as áreas estão em dia." />;
  }

  const ordenada = [...distribuicao].sort((a, b) => ORDEM_AREA.indexOf(a.area) - ORDEM_AREA.indexOf(b.area));

  return (
    <div className={styles.lista}>
      {ordenada.map((item) => (
        <Link key={item.area} to={linkPorArea(item.area)} className={styles.cartao} style={{ background: FUNDO_POR_AREA[item.area] }}>
          <span className={styles.cabecalho}>
            <b>{formatarRotuloArea(item.area)}</b>
            <span className={`num ${styles.quantidade}`}>{item.quantidade_tarefas_abertas}</span>
          </span>
          <span className={styles.descricao}>{DESCRICAO_POR_AREA[item.area]}</span>
          <span className={styles.rodape}>
            {formatarCentavos(item.risco_cents)} em risco
            {item.pendencia_mais_antiga_utc ? ` · mais antiga ${formatarHaDias(item.pendencia_mais_antiga_utc)}` : ""}
          </span>
        </Link>
      ))}
    </div>
  );
}
