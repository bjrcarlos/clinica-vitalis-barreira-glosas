import { useEffect, useState, type FormEvent } from "react";
import { ApiError, trocarSessao, type PapelSessao } from "../lib/api";
import styles from "./TrocaDePapel.module.css";

interface TrocaDePapelProps {
  readonly papelInicial?: PapelSessao;
  /** Chamado depois que o servidor confirma a troca — o pai decide se refaz alguma busca. */
  readonly aoTrocar?: (papel: PapelSessao) => void;
}

const OPCOES: ReadonlyArray<{ valor: PapelSessao; rotulo: string }> = [
  { valor: "SECRETARIA", rotulo: "Secretaria" },
  { valor: "FINANCEIRO", rotulo: "Financeiro" },
  { valor: "DIRECAO", rotulo: "Direção · leitura" },
];

/**
 * Nome fictício por trás de cada identidade funcional da demonstração (PRD §8) — mesmos nomes de
 * `design-reference/*.dc.html` (avatar + nome na sidebar: "Dr. Renato" para Direção, "Ana Ferraz"
 * para Financeiro, "Júlia Prado" para Secretaria). Não é dado de negócio, nada aqui é persistido
 * em D1 — é só o rótulo que a saudação do relatório usa no lugar do nome do sistema.
 */
export const NOME_POR_PAPEL: Readonly<Record<PapelSessao, string>> = {
  DIRECAO: "Dr. Renato",
  FINANCEIRO: "Ana Ferraz",
  SECRETARIA: "Júlia Prado",
};

/**
 * Nome de quem está por trás da identidade funcional atual. Mesma fonte que o seletor usa para
 * lembrar a última troca entre reloads (`lerPapelSalvo`/`localStorage`, conveniência só deste
 * navegador) — sem cookie salvo ainda, a identidade padrão é Direção.
 */
export function nomeDaIdentidadeAtual(): string {
  return NOME_POR_PAPEL[lerPapelSalvo() ?? "DIRECAO"];
}

/**
 * O cookie de sessão (`vitalis_sessao`) é HttpOnly — por desenho, o JavaScript do cliente nunca
 * o lê (só o servidor verifica a assinatura). Sem isso, um F5 sempre reabre a SPA sem saber que
 * papel o cookie ainda carrega e o seletor volta para "Direção" por padrão, mesmo que a sessão
 * no servidor continue válida. Para o seletor refletir a última escolha em vez de mentir depois
 * de um reload (ou de um link aberto em nova aba), a última troca bem-sucedida fica também em
 * `localStorage` (só uma conveniência de exibição deste navegador) e, ao montar, o componente
 * repete a troca no servidor — restaura o cookie (inclusive se já tiver expirado) e sincroniza
 * o valor mostrado, sem depender de nenhuma rota nova fora do contrato desta fase.
 */
const CHAVE_PAPEL_LOCAL = "vitalis:identidade-demonstracao";

function lerPapelSalvo(): PapelSessao | null {
  try {
    const valor = window.localStorage.getItem(CHAVE_PAPEL_LOCAL);
    return valor === "SECRETARIA" || valor === "FINANCEIRO" || valor === "DIRECAO" ? valor : null;
  } catch {
    return null;
  }
}

function salvarPapel(papel: PapelSessao): void {
  try {
    window.localStorage.setItem(CHAVE_PAPEL_LOCAL, papel);
  } catch {
    // Sem localStorage (modo privado, storage bloqueado) só perde a conveniência entre reloads.
  }
}

/**
 * Seletor da identidade funcional da demonstração (PRD §8: OAuth fora de escopo).
 * Chama `POST /api/session`; o papel real de cada mutação sempre vem do cookie assinado
 * que o servidor devolve — este componente só pede a troca, nunca decide autorização.
 */
export function TrocaDePapel({ papelInicial, aoTrocar }: TrocaDePapelProps) {
  const [papel, setPapel] = useState<PapelSessao>(() => papelInicial ?? lerPapelSalvo() ?? "DIRECAO");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function trocar(novoPapel: PapelSessao) {
    setCarregando(true);
    setErro(null);
    try {
      await trocarSessao(novoPapel);
      salvarPapel(novoPapel);
      setPapel(novoPapel);
      aoTrocar?.(novoPapel);
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : "Não foi possível trocar de identidade agora.");
    } finally {
      setCarregando(false);
    }
  }

  // Reabre a sessão do papel lembrado ao montar (reload de página ou link em nova aba) — nunca
  // na primeira visita (nada salvo ainda) nem quando o pai já controla `papelInicial` de fora.
  useEffect(() => {
    if (papelInicial !== undefined) return;
    const salvo = lerPapelSalvo();
    if (salvo && salvo !== "DIRECAO") void trocar(salvo);
    // Intencional: roda só na montagem, não a cada troca de `papel`/`trocar`.
  }, []);

  async function aoSubmeter(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    await trocar(papel);
  }

  return (
    <form className={styles.form} onSubmit={aoSubmeter}>
      <label htmlFor="troca-de-papel" className={styles.rotulo}>
        Identidade da demonstração
      </label>
      <div className={styles.linha}>
        <select
          id="troca-de-papel"
          className={styles.select}
          value={papel}
          onChange={(evento) => setPapel(evento.target.value as PapelSessao)}
        >
          {OPCOES.map((opcao) => (
            <option key={opcao.valor} value={opcao.valor}>
              {opcao.rotulo}
            </option>
          ))}
        </select>
        <button type="submit" className={styles.botao} disabled={carregando}>
          {carregando ? "Trocando…" : "Trocar"}
        </button>
      </div>
      {erro ? (
        <p role="alert" className={styles.erro}>
          {erro}
        </p>
      ) : null}
    </form>
  );
}
