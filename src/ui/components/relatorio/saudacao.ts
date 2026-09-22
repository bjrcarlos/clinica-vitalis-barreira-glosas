const FUSO_BRASILIA = "America/Sao_Paulo";

/**
 * Saudação por horário do dia, calculada no fuso de Brasília a partir do relógio real do
 * navegador. Esta função só decide "Bom dia"/"Boa tarde"/"Boa noite" — nunca fabrica um nome
 * próprio; quem chama decide o que vem depois da vírgula (ver `TrocaDePapel.nomeDaIdentidadeAtual`,
 * que mapeia o papel funcional da demonstração — PRD §8 — para o nome fictício da pessoa).
 */
export function saudacaoPorHorario(agora: Date = new Date()): string {
  const hora = Number(
    new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", hour12: false, timeZone: FUSO_BRASILIA }).format(agora),
  );
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}
