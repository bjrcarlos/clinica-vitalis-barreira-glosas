import { describe, expect, it } from "vitest";

import type { GeradorId } from "../src/application/ports";
import { assinarLink, verificarLink } from "../src/infrastructure/signing/links";

class GeradorIdFixo implements GeradorId {
  private indice = 0;
  constructor(private readonly valores: readonly string[] = ["nonce-1", "nonce-2", "nonce-3"]) {}

  novo(): string {
    const valor = this.valores[this.indice] ?? `extra-${this.indice}`;
    this.indice++;
    return valor;
  }
}

const CHAVE_SECRETA = "chave-de-teste-nao-e-segredo-real";
const AGORA_UTC = "2026-09-21T12:00:00.000Z";

describe("assinarLink / verificarLink", () => {
  it("aceita um token válido para a finalidade e o recurso corretos", async () => {
    const { token } = await assinarLink(
      { finalidade: "evidence", recursoId: "evidencia-123" },
      CHAVE_SECRETA,
      AGORA_UTC,
      new GeradorIdFixo(),
    );

    const payload = await verificarLink(token, CHAVE_SECRETA, AGORA_UTC, {
      finalidadeEsperada: "evidence",
      recursoIdEsperado: "evidencia-123",
    });

    expect(payload).not.toBeNull();
    expect(payload?.finalidade).toBe("evidence");
    expect(payload?.recursoId).toBe("evidencia-123");
  });

  it("recusa token com assinatura adulterada", async () => {
    const { token } = await assinarLink(
      { finalidade: "review", recursoId: "VT-26-0001" },
      CHAVE_SECRETA,
      AGORA_UTC,
      new GeradorIdFixo(),
    );

    const [payloadB64] = token.split(".");
    const tokenAdulterado = `${payloadB64}.assinatura-forjada-nao-corresponde`;

    const payload = await verificarLink(tokenAdulterado, CHAVE_SECRETA, AGORA_UTC, {
      finalidadeEsperada: "review",
      recursoIdEsperado: "VT-26-0001",
    });

    expect(payload).toBeNull();
  });

  it("recusa token expirado", async () => {
    const { token } = await assinarLink(
      { finalidade: "evidence", recursoId: "evidencia-123" },
      CHAVE_SECRETA,
      AGORA_UTC,
      new GeradorIdFixo(),
      60 * 1000, // 1 minuto de validade
    );

    const doisMinutosDepois = new Date(new Date(AGORA_UTC).getTime() + 2 * 60 * 1000).toISOString();

    const payload = await verificarLink(token, CHAVE_SECRETA, doisMinutosDepois, {
      finalidadeEsperada: "evidence",
      recursoIdEsperado: "evidencia-123",
    });

    expect(payload).toBeNull();
  });

  it("recusa token emitido para outra finalidade", async () => {
    const { token } = await assinarLink(
      { finalidade: "evidence", recursoId: "recurso-compartilhado" },
      CHAVE_SECRETA,
      AGORA_UTC,
      new GeradorIdFixo(),
    );

    const payload = await verificarLink(token, CHAVE_SECRETA, AGORA_UTC, {
      finalidadeEsperada: "review",
      recursoIdEsperado: "recurso-compartilhado",
    });

    expect(payload).toBeNull();
  });

  it("recusa token válido de um recurso quando usado para acessar outro", async () => {
    const { token } = await assinarLink(
      { finalidade: "evidence", recursoId: "evidencia-A" },
      CHAVE_SECRETA,
      AGORA_UTC,
      new GeradorIdFixo(),
    );

    const payload = await verificarLink(token, CHAVE_SECRETA, AGORA_UTC, {
      finalidadeEsperada: "evidence",
      recursoIdEsperado: "evidencia-B",
    });

    expect(payload).toBeNull();
  });
});
