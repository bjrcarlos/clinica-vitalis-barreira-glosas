import type { PapelSessao } from "../../lib/api";

/**
 * Papel atual só para DECISÃO DE EXIBIÇÃO nesta tela (Fase 3: "ações de fluxo exibidas conforme
 * o papel atual"). Nunca é autorização — o cookie de sessão é HttpOnly (`src/infrastructure/auth/
 * session.ts`), o JavaScript do cliente nunca o lê, e cada handler confere o papel de verdade a
 * partir dele. Quando o papel mostrado aqui não bater com o cookie real, o servidor recusa com
 * `ROLE_NOT_ALLOWED` e a tela mostra o erro — a interface só evita mostrar um botão habilitado
 * para quem claramente não vai poder usá-lo.
 *
 * Reaproveita a MESMA chave de `localStorage` que `src/ui/components/TrocaDePapel.tsx` grava
 * (o seletor global da sidebar, sempre visível — `App.tsx`) — não uma cópia própria: esse
 * componente está fora do escopo de arquivos desta tarefa (só leitura aqui, nunca escrita), e
 * usar uma chave diferente faria esta tela discordar do seletor que a pessoa vê na tela.
 * `src/ui/pages/Pendencias.tsx` optou por uma chave própria porque também renderiza seu próprio
 * seletor local; esta tela não renderiza um segundo seletor, só lê o global.
 */
const CHAVE_PAPEL_GLOBAL = "vitalis:identidade-demonstracao";

export function lerPapelAtual(): PapelSessao {
  try {
    const valor = window.localStorage.getItem(CHAVE_PAPEL_GLOBAL);
    if (valor === "SECRETARIA" || valor === "FINANCEIRO" || valor === "DIRECAO") return valor;
  } catch {
    // localStorage indisponível (aba privada, storage bloqueado) — segue com o padrão.
  }
  return "DIRECAO";
}
