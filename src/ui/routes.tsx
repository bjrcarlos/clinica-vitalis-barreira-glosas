import { Navigate, Route, Routes } from "react-router-dom";
import { Relatorio } from "./pages/Relatorio";
import { Dashboard } from "./pages/Dashboard";
import { Guias } from "./pages/Guias";
import { Protocolo } from "./pages/Protocolo";
import { Pendencias } from "./pages/Pendencias";
import { Regras } from "./pages/Regras";
import { Merge } from "./pages/Merge";
import { Conectar } from "./pages/Conectar";

/**
 * Rotas da Fase 2 (docs/PRD-SDD.md §24, escopo fixado pelo orquestrador). Cada página é hoje
 * um placeholder — outro agente preenche o conteúdo real em paralelo, no arquivo já indicado
 * ao lado. Arquivo da página ↔ tela do design-reference:
 *
 *   /                    -> src/ui/pages/Relatorio.tsx  (design-reference/Relatorio.dc.html)
 *   /dashboard           -> src/ui/pages/Dashboard.tsx  (design-reference/Dashboard.dc.html)
 *   /guias               -> src/ui/pages/Guias.tsx      (design-reference/Guias.dc.html)
 *   /protocolos/:numero  -> src/ui/pages/Protocolo.tsx  (design-reference/Protocolo.dc.html)
 *   /pendencias          -> src/ui/pages/Pendencias.tsx (design-reference/Pendencias.dc.html)
 *   /importar            -> redireciona para /guias?modal=importar (modal sobre a lista, ver Guias.tsx)
 *   /nova-guia           -> redireciona para /guias?modal=nova-guia (modal sobre a lista, ver Guias.tsx)
 *   /regras              -> src/ui/pages/Regras.tsx     (design-reference/Regras.dc.html)
 *   /conectar            -> src/ui/pages/Conectar.tsx   (sem tela em design-reference; tutorial de instalação do MCP)
 *
 * "Importar" e "Nova guia" deixaram de ser páginas/itens de sidebar: viraram modais abertos
 * pelos botões de "Todas as guias" (src/ui/components/entrada/FormularioImportacao.tsx e
 * FormularioNovaGuia.tsx, dentro de src/ui/components/Modal.tsx). As duas rotas continuam
 * existindo só para não quebrar link antigo — o parâmetro `modal` na URL é compartilhável,
 * como o resto dos filtros de "Todas as guias".
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Relatorio />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/guias" element={<Guias />} />
      <Route path="/protocolos/:numero" element={<Protocolo />} />
      <Route path="/pendencias" element={<Pendencias />} />
      <Route path="/importar" element={<Navigate to="/guias?modal=importar" replace />} />
      <Route path="/nova-guia" element={<Navigate to="/guias?modal=nova-guia" replace />} />
      <Route path="/regras" element={<Regras />} />
      <Route path="/merge" element={<Merge />} />
      <Route path="/conectar" element={<Conectar />} />
    </Routes>
  );
}
