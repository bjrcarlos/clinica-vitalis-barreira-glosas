import { formatarCentavos } from "../../lib/format";
import styles from "./RiscoResumoGrafico.module.css";

interface RiscoResumoGraficoProps {
  readonly inicialCents: number;
  readonly tratadoCents: number;
  readonly pendenteCents: number;
}

const ALTURA_LINHA = 40;
const LARGURA_SVG = 660;
const INICIO_BARRA_X = 96;
const LARGURA_MAXIMA_BARRA = 420;

/**
 * SVG inline próprio (sem biblioteca) para o painel de risco do Dashboard.
 *
 * SUPOSIÇÃO DECLARADA: `GET /api/report` não tem série temporal (nenhum campo semanal/mensal
 * no contrato fixado) — só os totais de RF-14/§27. Por isso este painel não é a "evolução por
 * semana" da referência visual (que exigiria inventar 8 pontos sem dado real por trás); é uma
 * comparação real de detectado × tratado × pendente, os três números que o próprio relatório
 * já expõe, sem nenhum valor fixo no código.
 */
export function RiscoResumoGrafico({ inicialCents, tratadoCents, pendenteCents }: RiscoResumoGraficoProps) {
  const linhas = [
    { rotulo: "Detectado", valorCents: inicialCents, cor: "var(--cor-primaria)" },
    { rotulo: "Tratado", valorCents: tratadoCents, cor: "var(--dado-ok)" },
    { rotulo: "Pendente", valorCents: pendenteCents, cor: "var(--dado-nao-faturar)" },
  ] as const;
  const maior = Math.max(inicialCents, tratadoCents, pendenteCents, 1);
  const alturaTotal = linhas.length * ALTURA_LINHA;
  const rotuloAria = `Risco detectado ${formatarCentavos(inicialCents)}, tratado ${formatarCentavos(tratadoCents)}, pendente ${formatarCentavos(pendenteCents)}.`;

  return (
    <svg viewBox={`0 0 ${LARGURA_SVG} ${alturaTotal}`} width="100%" height={alturaTotal} role="img" aria-label={rotuloAria} className={styles.grafico}>
      <title>{rotuloAria}</title>
      {linhas.map((linha, indice) => {
        const largura = Math.max((linha.valorCents / maior) * LARGURA_MAXIMA_BARRA, 3);
        const y = indice * ALTURA_LINHA;
        return (
          <g key={linha.rotulo} transform={`translate(0 ${y})`}>
            <text x="0" y={ALTURA_LINHA / 2 + 4} fontSize="12" style={{ fill: "var(--cor-texto-2)", fontFamily: "var(--fonte-corpo)" }}>
              {linha.rotulo}
            </text>
            <rect x={INICIO_BARRA_X} y={ALTURA_LINHA / 2 - 8} width={LARGURA_MAXIMA_BARRA} height="16" rx="8" style={{ fill: "var(--trilho)" }} />
            <rect x={INICIO_BARRA_X} y={ALTURA_LINHA / 2 - 8} width={largura} height="16" rx="8" style={{ fill: linha.cor }} />
            <text
              x={INICIO_BARRA_X + LARGURA_MAXIMA_BARRA + 12}
              y={ALTURA_LINHA / 2 + 4}
              fontSize="13"
              fontWeight="600"
              style={{ fill: "var(--cor-texto)", fontFamily: "var(--fonte-titulo)" }}
            >
              {formatarCentavos(linha.valorCents)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
