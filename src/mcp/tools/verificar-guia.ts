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

/**
 * Aceita exatamente uma das duas formas (PRD-SDD §23.3). Um `z.object` com `.refine()` — em vez
 * do `z.union` anterior — porque o `inputSchema` de uma tool MCP precisa ser um schema de objeto
 * (JSON Schema `type: "object"` em `tools/list`); a exclusividade continua sendo imposta em
 * runtime, só a forma de declarar mudou.
 */
const schemaVerificar = z
  .object({
    id_guia: z.string().trim().min(1).optional(),
    guia: esquemaGuiaBruta.optional(),
  })
  .refine((valor) => (valor.id_guia !== undefined) !== (valor.guia !== undefined), {
    message: "Informe exatamente um entre id_guia e guia.",
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
  if (linha === null) throw new Error("Guia não encontrada na base da prova.");
  return { ...linha, guiaBruta: esquemaGuiaBruta.parse(JSON.parse(linha.raw_payload_json)), guia: JSON.parse(linha.normalized_payload_json) };
}

/** `verificar_guia` (PRD-SDD §23.3): verifica guia existente ou estruturada sem persistir nem alterar nada. */
export function registrarVerificarGuia(server: McpServer, env: Env): void {
  server.registerTool(
    "verificar_guia",
    {
      description: "Verifica uma guia existente ou um objeto estruturado sem persistir.",
      inputSchema: schemaVerificar,
    },
    async (entrada) => {
      const regras = await carregarRegrasAtivas(env.DB);
      const ids = new GeradorIdCrypto();
      const relogio = new RelogioReal();
      const repos = criarRepositoriosD1(env.DB, ids, relogio);
      let guiaBruta: z.infer<typeof esquemaGuiaBruta>;
      let guia: ReturnType<typeof normalizarGuia>["guia"];
      let protocoloId: string | undefined;
      if (entrada.id_guia !== undefined) {
        const existente = await guiaPorId(env.DB, entrada.id_guia);
        guiaBruta = existente.guiaBruta;
        guia = existente.guia;
        protocoloId = existente.protocol_id;
      } else {
        guiaBruta = entrada.guia!;
        guia = normalizarGuia(guiaBruta).guia;
      }
      const candidatos = (await repos.versoes.listarCandidatosDuplicidade(guia)).filter((candidato) => candidato.protocoloId !== protocoloId);
      const interpretacao = await interpretarObservacao(aiDoAmbiente(env), guia, regras);
      const resultado = motorValidacao(guia, regras, candidatos, interpretacao.interpretacao);
      const saida = {
        status: resultado.status,
        resumo: resultado.resumo,
        problemas: resultado.problemas,
        regras_aplicadas: resultado.regras_aplicadas,
        ai: { status: interpretacao.status, modelo: interpretacao.modelo, prompt_version: interpretacao.promptVersion },
        persistiu: false,
        id_guia: guiaBruta.id_guia,
        // A orientação viaja na resposta, e não só na description: é o que o modelo relê ao
        // formular a frase final para a pessoa.
        orientacao:
          "Conferência apenas: nenhum protocolo foi criado ou alterado. Corrigir, liberar, enviar, encerrar e mesclar são ações da tela, não do MCP.",
      };
      return { content: [{ type: "text", text: JSON.stringify(saida) }] };
    },
  );
}
