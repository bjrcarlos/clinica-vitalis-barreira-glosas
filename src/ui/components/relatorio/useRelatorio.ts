import { useCallback, useEffect, useState } from "react";
import { ApiError, obterRelatorio } from "../../lib/api";
import type { RelatorioResposta } from "./tipos";

interface EstadoRelatorio {
  readonly relatorio: RelatorioResposta | null;
  readonly carregando: boolean;
  readonly erro: string | null;
  /** Refaz a busca (ex.: botão "Tentar novamente" ou "Atualizar"). */
  readonly recarregar: () => void;
}

/**
 * Busca `GET /api/report` (RF-14/§27) — única fonte de dados de Relatório e Dashboard.
 * Compartilhado pelas duas telas para não duplicar o ciclo de carregando/erro/nova tentativa.
 */
export function useRelatorio(): EstadoRelatorio {
  const [relatorio, setRelatorio] = useState<RelatorioResposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const controlador = new AbortController();
    setCarregando(true);
    setErro(null);
    obterRelatorio<RelatorioResposta>(controlador.signal)
      .then((resposta) => {
        if (controlador.signal.aborted) return;
        setRelatorio(resposta);
      })
      .catch((falha: unknown) => {
        if (controlador.signal.aborted) return;
        setErro(falha instanceof ApiError ? falha.message : "Não foi possível carregar o relatório agora.");
      })
      .finally(() => {
        if (!controlador.signal.aborted) setCarregando(false);
      });
    return () => controlador.abort();
  }, [tentativa]);

  const recarregar = useCallback(() => setTentativa((n) => n + 1), []);

  return { relatorio, carregando, erro, recarregar };
}
