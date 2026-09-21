import { z } from "zod";
import type { GuiaNormalizada } from "../domain/guide";
import type { ConjuntoRegras, RegraConvenio, RegraProcedimento } from "../domain/rule-set";

/**
 * Motor puro de regras versionadas (RN-01): transforma o texto do `regras_convenio.json`
 * oficial num `ConjuntoRegras` validado e indexado. Sem `fetch`, sem D1, sem relógio — o
 * hash é recebido pronto porque calculá-lo é efeito de plataforma (WebCrypto), não do motor.
 */

/** Campos de `GuiaNormalizada` que uma regra de convênio pode declarar como obrigatórios. */
const CAMPOS_GUIA_NORMALIZADA = [
  "id_guia",
  "unidade",
  "data_atendimento",
  "paciente",
  "convenio",
  "carteirinha",
  "cid",
  "procedimento_codigo",
  "procedimento_descricao",
  "numero_autorizacao",
  "autorizacao_validade",
  "autorizacao_sessoes_limite",
  "sessao_numero_na_autorizacao",
  "profissional",
  "profissional_registro",
  "valor_cents",
  "observacao_recepcao",
  "data_lancamento",
] as const satisfies readonly (keyof GuiaNormalizada)[];

const esquemaDefinicoes = z.object({
  autorizacao_valida: z.string(),
  sessao_numero_na_autorizacao: z.string(),
  prazo_envio_dias: z.string(),
  valor: z.string(),
});

const esquemaProcedimentoOficial = z.object({
  codigo: z.string().min(1),
  descricao: z.string().min(1),
  valor_referencia: z.number().positive(),
});

const esquemaConvenioOficial = z.object({
  nome: z.string().min(1),
  campos_obrigatorios: z.array(z.enum(CAMPOS_GUIA_NORMALIZADA)),
  validade_maxima_autorizacao_dias: z.number().int().positive(),
  limite_sessoes_por_autorizacao: z.number().int().positive(),
  procedimentos_cobertos: z.array(z.string().min(1)),
  prazo_envio_dias: z.number().int().positive(),
  observacao: z.string(),
});

const esquemaRegrasOficial = z.object({
  versao: z.string().min(1),
  definicoes: esquemaDefinicoes,
  procedimentos: z.array(esquemaProcedimentoOficial).min(1),
  convenios: z.array(esquemaConvenioOficial).min(1),
});

/** A fatia de regra aplicável a um par convênio+procedimento — usada por `consultar_regra` (Fase 4) e pela interpretação de IA. */
export interface RegraAplicavelConvenioProcedimento {
  readonly convenio: string;
  /** `null` quando o código de procedimento informado não existe no conjunto de regras. */
  readonly procedimento: RegraProcedimento | null;
  readonly procedimento_coberto: boolean;
  readonly campos_obrigatorios: ReadonlyArray<keyof GuiaNormalizada>;
  readonly validade_maxima_autorizacao_dias: number;
  readonly limite_sessoes_por_autorizacao: number;
  readonly prazo_envio_dias: number;
  readonly observacao: string;
  readonly referencia: { readonly versao: string; readonly sha256: string };
}

/** `ConjuntoRegras` com buscadores indexados por nome de convênio (insensível a caixa/acento) e por código de procedimento. */
export interface ConjuntoRegrasIndexado extends ConjuntoRegras {
  /** Busca por nome de convênio ignorando caixa e acento ("saude interior" resolve "Saúde Interior"). */
  convenioPorNome(nome: string): RegraConvenio | null;
  /** Busca por código exato de procedimento. Nunca lança para código desconhecido — devolve `null`. */
  procedimentoPorCodigo(codigo: string): RegraProcedimento | null;
  /** Fatia de regra aplicável a um convênio+procedimento específicos, ou `null` se o convênio for desconhecido. */
  regraAplicavel(convenioNome: string, procedimentoCodigo: string): RegraAplicavelConvenioProcedimento | null;
}

/**
 * Valida com Zod e monta o `ConjuntoRegras` indexado a partir do texto original de
 * `regras_convenio.json`. Lança `Error` com mensagem útil se o texto não for JSON válido
 * ou não corresponder ao formato oficial esperado.
 */
export function montarConjuntoRegras(textoOriginal: string, sha256: string): ConjuntoRegrasIndexado {
  const bruto = analisarJsonOficial(textoOriginal);

  const procedimentos: readonly RegraProcedimento[] = bruto.procedimentos.map((procedimento) => ({
    codigo: procedimento.codigo,
    descricao: procedimento.descricao,
    valor_referencia_cents: Math.round(procedimento.valor_referencia * 100),
  }));

  const convenios: readonly RegraConvenio[] = bruto.convenios.map((convenio) => ({
    nome: convenio.nome,
    campos_obrigatorios: convenio.campos_obrigatorios,
    validade_maxima_autorizacao_dias: convenio.validade_maxima_autorizacao_dias,
    limite_sessoes_por_autorizacao: convenio.limite_sessoes_por_autorizacao,
    procedimentos_cobertos: convenio.procedimentos_cobertos,
    prazo_envio_dias: convenio.prazo_envio_dias,
    observacao: convenio.observacao,
  }));

  const indiceConvenios = new Map<string, RegraConvenio>();
  for (const convenio of convenios) {
    indiceConvenios.set(chaveNormalizada(convenio.nome), convenio);
  }

  const indiceProcedimentos = new Map<string, RegraProcedimento>();
  for (const procedimento of procedimentos) {
    indiceProcedimentos.set(procedimento.codigo, procedimento);
  }

  const versao = bruto.versao;

  return {
    versao,
    sha256,
    convenios,
    procedimentos,
    definicoes: bruto.definicoes,
    convenioPorNome(nome) {
      return indiceConvenios.get(chaveNormalizada(nome)) ?? null;
    },
    procedimentoPorCodigo(codigo) {
      return indiceProcedimentos.get(codigo) ?? null;
    },
    regraAplicavel(convenioNome, procedimentoCodigo) {
      const convenio = indiceConvenios.get(chaveNormalizada(convenioNome)) ?? null;
      if (convenio === null) {
        return null;
      }
      const procedimento = indiceProcedimentos.get(procedimentoCodigo) ?? null;
      return {
        convenio: convenio.nome,
        procedimento,
        procedimento_coberto: procedimento !== null && convenio.procedimentos_cobertos.includes(procedimento.codigo),
        campos_obrigatorios: convenio.campos_obrigatorios,
        validade_maxima_autorizacao_dias: convenio.validade_maxima_autorizacao_dias,
        limite_sessoes_por_autorizacao: convenio.limite_sessoes_por_autorizacao,
        prazo_envio_dias: convenio.prazo_envio_dias,
        observacao: convenio.observacao,
        referencia: { versao, sha256 },
      };
    },
  };
}

function analisarJsonOficial(textoOriginal: string): z.infer<typeof esquemaRegrasOficial> {
  let json: unknown;
  try {
    json = JSON.parse(textoOriginal);
  } catch (erro: unknown) {
    const detalhe = erro instanceof Error ? erro.message : String(erro);
    throw new Error(`regras_convenio.json invalido: JSON malformado (${detalhe}).`);
  }

  const resultado = esquemaRegrasOficial.safeParse(json);
  if (!resultado.success) {
    const detalhes = resultado.error.issues
      .map((issue) => `${issue.path.join(".") || "(raiz)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`regras_convenio.json invalido: ${detalhes}`);
  }

  return resultado.data;
}

/**
 * Normaliza um nome de convênio para comparação: sem acento, sem caixa, sem espaços nas pontas.
 * Exportada para o motor (`src/rules/coverage.ts`) comparar nomes de convênio com a mesma
 * tolerância usada por `convenioPorNome`, sem precisar do índice completo.
 */
export function chaveNormalizada(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}
