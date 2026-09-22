import { Card } from "../Card";
import { formatarDataHoraBrasilia } from "../../lib/format";
import { apresentarArea, apresentarOrigem } from "../../../domain/statuses";
import type { EventoWire, VersaoProtocoloWire } from "../../../http/contracts";
import { ROTULO_CAMPO_GUIA, apresentarTipoEvento, normalizarNomeCampoDiff } from "./campos";
import styles from "./HistoricoProtocolo.module.css";

interface HistoricoProtocoloProps {
  readonly eventos: readonly EventoWire[];
  readonly versoes: readonly VersaoProtocoloWire[];
}

/** Linha do tempo append-only (PRD §12.2, item 7; RF-11). Mais recente primeiro, como commits. */
export function HistoricoProtocolo({ eventos, versoes }: HistoricoProtocoloProps) {
  const ordenados = [...eventos].sort((a, b) => b.ocorrido_em_utc.localeCompare(a.ocorrido_em_utc));
  const versaoPorId = new Map(versoes.map((versao) => [versao.id, versao]));

  return (
    <Card className={styles.cartao}>
      <div>
        <h2 className={styles.titulo}>Histórico</h2>
        <p className={styles.subtitulo}>Cada linha é um evento append-only. Datas em horário de Brasília: quando aconteceu e quando foi registrado.</p>
      </div>

      {ordenados.length === 0 ? (
        <p className={styles.vazio}>Nenhum evento registrado ainda.</p>
      ) : (
        <ol className={styles.linha}>
          {ordenados.map((evento, indice) => {
            const versaoAssociada = evento.guia_versao_id ? versaoPorId.get(evento.guia_versao_id) : undefined;
            const mostrarDiff = evento.tipo === "CORRECAO" && versaoAssociada && versaoAssociada.diff.length > 0;

            return (
              <li key={evento.id} className={styles.evento}>
                <span className={styles.marcador} aria-hidden="true">
                  <i className={indice === 0 ? styles.pontoAtual : styles.ponto} />
                  {indice < ordenados.length - 1 && <span className={styles.trilho} />}
                </span>
                <div className={styles.corpo}>
                  <div className={styles.tituloEvento}>
                    <b>{apresentarTipoEvento(evento.tipo)}</b>
                    <span className={styles.papel}>{apresentarArea(evento.papel)}</span>
                  </div>
                  <p className={styles.metaLinha}>
                    ocorrido {formatarDataHoraBrasilia(evento.ocorrido_em_utc)} · registrado {formatarDataHoraBrasilia(evento.registrado_em_utc)} ·{" "}
                    <em>{evento.ator}</em> · {apresentarOrigem(evento.origem)}
                    {evento.motivo ? (
                      <>
                        {" "}
                        · motivo: <em>“{evento.motivo}”</em>
                      </>
                    ) : null}
                  </p>
                  {mostrarDiff && versaoAssociada && (
                    <dl className={styles.diff}>
                      {versaoAssociada.diff.map((linha, i) => (
                        <div key={i} className={styles.diffLinha}>
                          <dt>{ROTULO_CAMPO_GUIA[normalizarNomeCampoDiff(linha.campo)] ?? linha.campo}</dt>
                          <dd>
                            <s className={styles.antes}>{linha.valor_anterior ?? "—"}</s>
                            <span aria-hidden="true"> → </span>
                            <span className={styles.visuallyHidden}>alterado para</span>
                            <b className={styles.depois}>{linha.valor_novo ?? "—"}</b>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
