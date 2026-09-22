import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { carregarRegrasAtivas, buscarResumoWire } from "../../http/handlers/create-protocol";
import { normalizarGuia } from "../../domain/normalize";
import { esquemaGuiaBruta, esquemaProtocoloResumo } from "../../http/contracts";
import { apresentarFluxoStatus, apresentarValidacaoStatus } from "../../domain/statuses";
import { formatarCentavos } from "../../domain/apresentacao";
import { validarGuia as motorValidacao } from "../../rules/engine";
import { criarRepositoriosD1 } from "../../infrastructure/d1/repositories";
import { GeradorIdCrypto } from "../../infrastructure/id";
import { RelogioReal } from "../../infrastructure/clock";
import { interpretarObservacao, type AiLike } from "../../infrastructure/ai/interpreter";
import { registrarGuia } from "../../application/register-guide";
import type { Env } from "../../worker/index";
import type { ContextoMcp } from "../auth";
import { ESCRITA_IDEMPOTENTE, erroTool, responder } from "../resposta";
import { apresentarValidacao, esquemaValidacaoApresentada, textoDaValidacao } from "./apresentar-validacao";

const schemaRegistrar = z.object({
  id_guia_origem: z.string().trim().min(1).max(200).describe("Identificador da guia na origem (o id_guia da recepção). Chave de idempotência: repetir o mesmo id não cria segundo protocolo."),
  guia: esquemaGuiaBruta.describe("Guia estruturada como a recepção escreveu. Só os campos presentes; nunca invente valor."),
});

const esquemaSaidaRegistrar = z.object({
  ja_existia: z.boolean(),
  gravado_nesta_chamada: z.boolean(),
  protocolo: esquemaProtocoloResumo,
  status_validacao_rotulo: z.string(),
  status_fluxo_rotulo: z.string(),
  risco: z.string(),
  resultado_validacao: esquemaValidacaoApresentada.nullable(),
  url_revisao: z.string(),
  orientacao: z.string(),
});

function aiDoAmbiente(env: Env): AiLike | undefined {
  return env.AI as unknown as AiLike | undefined;
}

/**
 * `registrar_guia` (PRD-SDD §23.3): exclusiva da Secretaria, idempotente por `id_guia_origem`.
 * `contexto` vem do Bearer autenticado (nunca de `arguments`) — é aqui que a exclusividade de
 * papel é imposta, antes de qualquer escrita.
 */
export function registrarRegistrarGuia(server: McpServer, env: Env, contexto: ContextoMcp): void {
  server.registerTool(
    "registrar_guia",
    {
      title: "Registrar guia nova (Secretaria)",
      description:
        "GRAVA: cria protocolo e versão inicial de uma guia nova e roda a validação — a única tool do MCP que escreve. Só a Secretaria pode chamar, e só com pedido explícito da pessoa; para conferir sem gravar use verificar_guia. Idempotente por id_guia_origem: repetir devolve o protocolo existente sem gravar de novo. Devolve protocolo, estado, problemas e o link da tela. Não corrige, não libera, não envia.",
      inputSchema: schemaRegistrar,
      outputSchema: esquemaSaidaRegistrar,
      annotations: ESCRITA_IDEMPOTENTE,
    },
    async (entrada) => {
      if (contexto.papel !== "SECRETARIA") {
        throw erroTool("ROLE_NOT_ALLOWED", "Somente a Secretaria pode registrar_guia. Nada foi gravado. Para conferir sem gravar, use verificar_guia.");
      }
      const regras = await carregarRegrasAtivas(env.DB);
      const normalizada = normalizarGuia(entrada.guia);
      const interpretacao = await interpretarObservacao(aiDoAmbiente(env), normalizada.guia, regras);
      const ids = new GeradorIdCrypto();
      const relogio = new RelogioReal();
      const repos = criarRepositoriosD1(env.DB, ids, relogio);
      const registro = await registrarGuia(
        {
          idGuiaOrigem: entrada.id_guia_origem,
          guiaBruta: entrada.guia,
          guiaNormalizada: normalizada.guia,
          avisosNormalizacao: normalizada.avisos,
          criadoPorPapel: "SECRETARIA",
          criadoPorPrincipal: contexto.principal,
          origem: "MCP",
          regras,
          interpretacaoIA: interpretacao.interpretacao,
          aiStatus: interpretacao.status,
          aiModel: interpretacao.modelo,
          aiPromptVersion: interpretacao.promptVersion,
          aiInputJson: interpretacao.inputJson,
          aiOutputJson: interpretacao.outputJson,
        },
        { protocolos: repos.protocolos, versoes: repos.versoes, eventos: repos.eventos, relogio, validarGuiaDependencias: { motor: motorValidacao, validacoes: repos.validacoes, tarefas: repos.tarefas, eventos: repos.eventos, relogio } },
      );
      const resumo = await buscarResumoWire(env.DB, registro.protocolo.numeroProtocolo);
      const validacao = registro.validacao ? apresentarValidacao(registro.validacao.resultado) : null;
      const urlRevisao = `/protocolos/${encodeURIComponent(registro.protocolo.numeroProtocolo)}`;

      const saida = {
        ja_existia: registro.jaExistia,
        gravado_nesta_chamada: !registro.jaExistia,
        protocolo: resumo,
        status_validacao_rotulo: apresentarValidacaoStatus(resumo.status_validacao),
        status_fluxo_rotulo: apresentarFluxoStatus(resumo.status_fluxo),
        risco: formatarCentavos(resumo.risco_atual_cents),
        resultado_validacao: validacao,
        url_revisao: urlRevisao,
        orientacao: registro.jaExistia
          ? "Já existia um protocolo para este id_guia_origem; nada novo foi gravado. O estado mostrado é o atual dele."
          : "Protocolo criado e validado. Correção, liberação, envio, encerramento e mesclagem são feitos na tela do protocolo, não pelo MCP.",
      };

      const texto = registro.jaExistia
        ? `## Guia já registrada — protocolo ${resumo.numero_protocolo}

Já existia um protocolo para a origem \`${entrada.id_guia_origem}\`. **Nada novo foi gravado.**

- Estado atual: **${saida.status_validacao_rotulo}** · fluxo: ${saida.status_fluxo_rotulo}
- Risco atual: ${saida.risco}
- Tela do protocolo: ${urlRevisao}`
        : `## Protocolo ${resumo.numero_protocolo} criado

Guia \`${entrada.id_guia_origem}\` registrada pela Secretaria e validada.

${validacao ? textoDaValidacao(validacao) : ""}

- Tela do protocolo: ${urlRevisao}

_Correção, liberação, envio, encerramento e mesclagem são feitos na tela, não pelo MCP._`;

      return responder(texto, saida);
    },
  );
}
