import { useState } from "react";
import { Card } from "../Card";
import { apresentarArea } from "../../../domain/statuses";
import type { ProblemaHistoricoWire } from "../../../http/contracts";
import { formatarValorSePossuirDataDeCalendario } from "../../lib/format";
import { ApiError, decidirRevisao, type PapelSessao } from "../../lib/api";
import styles from "./ProblemasProtocolo.module.css";

interface ProblemasProtocoloProps {
  readonly problemas: readonly ProblemaHistoricoWire[];
  readonly numeroProtocolo: string;
  readonly papelAtual: PapelSessao;
  readonly aoAtualizarProtocolo: () => void;
}

/**
 * Problemas e subproblemas de todas as versões (PRD §12.2, item 4; RF-07). Nada é escondido
 * pelo estado principal: abertos e resolvidos aparecem juntos, resolvidos só ficam visualmente
 * discretos. Cada `<details>` é um elemento real de disclosure — nunca `onClick` em `div`.
 */
export function ProblemasProtocolo({ problemas, numeroProtocolo, papelAtual, aoAtualizarProtocolo }: ProblemasProtocoloProps) {
  const abertos = problemas.filter((problema) => problema.status === "ABERTO");
  const resolvidos = problemas.filter((problema) => problema.status === "RESOLVIDO");
  const ordenados = [...abertos, ...resolvidos];

  return (
    <Card className={styles.cartao}>
      <div className={styles.cabecalho}>
        <div>
          <h2 className={styles.titulo}>Problemas e subproblemas</h2>
          <p className={styles.subtitulo}>Tudo o que a regra encontrou, versão por versão. Nada é escondido pelo estado principal.</p>
        </div>
        <span className={styles.contagem}>
          {abertos.length} aberto{abertos.length === 1 ? "" : "s"} · {resolvidos.length} resolvido{resolvidos.length === 1 ? "" : "s"}
        </span>
      </div>

      {ordenados.length === 0 ? (
        <p className={styles.vazio}>Nenhum problema encontrado nesta guia.</p>
      ) : (
        <div className={styles.lista}>
          {ordenados.map((problema) => (
            <details key={problema.id} open={problema.status === "ABERTO"} className={problema.status === "RESOLVIDO" ? styles.resolvido : styles.aberto}>
              <summary className={styles.resumo}>
                <span className={problema.status === "ABERTO" ? styles.selo : styles.seloResolvido}>
                  {problema.status === "ABERTO" ? `Aberto · ${apresentarArea(problema.area_responsavel)}` : `Resolvido na v${problema.numero_versao_origem}`}
                </span>
                <b className={styles.tituloProblema}>{problema.titulo}</b>
                <span className={styles.codigo}>{problema.codigo}</span>
              </summary>
              <ul className={styles.subproblemas}>
                {problema.subproblemas.map((sub, indice) => (
                  <li key={indice}>
                    {sub.rotulo}: <b>{formatarValorSePossuirDataDeCalendario(sub.valor)}</b>
                  </li>
                ))}
                <li className={styles.referencia}>regra aplicada: {problema.referencia_regra}</li>
              </ul>
              <AcoesRevisao
                problema={problema}
                numeroProtocolo={numeroProtocolo}
                papelAtual={papelAtual}
                aoAtualizarProtocolo={aoAtualizarProtocolo}
              />
            </details>
          ))}
        </div>
      )}
    </Card>
  );
}

function AcoesRevisao({
  problema,
  numeroProtocolo,
  papelAtual,
  aoAtualizarProtocolo,
}: {
  readonly problema: ProblemaHistoricoWire;
  readonly numeroProtocolo: string;
  readonly papelAtual: PapelSessao;
  readonly aoAtualizarProtocolo: () => void;
}) {
  const [executando, setExecutando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (problema.status !== "ABERTO" || problema.acao_recomendada !== "REVISAR" || papelAtual !== "FINANCEIRO") {
    return null;
  }

  async function decidir(decisao: "CONFIRMAR_PROBLEMA" | "INVALIDAR_PROBLEMA") {
    const motivo = window.prompt(
      decisao === "INVALIDAR_PROBLEMA"
        ? "Motivo da invalidação (a evidência já deve estar anexada):"
        : "Motivo da decisão Financeiro:",
    );
    if (!motivo?.trim()) return;
    setExecutando(true);
    setErro(null);
    try {
      await decidirRevisao(numeroProtocolo, { problema_id: problema.id, decisao, motivo: motivo.trim() });
      aoAtualizarProtocolo();
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : "Não foi possível registrar a decisão agora.");
    } finally {
      setExecutando(false);
    }
  }

  return (
    <div className={styles.acoesRevisao}>
      <span className={styles.rotuloAcao}>Decisão Financeiro</span>
      <button type="button" className={styles.botaoAcao} disabled={executando} onClick={() => void decidir("CONFIRMAR_PROBLEMA")}>
        Confirmar pendência
      </button>
      <button type="button" className={styles.botaoAcao} disabled={executando} onClick={() => void decidir("INVALIDAR_PROBLEMA")}>
        Invalidar com evidência
      </button>
      {erro ? <span role="alert" className={styles.erroAcao}>{erro}</span> : null}
    </div>
  );
}
