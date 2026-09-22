import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { CompararMergeResposta, ExecutarMergeResposta } from "../../http/contracts";
import { compararMerge, executarMerge, ApiError } from "../lib/api";
import { lerPapelAtual } from "../components/protocolo/identidadeAtual";
import { ComparacaoCampos } from "../components/merge/ComparacaoCampos";
import { SeletorPrincipalMerge, type LadoProtocolo } from "../components/merge/SeletorPrincipalMerge";
import { SeletorProtocolos } from "../components/merge/SeletorProtocolos";
import styles from "./Merge.module.css";

export function Merge() {
  const [parametros] = useSearchParams();
  const [resposta, setResposta] = useState<CompararMergeResposta | null>(null);
  const [principal, setPrincipal] = useState<LadoProtocolo | null>(null);
  const [escolhas, setEscolhas] = useState<Readonly<Record<string, LadoProtocolo>>>({});
  const [comparando, setComparando] = useState(false);
  const [executando, setExecutando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<ExecutarMergeResposta | null>(null);

  if (lerPapelAtual() !== "FINANCEIRO") {
    return (
      <div className={styles.pagina}>
        <h1 className={styles.titulo}>Merge de duplicidades</h1>
        <p className={styles.aviso}>Somente o Financeiro pode comparar e mesclar protocolos.</p>
      </div>
    );
  }

  async function aoComparar(numeroA: string, numeroB: string) {
    setComparando(true);
    setErro(null);
    setSucesso(null);
    try {
      const resultado = await compararMerge<CompararMergeResposta>({ numero_protocolo_a: numeroA.trim(), numero_protocolo_b: numeroB.trim() });
      setResposta(resultado);
      setPrincipal(null);
      setEscolhas({});
    } catch (falha) {
      setResposta(null);
      setErro(falha instanceof ApiError ? falha.message : "Não foi possível comparar os protocolos agora.");
    } finally {
      setComparando(false);
    }
  }

  function aoEscolherCampo(campo: string, lado: LadoProtocolo) {
    setEscolhas((atual) => ({ ...atual, [campo]: lado }));
  }

  async function aoExecutar() {
    if (!resposta || principal === null) return;
    if (!resposta.suspeita_duplicidade_aberta) {
      setErro("O servidor não encontrou uma suspeita de duplicidade aberta para estes protocolos.");
      return;
    }
    const faltantes = resposta.campos_divergentes.filter((campo) => escolhas[campo.campo] === undefined);
    if (faltantes.length > 0) {
      setErro("Escolha um valor para cada campo divergente antes de executar o merge.");
      return;
    }
    const motivo = window.prompt("Justificativa do merge:");
    if (!motivo?.trim()) return;
    setExecutando(true);
    setErro(null);
    try {
      const numeroPrincipal = principal === "A" ? resposta.protocolo_a.numero_protocolo : resposta.protocolo_b.numero_protocolo;
      const numeroOrigem = principal === "A" ? resposta.protocolo_b.numero_protocolo : resposta.protocolo_a.numero_protocolo;
      const resolucao_campos = resposta.campos_divergentes.map((campo) => {
        const lado = escolhas[campo.campo];
        return { campo: campo.campo, valor_escolhido: lado === "A" ? campo.valor_a : campo.valor_b };
      });
      const resultado = await executarMerge<ExecutarMergeResposta>({
        numero_protocolo_principal: numeroPrincipal,
        numero_protocolo_origem: numeroOrigem,
        resolucao_campos,
        motivo: motivo.trim(),
      });
      setSucesso(resultado);
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : "Não foi possível executar o merge agora.");
    } finally {
      setExecutando(false);
    }
  }

  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalho}>
        <div>
          <Link to="/guias" className={styles.voltar}>← Todas as guias</Link>
          <h1 className={styles.titulo}>Merge de duplicidades</h1>
          <p className={styles.subtitulo}>Compare, escolha o principal e resolva cada divergência. Nada do histórico é apagado.</p>
        </div>
      </div>

      <SeletorProtocolos
        numeroAInicial={parametros.get("a") ?? "VT-26-0057"}
        numeroBInicial={parametros.get("b") ?? "VT-26-0076"}
        comparando={comparando}
        erro={null}
        aoComparar={(numeroA, numeroB) => void aoComparar(numeroA, numeroB)}
      />

      {erro ? <p role="alert" className={styles.erro}>{erro}</p> : null}
      {resposta ? (
        <>
          {!resposta.suspeita_duplicidade_aberta ? <p className={styles.aviso}>Não há suspeita de duplicidade aberta para esse par.</p> : null}
          <SeletorPrincipalMerge protocoloA={resposta.protocolo_a} protocoloB={resposta.protocolo_b} escolhido={principal} aoEscolher={setPrincipal} />
          <ComparacaoCampos resposta={resposta} escolhasPorCampo={escolhas} aoEscolherCampo={aoEscolherCampo} />
          <button type="button" className={styles.botaoPrincipal} disabled={executando || principal === null} onClick={() => void aoExecutar()}>
            {executando ? "Executando merge…" : "Executar merge"}
          </button>
        </>
      ) : null}

      {sucesso ? (
        <div className={styles.sucesso} role="status">
          <b>Merge concluído</b>
          <span>Principal: {sucesso.merge.numero_protocolo_principal} · versão {sucesso.merge.numero_versao_resultante}</span>
          <Link to={"/protocolos/" + encodeURIComponent(sucesso.merge.numero_protocolo_principal)}>Abrir protocolo principal</Link>
        </div>
      ) : null}
    </div>
  );
}
