import { useEffect, useRef, useState, type FormEvent } from "react";
import { Card } from "../components/Card";
import { CampoFormulario } from "../components/entrada/CampoFormulario";
import { ApiError, obterUsuarioAtual, trocarPropriaSenha, type UsuarioAtual } from "../lib/api";
import styles from "./MinhaConta.module.css";

const ROTULO_PAPEL: Readonly<Record<string, string>> = {
  SECRETARIA: "Secretaria",
  FINANCEIRO: "Financeiro",
  DIRECAO: "Direção",
};

/**
 * Mesmo mínimo aplicado pelo servidor (`TAMANHO_MINIMO_SENHA` em
 * `src/http/handlers/usuarios.ts`) — repetido aqui só como conveniência de UX para não deixar
 * submeter uma senha curta demais; quem decide de verdade continua sendo o servidor.
 */
const TAMANHO_MINIMO_SENHA = 10;

function ehCancelamento(falha: unknown): boolean {
  return falha instanceof DOMException && falha.name === "AbortError";
}

/** "Minha conta" (RF fora do design-reference) — dados da própria conta e troca de senha. */
export function MinhaConta() {
  const [usuario, setUsuario] = useState<UsuarioAtual | null>(null);
  const [carregando, setCarregando] = useState(true);

  const [senhaAtual, setSenhaAtual] = useState("");
  const [senhaNova, setSenhaNova] = useState("");
  const [senhaRepetida, setSenhaRepetida] = useState("");
  const [erroValidacao, setErroValidacao] = useState<string | null>(null);
  const [erroServidor, setErroServidor] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const abortadorRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controlador = new AbortController();
    obterUsuarioAtual(controlador.signal)
      .then((resposta) => {
        if (!controlador.signal.aborted) setUsuario(resposta);
      })
      .catch((falha) => {
        // Sem resposta, a tela trata como não autenticada — o aviso de login cobre o caso.
        if (ehCancelamento(falha)) return;
      })
      .finally(() => {
        if (!controlador.signal.aborted) setCarregando(false);
      });
    return () => controlador.abort();
  }, []);

  useEffect(() => () => abortadorRef.current?.abort(), []);

  async function aoSubmeter(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setErroServidor(null);
    setSucesso(false);

    if (senhaNova !== senhaRepetida) {
      setErroValidacao("A nova senha e a repetição precisam ser iguais.");
      return;
    }
    if (senhaNova.length < TAMANHO_MINIMO_SENHA) {
      setErroValidacao(`A nova senha precisa de pelo menos ${TAMANHO_MINIMO_SENHA} caracteres.`);
      return;
    }
    setErroValidacao(null);
    setEnviando(true);
    const controlador = new AbortController();
    abortadorRef.current = controlador;
    try {
      await trocarPropriaSenha({ senha_atual: senhaAtual, senha_nova: senhaNova }, controlador.signal);
      setSucesso(true);
      setSenhaAtual("");
      setSenhaNova("");
      setSenhaRepetida("");
    } catch (falha) {
      if (ehCancelamento(falha)) return;
      setErroServidor(falha instanceof ApiError ? falha.message : "Não foi possível trocar a senha agora.");
    } finally {
      setEnviando(false);
    }
  }

  if (carregando) {
    return (
      <div className={styles.pagina}>
        <p role="status" className={styles.carregando}>
          Carregando…
        </p>
      </div>
    );
  }

  if (!usuario?.autenticado) {
    return (
      <div className={styles.pagina}>
        <h1 className={styles.titulo}>Minha conta</h1>
        <Card className={styles.cartaoAviso}>
          <p className={styles.avisoTexto}>Você precisa entrar com sua conta para ver e alterar seus dados.</p>
          <a className={styles.botaoPrimario} href="/entrar?redirecionar=/minha-conta">
            Entrar
          </a>
        </Card>
      </div>
    );
  }

  return (
    <div className={styles.pagina}>
      <h1 className={styles.titulo}>Minha conta</h1>

      <Card className={styles.cartaoPerfil}>
        <dl className={styles.listaPerfil}>
          <div className={styles.linhaPerfil}>
            <dt>Nome</dt>
            <dd>{usuario.nome}</dd>
          </div>
          <div className={styles.linhaPerfil}>
            <dt>E-mail</dt>
            <dd>{usuario.email}</dd>
          </div>
          <div className={styles.linhaPerfil}>
            <dt>Perfil</dt>
            <dd>{ROTULO_PAPEL[usuario.papel ?? ""] ?? usuario.papel}</dd>
          </div>
        </dl>
      </Card>

      <Card>
        <h2 className={styles.h2}>Trocar senha</h2>
        <form className={styles.formulario} onSubmit={(evento) => void aoSubmeter(evento)}>
          <CampoFormulario idCampo="senha-atual" rotulo="Senha atual" obrigatorio>
            <input
              id="senha-atual"
              type="password"
              autoComplete="current-password"
              required
              value={senhaAtual}
              onChange={(evento) => setSenhaAtual(evento.target.value)}
            />
          </CampoFormulario>
          <CampoFormulario
            idCampo="senha-nova"
            rotulo="Nova senha"
            obrigatorio
            dica={`Pelo menos ${TAMANHO_MINIMO_SENHA} caracteres.`}
          >
            <input
              id="senha-nova"
              type="password"
              autoComplete="new-password"
              required
              minLength={TAMANHO_MINIMO_SENHA}
              value={senhaNova}
              onChange={(evento) => setSenhaNova(evento.target.value)}
            />
          </CampoFormulario>
          <CampoFormulario idCampo="senha-repetir" rotulo="Repetir nova senha" obrigatorio>
            <input
              id="senha-repetir"
              type="password"
              autoComplete="new-password"
              required
              value={senhaRepetida}
              onChange={(evento) => setSenhaRepetida(evento.target.value)}
            />
          </CampoFormulario>

          {erroValidacao ? (
            <p role="alert" className={styles.erro}>
              {erroValidacao}
            </p>
          ) : null}
          {erroServidor ? (
            <p role="alert" className={styles.erro}>
              {erroServidor}
            </p>
          ) : null}
          {sucesso ? (
            <p role="status" aria-live="polite" className={styles.sucesso}>
              Senha trocada com sucesso.
            </p>
          ) : null}

          <button type="submit" className={styles.botaoPrimario} disabled={enviando}>
            {enviando ? "Trocando…" : "Trocar senha"}
          </button>
        </form>
      </Card>
    </div>
  );
}
