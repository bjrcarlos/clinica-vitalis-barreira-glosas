/**
 * Páginas servidas pelo próprio Worker durante o login e a autorização do cliente de IA.
 *
 * São HTML server-rendered, não a SPA: elas precisam existir antes de qualquer JavaScript da
 * aplicação carregar, e o navegador chega nelas vindo de um redirecionamento do cliente MCP.
 * O visual segue `docs/DESIGN.md` (mesmos tokens e fontes) para a pessoa reconhecer o sistema.
 *
 * Todo valor vindo de fora (nome do cliente, `state`, e-mail digitado) passa por `escaparHtml`
 * antes de entrar no documento — é uma tela que recebe parâmetros de terceiros por definição.
 */

export function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ESTILO = `
:root {
  --cor-fundo: #F4F3ED; --cor-superficie: #FBFAF6; --cor-card: #FFFFFF;
  --cor-borda: #E3E1D8; --cor-divisoria: #F1F0EA;
  --cor-texto: #14241E; --cor-texto-2: #3E5249; --cor-texto-3: #52604F; --cor-texto-4: #5A6660;
  --cor-primaria: #0F3B2E; --cor-primaria-clara: #1B6B4F; --cor-mint: #DDF3E4; --cor-mint-hover: #EEF6F0;
  --cor-ok-bg: #DDF3E4; --cor-ok-txt: #155C3F;
  --cor-nao-faturar-bg: #FCE3DF; --cor-nao-faturar-txt: #8F2B22;
  --raio-card: 18px; --raio-item: 10px; --raio-pill: 999px;
  --fonte-titulo: "Bricolage Grotesque", system-ui, sans-serif;
  --fonte-corpo: "Instrument Sans", system-ui, sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
  padding: 24px; background: var(--cor-fundo); color: var(--cor-texto);
  font-family: var(--fonte-corpo); font-size: 15px; line-height: 1.5;
}
.cartao {
  width: 100%; max-width: 460px; background: var(--cor-card); border: 1px solid var(--cor-borda);
  border-radius: var(--raio-card); padding: 32px; box-shadow: 0 12px 28px -14px rgba(15, 59, 46, .35);
}
.marca { display: flex; align-items: center; gap: 10px; margin-bottom: 22px; }
.marca-selo {
  width: 30px; height: 30px; border-radius: 9px; background: var(--cor-primaria); color: #fff;
  display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px;
}
.marca-nome { font-family: var(--fonte-titulo); font-weight: 600; font-size: 16px; }
h1 { margin: 0 0 6px; font-family: var(--fonte-titulo); font-size: 26px; line-height: 1.15; letter-spacing: -.02em; }
.apoio { margin: 0 0 22px; color: var(--cor-texto-3); font-size: 14px; }
label { display: block; font-size: 12px; font-weight: 600; color: var(--cor-texto-2); margin-bottom: 6px; }
input[type=email], input[type=password] {
  width: 100%; font: inherit; font-size: 15px; padding: 11px 13px; margin-bottom: 16px;
  border: 1px solid var(--cor-borda); border-radius: var(--raio-item); background: var(--cor-card); color: var(--cor-texto);
}
input:focus { outline: 0; border-color: var(--cor-primaria); box-shadow: 0 0 0 3px var(--cor-mint); }
button {
  font: inherit; font-size: 14px; font-weight: 600; padding: 12px 18px; width: 100%;
  border-radius: var(--raio-item); border: 1px solid var(--cor-primaria);
  background: var(--cor-primaria); color: #fff; cursor: pointer;
}
button:hover { background: var(--cor-primaria-clara); border-color: var(--cor-primaria-clara); }
button.secundario { background: var(--cor-card); color: var(--cor-texto-2); border-color: var(--cor-borda); }
button.secundario:hover { background: var(--cor-mint-hover); color: var(--cor-texto); }
.botoes { display: flex; gap: 10px; }
.erro {
  margin: 0 0 18px; padding: 11px 14px; border-radius: var(--raio-item);
  background: var(--cor-nao-faturar-bg); color: var(--cor-nao-faturar-txt); font-size: 13px; font-weight: 500;
}
.perfil {
  display: flex; align-items: center; gap: 12px; padding: 14px 16px; margin-bottom: 18px;
  border: 1px solid var(--cor-borda); border-radius: var(--raio-item); background: var(--cor-superficie);
}
.perfil-avatar {
  width: 38px; height: 38px; border-radius: 50%; background: var(--cor-mint); color: var(--cor-ok-txt);
  display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0;
}
.perfil-nome { font-weight: 600; font-size: 14px; }
.perfil-papel { font-size: 12px; color: var(--cor-texto-3); }
.pilula {
  display: inline-block; padding: 3px 10px; border-radius: var(--raio-pill);
  background: var(--cor-ok-bg); color: var(--cor-ok-txt); font-size: 11px; font-weight: 700;
  letter-spacing: .04em; text-transform: uppercase;
}
ul.permissoes { margin: 0 0 20px; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 9px; }
ul.permissoes li { display: flex; gap: 9px; font-size: 13.5px; color: var(--cor-texto-2); }
ul.permissoes li span { color: var(--cor-primaria-clara); font-weight: 700; flex-shrink: 0; }
.rodape { margin: 20px 0 0; padding-top: 16px; border-top: 1px solid var(--cor-divisoria); font-size: 12px; color: var(--cor-texto-4); }
.rodape a { color: var(--cor-primaria-clara); }
`;

function documento(titulo: string, corpo: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escaparHtml(titulo)} — Barreira de Glosas</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;600;700&family=Instrument+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>${ESTILO}</style>
</head>
<body>
<main class="cartao">
  <div class="marca"><div class="marca-selo" aria-hidden="true">V</div><div class="marca-nome">Barreira de Glosas · Vitalis</div></div>
  ${corpo}
</main>
</body>
</html>`;
}

export function respostaHtml(html: string, status = 200, cabecalhos: Record<string, string> = {}): Response {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      ...cabecalhos,
    },
  });
}

function camposOcultos(valores: Readonly<Record<string, string | null>>): string {
  return Object.entries(valores)
    .filter(([, valor]) => valor !== null && valor !== "")
    .map(([chave, valor]) => `<input type="hidden" name="${escaparHtml(chave)}" value="${escaparHtml(valor as string)}">`)
    .join("\n      ");
}

export interface DadosPaginaLogin {
  /** Para onde postar o formulário: `/oauth/authorize` no fluxo do MCP, `/entrar` no login direto. */
  readonly acao: string;
  readonly titulo: string;
  readonly apoio: string;
  readonly erro?: string;
  readonly emailPreenchido?: string;
  /** Parâmetros do fluxo OAuth que precisam sobreviver ao POST. */
  readonly ocultos?: Readonly<Record<string, string | null>>;
}

export function paginaLogin(dados: DadosPaginaLogin): string {
  return documento(
    "Entrar",
    `<h1>${escaparHtml(dados.titulo)}</h1>
  <p class="apoio">${escaparHtml(dados.apoio)}</p>
  ${dados.erro ? `<p class="erro" role="alert">${escaparHtml(dados.erro)}</p>` : ""}
  <form method="post" action="${escaparHtml(dados.acao)}">
      ${camposOcultos({ ...(dados.ocultos ?? {}), acao: "entrar" })}
      <label for="email">E-mail</label>
      <input id="email" name="email" type="email" autocomplete="username" required autofocus value="${escaparHtml(dados.emailPreenchido ?? "")}">
      <label for="senha">Senha</label>
      <input id="senha" name="senha" type="password" autocomplete="current-password" required>
      <button type="submit">Entrar</button>
  </form>
  <p class="rodape">Seu perfil — Secretaria, Financeiro ou Direção — vem desta conta. É ele que define o que você e o seu assistente de IA enxergam.</p>`,
  );
}

const ROTULO_PAPEL: Readonly<Record<string, string>> = {
  SECRETARIA: "Secretaria",
  FINANCEIRO: "Financeiro",
  DIRECAO: "Direção",
};

const PERMISSOES_POR_PAPEL: Readonly<Record<string, readonly string[]>> = {
  SECRETARIA: [
    "Consultar as regras dos convênios",
    "Conferir uma guia sem salvar nada",
    "Ver a fila de pendências da Secretaria",
    "Registrar uma guia nova quando você pedir",
    "Consultar o histórico de um protocolo",
  ],
  FINANCEIRO: [
    "Consultar as regras dos convênios",
    "Conferir uma guia sem salvar nada",
    "Ver a fila de pendências do Financeiro",
    "Consultar o histórico de um protocolo",
  ],
  DIRECAO: [
    "Consultar as regras dos convênios",
    "Conferir uma guia sem salvar nada",
    "Ler o relatório consolidado das duas áreas",
    "Consultar o histórico de um protocolo",
  ],
};

export interface DadosPaginaConsentimento {
  readonly nomeCliente: string;
  readonly nomeUsuario: string;
  readonly emailUsuario: string;
  readonly papel: string;
  readonly ocultos: Readonly<Record<string, string | null>>;
}

export function paginaConsentimento(dados: DadosPaginaConsentimento): string {
  const iniciais = dados.nomeUsuario
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte.charAt(0).toUpperCase())
    .join("");
  const permissoes = PERMISSOES_POR_PAPEL[dados.papel] ?? [];
  const naoPode =
    dados.papel === "DIRECAO"
      ? "Como Direção, o assistente não registra guia nem recebe fila de pendências."
      : dados.papel === "FINANCEIRO"
        ? "Como Financeiro, o assistente não registra guia nova — isso é da Secretaria."
        : "O assistente nunca libera, envia, encerra ou mescla: essas decisões continuam suas, na tela.";

  return documento(
    "Autorizar acesso",
    `<h1>Autorizar ${escaparHtml(dados.nomeCliente)}?</h1>
  <p class="apoio">Este assistente quer consultar a Barreira de Glosas em seu nome.</p>
  <div class="perfil">
    <div class="perfil-avatar" aria-hidden="true">${escaparHtml(iniciais || "V")}</div>
    <div>
      <div class="perfil-nome">${escaparHtml(dados.nomeUsuario)}</div>
      <div class="perfil-papel">${escaparHtml(dados.emailUsuario)} · <span class="pilula">${escaparHtml(ROTULO_PAPEL[dados.papel] ?? dados.papel)}</span></div>
    </div>
  </div>
  <ul class="permissoes">
    ${permissoes.map((item) => `<li><span aria-hidden="true">✓</span>${escaparHtml(item)}</li>`).join("\n    ")}
  </ul>
  <p class="apoio">${escaparHtml(naoPode)}</p>
  <form method="post" action="/oauth/authorize">
      ${camposOcultos({ ...dados.ocultos, acao: "autorizar" })}
      <div class="botoes">
        <button type="submit" name="decisao" value="negar" class="secundario" formnovalidate>Cancelar</button>
        <button type="submit" name="decisao" value="permitir">Autorizar</button>
      </div>
  </form>
  <p class="rodape">O acesso vale por 30 dias e pode ser revogado a qualquer momento em <a href="/conectar">Conectar seu assistente</a>.</p>`,
  );
}

export function paginaErro(titulo: string, detalhe: string): string {
  return documento(
    titulo,
    `<h1>${escaparHtml(titulo)}</h1>
  <p class="apoio">${escaparHtml(detalhe)}</p>
  <p class="rodape">Se o pedido partiu do seu assistente, volte a ele e tente conectar de novo. Instruções em <a href="/conectar">Conectar seu assistente</a>.</p>`,
  );
}

export function paginaConcluida(nomeCliente: string, papel: string): string {
  return documento(
    "Tudo certo",
    `<h1>Pronto</h1>
  <p class="apoio">${escaparHtml(nomeCliente)} está conectado como <span class="pilula">${escaparHtml(ROTULO_PAPEL[papel] ?? papel)}</span>. Pode fechar esta aba e voltar ao seu assistente.</p>`,
  );
}
