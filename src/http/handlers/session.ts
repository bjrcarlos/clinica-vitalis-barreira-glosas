import type { ManipuladorRota } from "../routes";
import { lerCorpoJson } from "../routes";
import { esquemaTrocarSessaoEntrada, esquemaTrocarSessaoResposta, type TrocarSessaoResposta } from "../contracts";
import { assinarSessao, construirCabecalhoSetCookie } from "../../infrastructure/auth/session";
import type { PapelSessao } from "../../infrastructure/auth/session";

/**
 * POST /api/session — identidade funcional da demonstração (PRD-SDD §8: OAuth de produção
 * fora de escopo; CLAUDE.md "papel vem da credencial, nunca de parâmetro de entrada"). Esta é
 * a ÚNICA rota que lê `papel` do corpo — é o próprio propósito dela. Nenhuma outra rota de
 * mutação faz isso: todas usam `ctx.papel`, resolvido pelo roteador a partir do cookie
 * assinado que esta rota emite.
 *
 * Sem gate de papel aqui: qualquer visitante (inclusive o padrão `DIRECAO` sem sessão) pode
 * trocar de identidade funcional — é a mecânica de demonstração, não uma permissão a proteger.
 */

/** Núcleo testável, sem `Request`/`Response`: assina a sessão e devolve corpo + cabeçalho `Set-Cookie`. */
export async function trocarSessao(
  chaveSecreta: string | undefined,
  corpoBruto: unknown,
  agoraUtc: string,
  seguro: boolean,
): Promise<{ readonly corpo: TrocarSessaoResposta; readonly cabecalhoSetCookie: string }> {
  const entrada = esquemaTrocarSessaoEntrada.parse(corpoBruto);

  if (!chaveSecreta) {
    // Configuração ausente (dev sem `.dev.vars`) é falha inesperada de ambiente, não um erro
    // de domínio estável do CLAUDE.md — vira 500 via `respostaDeErro` (catch-all).
    throw new Error("LINK_SIGNING_KEY não configurada neste ambiente.");
  }

  const { valorCookie, sessao } = await assinarSessao(entrada.papel as PapelSessao, chaveSecreta, agoraUtc);
  const cabecalhoSetCookie = construirCabecalhoSetCookie(valorCookie, sessao.expiraEmUtc, seguro);

  const corpo: TrocarSessaoResposta = esquemaTrocarSessaoResposta.parse({
    papel: sessao.papel,
    expira_em_utc: sessao.expiraEmUtc,
  });

  return { corpo, cabecalhoSetCookie };
}

export const manipularTrocaSessao: ManipuladorRota = async (ctx) => {
  const corpoBruto = await lerCorpoJson(ctx.request);
  const seguro = ctx.url.protocol === "https:";
  const { corpo, cabecalhoSetCookie } = await trocarSessao(
    ctx.env.LINK_SIGNING_KEY,
    corpoBruto,
    new Date().toISOString(),
    seguro,
  );
  return Response.json(corpo, { headers: { "Set-Cookie": cabecalhoSetCookie } });
};
