/**
 * Conversão entre `<input type="datetime-local">` (interpretado como hora de parede em
 * América/São Paulo — é o fuso operacional único desta demonstração, PRD §11 RF-11) e o instante
 * UTC ISO que o contrato de rede exige (`esquemaInstanteIso`, `src/http/contracts.ts`).
 *
 * Brasil não usa mais horário de verão desde 2019 — América/São Paulo é UTC-3 fixo, sem exceção
 * sazonal a considerar aqui. Por isso a conversão é uma soma simples de 3 horas, sem depender de
 * `Intl`/fuso do navegador (que poderia estar em outro fuso).
 */
const DESLOCAMENTO_BRASILIA_HORAS = 3;

/** `"YYYY-MM-DDTHH:mm"` ou `"YYYY-MM-DDTHH:mm:ss"` (valor de `datetime-local`) → instante UTC ISO. */
export function brasiliaLocalParaUtcIso(valorLocal: string): string {
  const comSegundos = valorLocal.length === 16 ? `${valorLocal}:00` : valorLocal;
  const [dataParte, horaParte] = comSegundos.split("T");
  const [ano, mes, dia] = dataParte.split("-").map(Number);
  const [hora, minuto, segundo] = horaParte.split(":").map(Number);
  const instanteUtcMs = Date.UTC(ano, mes - 1, dia, hora + DESLOCAMENTO_BRASILIA_HORAS, minuto, segundo);
  return new Date(instanteUtcMs).toISOString();
}

/** Instante UTC ISO → valor pronto para `<input type="datetime-local">` (hora de parede em Brasília). */
export function utcIsoParaBrasiliaLocal(isoUtc: string): string {
  const instante = new Date(new Date(isoUtc).getTime() + DESLOCAMENTO_BRASILIA_HORAS * 60 * 60 * 1000);
  const parte = (n: number) => String(n).padStart(2, "0");
  return (
    `${instante.getUTCFullYear()}-${parte(instante.getUTCMonth() + 1)}-${parte(instante.getUTCDate())}` +
    `T${parte(instante.getUTCHours())}:${parte(instante.getUTCMinutes())}`
  );
}

/** Agora, em hora de parede de Brasília, no formato de `datetime-local` — valor inicial dos formulários. */
export function agoraBrasiliaLocal(): string {
  return utcIsoParaBrasiliaLocal(new Date().toISOString());
}
