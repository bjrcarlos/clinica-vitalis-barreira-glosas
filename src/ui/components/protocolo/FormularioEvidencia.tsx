import { useId, useState, type ChangeEvent, type FormEvent } from "react";
import { ApiError } from "../../lib/api";
import type { AnexarEvidenciaResposta } from "../../../http/contracts";
import {
  LIMITE_EVIDENCIA_BYTES,
  TIPOS_MIME_EVIDENCIA_ACEITOS,
  anexarEvidencia,
  formatarTamanhoArquivo,
  rotuloTipoMime,
  tipoMimeAceito,
} from "./evidenciaCliente";
import { agoraBrasiliaLocal, brasiliaLocalParaUtcIso } from "./horarioBrasilia";
import formStyles from "./FormularioCorrecao.module.css";
import styles from "./FormularioEvidencia.module.css";

interface FormularioEvidenciaProps {
  readonly numeroProtocolo: string;
  readonly aoConcluir: (resposta: AnexarEvidenciaResposta) => void;
  readonly aoCancelar: () => void;
}

const ACEITA_ATRIBUTO = TIPOS_MIME_EVIDENCIA_ACEITOS.join(",");
const ROTULO_TIPOS_ACEITOS = TIPOS_MIME_EVIDENCIA_ACEITOS.map(rotuloTipoMime).join(", ");
const LIMITE_LEGIVEL = formatarTamanhoArquivo(LIMITE_EVIDENCIA_BYTES);

/**
 * Formulário de anexar evidência (RF-12, PRD §25.2): tipos aceitos e limite ficam visíveis ANTES
 * de escolher o arquivo (não só como erro depois). Valida tipo e tamanho no cliente assim que o
 * arquivo é escolhido — conveniência de UX; o servidor confere de novo antes e durante a leitura
 * do corpo (PRD §25.2), então esta checagem nunca é a última linha de defesa.
 */
export function FormularioEvidencia({ numeroProtocolo, aoConcluir, aoCancelar }: FormularioEvidenciaProps) {
  const idArquivo = useId();
  const idData = useId();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const [ocorridoEmLocal, setOcorridoEmLocal] = useState(() => agoraBrasiliaLocal());
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);

  function aoEscolherArquivo(evento: ChangeEvent<HTMLInputElement>) {
    const escolhido = evento.target.files?.[0] ?? null;
    setErroEnvio(null);
    if (!escolhido) {
      setArquivo(null);
      setErroArquivo(null);
      return;
    }
    if (!tipoMimeAceito(escolhido.type)) {
      setArquivo(null);
      setErroArquivo(`Tipo não aceito (${escolhido.type || "desconhecido"}). Envie PDF, JPG ou PNG.`);
      return;
    }
    if (escolhido.size > LIMITE_EVIDENCIA_BYTES) {
      setArquivo(null);
      setErroArquivo(`Arquivo tem ${formatarTamanhoArquivo(escolhido.size)} — o limite é ${LIMITE_LEGIVEL}.`);
      return;
    }
    setErroArquivo(null);
    setArquivo(escolhido);
  }

  async function aoSubmeter(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!arquivo) {
      setErroArquivo("Escolha um arquivo antes de anexar.");
      return;
    }
    setErroEnvio(null);
    setEnviando(true);
    setProgresso(0);
    try {
      const resposta = await anexarEvidencia(numeroProtocolo, arquivo, {
        ocorridoEmUtc: brasiliaLocalParaUtcIso(ocorridoEmLocal),
        aoProgredir: setProgresso,
      });
      aoConcluir(resposta);
    } catch (falha) {
      setErroEnvio(falha instanceof ApiError ? falha.message : "Não foi possível anexar a evidência agora.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className={formStyles.form} onSubmit={aoSubmeter}>
      <p className={formStyles.aviso}>Aceita {ROTULO_TIPOS_ACEITOS} · até {LIMITE_LEGIVEL} por arquivo.</p>

      <label className={formStyles.campo} htmlFor={idArquivo}>
        <span>Arquivo *</span>
        <input id={idArquivo} type="file" accept={ACEITA_ATRIBUTO} onChange={aoEscolherArquivo} disabled={enviando} aria-describedby={erroArquivo ? `${idArquivo}-erro` : undefined} />
      </label>
      {erroArquivo ? (
        <p role="alert" id={`${idArquivo}-erro`} className={formStyles.erro}>
          {erroArquivo}
        </p>
      ) : arquivo ? (
        <p className={styles.arquivoEscolhido}>
          {arquivo.name} · {formatarTamanhoArquivo(arquivo.size)}
        </p>
      ) : null}

      <label className={formStyles.campo} htmlFor={idData}>
        <span>Data em que o fato ocorreu *</span>
        <input id={idData} type="datetime-local" value={ocorridoEmLocal} onChange={(evento) => setOcorridoEmLocal(evento.target.value)} disabled={enviando} required />
      </label>
      <p className={styles.explicacaoData}>
        Pode ser retroativa (ex.: um documento que já existia antes de anexar). Fica registrada em separado da data em que este anexo entrou no sistema.
      </p>

      {enviando ? (
        <div className={styles.progresso} role="status" aria-live="polite">
          <div className={styles.progressoTrilho}>
            <div className={styles.progressoPreenchido} style={{ width: `${Math.round(progresso * 100)}%` }} />
          </div>
          <span>Enviando… {Math.round(progresso * 100)}%</span>
        </div>
      ) : null}

      {erroEnvio ? (
        <p role="alert" className={formStyles.erro}>
          {erroEnvio}
        </p>
      ) : null}

      <div className={formStyles.acoes}>
        <button type="button" className={formStyles.cancelar} onClick={aoCancelar} disabled={enviando}>
          Cancelar
        </button>
        <button type="submit" className={formStyles.salvar} disabled={enviando || !arquivo}>
          {enviando ? "Enviando…" : "Anexar evidência"}
        </button>
      </div>
    </form>
  );
}
