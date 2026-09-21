import { useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { TrocaDePapel } from "./components/TrocaDePapel";
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

  return (
    <BrowserRouter>
      <div className={styles.layout}>
        <Sidebar rodape={<TrocaDePapel />} />
        <div className={styles.coluna}>
          <Topbar busca={busca} aoMudarBusca={setBusca} />
          <main className={styles.conteudo}>
            <AppRoutes />
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}
