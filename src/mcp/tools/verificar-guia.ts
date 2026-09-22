import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { carregarRegrasAtivas } from "../../http/handlers/create-protocol";
import { normalizarGuia } from "../../domain/normalize";
import { esquemaGuiaBruta } from "../../http/contracts";
import { validarGuia as motorValidacao } from "../../rules/engine";
import { criarRepositoriosD1 } from "../../infrastructure/d1/repositories";
import { GeradorIdCrypto } from "../../infrastructure/id";
import { RelogioReal } from "../../infrastructure/clock";
import { interpretarObservacao, type AiLike } from "../../infrastructure/ai/interpreter";
import type { Env } from "../../worker/index";
import { SOMENTE_LEITURA, erroTool, responder } from "../resposta";
import { apresentarValidacao, esquemaValidacaoApresentada, textoDaValidacao } from "./apresentar-validacao";

/**
 * Aceita exatamente uma das duas formas (PRD-SDD §23.3). Um `z.object` com `.refine()` — em vez
 * do `z.union` anterior — porque o `inputSchema` de uma tool MCP precisa ser um schema de objeto
 * (JSON Schema `type: "object"` em `tools/list`); a exclusividade continua sendo imposta em
 * runtime, só a forma de declarar mudou.
 */
const schemaVerificar = z
  .object({
    id_guia: z.string().trim().min(1).optional().describe("ID de origem de uma guia JÁ cadastrada (coluna id_guia). Use só para guia existente."),
    guia: esquemaGuiaBruta.optional().describe("Guia estruturada a partir do que a recepção escreveu. Use para conferir antes de cadastrar. Só os campos presentes; nunca invente valor."),
  })
  .refine((valor) => (valor.id_guia !== undefined) !== (valor.guia !== undefined), {
    message: "Informe exatamente um entre id_guia e guia.",
  });

const esquemaSaidaVerificar = esquemaValidacaoApresentada.extend({
  id_guia: z.string(),
  numero_protocolo: z.string().nullable(),
  ia: z.object({ status: z.enum(["NAO_EXECUTADA", "CONCLUIDA", "FALHOU"]), modelo: z.string().nullable(), prompt_version: z.string().nullable() }),
  persistiu: z.literal(false),
  orientacao: z.string(),
});

function aiDoAmbiente(env: Env): AiLike | undefined {
  return env.AI as unknown as AiLike | undefined;
}

async function guiaPorId(db: D1Database, idGuia: string) {
  const linha = await db
    .prepare(
      `SELECT p.id AS protocol_id, p.protocol_number, gv.raw_payload_json, gv.normalized_payload_json FROM protocols p JOIN guide_versions gv ON gv.id = p.current_version_id WHERE p.source_guide_id = ?`,
    )
    .bind(idGuia)
    .first<{ protocol_id: string; protocol_number: string; raw_payload_json: string; normalized_payload_json: string }>();
  if (linha === null) throw erroTool("GUIA_NAO_ENCONTRADA", `Nenhuma guia cadastrada com id_guia "${idGuia}". Para conferir uma guia nova, envie o objeto guia em vez de id_guia.`);
  return { ...linha, guiaBruta: esquemaGuiaBruta.parse(JSON.parse(linha.raw_payload_json)), guia: JSON.parse(linha.normalized_payload_json) };
}

/** `verificar_guia` (PRD-SDD §23.3): verifica guia existente ou estruturada sem persistir nem alterar nada. */
export function registrarVerificarGuia(server: McpServer, env: Env): void {
  server.registerTool(
    "verificar_guia",
    {
      title: "Verificar guia (sem gravar)",
      description:
        "Roda o mesmo motor de validação da tela sobre uma guia já cadastrada (id_guia) OU sobre um objeto guia montado do texto da recepção — exatamente um dos dois. Devolve estado, problemas com evidência, quem resolve, risco e próximo passo. NÃO grava, NÃO cria protocolo, NÃO altera nada. Apresente o texto devolvido como veio e termine dizendo que nada foi gravado.",
      inputSchema: schemaVerificar,
      outputSchema: esquemaSaidaVerificar,
      annotations: SOMENTE_LEITURA,
    },
    async (entrada) => {
      const regras = await carregarRegrasAtivas(env.DB);
      const ids = new GeradorIdCrypto();
      const relogio = new RelogioReal();
      const repos = criarRepositoriosD1(env.DB, ids, relogio);
      let guiaBruta: z.infer<typeof esquemaGuiaBruta>;
      let guia: ReturnType<typeof normalizarGuia>["guia"];
      let protocoloId: string | undefined;
      let numeroProtocolo: string | null = null;
      if (entrada.id_guia !== undefined) {
        const existente = await guiaPorId(env.DB, entrada.id_guia);
        guiaBruta = existente.guiaBruta;
        guia = existente.guia;
        protocoloId = existente.protocol_id;
        numeroProtocolo = existente.protocol_number;
      } else {
        guiaBruta = entrada.guia!;
        guia = normalizarGuia(guiaBruta).guia;
      }
      const candidatos = (await repos.versoes.listarCandidatosDuplicidade(guia)).filter((candidato) => candidato.protocoloId !== protocoloId);
      const interpretacao = await interpretarObservacao(aiDoAmbiente(env), guia, regras);
      const resultado = motorValidacao(guia, regras, candidatos, interpretacao.interpretacao);
      const apresentada = apresentarValidacao(resultado);

      const saida = {
        ...apresentada,
        id_guia: guiaBruta.id_guia,
        numero_protocolo: numeroProtocolo,
        ia: { status: interpretacao.status, modelo: interpretacao.modelo, prompt_version: interpretacao.promptVersion },
        persistiu: false as const,
        // A orientação viaja na resposta, e não só na description: é o que o modelo relê ao
        // formular a frase final para a pessoa.
        orientacao:
          "Conferência apenas: nenhum protocolo foi criado ou alterado. Corrigir, liberar, enviar, encerrar e mesclar são ações da tela, não do MCP.",
      };

      const cabecalho = numeroProtocolo ? `## Conferência da guia ${guiaBruta.id_guia} (protocolo ${numeroProtocolo})` : `## Conferência da guia ${guiaBruta.id_guia}`;
      const avisoIa = interpretacao.status === "FALHOU" ? "\n\n> A interpretação da observação da recepção falhou; por isso a observação conta como não interpretada e o caso vai para revisão humana." : "";
      const texto = `${cabecalho}

${textoDaValidacao(apresentada)}${avisoIa}

_Nada foi gravado. Corrigir, liberar, enviar, encerrar e mesclar são ações da tela do protocolo._`;

      return responder(texto, saida);
    },
  );
}
