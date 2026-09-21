import { Link } from "react-router-dom";
import { formatarCentavos, formatarHaDias, formatarRotuloArea } from "../../lib/format";
import type { RelatorioResposta } from "./tipos";
import { BadgeValidacao } from "../BadgeValidacao";
import { EstadoVazio } from "../EstadoVazio";
import { Tabela } from "../Tabela";
import styles from "./PendenciasAntigas.module.css";

interface PendenciasAntigasProps {
  readonly pendencias: RelatorioResposta["pendencias_mais_antigas"];
  /** Corta a lista às N primeiras (mais antigas) — usado no Dashboard, que tem menos espaço vertical. */
  readonly limite?: number;
}

/** Tabela de pendências mais antigas (RF-14), cada linha com link real para o protocolo. */
export function PendenciasAntigas({ pendencias, limite }: PendenciasAntigasProps) {
  if (pendencias.length === 0) {
    return <EstadoVazio titulo="Nenhuma pendência em aberto" descricao="Todas as guias verificadas estão OK." />;
  }

  const ordenadas = [...pendencias].sort((a, b) => a.aberta_desde_utc.localeCompare(b.aberta_desde_utc));
  const visiveis = typeof limite === "number" ? ordenadas.slice(0, limite) : ordenadas;

  return (
    <Tabela caption="Pendências mais antigas, aguardando ação há mais tempo">
      <Tabela.Cabecalho>
        <tr>
          <Tabela.CelulaCabecalho>Protocolo</Tabela.CelulaCabecalho>
          <Tabela.CelulaCabecalho>Próxima ação</Tabela.CelulaCabecalho>
          <Tabela.CelulaCabecalho>Área</Tabela.CelulaCabecalho>
          <Tabela.CelulaCabecalho style={{ textAlign: "right" }}>Valor</Tabela.CelulaCabecalho>
          <Tabela.CelulaCabecalho style={{ textAlign: "right" }}>Há</Tabela.CelulaCabecalho>
        </tr>
      </Tabela.Cabecalho>
      <Tabela.Corpo>
        {visiveis.map((pendencia) => (
          <tr key={pendencia.numero_protocolo}>
            <Tabela.Celula>
              <Link to={`/protocolos/${pendencia.numero_protocolo}`} className={`num ${styles.link}`}>
                {pendencia.numero_protocolo}
              </Link>
              <div className={styles.legenda}>
                {pendencia.id_guia_origem ?? "—"} · {pendencia.unidade}
              </div>
            </Tabela.Celula>
            <Tabela.Celula>
              <BadgeValidacao status={pendencia.status_validacao} />
              <div className={styles.legenda}>{pendencia.resumo}</div>
            </Tabela.Celula>
            <Tabela.Celula>{pendencia.area_responsavel ? formatarRotuloArea(pendencia.area_responsavel) : "—"}</Tabela.Celula>
            <Tabela.CelulaNumerica>{formatarCentavos(pendencia.risco_cents)}</Tabela.CelulaNumerica>
            <Tabela.CelulaNumerica>{formatarHaDias(pendencia.aberta_desde_utc)}</Tabela.CelulaNumerica>
          </tr>
        ))}
      </Tabela.Corpo>
    </Tabela>
  );
}
