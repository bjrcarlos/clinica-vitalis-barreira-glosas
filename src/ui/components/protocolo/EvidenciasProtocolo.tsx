import { useState } from "react";
import { Card } from "../Card";
import { EstadoVazio } from "../EstadoVazio";
import { apresentarArea } from "../../../domain/statuses";
import type { EvidenciaWire, AnexarEvidenciaResposta } from "../../../http/contracts";
import type { PapelSessao } from "../../lib/api";
import { formatarDataHoraBrasilia } from "../../lib/format";
import { FormularioEvidencia } from "./FormularioEvidencia";
import { ApiError, invalidarEvidencia } from "../../lib/api";
import { baixarPeloLink, formatarTamanhoArquivo, rotuloTipoMime, solicitarLinkDownload } from "./evidenciaCliente";
import styles from "./EvidenciasProtocolo.module.css";

interface EvidenciasProtocoloProps {
  readonly numeroProtocolo: string;
  /** `undefined` enquanto `GET /api/protocols/:numero` (Fase 2) ainda não popula este campo (ver contracts.ts, nota da Fase 3). */
  readonly evidencias: readonly EvidenciaWire[] | undefined;
  readonly papelAtual: PapelSessao;
  /** Recarrega o detalhe do protocolo depois de um anexo bem-sucedido. */
  readonly aoAtualizarProtocolo: () => void;
}

const PODE_ANEXAR: ReadonlySet<PapelSessao> = new Set(["SECRETARIA", "FINANCEIRO"]);

/**
 * Evidências (RF-12, PRD §19.8/§25). Lista tudo que já foi anexado — inclusive invalidado, riscado
 * com o motivo, nunca removido da lista (RF-12: "arquivos não serão sobrescritos ou excluídos pela
 * interface"). O botão de baixar só pede o link assinado NO MOMENTO DO CLIQUE (PRD §25.3): nunca
 * fica guardado em estado além da duração do clique.
 */
export function EvidenciasProtocolo({ numeroProtocolo, evidencias, papelAtual, aoAtualizarProtocolo }: EvidenciasProtocoloProps) {
  const [anexando, setAnexando] = useState(false);
  const [baixandoId, setBaixandoId] = useState<string | null>(null);
  const [erroDownload, setErroDownload] = useState<string | null>(null);

  const lista = evidencias ?? [];
  const podeAnexar = PODE_ANEXAR.has(papelAtual);

  function aoConcluirAnexo(_resposta: AnexarEvidenciaResposta) {
    setAnexando(false);
    aoAtualizarProtocolo();
  }

  async function aoBaixar(evidencia: EvidenciaWire) {
    setErroDownload(null);
    setBaixandoId(evidencia.id);
    try {
      const url = await solicitarLinkDownload(evidencia.id);
      baixarPeloLink(url, evidencia.nome_exibicao);
    } catch (falha) {
      setErroDownload(falha instanceof ApiError ? falha.message : "Não foi possível preparar o link de download agora.");
    } finally {
      setBaixandoId(null);
    }
  }

  async function aoInvalidar(evidencia: EvidenciaWire) {
    const motivo = window.prompt("Motivo da invalidação da evidência:");
    if (!motivo?.trim()) return;
    setErroDownload(null);
    setBaixandoId(evidencia.id);
    try {
      await invalidarEvidencia(evidencia.id, { motivo: motivo.trim() });
      aoAtualizarProtocolo();
    } catch (falha) {
      setErroDownload(falha instanceof ApiError ? falha.message : "Não foi possível invalidar a evidência agora.");
    } finally {
      setBaixandoId(null);
    }
  }

  return (
    <Card className={styles.cartao}>
      <div className={styles.cabecalho}>
        <div>
          <h2 className={styles.titulo}>Evidências</h2>
          <p className={styles.subtitulo}>PDF, JPG ou PNG até 10 MB. Nada é sobrescrito; uma evidência errada é invalidada com motivo, nunca some da lista.</p>
        </div>
        {!anexando && (
          <button type="button" className={styles.botaoAnexar} onClick={() => setAnexando(true)} disabled={!podeAnexar} aria-describedby={podeAnexar ? undefined : "motivo-sem-anexar"}>
            Anexar evidência
          </button>
        )}
      </div>
      {!podeAnexar && !anexando && (
        <p id="motivo-sem-anexar" className={styles.motivoDesabilitado}>
          Disponível para Secretaria ou Financeiro (identidade atual: {apresentarPapel(papelAtual)}).
        </p>
      )}

      {anexando && <FormularioEvidencia numeroProtocolo={numeroProtocolo} aoConcluir={aoConcluirAnexo} aoCancelar={() => setAnexando(false)} />}

      {lista.length === 0 ? (
        <EstadoVazio titulo="Nenhuma evidência anexada ainda" descricao="Anexe um PDF, JPG ou PNG acima quando houver um documento que comprove uma ação." />
      ) : (
        <ul className={styles.lista}>
          {lista.map((evidencia) => {
            const invalidada = evidencia.invalidada_em_utc !== null;
            return (
              <li key={evidencia.id} className={invalidada ? styles.itemInvalidado : styles.item}>
                <span className={styles.icone} aria-hidden="true">
                  {rotuloTipoMime(evidencia.tipo_mime)}
                </span>
                <div className={styles.corpo}>
                  <div className={styles.linhaNome}>
                    <b className={invalidada ? styles.nomeRiscado : undefined}>{evidencia.nome_exibicao}</b>
                    {invalidada && <span className={styles.seloInvalidada}>Invalidada</span>}
                  </div>
                  <p className={styles.meta}>
                    {formatarTamanhoArquivo(evidencia.tamanho_bytes)} · anexado por {evidencia.anexado_por_principal} ({apresentarArea(evidencia.anexado_por_papel)}) ·{" "}
                    {formatarDataHoraBrasilia(evidencia.anexado_em_utc)}
                  </p>
                  {invalidada && (
                    <p className={styles.motivoInvalidacao}>
                      Motivo da invalidação: {evidencia.motivo_invalidacao ?? "não informado"}
                      {evidencia.invalidada_em_utc ? ` · ${formatarDataHoraBrasilia(evidencia.invalidada_em_utc)}` : ""}
                    </p>
                  )}
                  <details className={styles.detalheTecnico}>
                    <summary>Detalhe técnico</summary>
                    <span>
                      sha256 {evidencia.sha256.slice(0, 12)}… · {evidencia.tipo_mime} · {evidencia.tamanho_bytes} bytes
                    </span>
                  </details>
                </div>
                <div className={styles.acoes}>
                  <button type="button" className={styles.botaoBaixar} onClick={() => aoBaixar(evidencia)} disabled={baixandoId === evidencia.id}>
                    {baixandoId === evidencia.id ? "Preparando…" : "Baixar"}
                  </button>
                  {!invalidada && podeAnexar && (
                    <button type="button" className={styles.botaoInvalidar} onClick={() => void aoInvalidar(evidencia)} disabled={baixandoId === evidencia.id}>
                      Invalidar
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {erroDownload ? (
        <p role="alert" className={styles.motivoInvalidacao}>
          {erroDownload}
        </p>
      ) : null}
    </Card>
  );
}

function apresentarPapel(papel: PapelSessao): string {
  if (papel === "SECRETARIA") return "Secretaria";
  if (papel === "FINANCEIRO") return "Financeiro";
  return "Direção";
}
