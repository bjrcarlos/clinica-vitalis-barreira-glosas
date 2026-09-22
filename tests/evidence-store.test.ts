import { describe, expect, it } from "vitest";

import type { GeradorId } from "../src/application/ports";
import {
  EvidenciaRejeitadaError,
  GravacaoMetadadosEvidenciaFalhouError,
  LIMITE_BYTES_EVIDENCIA,
  guardarEvidencia,
  guardarEvidenciaComCompensacao,
  montarChaveEvidencia,
  recuperarEvidencia,
  sanitizarNomeArquivo,
  type BucketEvidencias,
  type EntradaEvidencia,
} from "../src/infrastructure/r2/evidence-store";

/** Gerador de id determinístico para teste: devolve os valores dados, em ordem. */
class GeradorIdFixo implements GeradorId {
  private indice = 0;
  constructor(private readonly valores: readonly string[]) {}

  novo(): string {
    const valor = this.valores[this.indice] ?? `extra-${this.indice}`;
    this.indice++;
    return valor;
  }
}

interface ObjetoEmMemoria {
  readonly bytes: Uint8Array;
  readonly httpMetadata?: { readonly contentType?: string };
  readonly customMetadata?: Record<string, string>;
}

/** Duplo de R2 em memória — só put/get/delete, o suficiente para `BucketEvidencias`. Nunca depende de wrangler. */
class BucketEmMemoria implements BucketEvidencias {
  readonly objetos = new Map<string, ObjetoEmMemoria>();

  async put(
    chave: string,
    valor: Uint8Array,
    opcoes?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ): Promise<void> {
    this.objetos.set(chave, {
      bytes: valor.slice(),
      httpMetadata: opcoes?.httpMetadata,
      customMetadata: opcoes?.customMetadata,
    });
  }

  async get(chave: string) {
    const objeto = this.objetos.get(chave);
    if (objeto === undefined) return null;
    return {
      arrayBuffer: async () => objeto.bytes.slice().buffer,
      httpMetadata: objeto.httpMetadata,
      customMetadata: objeto.customMetadata,
    };
  }

  async delete(chave: string): Promise<void> {
    this.objetos.delete(chave);
  }
}

/** Stream de teste que entrega `bytes` em pedaços de `tamanhoPedaco` — simula upload real (rede), nunca um único chunk monolítico quando o teste quer provar que a checagem é feita DURANTE a leitura. */
function streamDeBytes(bytes: Uint8Array, tamanhoPedaco: number = bytes.byteLength || 1): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const fim = Math.min(offset + tamanhoPedaco, bytes.byteLength);
      controller.enqueue(bytes.slice(offset, fim));
      offset = fim;
    },
  });
}

function entradaBase(overrides: Partial<EntradaEvidencia> = {}): EntradaEvidencia {
  const conteudo = new TextEncoder().encode("conteudo de teste");
  return {
    protocoloId: "protocolo-1",
    eventoId: "evento-1",
    nomeArquivoOriginal: "comprovante.pdf",
    contentType: "application/pdf",
    tamanhoDeclaradoBytes: conteudo.byteLength,
    conteudo: streamDeBytes(conteudo),
    ...overrides,
  };
}

describe("sanitizarNomeArquivo", () => {
  it("remove tentativa de path traversal, mantendo só o nome final", () => {
    expect(sanitizarNomeArquivo("../../etc/passwd")).toBe("passwd");
  });

  it("remove qualquer diretório do caminho, com barra normal ou invertida", () => {
    expect(sanitizarNomeArquivo("pasta/subpasta/arquivo.png")).toBe("arquivo.png");
    expect(sanitizarNomeArquivo("C:\\pasta\\arquivo.png")).toBe("arquivo.png");
  });

  it("remove caractere de controle embutido no nome", () => {
    expect(sanitizarNomeArquivo("relatorio\u0000oculto.pdf")).toBe("relatoriooculto.pdf");
  });

  it("nunca devolve vazio: nome que sobra só lixo vira o padrão", () => {
    expect(sanitizarNomeArquivo("../../")).toBe("arquivo");
  });
});

describe("guardarEvidencia", () => {
  it("recusa tipo MIME não aceito e não grava nada no bucket", async () => {
    const bucket = new BucketEmMemoria();
    const entrada = entradaBase({ contentType: "application/zip", nomeArquivoOriginal: "arquivo.zip" });

    await expect(guardarEvidencia(bucket, entrada, new GeradorIdFixo(["uuid-1"]))).rejects.toThrow(
      EvidenciaRejeitadaError,
    );
    expect(bucket.objetos.size).toBe(0);
  });

  it("recusa quando a extensão do nome não bate com o MIME declarado", async () => {
    const bucket = new BucketEmMemoria();
    const entrada = entradaBase({ contentType: "application/pdf", nomeArquivoOriginal: "imagem.png" });

    await expect(guardarEvidencia(bucket, entrada, new GeradorIdFixo(["uuid-1"]))).rejects.toThrow(
      EvidenciaRejeitadaError,
    );
    expect(bucket.objetos.size).toBe(0);
  });

  it("recusa pelo tamanho declarado, antes mesmo de tomar o reader do corpo", async () => {
    const bucket = new BucketEmMemoria();
    // A stream engine já dispara `pull()` uma vez por conta própria assim que o stream é
    // construído (prefetch especulativo do próprio motor, antes de qualquer reader existir) —
    // por isso a prova de "nunca leu o corpo" não pode ser "pull não rodou". O que
    // `guardarEvidencia` garante é nunca chamar `getReader()`: o stream continua destrancado.
    const streamNuncaLido = new ReadableStream<Uint8Array>({ pull() {} });
    const entrada = entradaBase({
      tamanhoDeclaradoBytes: LIMITE_BYTES_EVIDENCIA + 1,
      conteudo: streamNuncaLido,
    });

    await expect(guardarEvidencia(bucket, entrada, new GeradorIdFixo(["uuid-1"]))).rejects.toThrow(
      EvidenciaRejeitadaError,
    );
    expect(streamNuncaLido.locked).toBe(false);
  });

  it("recusa arquivo maior que o limite mesmo quando o tamanho declarado mente (checagem durante a leitura)", async () => {
    const bucket = new BucketEmMemoria();
    const conteudoGrande = new Uint8Array(LIMITE_BYTES_EVIDENCIA + 1024);
    const entrada = entradaBase({
      nomeArquivoOriginal: "grande.pdf",
      tamanhoDeclaradoBytes: 10, // Content-Length mentiroso: diz que é pequeno.
      conteudo: streamDeBytes(conteudoGrande, 64 * 1024), // chega em pedaços, como um upload real.
    });

    await expect(guardarEvidencia(bucket, entrada, new GeradorIdFixo(["uuid-1"]))).rejects.toThrow(
      EvidenciaRejeitadaError,
    );
    expect(bucket.objetos.size).toBe(0);
  });

  it("calcula o SHA-256 correto do conteúdo gravado", async () => {
    const bucket = new BucketEmMemoria();
    const conteudo = new TextEncoder().encode("evidencia-vitalis-2026");
    const entrada = entradaBase({ conteudo: streamDeBytes(conteudo), tamanhoDeclaradoBytes: conteudo.byteLength });

    const armazenada = await guardarEvidencia(bucket, entrada, new GeradorIdFixo(["uuid-hash"]));

    const digestEsperado = await crypto.subtle.digest("SHA-256", conteudo);
    const shaEsperado = Array.from(new Uint8Array(digestEsperado))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    expect(armazenada.sha256).toBe(shaEsperado);
    expect(armazenada.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("grava na chave fixada (evidence/{protocolo}/{evento}/{uuid}-{nome}) e permite recuperar de volta", async () => {
    const bucket = new BucketEmMemoria();
    const conteudo = new TextEncoder().encode("comprovante");
    const entrada = entradaBase({
      conteudo: streamDeBytes(conteudo),
      tamanhoDeclaradoBytes: conteudo.byteLength,
      nomeArquivoOriginal: "comprovante.pdf",
    });

    const armazenada = await guardarEvidencia(bucket, entrada, new GeradorIdFixo(["uuid-abc"]));

    expect(armazenada.chave).toBe(montarChaveEvidencia("protocolo-1", "evento-1", "uuid-abc", "comprovante.pdf"));

    const recuperada = await recuperarEvidencia(bucket, armazenada.chave);
    expect(recuperada).not.toBeNull();
    expect(new TextDecoder().decode(recuperada!.conteudo)).toBe("comprovante");
    expect(recuperada!.contentType).toBe("application/pdf");
  });
});

describe("guardarEvidenciaComCompensacao", () => {
  it("remove o objeto órfão do R2 quando a gravação dos metadados falha", async () => {
    const bucket = new BucketEmMemoria();
    const entrada = entradaBase();

    await expect(
      guardarEvidenciaComCompensacao(bucket, entrada, new GeradorIdFixo(["uuid-orfao"]), async () => {
        throw new Error("D1 indisponível");
      }),
    ).rejects.toThrow(GravacaoMetadadosEvidenciaFalhouError);

    expect(bucket.objetos.size).toBe(0);
  });

  it("propaga o resultado de persistirMetadados quando tudo dá certo, sem tocar no objeto gravado", async () => {
    const bucket = new BucketEmMemoria();
    const entrada = entradaBase();

    const resultado = await guardarEvidenciaComCompensacao(
      bucket,
      entrada,
      new GeradorIdFixo(["uuid-ok"]),
      async (armazenada) => `evidencia-persistida:${armazenada.chave}`,
    );

    expect(resultado).toBe(
      `evidencia-persistida:${montarChaveEvidencia("protocolo-1", "evento-1", "uuid-ok", "comprovante.pdf")}`,
    );
    expect(bucket.objetos.size).toBe(1);
  });
});
