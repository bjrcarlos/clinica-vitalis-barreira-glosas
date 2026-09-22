import type { UsuarioAtual } from "../lib/api";
import styles from "./IdentidadeAtual.module.css";

const ROTULO_PAPEL: Readonly<Record<string, string>> = {
  SECRETARIA: "Secretaria",
  FINANCEIRO: "Financeiro",
  DIRECAO: "Direção · leitura",
};

function iniciais(nome: string): string {
  return nome
    .split(/\s+/)
    .filter((parte) => parte.length > 2 || /^[A-ZÁÉÍÓÚ]/.test(parte))
    .slice(0, 2)
    .map((parte) => parte.charAt(0).toUpperCase())
    .join("");
}

/**
 * Rodapé da barra lateral quando existe uma conta logada: substitui o seletor de identidade da
 * demonstração, porque com login de verdade o papel deixa de ser uma escolha de tela — ele vem
 * da conta, igual ao que o MCP enxerga.
 *
 * "Sair" é um formulário POST de verdade (não `fetch`): a sessão vive em cookie HttpOnly e o
 * servidor precisa responder com o `Set-Cookie` de expiração numa navegação.
 */
export function IdentidadeAtual({ usuario }: { readonly usuario: UsuarioAtual }) {
  if (!usuario.autenticado || !usuario.nome || !usuario.papel) return null;

  return (
    <div className={styles.caixa}>
      <div className={styles.linha}>
        <span className={styles.avatar} aria-hidden="true">
          {iniciais(usuario.nome)}
        </span>
        <span className={styles.textos}>
          <span className={styles.nome}>{usuario.nome}</span>
          <span className={styles.papel}>{ROTULO_PAPEL[usuario.papel] ?? usuario.papel}</span>
        </span>
      </div>
      <form method="post" action="/sair">
        <button type="submit" className={styles.sair}>
          Sair
        </button>
      </form>
    </div>
  );
}
