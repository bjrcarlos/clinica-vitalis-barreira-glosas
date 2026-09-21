import { Route, Routes } from "react-router-dom";
import { Relatorio } from "./pages/Relatorio";
import { Dashboard } from "./pages/Dashboard";
import { Guias } from "./pages/Guias";
import { Protocolo } from "./pages/Protocolo";
import { Pendencias } from "./pages/Pendencias";
import { Importar } from "./pages/Importar";
import { NovaGuia } from "./pages/NovaGuia";
import { Regras } from "./pages/Regras";

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
 *   /importar            -> src/ui/pages/Importar.tsx   (design-reference/Importar.dc.html)
 *   /nova-guia           -> src/ui/pages/NovaGuia.tsx   (design-reference/NovaGuia.dc.html)
 *   /regras              -> src/ui/pages/Regras.tsx     (design-reference/Regras.dc.html)
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Relatorio />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/guias" element={<Guias />} />
      <Route path="/protocolos/:numero" element={<Protocolo />} />
      <Route path="/pendencias" element={<Pendencias />} />
      <Route path="/importar" element={<Importar />} />
      <Route path="/nova-guia" element={<NovaGuia />} />
      <Route path="/regras" element={<Regras />} />
    </Routes>
  );
}
