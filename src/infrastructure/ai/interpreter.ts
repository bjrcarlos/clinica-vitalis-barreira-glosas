import { z } from "zod";
import type { GuiaNormalizada } from "../../domain/guide";
import type { ConjuntoRegras } from "../../domain/rule-set";
import type { InterpretacaoObservacaoIA } from "../../application/validate-guide";

const esquemaSaidaIA = z.object({
  has_operational_signal: z.boolean(),
  category: z.enum([
    "NEW_AUTHORIZATION_NOT_REGISTERED",
    "VERBAL_AUTHORIZATION_OR_PROTOCOL",
    "PRIVATE_BILLING",
    "PROCEDURE_MISMATCH",
    "RESCHEDULE_VALIDITY_CONFLICT",
    "NO_OPERATIONAL_SIGNAL",
  ]),
  summary: z.string().min(1).max(1000),
  requires_human_review: z.boolean(),
  suggested_owner: z.enum(["SECRETARIA", "FINANCEIRO"]),
  evidence_excerpt: z.string().max(500),
});

export interface AiLike {
  run(model: string, input: unknown): Promise<unknown>;
}

export interface ResultadoInterpretacaoIA {
  readonly status: "NAO_EXECUTADA" | "CONCLUIDA" | "FALHOU";
  readonly interpretacao: InterpretacaoObservacaoIA | null;
  readonly modelo: string | null;
  readonly promptVersion: string | null;
  readonly inputJson: string | null;
  readonly outputJson: string | null;
}

const MODELO_PADRAO = "@cf/meta/llama-3.1-8b-instruct";
const VERSAO_PROMPT = "observacao-v1";

function extrairTextoSaida(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw !== null && typeof raw === "object" && "response" in raw && typeof raw.response === "string") return raw.response;
  return JSON.stringify(raw);
}

function extrairJson(texto: string): unknown {
  const limpo = texto.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(limpo); } catch { return null; }
}

export async function interpretarObservacao(
  ai: AiLike | undefined,
  guia: GuiaNormalizada,
  regras: ConjuntoRegras,
): Promise<ResultadoInterpretacaoIA> {
  const observacao = guia.observacao_recepcao.trim();
  if (observacao.length === 0) return { status: "NAO_EXECUTADA", interpretacao: null, modelo: null, promptVersion: null, inputJson: null, outputJson: null };

  const entrada = {
    observacao,
    convenio: guia.convenio,
    data_atendimento: guia.data_atendimento,
    data_lancamento: guia.data_lancamento,
    procedimento_codigo: guia.procedimento_codigo,
    regra: regras.convenios.find((convenio) => convenio.nome === guia.convenio)?.observacao ?? null,
  };
  const inputJson = JSON.stringify(entrada);
  if (ai === undefined) return { status: "FALHOU", interpretacao: null, modelo: MODELO_PADRAO, promptVersion: VERSAO_PROMPT, inputJson, outputJson: null };

  const prompt = [
    "Interprete somente a observação operacional da recepção. Não invente campos.",
    "Responda exclusivamente JSON válido com as chaves do schema fornecido.",
    inputJson,
  ].join("\n");
  try {
    const raw = await ai.run(MODELO_PADRAO, { prompt, temperature: 0, max_tokens: 300 });
    const outputJson = extrairTextoSaida(raw).slice(0, 10000);
    const parsed = esquemaSaidaIA.safeParse(extrairJson(outputJson));
    if (!parsed.success) return { status: "FALHOU", interpretacao: null, modelo: MODELO_PADRAO, promptVersion: VERSAO_PROMPT, inputJson, outputJson };
    return { status: "CONCLUIDA", interpretacao: parsed.data, modelo: MODELO_PADRAO, promptVersion: VERSAO_PROMPT, inputJson, outputJson };
  } catch {
    return { status: "FALHOU", interpretacao: null, modelo: MODELO_PADRAO, promptVersion: VERSAO_PROMPT, inputJson, outputJson: null };
  }
}
