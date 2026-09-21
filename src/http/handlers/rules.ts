import type { ManipuladorRota } from "../routes";
import { ErroDominio } from "../routes";
import { esquemaRegrasAtivasResposta, type RegrasAtivasResposta } from "../contracts";
import { carregarRegrasAtivas } from "./create-protocol";

/**
 * GET /api/rules — devolve a regra de convênio ativa (versão, hash, datas de
 * importação/ativação) e, desde a auditoria da Fase 2, o catálogo completo (convênios,
 * procedimentos, definições) para as telas "Nova guia"/"Regras" exibirem sem ler
 * `regras_convenio.json.txt`/`src/rules` direto no bundle do cliente (achado de dependência:
 * `ui → application → domain+rules`, CLAUDE.md). `carregarRegrasAtivas` é a mesma leitura de
 * `rule_sets.source_json` que `src/http/handlers/create-protocol.ts` já faz para validar — uma
 * única fonte, nunca uma cópia divergente para exibição.
 *
 * `origem` não tem coluna própria em `rule_sets`; RN-01 fixa a fonte oficial como
 * `regras_convenio.json`, por isso o valor é constante aqui.
 */

const ORIGEM_REGRAS_OFICIAIS = "regras_convenio.json";

interface LinhaRegraAtiva {
  readonly version: string;
  readonly source_sha256: string;
  readonly imported_at_utc: string;
  readonly activated_at_utc: string | null;
}

export async function montarRegrasAtivas(db: D1Database): Promise<RegrasAtivasResposta> {
  const linha = await db
    .prepare(
      `SELECT version, source_sha256, imported_at_utc, activated_at_utc
       FROM rule_sets
       WHERE is_active = 1
       LIMIT 1`,
    )
    .first<LinhaRegraAtiva>();

  if (linha === null) {
    throw new ErroDominio("REGRA_NAO_ENCONTRADA", "Nenhuma regra de convênio ativa encontrada.", 404);
  }

  const regras = await carregarRegrasAtivas(db);

  return esquemaRegrasAtivasResposta.parse({
    versao: linha.version,
    sha256: linha.source_sha256,
    origem: ORIGEM_REGRAS_OFICIAIS,
    importada_em_utc: linha.imported_at_utc,
    ativada_em_utc: linha.activated_at_utc,
    convenios: regras.convenios,
    procedimentos: regras.procedimentos,
    definicoes: regras.definicoes,
  });
}

export const manipularRegrasAtivas: ManipuladorRota = async (ctx) => {
  const resposta = await montarRegrasAtivas(ctx.env.DB);
  return Response.json(resposta);
};
