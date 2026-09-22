import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, liberarProtocolo, obterProtocolo } from "../lib/api";
import type { CriarVersaoResposta, LiberarProtocoloResposta, ProtocoloDetalheResposta } from "../../http/contracts";
import { CabecalhoProtocolo } from "../components/protocolo/CabecalhoProtocolo";
import { TravaLiberacao } from "../components/protocolo/TravaLiberacao";
import { ProblemasProtocolo } from "../components/protocolo/ProblemasProtocolo";
import { VersaoAtualProtocolo } from "../components/protocolo/VersaoAtualProtocolo";
import { EvidenciasProtocolo } from "../components/protocolo/EvidenciasProtocolo";
import { lerPapelAtual } from "../components/protocolo/identidadeAtual";
import { HistoricoProtocolo } from "../components/protocolo/HistoricoProtocolo";
import { AcoesProtocolo } from "../components/protocolo/AcoesProtocolo";
import styles from "./Protocolo.module.css";

/**
 * Tela do protocolo (design-reference/Protocolo.dc.html, PRD-SDD §12.2). Ordem de leitura fixa:
 * número/estado → próxima ação → trava (quando bloqueada) → problemas → versão atual →
 * evidências → histórico → ações. Toda regra de negócio (validação, trava, diff) já vem pronta
 * do motor via `GET /api/protocols/:numero` — este arquivo só busca, guarda estado e exibe.
 */
export function Protocolo() {
  const { numero } = useParams<{ numero: string }>();
  const [detalhe, setDetalhe] = useState<ProtocoloDetalheResposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [liberando, setLiberando] = useState(false);
  const [erroLiberacao, setErroLiberacao] = useState<string | null>(null);

  const carregar = useCallback(
    async (signal?: AbortSignal) => {
      if (!numero) return;
      setCarregando(true);
      setErroCarga(null);
      try {
        const resposta = await obterProtocolo<ProtocoloDetalheResposta>(numero, signal);
        setDetalhe(resposta);
      } catch (falha) {
        if (falha instanceof ApiError) setErroCarga(falha.message);
        else if (!(falha instanceof DOMException && falha.name === "AbortError")) {
          setErroCarga("Não foi possível carregar este protocolo agora.");
        }
      } finally {
        setCarregando(false);
      }
    },
    [numero],
  );

  useEffect(() => {
    const controlador = new AbortController();
    carregar(controlador.signal);
    return () => controlador.abort();
  }, [carregar]);

  async function aoLiberar() {
    if (!numero) return;
    setErroLiberacao(null);
    setLiberando(true);
    try {
      await liberarProtocolo<LiberarProtocoloResposta>(numero);
      await carregar();
    } catch (falha) {
      setErroLiberacao(falha instanceof ApiError ? falha.message : "Não foi possível liberar agora.");
    } finally {
      setLiberando(false);
    }
  }

  function aoCorrigirConcluido(_resposta: CriarVersaoResposta) {
    // A revalidação já aparece de imediato (mensagem otimista em AcoesProtocolo); recarrega o
    // resto (problemas, trava, histórico) sem navegar/recarregar a página inteira (RF-10).
    void carregar();
  }

  if (carregando && !detalhe) {
    return <p role="status">Carregando protocolo…</p>;
  }

  if (erroCarga && !detalhe) {
    return (
      <div className={styles.erroCarga}>
        <p role="alert">{erroCarga}</p>
        <Link to="/guias">← Voltar para todas as guias</Link>
      </div>
    );
  }

  if (!detalhe) return null;

  const { protocolo, resultado_validacao_atual, versoes, problemas, eventos, trava_liberacao } = detalhe;
  const versaoAtual = versoes.find((versao) => versao.numero_versao === protocolo.numero_versao_atual) ?? versoes[versoes.length - 1];

  return (
    <div className={styles.pagina}>
      <nav className={styles.crumb} aria-label="Caminho">
        <Link to="/guias">Todas as guias</Link>
        <span aria-hidden="true">›</span>
        <b>{protocolo.numero_protocolo}</b>
      </nav>

      <div className={styles.grade}>
        <div className={styles.coluna}>
          <CabecalhoProtocolo
            protocolo={protocolo}
            unidade={versaoAtual?.guia.unidade ?? "—"}
            resultado={resultado_validacao_atual}
            trava={trava_liberacao}
          />
          {!trava_liberacao.pode_liberar && <TravaLiberacao trava={trava_liberacao} />}
          <ProblemasProtocolo
            problemas={problemas}
            numeroProtocolo={protocolo.numero_protocolo}
            papelAtual={lerPapelAtual()}
            aoAtualizarProtocolo={() => void carregar()}
          />
          {versaoAtual && <VersaoAtualProtocolo versao={versaoAtual} />}
          <EvidenciasProtocolo
            numeroProtocolo={protocolo.numero_protocolo}
            evidencias={detalhe.evidencias}
            papelAtual={lerPapelAtual()}
            aoAtualizarProtocolo={() => void carregar()}
          />
          <HistoricoProtocolo eventos={eventos} versoes={versoes} />
        </div>

        {versaoAtual && (
          <AcoesProtocolo
            numeroProtocolo={protocolo.numero_protocolo}
            trava={trava_liberacao}
            guiaBrutaAtual={versaoAtual.guia_bruta}
            regrasAplicadas={resultado_validacao_atual.regras_aplicadas}
            riscoInicialCents={protocolo.risco_inicial_cents}
            riscoAtualCents={protocolo.risco_atual_cents}
            liberando={liberando}
            erroLiberacao={erroLiberacao}
            aoLiberar={aoLiberar}
            aoCorrigirConcluido={aoCorrigirConcluido}
          />
        )}
      </div>
    </div>
  );
}
