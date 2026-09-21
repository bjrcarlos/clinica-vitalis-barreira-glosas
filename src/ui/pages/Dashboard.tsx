import { Link } from "react-router-dom";
import { Card } from "../components/Card";
import { Chip } from "../components/Chip";
import { EstadoVazio } from "../components/EstadoVazio";
import { DistribuicaoPorArea } from "../components/relatorio/DistribuicaoPorArea";
import { KpiCard } from "../components/relatorio/KpiCard";
import { LINK_EXIGEM_ATENCAO, LINK_RISCO_PENDENTE, LINK_TODAS_AS_GUIAS } from "../components/relatorio/links";
import { PendenciasAntigas } from "../components/relatorio/PendenciasAntigas";
import { RiscoResumoGrafico } from "../components/relatorio/RiscoResumoGrafico";
import { RoscaEstado } from "../components/relatorio/RoscaEstado";
import { saudacaoPorHorario } from "../components/relatorio/saudacao";
import { useRelatorio } from "../components/relatorio/useRelatorio";
import { formatarCentavos } from "../lib/format";
import styles from "./Dashboard.module.css";

const ICONE_GUIAS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M8 9h8M8 13h8M8 17h5" />
  </svg>
);
const ICONE_ATENCAO = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 8v5M12 16h.01" />
    <circle cx="12" cy="12" r="9" />
  </svg>
);
const ICONE_RISCO = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v18M16 7.5c0-1.5-1.8-2.5-4-2.5s-4 1-4 2.5 1.8 2.5 4 2.5 4 1 4 2.5-1.8 2.5-4 2.5-4-1-4-2.5" />
  </svg>
);
const ICONE_PENDENTE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4l3 2" />
  </svg>
);

/**
 * Dashboard operacional (design-reference/Dashboard.dc.html). Mesma fonte de dados do
 * Relatório (`GET /api/report`) — nenhum número fixo no código. Duas suposições declaradas:
 * a rosca de estado usa 2 fatias reais (OK × exige atenção), não 4 (ver `RoscaEstado.tsx`);
 * e o painel de risco compara detectado/tratado/pendente em vez da série semanal da referência
 * visual, que não tem dado real por trás no contrato fixado (ver `RiscoResumoGrafico.tsx`).
 */
export function Dashboard() {
  const { relatorio, carregando, erro, recarregar } = useRelatorio();

  if (carregando && !relatorio) {
    return (
      <Card>
        <EstadoVazio titulo="Carregando dashboard…" descricao="Buscando os números mais recentes do banco." />
      </Card>
    );
  }

  if (erro && !relatorio) {
    return (
      <Card>
        <EstadoVazio
          titulo="Não foi possível carregar o dashboard"
          descricao={erro}
          acao={<Chip onClick={recarregar}>Tentar novamente</Chip>}
        />
      </Card>
    );
  }

  if (!relatorio) return null;

  const semGuias = relatorio.guias_verificadas.valor === 0;
  const ok = relatorio.guias_verificadas.valor - relatorio.exigem_atencao.valor;

  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalho}>
        <div>
          <h1 className={styles.titulo}>
            {saudacaoPorHorario()}, <em className={styles.destaque}>Vitalis</em>
          </h1>
          <p className={styles.subtitulo}>O que a barreira segurou antes de chegar ao convênio.</p>
        </div>
        <Chip onClick={recarregar} disabled={carregando}>
          {carregando ? "Atualizando…" : "Atualizar"}
        </Chip>
      </div>

      {semGuias ? (
        <Card>
          <EstadoVazio
            titulo="Nenhuma guia verificada ainda"
            descricao="Importe um arquivo ou cadastre uma guia individual para começar a ver o dashboard."
          />
        </Card>
      ) : (
        <>
          <div className={styles.kpis}>
            <KpiCard
              to={LINK_TODAS_AS_GUIAS}
              variante="verde"
              icone={ICONE_GUIAS}
              rotulo="Guias verificadas"
              valor={String(relatorio.guias_verificadas.valor)}
              legenda={`Regras ${relatorio.regras_aplicadas.versao}`}
            />
            <KpiCard
              to={LINK_EXIGEM_ATENCAO}
              variante="atencao"
              icone={ICONE_ATENCAO}
              rotulo="Exigem atenção"
              valor={String(relatorio.exigem_atencao.valor)}
              legenda="Não estão OK ou têm tarefa bloqueante"
            />
            <KpiCard
              to={LINK_EXIGEM_ATENCAO}
              variante="risco"
              icone={ICONE_RISCO}
              rotulo="Risco detectado"
              valor={formatarCentavos(relatorio.risco_inicial_cents.valor)}
              legenda="Soma inicial, uma vez por protocolo"
            />
            <KpiCard
              to={LINK_RISCO_PENDENTE}
              variante="claro"
              icone={ICONE_PENDENTE}
              rotulo="Risco pendente"
              valor={formatarCentavos(relatorio.risco_pendente_cents.valor)}
              legenda={`${formatarCentavos(relatorio.risco_tratado_cents.valor)} já tratado`}
            />
          </div>

          <div className={styles.grade1}>
            <Card className={styles.painel}>
              <h2 className={styles.tituloCard}>Risco: detectado, tratado e pendente</h2>
              <p className={styles.subCard}>Valores reais do banco, uma vez por protocolo</p>
              <RiscoResumoGrafico
                inicialCents={relatorio.risco_inicial_cents.valor}
                tratadoCents={relatorio.risco_tratado_cents.valor}
                pendenteCents={relatorio.risco_pendente_cents.valor}
              />
            </Card>
            <Card className={styles.painel}>
              <h2 className={styles.tituloCard}>Estado das guias</h2>
              <p className={styles.subCard}>Distribuição das {relatorio.guias_verificadas.valor} guias verificadas</p>
              <RoscaEstado ok={ok} exigemAtencao={relatorio.exigem_atencao.valor} />
            </Card>
          </div>

          <div className={styles.grade2}>
            <Card className={styles.painel}>
              <div className={styles.cabecalhoPainel}>
                <div>
                  <h2 className={styles.tituloCard}>Pendências mais antigas</h2>
                  <p className={styles.subCard}>As que esperam ação há mais tempo</p>
                </div>
                <Link to={LINK_EXIGEM_ATENCAO} className={styles.verTodas}>
                  Ver todas
                </Link>
              </div>
              <PendenciasAntigas pendencias={relatorio.pendencias_mais_antigas} limite={5} />
            </Card>
            <Card className={styles.painel}>
              <h2 className={styles.tituloCard}>Quem resolve</h2>
              <p className={styles.subCard}>Pendências abertas por área responsável</p>
              <DistribuicaoPorArea distribuicao={relatorio.distribuicao_por_area} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
