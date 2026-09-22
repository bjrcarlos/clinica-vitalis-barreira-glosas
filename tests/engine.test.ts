import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { montarConjuntoRegras } from "../src/rules/rule-set";
import { validarGuia } from "../src/rules/engine";
import { normalizarGuia } from "../src/domain/normalize";
import type { GuiaBruta, GuiaNormalizada } from "../src/domain/guide";

// Bateria crítica do motor determinístico (PRD-SDD §30.1). Usa o conjunto de regras REAL
// (regras_convenio.json.txt, nunca editado) e guias sintéticas montadas aqui — nunca fixture
// copiada do CSV, para o teste não herdar acidentalmente um bug do gerador de fixtures.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAMINHO_REGRAS_OFICIAIS = path.resolve(__dirname, "../regras_convenio.json.txt");

// O hash é responsabilidade da infraestrutura (WebCrypto); o motor puro só recebe um já pronto.
const SHA256_FALSO = "0".repeat(64);

function carregarRegras() {
  const textoOficial = readFileSync(CAMINHO_REGRAS_OFICIAIS, "utf-8");
  return montarConjuntoRegras(textoOficial, SHA256_FALSO);
}

// --- Guias base sintéticas, uma por convênio, cada uma válida (status OK) por construção. ---
// Vitalcard: campos_obrigatorios inclui cid; prazo de envio 30 dias; limite 10 sessões;
// cobre 50000470 (fisioterapia musculoesquelética, R$ 62,00).
const GUIA_BASE_VITALCARD: GuiaNormalizada = {
  id_guia: "G-TESTE-0001",
  unidade: "Unidade Centro",
  data_atendimento: "2026-08-10",
  paciente: "Paciente Teste Um",
  convenio: "Vitalcard",
  carteirinha: "1234567890",
  cid: "M54.5",
  procedimento_codigo: "50000470",
  procedimento_descricao: "Sessão de fisioterapia musculoesquelética",
  numero_autorizacao: "AUT-0001",
  autorizacao_validade: "2026-08-20",
  autorizacao_sessoes_limite: 10,
  sessao_numero_na_autorizacao: 3,
  profissional: "Dra. Ana Souza",
  profissional_registro: "CREFITO-12345",
  valor_cents: 6200,
  observacao_recepcao: "",
  data_lancamento: "2026-08-10",
};

function guiaVitalcard(overrides: Partial<GuiaNormalizada> = {}): GuiaNormalizada {
  return { ...GUIA_BASE_VITALCARD, ...overrides };
}

// Saúde Interior: NÃO exige cid (diferença deliberada do Vitalcard, usada no teste 3); validade
// máxima 45 dias; limite 20 sessões; também cobre 50000470.
function guiaSaudeInterior(overrides: Partial<GuiaNormalizada> = {}): GuiaNormalizada {
  return {
    ...GUIA_BASE_VITALCARD,
    convenio: "Saúde Interior",
    cid: null,
    autorizacao_sessoes_limite: 20,
    ...overrides,
  };
}

// Plano Bem: exige cid; prazo de envio 30 dias; limite 12 sessões; NÃO cobre infiltração
// articular (40201015) — usada no teste de procedimento não coberto.
function guiaPlanoBem(overrides: Partial<GuiaNormalizada> = {}): GuiaNormalizada {
  return {
    ...GUIA_BASE_VITALCARD,
    convenio: "Plano Bem",
    procedimento_codigo: "40201015",
    procedimento_descricao: "Infiltração articular",
    valor_cents: 14000,
    autorizacao_sessoes_limite: 12,
    ...overrides,
  };
}

describe("validarGuia — validade da autorização (RN-03, RF-05)", () => {
  it("1. validade inclusiva: atendimento no mesmo dia do vencimento não gera problema", () => {
    const regras = carregarRegras();
    const guia = guiaVitalcard({ data_atendimento: "2026-08-20", autorizacao_validade: "2026-08-20" });

    const resultado = validarGuia(guia, regras, []);

    expect(resultado.problemas.some((p) => p.codigo === "AUTORIZACAO_VENCIDA")).toBe(false);
    expect(resultado.status).toBe("OK");
  });

  it("1b. um dia depois do vencimento gera AUTORIZACAO_VENCIDA", () => {
    const regras = carregarRegras();
    const guia = guiaVitalcard({ data_atendimento: "2026-08-21", autorizacao_validade: "2026-08-20" });

    const resultado = validarGuia(guia, regras, []);

    expect(resultado.problemas.some((p) => p.codigo === "AUTORIZACAO_VENCIDA")).toBe(true);
  });

  it("2. autorização vencida traz subproblemas com as datas e a diferença exata em dias", () => {
    const regras = carregarRegras();
    const guia = guiaVitalcard({ data_atendimento: "2026-08-25", autorizacao_validade: "2026-08-20" });

    const resultado = validarGuia(guia, regras, []);
    const problema = resultado.problemas.find((p) => p.codigo === "AUTORIZACAO_VENCIDA");

    expect(problema).toBeDefined();
    expect(problema?.subproblemas).toEqual([
      { rotulo: "data do atendimento", valor: "2026-08-25" },
      { rotulo: "validade da autorização", valor: "2026-08-20" },
      { rotulo: "dias vencida", valor: "5" },
    ]);
  });

  it("2b. uma validade distante não gera uma janela máxima sem data de concessão", () => {
    const regras = carregarRegras();
    const guia = guiaVitalcard({ autorizacao_validade: "2026-12-31" });

    const resultado = validarGuia(guia, regras, []);

    expect(resultado.problemas.some((p) => p.codigo === "AUTORIZACAO_VALIDADE_ACIMA_DO_MAXIMO")).toBe(false);
    expect(resultado.problemas.some((p) => p.codigo === "PRAZO_ENVIO_EXCEDIDO")).toBe(false);
  });

  it("11. controle negativo: detecta sabotagem que trocar a comparação de inclusiva para exclusiva", () => {
    // Esta suíte falha se `authorization.ts` for alterado de `if (diasJanela < 0)` para
    // `if (diasJanela <= 0)` (ou equivalente) — a sabotagem que tornaria o vencimento no
    // próprio dia um caso de AUTORIZACAO_VENCIDA, violando RN-03. Com a regra correta
    // (inclusiva), o mesmo dia não gera problema e o dia seguinte gera; o teste exige as duas
    // metades juntas para não passar por acidente caso ambos os lados quebrem igual.
    const regras = carregarRegras();

    const noMesmoDia = validarGuia(
      guiaVitalcard({ data_atendimento: "2026-08-20", autorizacao_validade: "2026-08-20" }),
      regras,
      [],
    );
    const umDiaDepois = validarGuia(
      guiaVitalcard({ data_atendimento: "2026-08-21", autorizacao_validade: "2026-08-20" }),
      regras,
      [],
    );

    expect(noMesmoDia.problemas.some((p) => p.codigo === "AUTORIZACAO_VENCIDA")).toBe(false);
    expect(umDiaDepois.problemas.some((p) => p.codigo === "AUTORIZACAO_VENCIDA")).toBe(true);
  });
});

describe("validarGuia — prazo de envio (RN-09)", () => {
  it("aceita o próprio dia limite, contado desde o atendimento", () => {
    const regras = carregarRegras();
    const guia = guiaVitalcard({
      data_atendimento: "2026-08-10",
      data_lancamento: "2026-09-09",
    });

    const resultado = validarGuia(guia, regras, []);

    expect(resultado.problemas.some((p) => p.codigo === "PRAZO_ENVIO_EXCEDIDO")).toBe(false);
  });

  it("gera revisão humana bloqueante quando o lançamento passa do prazo", () => {
    const regras = carregarRegras();
    const guia = guiaVitalcard({
      data_atendimento: "2026-08-10",
      data_lancamento: "2026-09-10",
    });

    const resultado = validarGuia(guia, regras, []);
    const problema = resultado.problemas.find((p) => p.codigo === "PRAZO_ENVIO_EXCEDIDO");

    expect(problema?.acao_recomendada).toBe("REVISAR");
    expect(problema?.area_responsavel).toBe("FINANCEIRO");
    expect(problema?.subproblemas).toContainEqual({ rotulo: "data limite para envio", valor: "2026-09-09" });
    expect(resultado.status).toBe("REVISAO_HUMANA");
    expect(resultado.tarefas).toContainEqual({
      tipo: "PRAZO_ENVIO_EXCEDIDO",
      titulo: "Prazo de envio excedido para Vitalcard",
      area: "FINANCEIRO",
      bloqueante: true,
    });
  });
});

describe("validarGuia — campos obrigatórios variam por convênio (RN-01, RF-05)", () => {
  it("3. cid é obrigatório no Vitalcard e não no Saúde Interior", () => {
    const regras = carregarRegras();

    const semCidVitalcard = validarGuia(guiaVitalcard({ cid: null }), regras, []);
    const semCidSaudeInterior = validarGuia(guiaSaudeInterior({ cid: null }), regras, []);

    expect(semCidVitalcard.problemas.some((p) => p.codigo === "CAMPO_OBRIGATORIO_AUSENTE")).toBe(true);
    expect(semCidSaudeInterior.problemas.some((p) => p.codigo === "CAMPO_OBRIGATORIO_AUSENTE")).toBe(false);
  });
});

describe("validarGuia — limite de sessões (RF-07)", () => {
  it("4. sessão 15 com limite 10 gera LIMITE_SESSOES_EXCEDIDO com os três subproblemas do PRD RF-07", () => {
    const regras = carregarRegras();
    const guia = guiaVitalcard({ sessao_numero_na_autorizacao: 15, autorizacao_sessoes_limite: 10 });

    const resultado = validarGuia(guia, regras, []);
    const problema = resultado.problemas.find((p) => p.codigo === "LIMITE_SESSOES_EXCEDIDO");

    expect(problema).toBeDefined();
    expect(problema?.acao_recomendada).toBe("CORRIGIR");
    expect(problema?.subproblemas).toEqual([
      { rotulo: "sessão registrada", valor: "15" },
      { rotulo: "limite informado na guia", valor: "10" },
      { rotulo: "limite oficial do convênio", valor: "10" },
    ]);
  });
});

describe("validarGuia — cobertura de procedimento (RF-05, RN-06)", () => {
  it("5. infiltração articular no Plano Bem gera NAO_FATURAR_CONVENIO como estado principal", () => {
    const regras = carregarRegras();
    const guia = guiaPlanoBem();

    const resultado = validarGuia(guia, regras, []);

    expect(resultado.problemas.some((p) => p.codigo === "PROCEDIMENTO_NAO_COBERTO")).toBe(true);
    expect(resultado.status).toBe("NAO_FATURAR_CONVENIO");
  });
});

describe("validarGuia — coerência de código, descrição e valor (RF-05)", () => {
  it("6. descrição trocada e valor diferente do de referência geram os dois problemas", () => {
    const regras = carregarRegras();
    const guia = guiaVitalcard({
      procedimento_descricao: "Consulta ortopédica",
      valor_cents: 9999,
    });

    const resultado = validarGuia(guia, regras, []);

    const descricao = resultado.problemas.find((p) => p.codigo === "DESCRICAO_DIVERGENTE");
    const valor = resultado.problemas.find((p) => p.codigo === "VALOR_DIVERGENTE");

    expect(descricao).toBeDefined();
    expect(descricao?.subproblemas).toEqual([
      { rotulo: "descrição na guia", valor: "Consulta ortopédica" },
      { rotulo: "descrição de referência", valor: "Sessão de fisioterapia musculoesquelética" },
    ]);

    expect(valor).toBeDefined();
    expect(valor?.subproblemas).toEqual([
      { rotulo: "valor da guia (centavos)", valor: "9999" },
      { rotulo: "valor de referência (centavos)", valor: "6200" },
    ]);
  });
});

describe("validarGuia — normalização não bloqueia sozinha (RN-08)", () => {
  it("7. datas em DD/MM/YYYY e valor com vírgula geram aviso de normalização e a guia normalizada fica OK", () => {
    const bruta: GuiaBruta = {
      id_guia: "G-TESTE-0002",
      unidade: "Unidade Centro",
      data_atendimento: "10/08/2026",
      paciente: "Paciente Teste Dois",
      convenio: "Vitalcard",
      carteirinha: "1234567890",
      cid: "M54.5",
      procedimento_codigo: "50000470",
      procedimento_descricao: "Sessão de fisioterapia musculoesquelética",
      numero_autorizacao: "AUT-0002",
      autorizacao_validade: "20/08/2026",
      autorizacao_sessoes_limite: "10",
      sessao_numero_na_autorizacao: "3",
      profissional: "Dra. Ana Souza",
      profissional_registro: "CREFITO-12345",
      valor: "62,00",
      observacao_recepcao: "",
      data_lancamento: "2026-08-10",
    };

    const { guia, avisos } = normalizarGuia(bruta);

    // A normalização por si só já produz aviso — antes mesmo de chegar ao motor.
    expect(avisos.map((a) => a.campo).sort()).toEqual(["autorizacao_validade", "data_atendimento", "valor_cents"]);
    expect(guia.data_atendimento).toBe("2026-08-10");
    expect(guia.autorizacao_validade).toBe("2026-08-20");
    expect(guia.valor_cents).toBe(6200);

    const regras = carregarRegras();
    const resultado = validarGuia(guia, regras, []);

    // O aviso de normalização não é, por si só, um problema do motor (RN-08).
    expect(resultado.status).toBe("OK");
    expect(resultado.problemas).toHaveLength(0);
  });
});

describe("validarGuia — composição do estado principal (RN-06)", () => {
  it("8a. corrigir + não faturar termina em NAO_FATURAR_CONVENIO", () => {
    const regras = carregarRegras();
    // Plano Bem, procedimento não coberto (NAO_FATURAR) + cid ausente (CORRIGIR).
    const guia = guiaPlanoBem({ cid: null });

    const resultado = validarGuia(guia, regras, []);

    const codigos = resultado.problemas.map((p) => p.codigo).sort();
    expect(codigos).toEqual(["CAMPO_OBRIGATORIO_AUSENTE", "PROCEDIMENTO_NAO_COBERTO"]);
    expect(resultado.status).toBe("NAO_FATURAR_CONVENIO");
  });

  it("8b. corrigir + revisão humana termina em REVISAO_HUMANA", () => {
    const regras = carregarRegras();
    // Vitalcard, sessão acima do limite (CORRIGIR) + descrição divergente (REVISAR).
    const guia = guiaVitalcard({
      sessao_numero_na_autorizacao: 15,
      procedimento_descricao: "Descrição inventada pela recepção",
    });

    const resultado = validarGuia(guia, regras, []);

    const codigos = resultado.problemas.map((p) => p.codigo).sort();
    expect(codigos).toEqual(["DESCRICAO_DIVERGENTE", "LIMITE_SESSOES_EXCEDIDO"]);
    expect(resultado.status).toBe("REVISAO_HUMANA");
  });
});

describe("validarGuia — risco sem duplicação (RN-05)", () => {
  it("9. três problemas na mesma guia somam o valor uma única vez; guia OK soma zero", () => {
    const regras = carregarRegras();
    const guiaComTresProblemas = guiaVitalcard({
      cid: null, // CAMPO_OBRIGATORIO_AUSENTE
      sessao_numero_na_autorizacao: 15, // LIMITE_SESSOES_EXCEDIDO
      procedimento_descricao: "Descrição inventada pela recepção", // DESCRICAO_DIVERGENTE
    });

    const resultadoComProblemas = validarGuia(guiaComTresProblemas, regras, []);
    expect(resultadoComProblemas.problemas).toHaveLength(3);
    expect(resultadoComProblemas.risco_cents).toBe(guiaComTresProblemas.valor_cents);
    expect(resultadoComProblemas.risco_cents).not.toBe(3 * guiaComTresProblemas.valor_cents);

    const resultadoOk = validarGuia(guiaVitalcard(), regras, []);
    expect(resultadoOk.status).toBe("OK");
    expect(resultadoOk.risco_cents).toBe(0);
  });
});

describe("validarGuia — determinismo (§21.2)", () => {
  it("10. a mesma entrada produz o mesmo resultado serializado em duas execuções", () => {
    const regras = carregarRegras();
    const guia = guiaVitalcard({
      cid: null,
      sessao_numero_na_autorizacao: 15,
      procedimento_descricao: "Descrição inventada pela recepção",
    });

    const primeiraExecucao = validarGuia(guia, regras, []);
    const segundaExecucao = validarGuia(guia, regras, []);

    expect(JSON.stringify(primeiraExecucao)).toBe(JSON.stringify(segundaExecucao));
  });
});
