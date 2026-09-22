import { useEffect, useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { TrocaDePapel, papelSalvoOuPadrao } from "./components/TrocaDePapel";
import { IdentidadeAtual } from "./components/IdentidadeAtual";
import { obterUsuarioAtual, type PapelSessao, type UsuarioAtual } from "./lib/api";
import { AppRoutes } from "./routes";
import styles from "./App.module.css";

/**
 * Layout raiz: sidebar + topbar fixos, conteúdo trocando por rota (ver src/ui/routes.tsx).
 *
 * A identidade vive aqui, e não dentro do seletor: trocar de papel muda o que o servidor
 * autoriza, então cada tela precisa buscar de novo com o cookie novo. A `key` em <AppRoutes>
 * remonta a árvore de rotas a cada troca, que é o que faz a tela refletir a mudança.
 *
 * Duas origens de identidade, nesta ordem:
 *
 * 1. **Conta logada** (`GET /api/me`), quando a pessoa entrou por `/entrar` ou pelo fluxo OAuth
 *    do MCP. O papel é o da conta e não se escolhe na tela — é o mesmo papel que o assistente
 *    de IA recebe.
 * 2. **Identidade funcional da demonstração**, o seletor de sempre, para quem só quer navegar
 *    sem criar conta.
 */
export default function App() {
  const [busca, setBusca] = useState("");
  const [papel, setPapel] = useState<PapelSessao>(() => papelSalvoOuPadrao());
  const [usuario, setUsuario] = useState<UsuarioAtual | null>(null);

  useEffect(() => {
    const controlador = new AbortController();
    obterUsuarioAtual(controlador.signal)
      .then((resposta) => {
        if (controlador.signal.aborted) return;
        setUsuario(resposta);
        if (resposta.autenticado && resposta.papel) setPapel(resposta.papel);
      })
      .catch(() => {
        // Sem resposta de /api/me a interface segue na identidade funcional — nenhuma tela
        // depende desta chamada para funcionar.
      });
    return () => controlador.abort();
  }, []);

  const logado = usuario?.autenticado === true;

  return (
    <BrowserRouter>
      <div className={styles.layout}>
        <Sidebar
          usuario={usuario}
          rodape={
            logado && usuario ? <IdentidadeAtual usuario={usuario} /> : <TrocaDePapel papelInicial={papel} aoTrocar={setPapel} />
          }
        />
        <div className={styles.coluna}>
          <Topbar busca={busca} aoMudarBusca={setBusca} />
          <main className={styles.conteudo}>
            <AppRoutes key={papel} />
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}
