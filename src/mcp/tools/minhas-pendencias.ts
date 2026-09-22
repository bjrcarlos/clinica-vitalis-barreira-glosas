import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { GeradorIdCrypto } from "../../infrastructure/id";
import { assinarLink } from "../../infrastructure/signing/links";
import { apresentarArea, apresentarFluxoStatus, apresentarValidacaoStatus, type FluxoStatus, type ValidacaoStatus } from "../../domain/statuses";
import { formatarCentavos, formatarDataCurta } from "../../domain/apresentacao";
import type { Env } from "../../worker/index";
import type { ContextoMcp } from "../auth";
import { SOMENTE_LEITURA, avisoTruncado, erroTool, responder, tabela } from "../resposta";

const LIMITE_PADRAO = 50;

const schemaPendencias = z.object({
  data_de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Só pendências abertas a partir desta data (aaaa-mm-dd)."),
  data_ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Só pendências abertas até esta data (aaaa-mm-dd)."),
  estado: z.enum(["OK", "CORRIGIR", "REVISAO_HUMANA", "NAO_FATURAR_CONVENIO"]).optional().describe("Filtra pelo estado de validação do protocolo."),
  limite: z.number().int().min(1).max(100).default(LIMITE_PADRAO).describe("Quantos protocolos listar (os totais são sempre da fila inteira)."),
});

const esquemaItem = z.object({
  numero_protocolo: z.string(),
  status_validacao: z.string(),
  status_validacao_rotulo: z.string(),
  status_fluxo: z.string(),
  status_fluxo_rotulo: z.string(),
  risco_cents: z.number().int(),
  risco: z.string(),
  tarefas_abertas: z.number().int(),
  pendencias: z.array(z.string()),
  aberta_desde_utc: z.string(),
  aberta_desde: z.string(),
  url_revisao: z.string().nullable(),
  expira_em_utc: z.string().nullable(),
});

const esquemaSaidaPendencias = z.object({
  area: z.enum(["SECRETARIA", "FINANCEIRO"]),
  area_rotulo: z.string(),
  total_protocolos: z.number().int(),
  total_tarefas_abertas: z.number().int(),
  risco_cents: z.number().int(),
  risco: z.string(),
  por_motivo: z.array(z.object({ motivo: z.string(), protocolos: z.number().int(), risco_cents: z.number().int(), risco: z.string(), protocol_numbers: z.array(z.string()) })),
  limite_aplicado: z.number().int(),
  truncado: z.boolean(),
  observacao: z.string(),
  itens: z.array(esquemaItem),
});

interface LinhaPendencia {
  protocol_number: string;
  validation_status: string;
  workflow_status: string;
  current_risk_cents: number;
  titulos: string;
  tarefas: number;
  aberta_desde: string;
}

interface LinhaMotivo {
  motivo: string;
  protocolos: number;
  risco_cents: number;
  numeros: string;
}

/**
 * `minhas_pendencias` (PRD-SDD §23.3/§23.4): nunca recebe área — deriva de `contexto.papel`
 * (credencial autenticada). Emite links HMAC de revisão (finalidade `review`) quando há chave de
 * assinatura configurada.
 *
 * **A saída é uma linha por PROTOCOLO, não por tarefa, e cada número diz o que conta.** A versão
 * anterior devolvia `total` sem dizer que eram tarefas e somava `total_valor_cents` por linha de
 * tarefa: um protocolo com duas tarefas abertas na mesma área entrava duas vezes na soma de
 * risco, contra o invariante "risco conta uma vez por protocolo" (CLAUDE.md).
 *
 * `por_motivo` vem agrupado do banco: o prompt da fila pedia ao assistente para agrupar, e
 * agrupar à mão é onde a soma sai errada. Como um protocolo pode ter mais de uma pendência, a
 * soma de `por_motivo` pode passar de `total_protocolos` — a resposta avisa.
 */
export function registrarMinhasPendencias(server: McpServer, env: Env, contexto: ContextoMcp): void {
  server.registerTool(
    "minhas_pendencias",
    {
      title: "Minha fila de pendências",
      description:
        "Fila da área da credencial (a área NÃO é parâmetro): um item por protocolo que espera esta área, já agrupado por motivo, com risco somado uma vez por protocolo e link de revisão. Os totais são da fila inteira, mesmo quando a lista vem cortada. Para contagens da clínica inteira use consultar_relatorio. Apresente o texto devolvido como veio; não recalcule totais.",
      inputSchema: schemaPendencias,
      outputSchema: esquemaSaidaPendencias,
      annotations: SOMENTE_LEITURA,
    },
    async (entrada) => {
      if (contexto.papel === "DIRECAO") {
        throw erroTool("ROLE_NOT_ALLOWED", "A Direção não tem fila própria de pendências. Use consultar_relatorio para a visão consolidada.");
      }

      const area = contexto.papel;
      const condicoes = ["t.assigned_area = ?", "t.status = 'ABERTA'", "p.workflow_status != 'MESCLADA'"];
      const valores: (string | number)[] = [area];
      if (entrada.data_de) {
        condicoes.push("substr(t.created_at_utc, 1, 10) >= ?");
        valores.push(entrada.data_de);
      }
      if (entrada.data_ate) {
        condicoes.push("substr(t.created_at_utc, 1, 10) <= ?");
        valores.push(entrada.data_ate);
      }
      if (entrada.estado) {
        condicoes.push("p.validation_status = ?");
        valores.push(entrada.estado);
      }
      const filtro = condicoes.join(" AND ");

      // Uma linha por protocolo: as tarefas viram contagem e lista de títulos.
      const linhas = await env.DB.prepare(
        `SELECT p.protocol_number, p.validation_status, p.workflow_status, p.current_risk_cents,
                GROUP_CONCAT(t.title, ' | ') AS titulos, COUNT(t.id) AS tarefas, MIN(t.created_at_utc) AS aberta_desde
         FROM tasks t JOIN protocols p ON p.id = t.protocol_id
         WHERE ${filtro}
         GROUP BY p.id
         ORDER BY aberta_desde ASC
         LIMIT ?`,
      )
        .bind(...valores, entrada.limite)
        .all<LinhaPendencia>();

      // Totais vêm do banco inteiro, não da página: o risco soma cada protocolo UMA vez.
      const totais = await env.DB.prepare(
        `SELECT COUNT(DISTINCT p.id) AS protocolos, COUNT(t.id) AS tarefas
         FROM tasks t JOIN protocols p ON p.id = t.protocol_id
         WHERE ${filtro}`,
      )
        .bind(...valores)
        .first<{ protocolos: number; tarefas: number }>();

      // Risco à parte, agrupando por protocolo ANTES de somar: é o que impede contar duas vezes
      // o mesmo protocolo quando ele tem mais de uma tarefa aberta para a área.
      const risco = await env.DB.prepare(
        `SELECT COALESCE(SUM(risco), 0) AS risco_cents FROM (
           SELECT p.id, p.current_risk_cents AS risco
           FROM tasks t JOIN protocols p ON p.id = t.protocol_id
           WHERE ${filtro}
           GROUP BY p.id
         )`,
      )
        .bind(...valores)
        .first<{ risco_cents: number }>();

      // Agrupamento por motivo da fila INTEIRA (não da página). A subconsulta reduz a uma linha
      // por (motivo, protocolo) ANTES de somar, para o risco entrar uma vez por protocolo dentro
      // de cada motivo — mesmo invariante do total.
      const motivos = await env.DB.prepare(
        `SELECT motivo, COUNT(*) AS protocolos, COALESCE(SUM(risco), 0) AS risco_cents, GROUP_CONCAT(numero) AS numeros
         FROM (
           SELECT t.title AS motivo, p.id, p.current_risk_cents AS risco, p.protocol_number AS numero
           FROM tasks t JOIN protocols p ON p.id = t.protocol_id
           WHERE ${filtro}
           GROUP BY t.title, p.id
         )
         GROUP BY motivo
         ORDER BY risco_cents DESC, protocolos DESC, motivo ASC`,
      )
        .bind(...valores)
        .all<LinhaMotivo>();

      const agora = new Date().toISOString();
      const itens = await Promise.all(
        linhas.results.map(async (linha) => {
          const link = env.LINK_SIGNING_KEY
            ? await assinarLink({ finalidade: "review", recursoId: linha.protocol_number, area }, env.LINK_SIGNING_KEY, agora, new GeradorIdCrypto())
            : null;
          return {
            numero_protocolo: linha.protocol_number,
            status_validacao: linha.validation_status,
            status_validacao_rotulo: apresentarValidacaoStatus(linha.validation_status as ValidacaoStatus),
            status_fluxo: linha.workflow_status,
            status_fluxo_rotulo: apresentarFluxoStatus(linha.workflow_status as FluxoStatus),
            risco_cents: linha.current_risk_cents,
            risco: formatarCentavos(linha.current_risk_cents),
            tarefas_abertas: linha.tarefas,
            pendencias: linha.titulos.split(" | "),
            aberta_desde_utc: linha.aberta_desde,
            aberta_desde: formatarDataCurta(linha.aberta_desde),
            url_revisao: link ? `/protocolos/${encodeURIComponent(linha.protocol_number)}?token=${encodeURIComponent(link.token)}` : null,
            expira_em_utc: link?.payload.expiraEmUtc ?? null,
          };
        }),
      );

      const totalProtocolos = totais?.protocolos ?? 0;
      const porMotivo = motivos.results.map((m) => ({
        motivo: m.motivo,
        protocolos: m.protocolos,
        risco_cents: m.risco_cents,
        risco: formatarCentavos(m.risco_cents),
        protocol_numbers: (m.numeros ?? "").split(",").filter((n) => n.length > 0).sort(),
      }));

      const saida = {
        area,
        area_rotulo: apresentarArea(area),
        total_protocolos: totalProtocolos,
        total_tarefas_abertas: totais?.tarefas ?? 0,
        risco_cents: risco?.risco_cents ?? 0,
        risco: formatarCentavos(risco?.risco_cents ?? 0),
        por_motivo: porMotivo,
        limite_aplicado: entrada.limite,
        truncado: itens.length < totalProtocolos,
        observacao:
          "Um item por protocolo. total_tarefas_abertas conta tarefas (um protocolo pode ter mais de uma); risco_cents soma cada protocolo uma única vez. Em por_motivo, um protocolo com duas pendências aparece em dois motivos, então a soma dos motivos pode passar de total_protocolos.",
        itens,
      };

      const somaMotivos = porMotivo.reduce((total, m) => total + m.protocolos, 0);
      const avisoMotivos = somaMotivos > totalProtocolos ? `\n\n> A soma por motivo (${somaMotivos}) passa do total de protocolos (${totalProtocolos}) porque um protocolo pode ter mais de uma pendência.` : "";

      const texto =
        totalProtocolos === 0
          ? `## Fila da ${saida.area_rotulo}\n\n_Nenhuma pendência aberta para esta área${entrada.estado || entrada.data_de || entrada.data_ate ? " com os filtros informados" : ""}._`
          : `## Fila da ${saida.area_rotulo}

**${totalProtocolos} protocolo(s)** aguardando esta área · ${saida.total_tarefas_abertas} pendência(s) aberta(s) · risco **${saida.risco}**

**Por motivo**

${tabela(["Motivo", "Protocolos", "Risco", "Números"], porMotivo.map((m) => [m.motivo, m.protocolos, m.risco, m.protocol_numbers.join(", ")]))}${avisoMotivos}

**Protocolos, do mais antigo para o mais recente**

${tabela(
  ["Protocolo", "Estado", "Pendências", "Risco", "Aberta desde", "Revisar"],
  itens.map((i) => [i.numero_protocolo, i.status_validacao_rotulo, i.pendencias.join("; "), i.risco, i.aberta_desde, i.url_revisao ? `[abrir](${i.url_revisao})` : "—"]),
)}${avisoTruncado(itens.length, totalProtocolos, "protocolos")}

_Decidir, corrigir e liberar é na tela do protocolo (link em "Revisar")._`;

      return responder(texto, saida);
    },
  );
}
