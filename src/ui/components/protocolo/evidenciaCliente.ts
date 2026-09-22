import { ApiError, type ErroApi } from "../../lib/api";
import {
  LIMITE_EVIDENCIA_BYTES,
  TIPOS_MIME_EVIDENCIA_ACEITOS,
  type AnexarEvidenciaResposta,
  type EvidenciaWire,
} from "../../../http/contracts";

/**
 * Cliente de `POST /api/protocols/:numero/evidence` e do download de evidência (RF-12, PRD §25).
 * Fica fora de `src/ui/lib/api.ts` de propósito: aquele cliente sempre serializa o corpo como
 * JSON (`JSON.stringify`), e upload de arquivo é `multipart/form-data` — não dá para reaproveitar
 * `requisitar()` sem reescrevê-lo (fora do escopo de arquivo desta tarefa). Usa `XMLHttpRequest`,
 * não `fetch`, porque só ele expõe progresso de upload (`upload.onprogress`), pedido pela tarefa.
 */

export function tipoMimeAceito(tipo: string): tipo is (typeof TIPOS_MIME_EVIDENCIA_ACEITOS)[number] {
  return (TIPOS_MIME_EVIDENCIA_ACEITOS as readonly string[]).includes(tipo);
}

const ROTULO_TIPO_MIME: Readonly<Record<string, string>> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPG",
  "image/png": "PNG",
};

export function rotuloTipoMime(tipo: string): string {
  return ROTULO_TIPO_MIME[tipo] ?? tipo;
}

export function formatarTamanhoArquivo(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export { LIMITE_EVIDENCIA_BYTES, TIPOS_MIME_EVIDENCIA_ACEITOS };

function erroDeRespostaTexto(status: number, texto: string): ApiError {
  if (texto.length > 0) {
    try {
      const corpo = JSON.parse(texto) as { erro?: Partial<ErroApi> };
      if (corpo.erro && typeof corpo.erro.codigo === "string" && typeof corpo.erro.mensagem === "string") {
        return new ApiError({ codigo: corpo.erro.codigo, mensagem: corpo.erro.mensagem });
      }
    } catch {
      // corpo não era JSON — cai no erro genérico abaixo.
    }
  }
  return new ApiError({ codigo: "ERRO_HTTP", mensagem: `Falha inesperada (HTTP ${status}).` });
}

interface AnexarEvidenciaOpcoes {
  /** Data em que o fato comprovado ocorreu (pode ser retroativa) — ver nota de suposição abaixo. */
  readonly ocorridoEmUtc: string;
  readonly aoProgredir?: (fracao: number) => void;
  readonly signal?: AbortSignal;
}

/**
 * SUPOSIÇÃO DECLARADA: `esquemaMetadadosArquivoEvidencia` (`src/http/contracts.ts`) só valida
 * `nome_original`/`tipo_mime`/`tamanho_bytes` — extraídos do próprio `File` pelo handler, sem
 * campo de data. A tarefa desta UI pede explicitamente um campo "data em que o fato ocorreu" no
 * formulário de anexar evidência (RF-11 aplicado aqui por analogia ao RF-09/envio). Como o
 * handler de upload é de outro agente e não está pronto nesta sessão, este campo é enviado como
 * um segundo campo de `FormData` (`ocorrido_em_utc`, texto solto) ao lado de `arquivo` — não faz
 * parte do esquema de metadados hoje, então um handler que ainda não o lê simplesmente o ignora
 * (não quebra nada). Quem estender o handler para persistir isso deve ler este campo do
 * `formData()`, não reintroduzir o campo em outro nome.
 */
export function anexarEvidencia(
  numeroProtocolo: string,
  arquivo: File,
  opcoes: AnexarEvidenciaOpcoes,
): Promise<AnexarEvidenciaResposta> {
  return new Promise((resolve, reject) => {
    const corpo = new FormData();
    corpo.append("arquivo", arquivo, arquivo.name);
    corpo.append("ocorrido_em_utc", opcoes.ocorridoEmUtc);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/protocols/${encodeURIComponent(numeroProtocolo)}/evidence`);
    xhr.responseType = "text";

    if (opcoes.signal) {
      if (opcoes.signal.aborted) {
        reject(new DOMException("Envio cancelado.", "AbortError"));
        return;
      }
      opcoes.signal.addEventListener("abort", () => xhr.abort());
    }

    xhr.upload.onprogress = (evento) => {
      if (evento.lengthComputable && opcoes.aoProgredir) {
        opcoes.aoProgredir(evento.loaded / evento.total);
      }
    };

    xhr.onerror = () => {
      reject(new ApiError({ codigo: "FALHA_DE_REDE", mensagem: "Não foi possível conectar ao servidor. Verifique a conexão e tente novamente." }));
    };
    xhr.onabort = () => reject(new DOMException("Envio cancelado.", "AbortError"));

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as AnexarEvidenciaResposta);
        } catch {
          reject(new ApiError({ codigo: "RESPOSTA_INVALIDA", mensagem: "O servidor respondeu em um formato inesperado." }));
        }
        return;
      }
      reject(erroDeRespostaTexto(xhr.status, xhr.responseText));
    };

    xhr.send(corpo);
  });
}

/**
 * SUPOSIÇÃO DECLARADA: o único caminho fixado pelo orquestrador para download é
 * `GET /api/evidence/:id?token=...` (link assinado, temporário). Como nenhum outro caminho existe
 * para OBTER esse token, esta função assume que a mesma rota, chamada SEM `?token=` (autenticada
 * só pelo cookie de sessão, como qualquer outra leitura desta fase), devolve `{ url }` — a URL já
 * assinada e com prazo curto, pronta para a segunda chamada (com token) servir o arquivo. Isso
 * evita inventar uma nona rota fora do contrato fixado. Quem implementar o handler deve manter
 * esse formato de resposta para `GET /api/evidence/:id` sem `token`, ou este arquivo precisa ser
 * ajustado — mudar a orientação, não o disco, se o handler final divergir.
 */
export async function solicitarLinkDownload(evidenciaId: string, signal?: AbortSignal): Promise<string> {
  const resposta = await fetch(`/api/evidence/${encodeURIComponent(evidenciaId)}`, {
    method: "GET",
    credentials: "same-origin",
    signal,
  });
  const texto = await resposta.text();
  if (!resposta.ok) throw erroDeRespostaTexto(resposta.status, texto);
  let corpo: unknown;
  try {
    corpo = JSON.parse(texto);
  } catch {
    throw new ApiError({ codigo: "RESPOSTA_INVALIDA", mensagem: "O servidor respondeu em um formato inesperado." });
  }
  const url = (corpo as { url?: unknown }).url;
  if (typeof url !== "string" || url.length === 0) {
    throw new ApiError({ codigo: "RESPOSTA_INVALIDA", mensagem: "O servidor não devolveu um link de download." });
  }
  return url;
}

/** Dispara o download pelo link assinado sem guardá-lo em nenhum estado além do clique (PRD §25.3). */
export function baixarPeloLink(url: string, nomeSugerido: string): void {
  const ancora = document.createElement("a");
  ancora.href = url;
  ancora.rel = "noopener";
  ancora.download = nomeSugerido;
  document.body.appendChild(ancora);
  ancora.click();
  document.body.removeChild(ancora);
}

/** Evidência ainda válida para vincular a uma ação (envio, decisão de revisão) — nunca uma invalidada. */
export function evidenciasValidas(evidencias: readonly EvidenciaWire[] | undefined): readonly EvidenciaWire[] {
  return (evidencias ?? []).filter((evidencia) => evidencia.invalidada_em_utc === null);
}
