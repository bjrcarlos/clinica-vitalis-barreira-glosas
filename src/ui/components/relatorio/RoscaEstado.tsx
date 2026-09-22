import type { ValidacaoStatus } from "../../../domain/statuses";
import styles from "./RoscaEstado.module.css";

interface FatiaEstadoValidacao {
  readonly status_validacao: ValidacaoStatus;
  readonly quantidade: number;
}

interface RoscaEstadoProps {
  readonly distribuicao: readonly FatiaEstadoValidacao[];
}

const RAIO = 70;
const CIRCUNFERENCIA = 2 * Math.PI * RAIO;

/** Ordem fixa de exibição (rosca e legenda), igual à referência aprovada (`design-reference/Dashboard.dc.html`). */
const ORDEM_ESTADOS: readonly ValidacaoStatus[] = ["OK", "CORRIGIR", "REVISAO_HUMANA", "NAO_FATURAR_CONVENIO"];

const COR_ESTADO: Readonly<Record<ValidacaoStatus, string>> = {
  OK: "var(--dado-ok)",
  CORRIGIR: "var(--dado-corrigir)",
  REVISAO_HUMANA: "var(--dado-revisao)",
  NAO_FATURAR_CONVENIO: "var(--dado-nao-faturar)",
};

/**
 * Rótulo curto de legenda — deliberadamente diferente de `apresentarValidacaoStatus`
 * (`src/domain/statuses.ts`, que dá "Não faturar ao convênio"): a legenda compacta da rosca usa
 * "Não faturar", igual à referência aprovada. Puramente de apresentação, sem regra de negócio.
 */
const ROTULO_LEGENDA: Readonly<Record<ValidacaoStatus, string>> = {
  OK: "OK",
  CORRIGIR: "Corrigir",
  REVISAO_HUMANA: "Revisão humana",
  NAO_FATURAR_CONVENIO: "Não faturar",
};

/**
 * Rosca "Estado das guias" (Dashboard) — 4 fatias reais (OK / Corrigir / Revisão humana / Não
 * faturar), vindas de `distribuicao_por_estado_validacao` em `GET /api/report`
 * (`esquemaRelatorioResposta`, `src/http/handlers/report.ts`). Antes desta correção a rosca só
 * desenhava 2 fatias (OK × exige atenção) porque o relatório não expunha a contagem por estado
 * individual — a correção foi expor o dado no servidor (uma consulta SQL agregada), nunca
 * reconstruir no cliente a precedência de status que é regra do motor (`src/rules/engine.ts`).
 *
 * Acessibilidade (obrigatório, `docs/DESIGN.md`): a cor nunca é o único canal — a legenda traz
 * rótulo e número de cada fatia, e o SVG expõe `<title>`/`aria-label` com a distribuição por
 * extenso.
 */
export function RoscaEstado({ distribuicao }: RoscaEstadoProps) {
  const porStatus = new Map(distribuicao.map((fatia) => [fatia.status_validacao, fatia.quantidade]));
  const quantidades = ORDEM_ESTADOS.map((status) => porStatus.get(status) ?? 0);
  const total = quantidades.reduce((soma, quantidade) => soma + quantidade, 0);

  const rotuloAria = `Rosca de estado das guias: ${quantidades[0]} OK, ${quantidades[1]} corrigir, ${quantidades[2]} revisão humana, ${quantidades[3]} não faturar.`;

  let offsetAcumulado = 0;
  const arcos = ORDEM_ESTADOS.map((status, indice) => {
    const fracao = total > 0 ? quantidades[indice] / total : 0;
    const comprimento = CIRCUNFERENCIA * fracao;
    const offset = -offsetAcumulado;
    offsetAcumulado += comprimento;
    return { status, comprimento, offset };
  });

  return (
    <div className={styles.envolt}>
      <svg viewBox="0 0 200 200" width="176" height="176" role="img" aria-label={rotuloAria}>
        <title>{rotuloAria}</title>
        <g transform="rotate(-90 100 100)" fill="none" strokeWidth="18" strokeLinecap="butt">
          {total === 0 ? (
            <circle cx="100" cy="100" r={RAIO} style={{ stroke: "var(--dado-neutro)" }} />
          ) : (
            arcos
              .filter((arco) => arco.comprimento > 0)
              .map((arco) => (
                <circle
                  key={arco.status}
                  cx="100"
                  cy="100"
                  r={RAIO}
                  style={{ stroke: COR_ESTADO[arco.status] }}
                  strokeDasharray={`${arco.comprimento} ${CIRCUNFERENCIA - arco.comprimento}`}
                  strokeDashoffset={arco.offset}
                />
              ))
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
        {ORDEM_ESTADOS.map((status, indice) => (
          <span key={status}>
            <i style={{ background: COR_ESTADO[status] }} />
            {ROTULO_LEGENDA[status]} · {quantidades[indice]}
          </span>
        ))}
      </div>
    </div>
  );
}
