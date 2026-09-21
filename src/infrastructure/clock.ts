import type { Relogio } from "../application/ports";

/** Relógio real: cada chamada lê o instante UTC atual do runtime (Worker ou Node). */
export class RelogioReal implements Relogio {
  agoraUtc(): string {
    return new Date().toISOString();
  }
}

/** Relógio fixo para testes: sempre devolve o mesmo instante, injetado na construção. */
export class RelogioFixo implements Relogio {
  constructor(private readonly instanteUtc: string) {}

  agoraUtc(): string {
    return this.instanteUtc;
  }
}
