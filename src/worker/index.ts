import { Roteador, respostaJsonErro, type ManipuladorRota } from "../http/routes";
import { manipularRelatorio } from "../http/handlers/report";
import { manipularListaProtocolos } from "../http/handlers/protocols-list";
import { manipularDetalheProtocolo } from "../http/handlers/protocol-detail";
import { manipularRegrasAtivas } from "../http/handlers/rules";
import { manipularCadastroProtocolo } from "../http/handlers/create-protocol";
import { manipularCriacaoVersaoProtocolo } from "../http/handlers/create-version";
import { manipularLiberacaoProtocolo } from "../http/handlers/release";
import { manipularImportacaoGuias } from "../http/handlers/imports";
import { manipularTrocaSessao } from "../http/handlers/session";

export interface Env {
  DB: D1Database;
  EVIDENCE: R2Bucket;
  AI: Ai;
  ASSETS: Fetcher;
  MCP_SECRETARIA_TOKEN?: string;
  MCP_FINANCEIRO_TOKEN?: string;
  LINK_SIGNING_KEY?: string;
}

/**
 * Andaime temporário: nenhum handler de negócio desta fase foi escrito ainda (outros agentes
 * fazem isso em paralelo, importando `src/http/contracts.ts` e `src/http/routes.ts`). Até lá,
 * toda rota reconhecida responde 501 em vez de 404 — o roteamento já existe, a implementação
 * ainda não. Troque cada entrada abaixo pelo handler real assim que ele existir; o padrão de
 * caminho e o método já são o contrato fixado (PRD-SDD §24) e não devem mudar aqui.
 */
const handlerNaoImplementado: ManipuladorRota = async () =>
  respostaJsonErro(
    501,
    "HANDLER_NAO_IMPLEMENTADO",
    "Rota reconhecida, mas o handler ainda não foi implementado nesta fase.",
  );

const roteador = new Roteador()
  .get("/api/report", manipularRelatorio)
  .get("/api/protocols", manipularListaProtocolos)
  .get("/api/protocols/:numero", manipularDetalheProtocolo)
  .post("/api/protocols", manipularCadastroProtocolo)
  .post("/api/protocols/:numero/versions", manipularCriacaoVersaoProtocolo)
  .post("/api/protocols/:numero/release", manipularLiberacaoProtocolo)
  .post("/api/imports", manipularImportacaoGuias)
  .get("/api/rules", manipularRegrasAtivas)
  .post("/api/session", manipularTrocaSessao);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        status: "ok",
        app: "vitalis-barreira-glosas",
        bindings: {
          DB: Boolean(env.DB),
          EVIDENCE: Boolean(env.EVIDENCE),
          AI: Boolean(env.AI),
        },
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return roteador.despachar(request, env);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
