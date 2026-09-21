import { Card } from "../Card";
import { apresentarArea } from "../../../domain/statuses";
import type { ProblemaHistoricoWire } from "../../../http/contracts";
import styles from "./ProblemasProtocolo.module.css";

interface ProblemasProtocoloProps {
  readonly problemas: readonly ProblemaHistoricoWire[];
}

/**
 * Problemas e subproblemas de todas as versões (PRD §12.2, item 4; RF-07). Nada é escondido
 * pelo estado principal: abertos e resolvidos aparecem juntos, resolvidos só ficam visualmente
 * discretos. Cada `<details>` é um elemento real de disclosure — nunca `onClick` em `div`.
 */
export function ProblemasProtocolo({ problemas }: ProblemasProtocoloProps) {
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
                    {sub.rotulo}: <b>{sub.valor}</b>
                  </li>
                ))}
                <li className={styles.referencia}>regra aplicada: {problema.referencia_regra}</li>
              </ul>
            </details>
          ))}
        </div>
      )}
    </Card>
  );
}
