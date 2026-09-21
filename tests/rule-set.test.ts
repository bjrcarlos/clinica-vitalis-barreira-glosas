import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { montarConjuntoRegras } from "../src/rules/rule-set";

// Lê o material oficial em tempo de teste — nunca copiado para dentro do código (regra do projeto).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAMINHO_REGRAS_OFICIAIS = path.resolve(__dirname, "../regras_convenio.json.txt");

// O hash é responsabilidade da infraestrutura (WebCrypto); o motor puro só recebe um já pronto.
const SHA256_FALSO = "0".repeat(64);

function textoOficial(): string {
  return readFileSync(CAMINHO_REGRAS_OFICIAIS, "utf-8");
}

describe("montarConjuntoRegras", () => {
  it("carrega os 3 convênios e os 5 procedimentos do JSON oficial", () => {
    const conjunto = montarConjuntoRegras(textoOficial(), SHA256_FALSO);

    expect(conjunto.versao).toBe("agosto/2026");
    expect(conjunto.sha256).toBe(SHA256_FALSO);
    expect(conjunto.convenios).toHaveLength(3);
    expect(conjunto.procedimentos).toHaveLength(5);
    expect(conjunto.convenios.map((c) => c.nome)).toEqual(["Vitalcard", "Saúde Interior", "Plano Bem"]);
  });

  it("resolve nome de convênio com acento e caixa diferentes da grafia oficial", () => {
    const conjunto = montarConjuntoRegras(textoOficial(), SHA256_FALSO);

    for (const variante of ["saude interior", "SAÚDE INTERIOR", "  Saúde Interior  ", "sAúDe InteRIOR"]) {
      expect(conjunto.convenioPorNome(variante)?.nome).toBe("Saúde Interior");
    }
  });

  it("devolve nulo para convênio e procedimento desconhecidos, sem lançar", () => {
    const conjunto = montarConjuntoRegras(textoOficial(), SHA256_FALSO);

    expect(() => conjunto.procedimentoPorCodigo("00000000")).not.toThrow();
    expect(conjunto.procedimentoPorCodigo("00000000")).toBeNull();

    expect(() => conjunto.convenioPorNome("Convênio Inexistente")).not.toThrow();
    expect(conjunto.convenioPorNome("Convênio Inexistente")).toBeNull();

    expect(conjunto.regraAplicavel("Convênio Inexistente", "50000470")).toBeNull();
  });

  it("converte valor de referência de reais para centavos inteiros", () => {
    const conjunto = montarConjuntoRegras(textoOficial(), SHA256_FALSO);

    expect(conjunto.procedimentoPorCodigo("50000470")?.valor_referencia_cents).toBe(6200); // 62.00
    expect(conjunto.procedimentoPorCodigo("50000560")?.valor_referencia_cents).toBe(7000); // 70.00
    expect(conjunto.procedimentoPorCodigo("50000012")?.valor_referencia_cents).toBe(5500); // 55.00
    expect(conjunto.procedimentoPorCodigo("20103301")?.valor_referencia_cents).toBe(9000); // 90.00
    expect(conjunto.procedimentoPorCodigo("40201015")?.valor_referencia_cents).toBe(14000); // 140.0

    for (const procedimento of conjunto.procedimentos) {
      expect(Number.isInteger(procedimento.valor_referencia_cents)).toBe(true);
    }
  });

  it("monta a fatia de regra aplicável para um par convênio+procedimento coberto", () => {
    const conjunto = montarConjuntoRegras(textoOficial(), SHA256_FALSO);

    const regra = conjunto.regraAplicavel("vitalcard", "50000470");

    expect(regra).not.toBeNull();
    expect(regra?.convenio).toBe("Vitalcard");
    expect(regra?.procedimento?.codigo).toBe("50000470");
    expect(regra?.procedimento_coberto).toBe(true);
    expect(regra?.referencia).toEqual({ versao: "agosto/2026", sha256: SHA256_FALSO });
  });

  it("marca procedimento_coberto como falso quando o procedimento é desconhecido", () => {
    const conjunto = montarConjuntoRegras(textoOficial(), SHA256_FALSO);

    const regra = conjunto.regraAplicavel("Vitalcard", "00000000");

    expect(regra).not.toBeNull();
    expect(regra?.procedimento).toBeNull();
    expect(regra?.procedimento_coberto).toBe(false);
  });

  it("rejeita JSON malformado com mensagem útil", () => {
    expect(() => montarConjuntoRegras("{ isto nao é json", SHA256_FALSO)).toThrow(/invalido/i);
  });

  it("rejeita JSON válido mas fora do formato oficial, com mensagem útil", () => {
    expect(() => montarConjuntoRegras(JSON.stringify({ versao: "agosto/2026" }), SHA256_FALSO)).toThrow(/invalido/i);
    expect(() =>
      montarConjuntoRegras(JSON.stringify({ versao: "", definicoes: {}, procedimentos: [], convenios: [] }), SHA256_FALSO),
    ).toThrow(/invalido/i);
  });
});
