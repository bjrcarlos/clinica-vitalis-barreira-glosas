export interface Env {
  DB: D1Database;
  EVIDENCE: R2Bucket;
  AI: Ai;
  ASSETS: Fetcher;
  MCP_SECRETARIA_TOKEN?: string;
  MCP_FINANCEIRO_TOKEN?: string;
  LINK_SIGNING_KEY?: string;
}

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

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
