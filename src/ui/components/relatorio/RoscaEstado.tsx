import styles from "./RoscaEstado.module.css";

interface RoscaEstadoProps {
  readonly ok: number;
  readonly exigemAtencao: number;
}

const RAIO = 70;
const CIRCUNFERENCIA = 2 * Math.PI * RAIO;

/**
 * Rosca "Estado das guias" (Dashboard). SUPOSIÇÃO DECLARADA: `GET /api/report`
 * (`esquemaRelatorioResposta`) não expõe contagem por `ValidacaoStatus` individual
 * (CORRIGIR/REVISAO_HUMANA/NAO_FATURAR_CONVENIO separados) — só o agregado `exigem_atencao`.
 * Como nenhum protocolo `OK` carrega risco nesta fase, `ok = verificadas - exigem_atencao` é
 * exato, não estimado. Por isso a rosca tem 2 fatias reais, não 4 — reconstruir as 4 exigiria
 * repetir no cliente a precedência de status que já é regra do motor (`src/rules/engine.ts`),
 * o que o contrato do projeto proíbe (nenhuma regra de negócio fora do motor).
 */
export function RoscaEstado({ ok, exigemAtencao }: RoscaEstadoProps) {
  const total = ok + exigemAtencao;
  const fracaoOk = total > 0 ? ok / total : 0;
  const compOk = CIRCUNFERENCIA * fracaoOk;
  const compAtencao = CIRCUNFERENCIA - compOk;
  const rotuloAria = `Rosca de estado das guias: ${ok} de ${total} guias OK, ${exigemAtencao} exigem atenção.`;

  return (
    <div className={styles.envolt}>
      <svg viewBox="0 0 200 200" width="176" height="176" role="img" aria-label={rotuloAria}>
        <title>{rotuloAria}</title>
        <g transform="rotate(-90 100 100)" fill="none" strokeWidth="18" strokeLinecap="butt">
          {total === 0 ? (
            <circle cx="100" cy="100" r={RAIO} style={{ stroke: "var(--dado-neutro)" }} />
          ) : (
            <>
              <circle
                cx="100"
                cy="100"
                r={RAIO}
                style={{ stroke: "var(--dado-ok)" }}
                strokeDasharray={`${compOk} ${CIRCUNFERENCIA - compOk}`}
                strokeDashoffset={0}
              />
              <circle
                cx="100"
                cy="100"
                r={RAIO}
                style={{ stroke: "var(--dado-corrigir)" }}
                strokeDasharray={`${compAtencao} ${CIRCUNFERENCIA - compAtencao}`}
                strokeDashoffset={-compOk}
              />
            </>
          )}
        </g>
        <text x="100" y="98" textAnchor="middle" fontSize="38" fontWeight="600" style={{ fill: "var(--cor-texto)", fontFamily: "var(--fonte-titulo)" }} letterSpacing="-1">
          {total}
        </text>
        <text x="100" y="118" textAnchor="middle" fontSize="11" style={{ fill: "var(--cor-texto-3)", fontFamily: "var(--fonte-corpo)" }}>
          guias verificadas
        </text>
      </svg>
      <div className={styles.legenda}>
        <span>
          <i style={{ background: "var(--dado-ok)" }} />
          OK · {ok}
        </span>
        <span>
          <i style={{ background: "var(--dado-corrigir)" }} />
          Exige atenção · {exigemAtencao}
        </span>
      </div>
    </div>
  );
}
