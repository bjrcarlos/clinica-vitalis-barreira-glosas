import { Card } from "../Card";
import { EstadoVazio } from "../EstadoVazio";

/**
 * Evidências (PRD §12.2, item 6). Upload em R2 é Fase 3 (fora de escopo desta tarefa) — a
 * resposta de `GET /api/protocols/:numero` desta fase nem carrega esse dado. A área fica vazia
 * de propósito, dizendo o que vem a seguir, em vez de simular uma lista de arquivos que não existe.
 */
export function EvidenciasProtocolo() {
  return (
    <Card>
      <h2 style={{ margin: 0, fontSize: 16 }}>Evidências</h2>
      <EstadoVazio
        titulo="Ainda não fazem parte desta etapa"
        descricao="Anexar PDF, JPG ou PNG como evidência entra na próxima etapa do produto."
      />
    </Card>
  );
}
