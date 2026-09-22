import { describe, expect, it } from "vitest";
import {
  formatarCentavos,
  formatarDataCurta,
  formatarDataHoraBrasilia,
  formatarHaDias,
  formatarRotuloArea,
  formatarRotuloFluxoStatus,
  formatarRotuloValidacaoStatus,
} from "../src/ui/lib/format";

describe("formatarDataCurta — fuso America/Sao_Paulo", () => {
  it("formata um instante que cai no mesmo dia em Brasília", () => {
    // 2026-09-20T18:00:00Z - 3h = 15:00 em Brasília, ainda dia 20.
    expect(formatarDataCurta("2026-09-20T18:00:00.000Z")).toBe("20/09/2026");
  });

  it("vira o dia anterior em Brasília para um instante UTC de madrugada", () => {
    // 2026-09-20T02:00:00Z - 3h = 2026-09-19T23:00:00 em Brasília: dia anterior ao UTC.
    expect(formatarDataCurta("2026-09-20T02:00:00.000Z")).toBe("19/09/2026");
  });
});

describe("formatarDataHoraBrasilia", () => {
  it("inclui data, hora, minuto, segundo e o rótulo do fuso", () => {
    expect(formatarDataHoraBrasilia("2026-09-20T18:05:07.000Z")).toBe(
      "20/09/2026 15:05:07 · horário de Brasília",
    );
  });

  it("também vira o dia anterior na virada de fuso", () => {
    expect(formatarDataHoraBrasilia("2026-09-20T02:30:00.000Z")).toBe(
      "19/09/2026 23:30:00 · horário de Brasília",
    );
  });
});

describe("formatarCentavos", () => {
  // Intl.NumberFormat("pt-BR", { style: "currency" }) separa "R$" do valor com um espaço
  // inquebrável (U+00A0); o formatador do domínio troca por espaço comum, que lê e copia igual
  // em tela, em Markdown e no MCP.
  const RCS = "R$ ";

  it("formata centavos inteiros com separador de milhar e vírgula decimal", () => {
    // Mesmo valor do risco inicial semeado (docs/BASELINE.md): 372.600 centavos.
    expect(formatarCentavos(372_600)).toBe(`${RCS}3.726,00`);
  });

  it("formata um valor sem milhar", () => {
    expect(formatarCentavos(7000)).toBe(`${RCS}70,00`);
  });

  it("formata zero", () => {
    expect(formatarCentavos(0)).toBe(`${RCS}0,00`);
  });
});

describe("rótulos com acento a partir do identificador ASCII", () => {
  it("traduz ValidacaoStatus", () => {
    expect(formatarRotuloValidacaoStatus("REVISAO_HUMANA")).toBe("Revisão humana");
    expect(formatarRotuloValidacaoStatus("NAO_FATURAR_CONVENIO")).toBe("Não faturar ao convênio");
  });

  it("traduz FluxoStatus", () => {
    expect(formatarRotuloFluxoStatus("LIBERADA_PARA_ENVIO")).toBe("Liberada para envio");
  });

  it("traduz Area", () => {
    expect(formatarRotuloArea("SECRETARIA")).toBe("Secretaria");
  });
});

describe("formatarHaDias", () => {
  const agora = "2026-09-20T12:00:00.000Z";

  it("retorna 'hoje' para o mesmo instante", () => {
    expect(formatarHaDias(agora, agora)).toBe("hoje");
  });

  it("usa singular para 1 dia", () => {
    expect(formatarHaDias("2026-09-19T12:00:00.000Z", agora)).toBe("há 1 dia");
  });

  it("usa plural para N dias", () => {
    expect(formatarHaDias("2026-09-11T12:00:00.000Z", agora)).toBe("há 9 dias");
  });

  it("nunca retorna negativo para um instante no futuro", () => {
    expect(formatarHaDias("2026-09-25T12:00:00.000Z", agora)).toBe("hoje");
  });
});
