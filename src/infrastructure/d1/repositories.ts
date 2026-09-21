import type { GeradorId, Relogio } from "../../application/ports";
import { RepositorioEventosD1 } from "./events";
import { RepositorioProtocolosD1 } from "./protocols";
import { RepositorioConjuntosDeRegrasD1 } from "./rule-sets";
import { RepositorioTarefasD1 } from "./tasks";
import { RepositorioValidacoesD1 } from "./validations";
import { RepositorioVersoesD1 } from "./versions";

export { RepositorioEventosD1 } from "./events";
export { RepositorioProtocolosD1 } from "./protocols";
export { RepositorioConjuntosDeRegrasD1 } from "./rule-sets";
export { RepositorioTarefasD1 } from "./tasks";
export { RepositorioValidacoesD1 } from "./validations";
export { RepositorioVersoesD1 } from "./versions";

/** Um repositório D1 por porta de `application/ports.ts`, prontos para injetar nos casos de uso. */
export interface RepositoriosD1 {
  readonly protocolos: RepositorioProtocolosD1;
  readonly versoes: RepositorioVersoesD1;
  readonly validacoes: RepositorioValidacoesD1;
  readonly tarefas: RepositorioTarefasD1;
  readonly eventos: RepositorioEventosD1;
  readonly conjuntosDeRegras: RepositorioConjuntosDeRegrasD1;
}

/** Constrói todos os repositórios D1 desta fase, compartilhando o mesmo `db`, `ids` e `relogio`. */
export function criarRepositoriosD1(db: D1Database, ids: GeradorId, relogio: Relogio): RepositoriosD1 {
  return {
    protocolos: new RepositorioProtocolosD1(db, ids, relogio),
    versoes: new RepositorioVersoesD1(db),
    validacoes: new RepositorioValidacoesD1(db, ids),
    tarefas: new RepositorioTarefasD1(db, ids, relogio),
    eventos: new RepositorioEventosD1(db, ids),
    conjuntosDeRegras: new RepositorioConjuntosDeRegrasD1(db, ids, relogio),
  };
}
