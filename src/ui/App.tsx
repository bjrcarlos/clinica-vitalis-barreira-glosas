import { useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { TrocaDePapel, papelSalvoOuPadrao } from "./components/TrocaDePapel";
import type { PapelSessao } from "./lib/api";
import { AppRoutes } from "./routes";
import styles from "./App.module.css";

/**
 * Layout raiz: sidebar + topbar fixos, conteúdo trocando por rota (ver src/ui/routes.tsx).
 * O contador de pendências da sidebar e o selo de regra ativa da topbar ainda não têm fonte
 * de dados nesta tarefa (esqueleto visual) — ficam `undefined` até a página que os busca
 * (GET /api/rules, GET /api/protocols) ser ligada.
 */
export default function App() {
  const [busca, setBusca] = useState("");
  // A identidade funcional vive aqui, e não dentro do seletor: trocar de papel muda o que o
  // servidor autoriza, então cada tela precisa buscar de novo com o cookie novo. A `key` em
  // <AppRoutes> remonta a árvore de rotas a cada troca, que é o que faz a tela refletir a
  // mudança — sem isso o cookie trocava no servidor e a interface continuava mostrando o
  // estado da identidade anterior.
  const [papel, setPapel] = useState<PapelSessao>(() => papelSalvoOuPadrao());

  return (
    <BrowserRouter>
      <div className={styles.layout}>
        <Sidebar rodape={<TrocaDePapel papelInicial={papel} aoTrocar={setPapel} />} />
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
