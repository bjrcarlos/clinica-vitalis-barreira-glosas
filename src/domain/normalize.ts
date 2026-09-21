import type { GuiaBruta, GuiaNormalizada, AvisoNormalizacao } from "./guide";

/**
 * Normalização determinística de uma guia crua (RN-08): converte formatos equivalentes de
 * data e dinheiro para a forma canônica do domínio, preservando o valor original em
 * `AvisoNormalizacao` sempre que algo foi reformatado ou não pôde ser interpretado.
 *
 * Puro: nenhuma leitura de relógio, arquivo, rede ou banco. Nunca lança exceção — uma guia
 * malformada gera aviso, não erro; a decisão sobre bloquear ou não é do motor de validação
 * (`src/rules`), nunca desta função.
 *
 * Nota de desvio deliberado: `GuiaNormalizada.data_atendimento`, `.autorizacao_validade`,
 * `.data_lancamento` (string), `.autorizacao_sessoes_limite` e `.sessao_numero_na_autorizacao`
 * (number) são campos não anuláveis no contrato já fixado em `guide.ts` — não é este arquivo
 * que decide isso. Quando o texto de origem é impossível de interpretar, o campo não pode
 * virar `null` sem violar esse contrato: para datas mantém-se o texto original (ainda é um
 * `string` válido) e para os inteiros usa-se `NaN` (ainda é um `number`, e nunca `0`, que
 * seria um valor inventado). Em ambos os casos um `AvisoNormalizacao` documenta o problema.
 */
export function normalizarGuia(bruta: GuiaBruta): {
  guia: GuiaNormalizada;
  avisos: AvisoNormalizacao[];
} {
  const avisos: AvisoNormalizacao[] = [];

  function registrar(
    campo: keyof GuiaNormalizada,
    aviso: Omit<AvisoNormalizacao, "campo"> | null,
  ): void {
    if (aviso !== null) {
      avisos.push({ campo, ...aviso });
    }
  }

  const data_atendimento = normalizarData(bruta.data_atendimento ?? "");
  registrar("data_atendimento", data_atendimento.aviso);

  const autorizacao_validade = normalizarData(bruta.autorizacao_validade ?? "");
  registrar("autorizacao_validade", autorizacao_validade.aviso);

  const data_lancamento = normalizarData(bruta.data_lancamento ?? "");
  registrar("data_lancamento", data_lancamento.aviso);

  const autorizacao_sessoes_limite = normalizarInteiro(
    bruta.autorizacao_sessoes_limite ?? "",
  );
  registrar("autorizacao_sessoes_limite", autorizacao_sessoes_limite.aviso);

  const sessao_numero_na_autorizacao = normalizarInteiro(
    bruta.sessao_numero_na_autorizacao ?? "",
  );
  registrar("sessao_numero_na_autorizacao", sessao_numero_na_autorizacao.aviso);

  const valor = normalizarValor(bruta.valor ?? "");
  registrar("valor_cents", valor.aviso);

  const guia: GuiaNormalizada = {
    id_guia: normalizarObrigatorio(bruta.id_guia),
    unidade: normalizarObrigatorio(bruta.unidade),
    data_atendimento: data_atendimento.valor,
    paciente: normalizarObrigatorio(bruta.paciente),
    convenio: normalizarObrigatorio(bruta.convenio),
    carteirinha: normalizarObrigatorio(bruta.carteirinha),
    cid: normalizarOpcional(bruta.cid),
    procedimento_codigo: normalizarObrigatorio(bruta.procedimento_codigo),
    procedimento_descricao: normalizarObrigatorio(bruta.procedimento_descricao),
    numero_autorizacao: normalizarOpcional(bruta.numero_autorizacao),
    autorizacao_validade: autorizacao_validade.valor,
    autorizacao_sessoes_limite: autorizacao_sessoes_limite.valor,
    sessao_numero_na_autorizacao: sessao_numero_na_autorizacao.valor,
    profissional: normalizarObrigatorio(bruta.profissional),
    profissional_registro: normalizarOpcional(bruta.profissional_registro),
    valor_cents: valor.cents,
    observacao_recepcao: normalizarObrigatorio(bruta.observacao_recepcao),
    data_lancamento: data_lancamento.valor,
  };

  return { guia, avisos };
}

/** Trim simples; nunca gera aviso (não é reformatação, é limpeza básica). Preserva caixa e acentuação. */
function normalizarObrigatorio(bruto: string | undefined): string {
  return (bruto ?? "").trim();
}

/** Trim e, se o resultado for vazio, `null` — para os campos opcionais do domínio. Nunca gera aviso. */
function normalizarOpcional(bruto: string | undefined): string | null {
  const texto = (bruto ?? "").trim();
  return texto === "" ? null : texto;
}

type ResultadoCampo<T> = { readonly valor: T; readonly aviso: Omit<AvisoNormalizacao, "campo"> | null };

const FORMATO_DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const FORMATO_DATA_BR = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const FORMATO_DATA_ISO_BARRA = /^(\d{4})\/(\d{2})\/(\d{2})$/;

function isAnoBissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

/** Dias no mês, calculado sem `Date` (domínio é puro) — devolve 0 para mês fora de 1–12. */
function diasNoMes(ano: number, mes: number): number {
  if (mes === 4 || mes === 6 || mes === 9 || mes === 11) return 30;
  if (mes === 2) return isAnoBissexto(ano) ? 29 : 28;
  if (mes >= 1 && mes <= 12) return 31;
  return 0;
}

function isDataValida(ano: number, mes: number, dia: number): boolean {
  if (mes < 1 || mes > 12) return false;
  if (dia < 1) return false;
  return dia <= diasNoMes(ano, mes);
}

/**
 * Aceita "YYYY-MM-DD", "DD/MM/YYYY" e "YYYY/MM/DD" e converte para "YYYY-MM-DD" (RN-08).
 * Formato não reconhecido ou data impossível (ex.: 32/13/2026) não é normalizado: o campo
 * mantém o texto original e recebe um aviso (ver nota de desvio no topo do arquivo).
 */
function normalizarData(bruto: string): ResultadoCampo<string> {
  const texto = bruto.trim();

  const isoMatch = FORMATO_DATA_ISO.exec(texto);
  const brMatch = FORMATO_DATA_BR.exec(texto);
  const isoBarraMatch = FORMATO_DATA_ISO_BARRA.exec(texto);

  let ano = 0;
  let mes = 0;
  let dia = 0;
  let formatoReconhecido = false;

  if (isoMatch) {
    ano = Number(isoMatch[1]);
    mes = Number(isoMatch[2]);
    dia = Number(isoMatch[3]);
    formatoReconhecido = true;
  } else if (brMatch) {
    dia = Number(brMatch[1]);
    mes = Number(brMatch[2]);
    ano = Number(brMatch[3]);
    formatoReconhecido = true;
  } else if (isoBarraMatch) {
    ano = Number(isoBarraMatch[1]);
    mes = Number(isoBarraMatch[2]);
    dia = Number(isoBarraMatch[3]);
    formatoReconhecido = true;
  }

  if (!formatoReconhecido || !isDataValida(ano, mes, dia)) {
    return {
      valor: bruto,
      aviso: {
        valor_original: bruto,
        valor_normalizado: bruto,
        motivo: formatoReconhecido
          ? "Data impossível (dia/mês/ano inconsistentes entre si); valor original mantido."
          : "Formato de data não reconhecido (esperado YYYY-MM-DD, DD/MM/YYYY ou YYYY/MM/DD); valor original mantido.",
      },
    };
  }

  const canonica = `${String(ano).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;

  if (canonica === texto) {
    return { valor: canonica, aviso: null };
  }

  return {
    valor: canonica,
    aviso: {
      valor_original: bruto,
      valor_normalizado: canonica,
      motivo: "Formato de data convertido para o padrão YYYY-MM-DD.",
    },
  };
}

/**
 * Inteiro sem sinal, sem separador decimal (usado para limite e número de sessão). Texto
 * vazio ou não numérico não normaliza: nunca cai silenciosamente para `0` — o campo recebe
 * `NaN` (ver nota de desvio no topo do arquivo) e um aviso explica o motivo.
 */
function normalizarInteiro(bruto: string): ResultadoCampo<number> {
  const texto = bruto.trim();

  if (!/^\d+$/.test(texto)) {
    return {
      valor: Number.NaN,
      aviso: {
        valor_original: bruto,
        valor_normalizado: bruto,
        motivo:
          texto === ""
            ? "Campo numérico obrigatório vazio; nunca assumido como zero."
            : "Valor numérico não reconhecido.",
      },
    };
  }

  const valor = Number(texto);
  const canonica = String(valor);

  if (canonica === texto) {
    return { valor, aviso: null };
  }

  return {
    valor,
    aviso: {
      valor_original: bruto,
      valor_normalizado: canonica,
      motivo: "Zeros à esquerda removidos do valor numérico.",
    },
  };
}

/**
 * Converte "62.00", "62,00" ou "R$ 62,00" para centavos inteiros, sem passar por ponto
 * flutuante (separa parte inteira e decimal como texto antes de somar). Valor não
 * reconhecido vira `NaN` (nunca `0`) com aviso.
 */
function normalizarValor(bruto: string): { cents: number; aviso: Omit<AvisoNormalizacao, "campo"> | null } {
  const textoOriginal = bruto.trim();
  let texto = textoOriginal.replace(/^r\$\s*/i, "").trim();

  const temVirgula = texto.includes(",");
  const temPonto = texto.includes(".");

  if (temVirgula && temPonto) {
    // "1.234,56": ponto é separador de milhar, vírgula é decimal.
    texto = texto.replace(/\./g, "").replace(",", ".");
  } else if (temVirgula) {
    texto = texto.replace(",", ".");
  }
  // Só ponto (ou nenhum separador): já está no formato "N.NN" ou é um inteiro puro de reais.

  const partes = texto.split(".");
  const parteInteira = partes[0] === "" ? "0" : partes[0];
  let parteDecimal = partes.length > 1 ? partes[1] : "00";
  if (parteDecimal.length === 1) parteDecimal = `${parteDecimal}0`;
  if (parteDecimal.length > 2) parteDecimal = parteDecimal.slice(0, 2);

  const parteInteiraValida = /^\d+$/.test(parteInteira);
  const parteDecimalValida = /^\d{2}$/.test(parteDecimal);

  if (!parteInteiraValida || !parteDecimalValida) {
    return {
      cents: Number.NaN,
      aviso: {
        valor_original: bruto,
        valor_normalizado: bruto,
        motivo: "Valor monetário não reconhecido; nunca assumido como zero.",
      },
    };
  }

  const cents = Number(parteInteira) * 100 + Number(parteDecimal);
  const formaCanonica = `${parteInteira}.${parteDecimal}`;

  if (formaCanonica === textoOriginal) {
    return { cents, aviso: null };
  }

  return {
    cents,
    aviso: {
      valor_original: bruto,
      valor_normalizado: String(cents),
      motivo: "Formato de valor monetário convertido para centavos inteiros.",
    },
  };
}
