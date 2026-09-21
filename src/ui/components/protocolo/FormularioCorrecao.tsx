import { useState, type FormEvent } from "react";
import { CABECALHO_GUIA_CSV } from "../../../domain/parse-csv";
import { ApiError, corrigirProtocolo } from "../../lib/api";
import type { CriarVersaoEntrada, CriarVersaoResposta, GuiaBrutaWire } from "../../../http/contracts";
import { ROTULO_CAMPO_GUIA } from "./campos";
import styles from "./FormularioCorrecao.module.css";

interface FormularioCorrecaoProps {
  readonly numeroProtocolo: string;
  /** Campos brutos da versão atual (`versao.guia_bruta`) — o formulário abre pré-preenchido com eles (RF-10). */
  readonly guiaAtual: GuiaBrutaWire;
  readonly aoConcluir: (resposta: CriarVersaoResposta) => void;
  readonly aoCancelar: () => void;
}

/** `id_guia` nunca muda por correção — é a chave de origem, não um campo editável nesta tela. */
const CAMPOS_EDITAVEIS = CABECALHO_GUIA_CSV.filter((campo) => campo !== "id_guia");

/** Formulário de correção (RF-10, papel SECRETARIA): cria nova versão, com justificativa obrigatória. */
export function FormularioCorrecao({ numeroProtocolo, guiaAtual, aoConcluir, aoCancelar }: FormularioCorrecaoProps) {
  const [valores, setValores] = useState<Record<string, string>>({ ...guiaAtual });
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function definirCampo(campo: string, valor: string) {
    setValores((atual) => ({ ...atual, [campo]: valor }));
  }

  async function aoSubmeter(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const guia = { ...valores, id_guia: guiaAtual.id_guia } as GuiaBrutaWire;
      const resposta = await corrigirProtocolo<CriarVersaoResposta, CriarVersaoEntrada>(numeroProtocolo, {
        guia,
        motivo: motivo.trim(),
      });
      aoConcluir(resposta);
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : "Não foi possível salvar a correção agora.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={aoSubmeter}>
      <p className={styles.aviso}>A correção não altera a versão atual — ela cria uma nova versão e revalida a guia.</p>
      <div className={styles.grade}>
        {CAMPOS_EDITAVEIS.map((campo) => (
          <label key={campo} className={styles.campo}>
            <span>{ROTULO_CAMPO_GUIA[campo] ?? campo}</span>
            {campo === "observacao_recepcao" ? (
              <textarea rows={2} value={valores[campo] ?? ""} onChange={(evento) => definirCampo(campo, evento.target.value)} />
            ) : (
              <input type="text" value={valores[campo] ?? ""} onChange={(evento) => definirCampo(campo, evento.target.value)} />
            )}
          </label>
        ))}
      </div>
      <label className={styles.campo}>
        <span>Justificativa da correção *</span>
        <textarea
          rows={2}
          required
          value={motivo}
          onChange={(evento) => setMotivo(evento.target.value)}
          placeholder="Ex.: paciente trouxe autorização renovada; número e validade atualizados."
        />
      </label>
      {erro ? (
        <p role="alert" className={styles.erro}>
          {erro}
        </p>
      ) : null}
      <div className={styles.acoes}>
        <button type="button" className={styles.cancelar} onClick={aoCancelar} disabled={enviando}>
          Cancelar
        </button>
        <button type="submit" className={styles.salvar} disabled={enviando || motivo.trim() === ""}>
          {enviando ? "Salvando…" : "Salvar correção e revalidar"}
        </button>
      </div>
    </form>
  );
}
