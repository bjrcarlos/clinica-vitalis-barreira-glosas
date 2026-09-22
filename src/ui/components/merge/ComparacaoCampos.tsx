import type { CampoComparadoMergeWire, CompararMergeResposta } from "../../../http/contracts";
import { Card } from "../Card";
import { rotuloCampoGuia } from "../protocolo/campos";
import { formatarValorSePossuirDataDeCalendario } from "../../lib/format";
import type { LadoProtocolo } from "./SeletorPrincipalMerge";
import styles from "./ComparacaoCampos.module.css";

interface ComparacaoCamposProps {
  readonly resposta: CompararMergeResposta;
  readonly escolhasPorCampo: Readonly<Record<string, LadoProtocolo>>;
  readonly aoEscolherCampo: (campo: string, lado: LadoProtocolo) => void;
}

function exibirValor(valor: string | null): string {
  if (valor === null || valor.trim() === "") return "—";
  return formatarValorSePossuirDataDeCalendario(valor);
}

function plural(quantidade: number, singular: string, plural_: string): string {
  return quantidade === 1 ? singular : plural_;
}

/**
 * Campos iguais entre os dois protocolos (mantidos automaticamente, PRD §26.2, recolhidos por
 * padrão) e divergentes (exigem escolha explícita por campo, com o valor de cada origem e de
 * qual protocolo veio). O servidor já decidiu igualdade — este componente só exibe e coleta.
 */
export function ComparacaoCampos({ resposta, escolhasPorCampo, aoEscolherCampo }: ComparacaoCamposProps) {
  const { protocolo_a, protocolo_b, campos_iguais, campos_divergentes } = resposta;

  return (
    <Card className={styles.cartao}>
      <div className={styles.cabecalho}>
        <h2 className={styles.titulo}>Comparação campo a campo</h2>
        <p className={styles.subtitulo}>
          {campos_iguais.length} {plural(campos_iguais.length, "campo igual", "campos iguais")} mantido{campos_iguais.length === 1 ? "" : "s"} automaticamente ·{" "}
          {campos_divergentes.length} {plural(campos_divergentes.length, "divergente", "divergentes")} para decidir.
        </p>
      </div>

      {campos_divergentes.length === 0 ? (
        <p className={styles.semDivergencia}>Nenhum campo divergente — os dois protocolos têm os mesmos dados nos campos comparados.</p>
      ) : (
        <div className={styles.listaDivergentes}>
          {campos_divergentes.map((campo) => (
            <CampoDivergente
              key={campo.campo}
              campo={campo}
              numeroA={protocolo_a.numero_protocolo}
              numeroB={protocolo_b.numero_protocolo}
              escolhido={escolhasPorCampo[campo.campo] ?? null}
              aoEscolher={(lado) => aoEscolherCampo(campo.campo, lado)}
            />
          ))}
        </div>
      )}

      {campos_iguais.length > 0 && (
        <details className={styles.iguais}>
          <summary>
            {campos_iguais.length} {plural(campos_iguais.length, "campo igual", "campos iguais")} · mantidos automaticamente
          </summary>
          <ul className={styles.listaIguais}>
            {campos_iguais.map((campo) => (
              <li key={campo.campo}>
                <span className={styles.rotuloIgual}>{rotuloCampoGuia(campo.campo)}</span>
                <b>{exibirValor(campo.valor_a)}</b>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

interface CampoDivergenteProps {
  readonly campo: CampoComparadoMergeWire;
  readonly numeroA: string;
  readonly numeroB: string;
  readonly escolhido: LadoProtocolo | null;
  readonly aoEscolher: (lado: LadoProtocolo) => void;
}

function CampoDivergente({ campo, numeroA, numeroB, escolhido, aoEscolher }: CampoDivergenteProps) {
  const nomeGrupo = `merge-campo-${campo.campo}`;
  return (
    <fieldset className={styles.campo}>
      <legend className={styles.rotuloCampo}>{rotuloCampoGuia(campo.campo)}</legend>
      <div className={styles.opcoesCampo}>
        <label className={`${styles.opcaoCampo} ${escolhido === "A" ? styles.opcaoEscolhida : ""}`}>
          <input type="radio" name={nomeGrupo} checked={escolhido === "A"} onChange={() => aoEscolher("A")} aria-label={`Usar ${exibirValor(campo.valor_a)} de ${numeroA}`} />
          <span>
            <b>{exibirValor(campo.valor_a)}</b>
            <small className="num">{numeroA}</small>
          </span>
        </label>
        <label className={`${styles.opcaoCampo} ${escolhido === "B" ? styles.opcaoEscolhida : ""}`}>
          <input type="radio" name={nomeGrupo} checked={escolhido === "B"} onChange={() => aoEscolher("B")} aria-label={`Usar ${exibirValor(campo.valor_b)} de ${numeroB}`} />
          <span>
            <b>{exibirValor(campo.valor_b)}</b>
            <small className="num">{numeroB}</small>
          </span>
        </label>
      </div>
    </fieldset>
  );
}
