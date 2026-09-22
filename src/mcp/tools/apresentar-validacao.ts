import { z } from "zod";
import { apresentarArea, apresentarValidacaoStatus, type ValidacaoStatus } from "../../domain/statuses";
import { formatarCentavos, formatarDataCalendario } from "../../domain/apresentacao";
import type { ResultadoValidacao } from "../../domain/validation";
import { tabela } from "../resposta";

/**
 * Apresentação de um `ResultadoValidacao` compartilhada por `verificar_guia` e `registrar_guia`:
 * as duas tools mostram o mesmo resultado do mesmo motor, então a tabela de problemas e o
 * "próximo passo" saem de um lugar só.
 */

export const esquemaProblemaApresentado = z.object({
  codigo: z.string(),
  titulo: z.string(),
  acao_recomendada: z.enum(["CORRIGIR", "REVISAR", "NAO_FATURAR"]),
  area_responsavel: z.enum(["SECRETARIA", "FINANCEIRO"]),
  area_responsavel_rotulo: z.string(),
  evidencias: z.array(z.object({ rotulo: z.string(), valor: z.string() })),
  referencia_regra: z.string(),
});

export const esquemaValidacaoApresentada = z.object({
  status: z.enum(["OK", "CORRIGIR", "REVISAO_HUMANA", "NAO_FATURAR_CONVENIO"]),
  status_rotulo: z.string(),
  resumo: z.string(),
  risco_cents: z.number().int(),
  risco: z.string(),
  problemas: z.array(esquemaProblemaApresentado),
  campos_ausentes: z.array(z.string()),
  regras_aplicadas: z.object({ versao: z.string(), sha256: z.string(), referencias: z.array(z.string()) }),
  proximo_passo: z.string(),
});
export type ValidacaoApresentada = z.infer<typeof esquemaValidacaoApresentada>;

function proximoPasso(status: ValidacaoStatus, resultado: ResultadoValidacao): string {
  const areas = Array.from(new Set(resultado.problemas.map((p) => apresentarArea(p.area_responsavel))));
  const quem = areas.length > 0 ? areas.join(" e ") : "a área responsável";
  switch (status) {
    case "OK":
      return "Nenhuma pendência. A liberação para envio é feita pela Secretaria na tela do protocolo.";
    case "CORRIGIR":
      return `${quem} corrige os campos indicados na tela do protocolo; o sistema revalida sozinho.`;
    case "REVISAO_HUMANA":
      return `${quem} revisa o caso na tela do protocolo e registra a decisão. O MCP não decide.`;
    case "NAO_FATURAR_CONVENIO":
      return "O Financeiro decide, na tela do protocolo, entre faturar como particular ou cancelar.";
  }
}

/** Monta a parte estruturada que as duas tools compartilham. */
export function apresentarValidacao(resultado: ResultadoValidacao): ValidacaoApresentada {
  const camposAusentes = resultado.problemas
    .filter((p) => p.codigo === "CAMPO_OBRIGATORIO_AUSENTE")
    .flatMap((p) => p.subproblemas.map((s) => s.rotulo));
  return {
    status: resultado.status,
    status_rotulo: apresentarValidacaoStatus(resultado.status),
    resumo: resultado.resumo,
    risco_cents: resultado.risco_cents,
    risco: formatarCentavos(resultado.risco_cents),
    problemas: resultado.problemas.map((p) => ({
      codigo: p.codigo,
      titulo: p.titulo,
      acao_recomendada: p.acao_recomendada,
      area_responsavel: p.area_responsavel,
      area_responsavel_rotulo: apresentarArea(p.area_responsavel),
      evidencias: p.subproblemas.map((s) => ({ rotulo: s.rotulo, valor: formatarDataCalendario(s.valor) })),
      referencia_regra: p.referencia_regra,
    })),
    campos_ausentes: camposAusentes,
    regras_aplicadas: { ...resultado.regras_aplicadas, referencias: [...resultado.regras_aplicadas.referencias] },
    proximo_passo: proximoPasso(resultado.status, resultado),
  };
}

/** Bloco Markdown do resultado: estado, resumo, tabela de problemas, regra e próximo passo. */
export function textoDaValidacao(apresentada: ValidacaoApresentada): string {
  const problemas =
    apresentada.problemas.length === 0
      ? "_Nenhum problema encontrado._"
      : tabela(
          ["Problema", "Evidência", "Quem resolve"],
          apresentada.problemas.map((p) => [
            p.titulo,
            p.evidencias.map((e) => `${e.rotulo}: ${e.valor}`).join("; ") || "—",
            p.area_responsavel_rotulo,
          ]),
        );
  const ausentes = apresentada.campos_ausentes.length > 0 ? `\n\n**Campos que faltam:** ${apresentada.campos_ausentes.join(", ")}` : "";
  return `**Estado: ${apresentada.status_rotulo}** · risco ${apresentada.risco}

${apresentada.resumo}

${problemas}${ausentes}

- Regra aplicada: versão ${apresentada.regras_aplicadas.versao}
- **Próximo passo:** ${apresentada.proximo_passo}`;
}
