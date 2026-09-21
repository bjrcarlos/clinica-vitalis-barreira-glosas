const FUSO_BRASILIA = "America/Sao_Paulo";

/**
 * Saudação por horário do dia, calculada no fuso de Brasília a partir do relógio real do
 * navegador. A sessão de demonstração (PRD §8) carrega só um papel funcional (Secretaria,
 * Financeiro, Direção) — nenhum nome de pessoa é persistido em lugar nenhum do sistema —,
 * então esta função nunca fabrica um nome próprio; quem chama decide o que vem depois da
 * vírgula (ex.: "Vitalis").
 */
export function saudacaoPorHorario(agora: Date = new Date()): string {
  const hora = Number(
    new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", hour12: false, timeZone: FUSO_BRASILIA }).format(agora),
  );
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}
