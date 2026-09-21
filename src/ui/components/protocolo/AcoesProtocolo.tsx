import { useState } from "react";
import { Card } from "../Card";
import { FormularioCorrecao } from "./FormularioCorrecao";
import type { CriarVersaoResposta, GuiaBrutaWire, TravaLiberacaoWire } from "../../../http/contracts";
import styles from "./AcoesProtocolo.module.css";

interface AcoesProtocoloProps {
  readonly numeroProtocolo: string;
  readonly trava: TravaLiberacaoWire;
  readonly guiaBrutaAtual: GuiaBrutaWire;
  readonly regrasAplicadas: { readonly versao: string; readonly sha256: string };
  readonly riscoInicialCents: number;
  readonly riscoAtualCents: number;
  readonly liberando: boolean;
  readonly erroLiberacao: string | null;
  readonly aoLiberar: () => void;
  readonly aoCorrigirConcluido: (resposta: CriarVersaoResposta) => void;
}

/**
 * Ações permitidas ao papel atual (PRD §12.2, item 8). O botão "Liberar para envio" aparece
 * sempre — quando bloqueado, fica desabilitado com o motivo ao lado, nunca escondido (RF-09).
 * Quem de fato pode liberar (Financeiro) ou corrigir (Secretaria) é o servidor: ele confere o
 * papel a partir do cookie assinado e devolve `ROLE_NOT_ALLOWED` se a pessoa errada tentar — a
 * interface não esconde a ação por adivinhar um papel que não tem como ler do lado do cliente.
 */
export function AcoesProtocolo({
  numeroProtocolo,
  trava,
  guiaBrutaAtual,
  regrasAplicadas,
  riscoInicialCents,
  riscoAtualCents,
  liberando,
  erroLiberacao,
  aoLiberar,
  aoCorrigirConcluido,
}: AcoesProtocoloProps) {
  const [corrigindo, setCorrigindo] = useState(false);
  const [mensagemCorrecao, setMensagemCorrecao] = useState<string | null>(null);

  function aoConcluirCorrecao(resposta: CriarVersaoResposta) {
    setCorrigindo(false);
    setMensagemCorrecao(`Nova validação (v${resposta.versao.numero_versao}): ${resposta.resultado_validacao.resumo}`);
    aoCorrigirConcluido(resposta);
  }

  return (
    <div className={styles.coluna}>
      <Card className={styles.cartao}>
        <h2 className={styles.titulo}>Liberação</h2>
        <button type="button" className={styles.botaoPrimario} disabled={!trava.pode_liberar || liberando} onClick={aoLiberar} aria-describedby="motivo-trava">
          {liberando ? "Liberando…" : "Liberar para envio"}
        </button>
        {!trava.pode_liberar && (
          <p id="motivo-trava" className={styles.motivoTrava}>
            {trava.motivo}
          </p>
        )}
        {erroLiberacao ? (
          <p role="alert" className={styles.erro}>
            {erroLiberacao}
          </p>
        ) : null}
      </Card>

      <Card className={styles.cartao}>
        <h2 className={styles.titulo}>Corrigir</h2>
        <p className={styles.descricao}>Cria uma nova versão, calcula o diff e revalida — a versão anterior nunca é alterada.</p>
        {!corrigindo && (
          <button type="button" className={styles.botaoSecundario} onClick={() => setCorrigindo(true)}>
            Criar nova versão (corrigir)
          </button>
        )}
        {corrigindo && (
          <FormularioCorrecao
            numeroProtocolo={numeroProtocolo}
            guiaAtual={guiaBrutaAtual}
            aoConcluir={aoConcluirCorrecao}
            aoCancelar={() => setCorrigindo(false)}
          />
        )}
        <p aria-live="polite" className={styles.mensagemRevalidacao}>
          {mensagemCorrecao}
        </p>
      </Card>

      <Card className={styles.detalhes}>
        <b>Detalhes técnicos</b>
        <span>
          regras {regrasAplicadas.versao} · hash {regrasAplicadas.sha256.slice(0, 8)}…
        </span>
        <span>
          risco inicial {riscoInicialCents} ¢ · risco atual {riscoAtualCents} ¢
        </span>
      </Card>
    </div>
  );
}
