import { useEffect, useState } from "react";
import { Card } from "../components/Card";
import { Chip } from "../components/Chip";
import { Tabela } from "../components/Tabela";
import { BotaoCopiar } from "../components/BotaoCopiar";
import { obterUsuarioAtual, type UsuarioAtual } from "../lib/api";
import styles from "./Conectar.module.css";

type AssistenteId = "claude-code" | "codex" | "outro";

interface AssistenteOpcao {
  readonly id: AssistenteId;
  readonly rotulo: string;
  readonly texto: string;
}

const TEXTO_CLAUDE_CODE = `Instale o MCP da Clínica Vitalis para mim.

1. Rode: claude mcp add --transport http vitalis https://vitalis-barreira-glosas.bjrcarlos04.workers.dev/mcp
2. Rode: /mcp e conclua o login que abrir no navegador.
3. Quando terminar, liste as ferramentas do servidor "vitalis" e me diga com qual perfil eu entrei.`;

const TEXTO_CODEX = `Instale o MCP da Clínica Vitalis para mim.

1. Rode: codex mcp add vitalis --url https://vitalis-barreira-glosas.bjrcarlos04.workers.dev/mcp
2. Rode: codex mcp login vitalis e conclua o login que abrir no navegador.
3. Quando terminar, liste as ferramentas do servidor "vitalis" e me diga com qual perfil eu entrei.`;

const TEXTO_OUTRO = `Conecte-se ao MCP da Clínica Vitalis.

Endereço (streamable HTTP): https://vitalis-barreira-glosas.bjrcarlos04.workers.dev/mcp
Autenticação: OAuth 2.1 com descoberta automática (RFC 9728). Registre o cliente dinamicamente e conclua o login no navegador.
Depois, liste as ferramentas disponíveis e me diga com qual perfil eu entrei.`;

/** As três opções fixadas no pedido do dono — trocar a opção troca só o texto do bloco de destaque. */
const ASSISTENTES: readonly AssistenteOpcao[] = [
  { id: "claude-code", rotulo: "Claude Code", texto: TEXTO_CLAUDE_CODE },
  { id: "codex", rotulo: "Codex (OpenAI)", texto: TEXTO_CODEX },
  { id: "outro", rotulo: "Outro assistente", texto: TEXTO_OUTRO },
];

/** Quatro passos em linguagem de leigo — o que a pessoa vê acontecer depois de colar o texto. */
const PASSOS: readonly string[] = [
  "O assistente adiciona o servidor da Vitalis sozinho, a partir do comando que você colou.",
  "Ele abre uma página de login da Vitalis no seu navegador.",
  "Você entra com seu e-mail e senha da clínica e autoriza o acesso.",
  "Pronto: o assistente passa a responder com os dados que o seu perfil pode ver. Nenhum token precisa ser copiado à mão.",
];

interface LinhaPermissao {
  readonly ferramenta: string;
  readonly secretaria: boolean;
  readonly financeiro: boolean;
  readonly direcao: boolean;
}

/** Conteúdo fixado no pedido do dono (§ "o que cada perfil pode fazer") — não é dado do servidor. */
const PERMISSOES: readonly LinhaPermissao[] = [
  { ferramenta: "Consultar regra do convênio", secretaria: true, financeiro: true, direcao: true },
  { ferramenta: "Verificar guia (sem salvar)", secretaria: true, financeiro: true, direcao: true },
  { ferramenta: "Consultar histórico", secretaria: true, financeiro: true, direcao: true },
  { ferramenta: "Minhas pendências", secretaria: true, financeiro: true, direcao: false },
  { ferramenta: "Registrar guia nova", secretaria: true, financeiro: false, direcao: false },
  { ferramenta: "Relatório consolidado", secretaria: false, financeiro: false, direcao: true },
];

/** Célula ✓/— da tabela de permissões — o ícone é decorativo, o texto lido pelo leitor de tela é "Sim"/"Não". */
function Permissao({ concedida }: { concedida: boolean }) {
  return (
    <>
      <span aria-hidden="true">{concedida ? "✓" : "—"}</span>
      <span className={styles.visuallyHidden}>{concedida ? "Sim" : "Não"}</span>
    </>
  );
}

/**
 * Tutorial de instalação do MCP para quem não é técnico (recepção, financeiro, direção). O
 * objetivo é copiar um texto pronto e colar no assistente de IA — o assistente faz o resto
 * (adicionar o servidor, abrir o login, listar as ferramentas). Não há chamada ao servidor
 * nesta tela: os três textos e a tabela de permissões são conteúdo fixo, igual para qualquer
 * clínica que rode este servidor MCP.
 */
const ROTULO_PAPEL: Readonly<Record<string, string>> = {
  SECRETARIA: "Secretaria",
  FINANCEIRO: "Financeiro",
  DIRECAO: "Direção",
};

export function Conectar() {
  const [assistenteId, setAssistenteId] = useState<AssistenteId>("claude-code");
  const [usuario, setUsuario] = useState<UsuarioAtual | null>(null);

  // Estado do login: é o que responde a pergunta que a pessoa realmente tem nesta tela —
  // "com qual perfil meu assistente vai entrar?". Falha na busca não quebra o tutorial.
  useEffect(() => {
    const controlador = new AbortController();
    obterUsuarioAtual(controlador.signal)
      .then((resposta) => {
        if (!controlador.signal.aborted) setUsuario(resposta);
      })
      .catch(() => undefined);
    return () => controlador.abort();
  }, []);
  const assistente = ASSISTENTES.find((opcao) => opcao.id === assistenteId) ?? ASSISTENTES[0];

  return (
    <div className={styles.pagina}>
      <div>
        <h1 className={styles.titulo}>Conectar seu assistente de IA</h1>
        <p className={styles.subtitulo}>
          Isso liga o assistente (Claude, ChatGPT/Codex) às regras e guias da clínica. O que ele consegue ver
          depende de quem faz login — Secretaria, Financeiro ou Direção.
        </p>
      </div>

      {usuario?.autenticado ? (
        <Card className={styles.cartaoLogin}>
          <div>
            <p className={styles.loginTitulo}>
              Você entrou como <b>{usuario.nome}</b> · {ROTULO_PAPEL[usuario.papel ?? ""] ?? usuario.papel}
            </p>
            <p className={styles.loginApoio}>
              Ao autorizar, seu assistente recebe exatamente este perfil — nem mais, nem menos.
            </p>
          </div>
          <form method="post" action="/sair">
            <button type="submit" className={styles.botaoSecundario}>
              Trocar de conta
            </button>
          </form>
        </Card>
      ) : (
        <Card className={styles.cartaoLogin}>
          <div>
            <p className={styles.loginTitulo}>Você ainda não entrou nesta máquina</p>
            <p className={styles.loginApoio}>
              Tudo bem: o próprio assistente vai abrir a página de login quando você colar o texto abaixo. Se
              preferir entrar antes, o passo some do caminho.
            </p>
          </div>
          <a className={styles.botaoPrimario} href="/entrar?redirecionar=/conectar">
            Entrar agora
          </a>
        </Card>
      )}

      <Card className={styles.cartaoComando}>
        <div className={styles.blocoCabecalho}>
          <h2 className={styles.h2}>Copie e cole no seu assistente</h2>
          <BotaoCopiar texto={assistente.texto} />
        </div>
        <pre className={styles.pre}>{assistente.texto}</pre>

        <p id="rotulo-seletor-assistente" className={styles.seletorRotulo}>
          Qual assistente você usa?
        </p>
        <div className={styles.seletor} role="group" aria-labelledby="rotulo-seletor-assistente">
          {ASSISTENTES.map((opcao) => (
            <Chip key={opcao.id} ativo={opcao.id === assistenteId} onClick={() => setAssistenteId(opcao.id)}>
              {opcao.rotulo}
            </Chip>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className={styles.h2}>O que vai acontecer</h2>
        <ol className={styles.passos}>
          {PASSOS.map((passo, indice) => (
            <li key={passo}>
              <span className={styles.numero} aria-hidden="true">
                {indice + 1}
              </span>
              <span>{passo}</span>
            </li>
          ))}
        </ol>
      </Card>

      <Card semPadding className={styles.cartaoTabela}>
        <div className={styles.tabelaCabecalho}>
          <h2 className={styles.h2}>O que cada perfil pode fazer</h2>
        </div>
        <div className={styles.wrapperRolagem}>
          <Tabela captionOculto caption="Ferramentas do MCP disponíveis por perfil de login">
            <Tabela.Cabecalho>
              <tr>
                <Tabela.CelulaCabecalho scope="col">Ferramenta</Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho scope="col">Secretaria</Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho scope="col">Financeiro</Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho scope="col">Direção</Tabela.CelulaCabecalho>
              </tr>
            </Tabela.Cabecalho>
            <Tabela.Corpo>
              {PERMISSOES.map((linha) => (
                <tr key={linha.ferramenta}>
                  <Tabela.Celula>{linha.ferramenta}</Tabela.Celula>
                  <Tabela.Celula className={styles.celulaPermissao}>
                    <Permissao concedida={linha.secretaria} />
                  </Tabela.Celula>
                  <Tabela.Celula className={styles.celulaPermissao}>
                    <Permissao concedida={linha.financeiro} />
                  </Tabela.Celula>
                  <Tabela.Celula className={styles.celulaPermissao}>
                    <Permissao concedida={linha.direcao} />
                  </Tabela.Celula>
                </tr>
              ))}
            </Tabela.Corpo>
          </Tabela>
        </div>
        <p className={styles.notaTabela}>
          O perfil vem do seu login, nunca de algo que o assistente escolhe — pedir por outro perfil não muda o
          que ele enxerga.
        </p>
      </Card>

      <Card className={styles.cartaoDesconectar}>
        <h2 className={styles.h2Discreto}>Precisa desconectar?</h2>
        <ul className={styles.comandosRemover}>
          <li>
            <code>claude mcp remove vitalis</code>
          </li>
          <li>
            <code>codex mcp remove vitalis</code>
          </li>
        </ul>
      </Card>
    </div>
  );
}
