import { describe, expect, it } from "vitest";
import { normalizarGuia } from "../src/domain/normalize";
import { parseCsv, CABECALHO_GUIA_CSV } from "../src/application/import/parse-csv";
import type { GuiaBruta } from "../src/domain/guide";

/** Guia crua válida de referência (espelha `G-2608-0001` de `guias.csv`); testes sobrescrevem só o campo em foco. */
function guiaBrutaValida(sobrescritas: Partial<Record<string, string>> = {}): GuiaBruta {
  return {
    id_guia: "G-2608-0001",
    unidade: "Sul",
    data_atendimento: "2026-08-28",
    paciente: "P-1036",
    convenio: "Vitalcard",
    carteirinha: "884410270",
    cid: "M79.7",
    procedimento_codigo: "50000470",
    procedimento_descricao: "Sessão de fisioterapia musculoesquelética",
    numero_autorizacao: "AUT887507",
    autorizacao_validade: "2026-08-28",
    autorizacao_sessoes_limite: "10",
    sessao_numero_na_autorizacao: "7",
    profissional: "Bruno Castanho",
    profissional_registro: "CREFITO-3 204411-F",
    valor: "62.00",
    observacao_recepcao: "",
    data_lancamento: "2026-08-31",
    ...sobrescritas,
  };
}

describe("normalizarGuia — datas", () => {
  it("aceita YYYY-MM-DD já canônico sem gerar aviso", () => {
    const { guia, avisos } = normalizarGuia(guiaBrutaValida({ data_atendimento: "2026-08-28" }));
    expect(guia.data_atendimento).toBe("2026-08-28");
    expect(avisos).toHaveLength(0);
  });

  it("converte DD/MM/YYYY para YYYY-MM-DD com aviso", () => {
    const { guia, avisos } = normalizarGuia(guiaBrutaValida({ data_atendimento: "28/08/2026" }));
    expect(guia.data_atendimento).toBe("2026-08-28");
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      campo: "data_atendimento",
      valor_original: "28/08/2026",
      valor_normalizado: "2026-08-28",
    });
    expect(avisos[0].motivo).toMatch(/convertido/i);
  });

  it("converte YYYY/MM/DD para YYYY-MM-DD com aviso", () => {
    const { guia, avisos } = normalizarGuia(guiaBrutaValida({ data_atendimento: "2026/08/28" }));
    expect(guia.data_atendimento).toBe("2026-08-28");
    expect(avisos).toHaveLength(1);
    expect(avisos[0].valor_normalizado).toBe("2026-08-28");
  });

  it("mantém o texto original de uma data impossível e avisa, sem normalizar (contrato fixa o campo como string, nunca null)", () => {
    const { guia, avisos } = normalizarGuia(guiaBrutaValida({ autorizacao_validade: "32/13/2026" }));
    expect(guia.autorizacao_validade).toBe("32/13/2026");
    expect(avisos).toHaveLength(1);
    expect(avisos[0].campo).toBe("autorizacao_validade");
    expect(avisos[0].motivo).toMatch(/imposs[ií]vel/i);
  });

  it("mantém o texto original de um formato de data não reconhecido e avisa", () => {
    const { guia, avisos } = normalizarGuia(guiaBrutaValida({ data_lancamento: "31 de agosto de 2026" }));
    expect(guia.data_lancamento).toBe("31 de agosto de 2026");
    expect(avisos[0].motivo).toMatch(/não reconhecido/i);
  });
});

describe("normalizarGuia — dinheiro", () => {
  it("aceita '62.00' já canônico sem gerar aviso", () => {
    const { guia, avisos } = normalizarGuia(guiaBrutaValida({ valor: "62.00" }));
    expect(guia.valor_cents).toBe(6200);
    expect(avisos).toHaveLength(0);
  });

  it("converte vírgula decimal ('62,00') para centavos com aviso", () => {
    const { guia, avisos } = normalizarGuia(guiaBrutaValida({ valor: "62,00" }));
    expect(guia.valor_cents).toBe(6200);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].campo).toBe("valor_cents");
    expect(avisos[0].valor_original).toBe("62,00");
  });

  it("converte 'R$ 62,00' para centavos com aviso", () => {
    const { guia, avisos } = normalizarGuia(guiaBrutaValida({ valor: "R$ 62,00" }));
    expect(guia.valor_cents).toBe(6200);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].valor_original).toBe("R$ 62,00");
  });

  it("nunca perde precisão por ponto flutuante em valores com milhar", () => {
    const { guia } = normalizarGuia(guiaBrutaValida({ valor: "1.234,56" }));
    expect(guia.valor_cents).toBe(123456);
  });

  it("valor monetário não reconhecido vira NaN (nunca 0), com aviso", () => {
    const { guia, avisos } = normalizarGuia(guiaBrutaValida({ valor: "abc" }));
    expect(Number.isNaN(guia.valor_cents)).toBe(true);
    expect(guia.valor_cents).not.toBe(0);
    expect(avisos[0].motivo).toMatch(/nunca assumido como zero/i);
  });
});

describe("normalizarGuia — campos opcionais vazios viram null", () => {
  it("numero_autorizacao vazio vira null, sem aviso", () => {
    const { guia, avisos } = normalizarGuia(guiaBrutaValida({ numero_autorizacao: "" }));
    expect(guia.numero_autorizacao).toBeNull();
    expect(avisos).toHaveLength(0);
  });

  it("cid vazio vira null, sem aviso", () => {
    const { guia, avisos } = normalizarGuia(guiaBrutaValida({ cid: "" }));
    expect(guia.cid).toBeNull();
    expect(avisos).toHaveLength(0);
  });

  it("profissional_registro vazio (só espaços) vira null", () => {
    const { guia } = normalizarGuia(guiaBrutaValida({ profissional_registro: "   " }));
    expect(guia.profissional_registro).toBeNull();
  });
});

describe("normalizarGuia — inteiros obrigatórios (sessões e limite)", () => {
  it("texto vazio nunca vira 0 — fica NaN, com aviso", () => {
    const { guia, avisos } = normalizarGuia(guiaBrutaValida({ autorizacao_sessoes_limite: "" }));
    expect(Number.isNaN(guia.autorizacao_sessoes_limite)).toBe(true);
    expect(guia.autorizacao_sessoes_limite).not.toBe(0);
    expect(avisos[0].motivo).toMatch(/nunca assumido como zero/i);
  });

  it("remove zeros à esquerda com aviso", () => {
    const { guia, avisos } = normalizarGuia(guiaBrutaValida({ sessao_numero_na_autorizacao: "007" }));
    expect(guia.sessao_numero_na_autorizacao).toBe(7);
    expect(avisos[0].campo).toBe("sessao_numero_na_autorizacao");
  });

  it("valor já canônico não gera aviso", () => {
    const { avisos } = normalizarGuia(guiaBrutaValida({ autorizacao_sessoes_limite: "10" }));
    expect(avisos).toHaveLength(0);
  });
});

describe("normalizarGuia — texto preserva acentuação e caixa", () => {
  it("mantém acentos e maiúsculas de paciente, profissional e observação, só faz trim", () => {
    const { guia } = normalizarGuia(
      guiaBrutaValida({
        paciente: "  José da SILVA Júnior  ",
        profissional: "  Dra. Marina LÓPEZ  ",
        observacao_recepcao: "  Confirmado às 14h, sem pendência.  ",
      }),
    );
    expect(guia.paciente).toBe("José da SILVA Júnior");
    expect(guia.profissional).toBe("Dra. Marina LÓPEZ");
    expect(guia.observacao_recepcao).toBe("Confirmado às 14h, sem pendência.");
  });
});

function linhaCsv(campos: readonly string[]): string {
  return campos
    .map((campo) => (/[",\n]/.test(campo) ? `"${campo.replace(/"/g, '""')}"` : campo))
    .join(",");
}

describe("parseCsv", () => {
  it("respeita aspas e vírgula interna a um campo", () => {
    const linhaDados = [
      "G-2608-0002",
      "Sul",
      "2026-08-06",
      "P-1044",
      "Plano Bem",
      "626441373",
      "M51.1",
      "20103301",
      "Consulta ortopédica",
      "AUT320436",
      "2026-08-23",
      "12",
      "1",
      "Dra. Marina Lopes",
      "CRM-SP 112390",
      "90.00",
      "Trouxe exame novo, anexado ao prontuário.",
      "2026-08-08",
    ];
    const texto = [linhaCsv([...CABECALHO_GUIA_CSV]), linhaCsv(linhaDados)].join("\n");

    const { linhas, rejeitadas } = parseCsv(texto);

    expect(rejeitadas).toHaveLength(0);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].observacao_recepcao).toBe("Trouxe exame novo, anexado ao prontuário.");
    expect(linhas[0].id_guia).toBe("G-2608-0002");
    expect(linhas[0].valor).toBe("90.00");
  });

  it("preserva aspas duplicadas escapadas dentro de um campo entre aspas", () => {
    const campoComAspas = 'Paciente disse "não sei" sobre a autorização.';
    const linhaDados = CABECALHO_GUIA_CSV.map((coluna) =>
      coluna === "observacao_recepcao" ? campoComAspas : "x",
    );
    const texto = [linhaCsv([...CABECALHO_GUIA_CSV]), linhaCsv(linhaDados)].join("\n");

    const { linhas } = parseCsv(texto);

    expect(linhas[0].observacao_recepcao).toBe(campoComAspas);
  });

  it("rejeita o arquivo inteiro quando o cabeçalho está errado", () => {
    const cabecalhoErrado = CABECALHO_GUIA_CSV.filter((coluna) => coluna !== "cid"); // falta uma coluna
    const texto = linhaCsv([...cabecalhoErrado]);

    const { linhas, rejeitadas } = parseCsv(texto);

    expect(linhas).toHaveLength(0);
    expect(rejeitadas).toHaveLength(1);
    expect(rejeitadas[0].numero_linha).toBe(1);
    expect(rejeitadas[0].motivo).toMatch(/Cabeçalho inválido/i);
  });

  it("rejeita apenas a linha com número de campos errado, mantendo as demais válidas", () => {
    const linhaValida = CABECALHO_GUIA_CSV.map(() => "x");
    const linhaCurta = "a,b,c"; // menos campos que o cabeçalho
    const texto = [linhaCsv([...CABECALHO_GUIA_CSV]), linhaCsv(linhaValida), linhaCurta].join("\n");

    const { linhas, rejeitadas } = parseCsv(texto);

    expect(linhas).toHaveLength(1);
    expect(rejeitadas).toHaveLength(1);
    expect(rejeitadas[0].numero_linha).toBe(3);
  });

  it("ignora linhas totalmente em branco", () => {
    const linhaValida = CABECALHO_GUIA_CSV.map(() => "x");
    const texto = [linhaCsv([...CABECALHO_GUIA_CSV]), "", linhaCsv(linhaValida), ""].join("\n");

    const { linhas, rejeitadas } = parseCsv(texto);

    expect(linhas).toHaveLength(1);
    expect(rejeitadas).toHaveLength(0);
  });
});
