import { CABECALHO_GUIA_CSV } from "../../../domain/parse-csv";

/** As 18 colunas de `guias.csv`, como texto cru — o mesmo formato que a importação envia. */
export type CamposGuia = Record<(typeof CABECALHO_GUIA_CSV)[number], string>;

/** Unidades observadas em `guias.csv` (docs/BASELINE.md) — sugestão, não trava: o domínio trata `unidade` como texto livre. */
export const SUGESTOES_UNIDADE = ["Centro", "Norte", "Sul"] as const;

export const PADRAO_DATA_BR = "\\d{2}/\\d{2}/\\d{4}";
export const PADRAO_VALOR = "(R\\$\\s*)?\\d+([.,]\\d{2})?";
export const PADRAO_INTEIRO = "\\d+";

/** Rótulo de tela de cada coluna — fonte única para o campo do formulário e para a revisão final. */
export const ROTULO_CAMPO: Record<keyof CamposGuia, string> = {
  id_guia: "id_guia (origem)",
  unidade: "Unidade",
  data_atendimento: "Data do atendimento",
  paciente: "Paciente",
  convenio: "Convênio",
  carteirinha: "Carteirinha",
  cid: "CID",
  procedimento_codigo: "Procedimento",
  procedimento_descricao: "Descrição do procedimento",
  numero_autorizacao: "Nº da autorização",
  autorizacao_validade: "Validade da autorização",
  autorizacao_sessoes_limite: "Limite de sessões",
  sessao_numero_na_autorizacao: "Sessão nº",
  profissional: "Profissional",
  profissional_registro: "Registro profissional",
  valor: "Valor",
  observacao_recepcao: "Observação da recepção",
  data_lancamento: "Data de lançamento",
};

/** Uma etapa do cadastro: o que ela pergunta e quais colunas ela responde (a revisão usa `campos`). */
export interface DefinicaoEtapa {
  /** Nome curto na trilha lateral. */
  readonly rotulo: string;
  /** Linha de apoio da trilha — diz o que a etapa cobre, em três ou quatro palavras. */
  readonly legenda: string;
  /** Título grande do painel da etapa. */
  readonly titulo: string;
  readonly apoio: string;
  readonly campos: readonly (keyof CamposGuia)[];
}

/**
 * O formulário inteiro tem 18 campos; numa tela só ele vira um paredão. As três etapas seguem a
 * ordem em que a recepção tem a informação em mãos: quem foi atendido, o que foi feito, quanto
 * custa — e a última mostra a revisão antes de salvar.
 */
export const ETAPAS_NOVA_GUIA: readonly DefinicaoEtapa[] = [
  {
    rotulo: "Atendimento",
    legenda: "Guia, paciente e convênio",
    titulo: "Quem foi atendido",
    apoio: "Identificação da guia, do paciente e do convênio. O convênio define o que os próximos passos vão exigir.",
    campos: ["id_guia", "unidade", "data_atendimento", "paciente", "convenio", "carteirinha"],
  },
  {
    rotulo: "Procedimento",
    legenda: "Autorização e profissional",
    titulo: "O que foi feito",
    apoio: "Procedimento, autorização e profissional responsável.",
    campos: [
      "procedimento_codigo",
      "cid",
      "numero_autorizacao",
      "autorizacao_validade",
      "sessao_numero_na_autorizacao",
      "autorizacao_sessoes_limite",
      "profissional",
      "profissional_registro",
    ],
  },
  {
    rotulo: "Valor e revisão",
    legenda: "Confira antes de salvar",
    titulo: "Valor, lançamento e revisão",
    apoio: "Confira o que foi preenchido antes de salvar — a verificação roda no servidor logo depois.",
    campos: ["valor", "data_lancamento", "observacao_recepcao"],
  },
];

export function hojeDDMMAAAA(): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/** "62,00" (sem "R$") — formato que `normalizarGuia` já reconhece direto, sem símbolo para não obrigar o usuário a apagá-lo. */
export function centavosParaTextoDeValor(centavos: number): string {
  return (centavos / 100).toFixed(2).replace(".", ",");
}

export function estadoInicial(
  convenioPadrao: string,
  procedimentoCodigoPadrao: string,
  procedimentoDescricaoPadrao: string,
  valorPadrao: string,
): CamposGuia {
  return {
    id_guia: "",
    unidade: "",
    data_atendimento: "",
    paciente: "",
    convenio: convenioPadrao,
    carteirinha: "",
    cid: "",
    procedimento_codigo: procedimentoCodigoPadrao,
    procedimento_descricao: procedimentoDescricaoPadrao,
    numero_autorizacao: "",
    autorizacao_validade: "",
    autorizacao_sessoes_limite: "",
    sessao_numero_na_autorizacao: "",
    profissional: "",
    profissional_registro: "",
    valor: valorPadrao,
    observacao_recepcao: "",
    data_lancamento: hojeDDMMAAAA(),
  };
}
