import { Link } from "react-router-dom";
import { Card } from "../components/Card";
import { Chip } from "../components/Chip";
import { EstadoVazio } from "../components/EstadoVazio";
import { BlocoDestinoRisco } from "../components/relatorio/BlocoDestinoRisco";
import { BlocoRelatorio } from "../components/relatorio/BlocoRelatorio";
import { DistribuicaoPorArea } from "../components/relatorio/DistribuicaoPorArea";
import { LINK_EXIGEM_ATENCAO, LINK_RISCO_PENDENTE, LINK_TODAS_AS_GUIAS } from "../components/relatorio/links";
import { PendenciasAntigas } from "../components/relatorio/PendenciasAntigas";
import { PrincipaisMotivos } from "../components/relatorio/PrincipaisMotivos";
import { saudacaoPorHorario } from "../components/relatorio/saudacao";
import { useRelatorio } from "../components/relatorio/useRelatorio";
import { formatarCentavos, formatarDataHoraBrasilia } from "../lib/format";
import styles from "./Relatorio.module.css";

/**
 * Relatório executivo (RF-14, design-reference/Relatorio.dc.html). Todos os números vêm de
 * `GET /api/report` — nenhum valor fixo no código. Ver `src/ui/components/relatorio/links.ts`
 * para a suposição declarada sobre como cada bloco reconcilia com a lista filtrada.
 */
export function Relatorio() {
  const { relatorio, carregando, erro, recarregar } = useRelatorio();

  if (carregando && !relatorio) {
    return (
      <Card>
        <EstadoVazio titulo="Carregando relatório…" descricao="Buscando os números mais recentes do banco." />
      </Card>
    );
  }

  if (erro && !relatorio) {
    return (
      <Card>
        <EstadoVazio
          titulo="Não foi possível carregar o relatório"
          descricao={erro}
          acao={<Chip onClick={recarregar}>Tentar novamente</Chip>}
        />
      </Card>
    );
  }

  if (!relatorio) return null;

  const semGuias = relatorio.guias_verificadas.valor === 0;

  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalho}>
        <div>
          <h1 className={styles.titulo}>
            {saudacaoPorHorario()}, <em className={styles.destaque}>Vitalis</em>
          </h1>
          <p className={styles.subtitulo}>
            O que a barreira verificou antes de qualquer guia chegar ao convênio. Clique num bloco para ver quais
            guias compõem o número.
          </p>
        </div>
        <Chip onClick={recarregar} disabled={carregando}>
          {carregando ? "Atualizando…" : "Atualizar"}
        </Chip>
      </div>

      {semGuias ? (
        <Card>
          <EstadoVazio
            titulo="Nenhuma guia verificada ainda"
            descricao="Importe um arquivo ou cadastre uma guia individual para começar a ver o relatório."
            acao={
              <div className={styles.acoesVazio}>
                <Link to="/importar" className={styles.linkAcao}>
                  Importar guias
                </Link>
                <Link to="/nova-guia" className={styles.linkAcao}>
                  Cadastrar guia
                </Link>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <div className={styles.blocos}>
            <BlocoRelatorio to={LINK_TODAS_AS_GUIAS} variante="verificadas" indice={1} titulo="Verificadas">
              <BlocoRelatorio.Valor>{relatorio.guias_verificadas.valor}</BlocoRelatorio.Valor>
              <BlocoRelatorio.Descricao>
                guias passaram pelas regras de {relatorio.regras_aplicadas.versao}
              </BlocoRelatorio.Descricao>
            </BlocoRelatorio>
            <BlocoRelatorio to={LINK_EXIGEM_ATENCAO} variante="atencao" indice={2} titulo="Exigem atenção">
              <BlocoRelatorio.Valor>{relatorio.exigem_atencao.valor}</BlocoRelatorio.Valor>
              <BlocoRelatorio.Descricao>não estão OK ou têm tarefa que impede a liberação</BlocoRelatorio.Descricao>
            </BlocoRelatorio>
            <BlocoRelatorio to={LINK_EXIGEM_ATENCAO} variante="risco" indice={3} titulo="Detectado em risco">
              <BlocoRelatorio.Valor tamanho="media">{formatarCentavos(relatorio.risco_inicial_cents.valor)}</BlocoRelatorio.Valor>
              <BlocoRelatorio.Descricao>
                valor das {relatorio.exigem_atencao.valor} guias no momento da detecção · cada guia contada uma vez
              </BlocoRelatorio.Descricao>
            </BlocoRelatorio>
            <BlocoDestinoRisco to={LINK_RISCO_PENDENTE} tratado={relatorio.risco_tratado_cents} pendente={relatorio.risco_pendente_cents} />
          </div>

          <div className={styles.paineis}>
            <Card className={styles.painel}>
              <h2 className={styles.tituloCard}>Principais motivos</h2>
              <p className={styles.subCard}>Ocorrências nas guias verificadas · uma guia pode ter mais de um</p>
              <PrincipaisMotivos motivos={relatorio.principais_motivos} />
            </Card>
            <Card className={styles.painel}>
              <h2 className={styles.tituloCard}>Quem resolve</h2>
              <p className={styles.subCard}>Pendências abertas por área responsável</p>
              <DistribuicaoPorArea distribuicao={relatorio.distribuicao_por_area} />
            </Card>
            <Card className={styles.painel}>
              <div className={styles.cabecalhoPainel}>
                <div>
                  <h2 className={styles.tituloCard}>Pendências mais antigas</h2>
                  <p className={styles.subCard}>Aguardando ação há mais tempo</p>
                </div>
                <Link to={LINK_EXIGEM_ATENCAO} className={styles.verTodas}>
                  Ver todas →
                </Link>
              </div>
              <PendenciasAntigas pendencias={relatorio.pendencias_mais_antigas} />
            </Card>
          </div>

          <p className={styles.rodape}>
            Regras {relatorio.regras_aplicadas.versao} · gerado em {formatarDataHoraBrasilia(relatorio.gerado_em_utc)}
          </p>
        </>
      )}
    </div>
  );
}
