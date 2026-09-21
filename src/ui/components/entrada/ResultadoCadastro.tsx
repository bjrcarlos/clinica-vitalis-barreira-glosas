import { Link } from "react-router-dom";
import { Card } from "../Card";
import { BadgeValidacao } from "../BadgeValidacao";
import { formatarCentavos, formatarRotuloArea } from "../../lib/format";
import type { ProblemaWire, ResultadoValidacaoResumoWire } from "../../../http/contracts";
import styles from "./ResultadoCadastro.module.css";

interface ResultadoCadastroProps {
  readonly numeroProtocolo: string;
  readonly resultado: ResultadoValidacaoResumoWire;
}

function LinhaProblema({ problema }: { readonly problema: ProblemaWire }) {
  return (
    <li className={styles.problema}>
      <div className={styles.problemaCabecalho}>
        <b>{problema.titulo}</b>
        <span className={styles.area}>{formatarRotuloArea(problema.area_responsavel)}</span>
      </div>
      {problema.subproblemas.length > 0 ? (
        <ul className={styles.subproblemas}>
          {problema.subproblemas.map((sub) => (
            <li key={`${sub.rotulo}-${sub.valor}`}>
              {sub.rotulo}: <b>{sub.valor}</b>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Resultado real da validação depois de salvar (RF-02: "o resultado da validação logo após
 * salvar, com link para o protocolo criado") — os dados vêm inteiros do servidor
 * (`CadastrarProtoculoResposta.resultado_validacao`); este componente só apresenta.
 */
export function ResultadoCadastro({ numeroProtocolo, resultado }: ResultadoCadastroProps) {
  return (
    <Card className={styles.card}>
      <div className={styles.cabecalho}>
        <BadgeValidacao status={resultado.status} />
        <span className={styles.risco}>{formatarCentavos(resultado.risco_cents)} em risco</span>
      </div>
      <p className={styles.resumo}>{resultado.resumo}</p>
      {resultado.problemas.length > 0 ? (
        <ul className={styles.listaProblemas}>
          {resultado.problemas.map((problema, indice) => (
            // Código de problema não é único por si (uma guia pode repetir o mesmo código
            // em subproblemas diferentes) — a posição na lista já é estável aqui, é resultado
            // de uma única resposta do servidor, nunca reordenada.
            <LinhaProblema key={`${problema.codigo}-${indice}`} problema={problema} />
          ))}
        </ul>
      ) : null}
      <Link to={`/protocolos/${encodeURIComponent(numeroProtocolo)}`} className={styles.link}>
        Ver protocolo {numeroProtocolo} →
      </Link>
    </Card>
  );
}
