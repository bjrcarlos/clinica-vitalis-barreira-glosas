import { useEffect, useRef, useState } from "react";
import styles from "./BotaoCopiar.module.css";

interface BotaoCopiarProps {
  /** Texto a copiar para a área de transferência. */
  readonly texto: string;
}

type Estado = "ocioso" | "copiado" | "falhou";

/**
 * Botão "Copiar" para textos longos (ex.: comando de instalação do MCP em `Conectar.tsx`).
 * Usa `navigator.clipboard` quando disponível, com fallback a `document.execCommand("copy")`
 * via um `<textarea>` invisível para navegadores sem a API. O resultado (sucesso ou falha) fica
 * numa região `aria-live="polite"` para quem usa leitor de tela — a troca do rótulo do botão
 * sozinha não garante o anúncio.
 */
export function BotaoCopiar({ texto }: BotaoCopiarProps) {
  const [estado, setEstado] = useState<Estado>("ocioso");
  const timeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timeoutRef.current), []);

  async function aoClicar() {
    const sucesso = await copiarParaAreaDeTransferencia(texto);
    setEstado(sucesso ? "copiado" : "falhou");
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setEstado("ocioso"), 2000);
  }

  return (
    <div className={styles.wrap} aria-live="polite">
      <button type="button" className={styles.botao} onClick={aoClicar}>
        {estado === "copiado" ? "Copiado ✓" : "Copiar"}
      </button>
      {estado === "falhou" && <span className={styles.aviso}>Não foi possível copiar — selecione o texto acima.</span>}
    </div>
  );
}

async function copiarParaAreaDeTransferencia(texto: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      // Segue para o fallback abaixo (ex.: página não está em contexto seguro).
    }
  }
  const area = document.createElement("textarea");
  area.value = texto;
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.setAttribute("aria-hidden", "true");
  document.body.appendChild(area);
  area.focus();
  area.select();
  let copiado = false;
  try {
    copiado = document.execCommand("copy");
  } catch {
    copiado = false;
  }
  document.body.removeChild(area);
  return copiado;
}
