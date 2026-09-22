import { useEffect, useRef, useState, type FormEvent } from "react";
import { Card } from "../components/Card";
import { Modal } from "../components/Modal";
import { Tabela } from "../components/Tabela";
import { BotaoCopiar } from "../components/BotaoCopiar";
import { EstadoVazio } from "../components/EstadoVazio";
import { CampoFormulario } from "../components/entrada/CampoFormulario";
import chipStyles from "../components/Chip.module.css";
import { formatarDataHoraBrasilia } from "../lib/format";
import {
  ApiError,
  alterarUsuario,
  criarUsuario,
  listarEventosDeUsuarios,
  listarUsuarios,
  redefinirSenhaUsuario,
  type CriarUsuarioEntrada,
  type EventoUsuario,
  type PapelSessao,
  type Usuario,
} from "../lib/api";
import styles from "./Pessoas.module.css";

const ROTULO_PAPEL: Readonly<Record<PapelSessao, string>> = {
  SECRETARIA: "Secretaria",
  FINANCEIRO: "Financeiro",
  DIRECAO: "Direção",
};

/** Estado da pílula — desativada tem prioridade (conta fora do ar), depois bloqueio, depois senha provisória. */
function estadoDaConta(usuario: Usuario): { readonly rotulo: string; readonly classe: string } {
  if (!usuario.ativo) return { rotulo: "Desativada", classe: styles.pilulaDesativada };
  if (usuario.bloqueado) return { rotulo: "Bloqueada", classe: styles.pilulaBloqueada };
  if (usuario.senhaProvisoria) return { rotulo: "Senha provisória", classe: styles.pilulaProvisoria };
  return { rotulo: "Ativa", classe: styles.pilulaAtiva };
}

/** Frase legível por tipo de evento (RF da tela: "não despeje JSON"). Switch exaustivo sobre os 8 tipos fechados. */
function descreverEvento(evento: EventoUsuario): string {
  const ator = evento.atorEmail ?? "o sistema";
  const papelDoMetadata = (chave: "de" | "para" | "papel"): string | null => {
    const valor = evento.metadata[chave];
    if (typeof valor !== "string") return null;
    return ROTULO_PAPEL[valor as PapelSessao] ?? valor;
  };
  switch (evento.tipo) {
    case "CONTA_CRIADA": {
      const papel = papelDoMetadata("papel");
      return papel
        ? `${evento.nomeUsuario} teve a conta criada como ${papel} por ${ator}.`
        : `${evento.nomeUsuario} teve a conta criada por ${ator}.`;
    }
    case "PAPEL_ALTERADO": {
      const de = papelDoMetadata("de");
      const para = papelDoMetadata("para");
      return de && para
        ? `${evento.nomeUsuario} teve o perfil alterado de ${de} para ${para} por ${ator}.`
        : `${evento.nomeUsuario} teve o perfil alterado por ${ator}.`;
    }
    case "CONTA_DESATIVADA":
      return `${evento.nomeUsuario} foi desativada por ${ator}.`;
    case "CONTA_REATIVADA":
      return `${evento.nomeUsuario} foi reativada por ${ator}.`;
    case "SENHA_REDEFINIDA":
      return `${evento.nomeUsuario} teve a senha redefinida por ${ator}.`;
    case "SENHA_TROCADA":
      return `${evento.nomeUsuario} trocou a própria senha.`;
    case "CONTA_BLOQUEADA":
      return `${evento.nomeUsuario} teve a conta bloqueada após várias tentativas de senha incorretas.`;
    case "ACESSO_REALIZADO":
      return `${evento.nomeUsuario} acessou o sistema.`;
  }
}

function ehCancelamento(falha: unknown): boolean {
  return falha instanceof DOMException && falha.name === "AbortError";
}

/** Mesmo bloco de resultado depois de "Adicionar pessoa" e depois de "Redefinir senha" — a senha só aparece uma vez. */
function ResultadoSenhaProvisoria({ nome, senha }: { readonly nome: string; readonly senha: string }) {
  return (
    <div className={styles.resultadoSenha}>
      <p className={styles.resultadoTitulo}>Senha provisória de {nome}</p>
      <div className={styles.senhaDestaque}>
        <code className={styles.senhaTexto}>{senha}</code>
        <BotaoCopiar texto={senha} />
      </div>
      <p className={styles.resultadoAviso}>
        Anote agora: esta senha aparece uma única vez. Ela serve para o primeiro acesso e a pessoa define a dela em
        seguida.
      </p>
    </div>
  );
}

interface LinhaUsuarioProps {
  readonly usuario: Usuario;
  readonly souEu: boolean;
  readonly processando: boolean;
  readonly aoTrocarPapel: (papel: PapelSessao) => void;
  readonly aoPedirDesativar: () => void;
  readonly aoReativar: () => void;
  readonly aoPedirRedefinirSenha: () => void;
}

function LinhaUsuario({
  usuario,
  souEu,
  processando,
  aoTrocarPapel,
  aoPedirDesativar,
  aoReativar,
  aoPedirRedefinirSenha,
}: LinhaUsuarioProps) {
  const estado = estadoDaConta(usuario);
  const idSelect = `perfil-${usuario.id}`;
  return (
    <tr>
      <Tabela.Celula>
        {usuario.nome}
        <div className={styles.linhaSecundaria}>{usuario.email}</div>
      </Tabela.Celula>
      <Tabela.Celula>
        <label htmlFor={idSelect} className={styles.somenteLeitor}>
          Perfil de {usuario.nome}
        </label>
        <select
          id={idSelect}
          className={styles.selectPapel}
          value={usuario.papel}
          disabled={processando}
          onChange={(evento) => aoTrocarPapel(evento.target.value as PapelSessao)}
        >
          <option value="SECRETARIA">Secretaria</option>
          <option value="FINANCEIRO">Financeiro</option>
          <option value="DIRECAO">Direção</option>
        </select>
      </Tabela.Celula>
      <Tabela.Celula>
        <span className={`${styles.pilula} ${estado.classe}`}>{estado.rotulo}</span>
      </Tabela.Celula>
      <Tabela.Celula>{usuario.ultimoAcessoUtc ? formatarDataHoraBrasilia(usuario.ultimoAcessoUtc) : "nunca entrou"}</Tabela.Celula>
      <Tabela.Celula>
        <div className={styles.acoesLinha}>
          {!souEu &&
            (usuario.ativo ? (
              <button type="button" className={styles.botaoAcao} disabled={processando} onClick={aoPedirDesativar}>
                Desativar
              </button>
            ) : (
              <button type="button" className={styles.botaoAcao} disabled={processando} onClick={aoReativar}>
                Reativar
              </button>
            ))}
          <button type="button" className={styles.botaoAcao} disabled={processando} onClick={aoPedirRedefinirSenha}>
            Redefinir senha
          </button>
        </div>
      </Tabela.Celula>
    </tr>
  );
}

type AcaoConfirmacao = { readonly tipo: "desativar" | "redefinir"; readonly usuario: Usuario };
type FormAdicionar = { readonly nome: string; readonly email: string; readonly papel: PapelSessao };
const FORM_ADICIONAR_VAZIO: FormAdicionar = { nome: "", email: "", papel: "SECRETARIA" };

/**
 * Administração de contas (papel DIRECAO) — RF fora do design-reference, contrato fixado pelo
 * orquestrador na tarefa desta tela. `GET /api/users`/`GET /api/users/eventos` exigem a MESMA
 * sessão de login (nunca a identidade funcional da demonstração) e o mesmo guarda no servidor
 * (`exigirDirecao`), por isso as duas buscas correm juntas: se uma nega acesso, a outra também
 * negaria, e a tela mostra um único estado explicativo em vez de duas falhas separadas.
 */
export function Pessoas() {
  const [usuarios, setUsuarios] = useState<readonly Usuario[]>([]);
  const [eu, setEu] = useState<{ readonly id: string; readonly email: string } | null>(null);
  const [eventos, setEventos] = useState<readonly EventoUsuario[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [semPermissao, setSemPermissao] = useState<string | null>(null);
  const [recarregarToken, setRecarregarToken] = useState(0);
  const [processandoId, setProcessandoId] = useState<string | null>(null);

  const [mensagemStatus, setMensagemStatus] = useState<{ readonly tipo: "ok" | "erro"; readonly texto: string } | null>(null);
  const timeoutStatusRef = useRef<number | undefined>(undefined);
  const abortadorRef = useRef<AbortController | null>(null);

  const [acaoConfirmacao, setAcaoConfirmacao] = useState<AcaoConfirmacao | null>(null);
  const [enviandoConfirmacao, setEnviandoConfirmacao] = useState(false);
  const [erroConfirmacao, setErroConfirmacao] = useState<string | null>(null);
  const [resultadoRedefinicao, setResultadoRedefinicao] = useState<{ readonly nome: string; readonly senha: string } | null>(null);

  const [modalAdicionarAberto, setModalAdicionarAberto] = useState(false);
  const [formAdicionar, setFormAdicionar] = useState<FormAdicionar>(FORM_ADICIONAR_VAZIO);
  const [enviandoAdicionar, setEnviandoAdicionar] = useState(false);
  const [erroAdicionar, setErroAdicionar] = useState<string | null>(null);
  const [resultadoAdicionar, setResultadoAdicionar] = useState<{ readonly nome: string; readonly senha: string } | null>(null);

  useEffect(() => () => window.clearTimeout(timeoutStatusRef.current), []);
  useEffect(() => () => abortadorRef.current?.abort(), []);

  useEffect(() => {
    const controlador = new AbortController();
    setCarregando(true);
    setErro(null);
    setSemPermissao(null);
    Promise.all([listarUsuarios(controlador.signal), listarEventosDeUsuarios(controlador.signal)])
      .then(([respostaUsuarios, respostaEventos]) => {
        setUsuarios(respostaUsuarios.usuarios);
        setEu(respostaUsuarios.eu);
        setEventos(respostaEventos.eventos);
      })
      .catch((falha) => {
        if (ehCancelamento(falha)) return;
        if (falha instanceof ApiError && (falha.codigo === "ROLE_NOT_ALLOWED" || falha.codigo === "NAO_AUTENTICADO")) {
          setSemPermissao(falha.message);
        } else {
          setErro(falha instanceof ApiError ? falha.message : "Não foi possível carregar as pessoas com acesso agora.");
        }
      })
      .finally(() => {
        if (!controlador.signal.aborted) setCarregando(false);
      });
    return () => controlador.abort();
  }, [recarregarToken]);

  function anunciar(tipo: "ok" | "erro", texto: string): void {
    setMensagemStatus({ tipo, texto });
    window.clearTimeout(timeoutStatusRef.current);
    timeoutStatusRef.current = window.setTimeout(() => setMensagemStatus(null), 5000);
  }

  async function trocarPapel(usuario: Usuario, novoPapel: PapelSessao): Promise<void> {
    if (novoPapel === usuario.papel) return;
    setProcessandoId(usuario.id);
    const controlador = new AbortController();
    abortadorRef.current = controlador;
    try {
      await alterarUsuario(usuario.id, { papel: novoPapel }, controlador.signal);
      anunciar("ok", `Perfil de ${usuario.nome} alterado para ${ROTULO_PAPEL[novoPapel]}.`);
      setRecarregarToken((token) => token + 1);
    } catch (falha) {
      if (ehCancelamento(falha)) return;
      anunciar("erro", falha instanceof ApiError ? falha.message : "Não foi possível trocar o perfil agora.");
    } finally {
      setProcessandoId(null);
    }
  }

  async function reativar(usuario: Usuario): Promise<void> {
    setProcessandoId(usuario.id);
    const controlador = new AbortController();
    abortadorRef.current = controlador;
    try {
      await alterarUsuario(usuario.id, { ativo: true }, controlador.signal);
      anunciar("ok", `${usuario.nome} foi reativada.`);
      setRecarregarToken((token) => token + 1);
    } catch (falha) {
      if (ehCancelamento(falha)) return;
      anunciar("erro", falha instanceof ApiError ? falha.message : "Não foi possível reativar agora.");
    } finally {
      setProcessandoId(null);
    }
  }

  function pedirDesativar(usuario: Usuario): void {
    setAcaoConfirmacao({ tipo: "desativar", usuario });
    setErroConfirmacao(null);
    setResultadoRedefinicao(null);
  }

  function pedirRedefinirSenha(usuario: Usuario): void {
    setAcaoConfirmacao({ tipo: "redefinir", usuario });
    setErroConfirmacao(null);
    setResultadoRedefinicao(null);
  }

  function fecharConfirmacao(): void {
    setAcaoConfirmacao(null);
    setErroConfirmacao(null);
    setResultadoRedefinicao(null);
  }

  async function confirmarAcao(): Promise<void> {
    if (!acaoConfirmacao) return;
    const { tipo, usuario } = acaoConfirmacao;
    setEnviandoConfirmacao(true);
    setErroConfirmacao(null);
    const controlador = new AbortController();
    abortadorRef.current = controlador;
    try {
      if (tipo === "desativar") {
        await alterarUsuario(usuario.id, { ativo: false }, controlador.signal);
        anunciar("ok", `${usuario.nome} foi desativada.`);
        setRecarregarToken((token) => token + 1);
        setAcaoConfirmacao(null);
      } else {
        const resposta = await redefinirSenhaUsuario(usuario.id, controlador.signal);
        setResultadoRedefinicao({ nome: usuario.nome, senha: resposta.senha_provisoria });
        setRecarregarToken((token) => token + 1);
      }
    } catch (falha) {
      if (ehCancelamento(falha)) return;
      setErroConfirmacao(falha instanceof ApiError ? falha.message : "Não foi possível concluir agora.");
    } finally {
      setEnviandoConfirmacao(false);
    }
  }

  function abrirModalAdicionar(): void {
    setModalAdicionarAberto(true);
  }

  function fecharModalAdicionar(): void {
    setModalAdicionarAberto(false);
    setFormAdicionar(FORM_ADICIONAR_VAZIO);
    setErroAdicionar(null);
    setResultadoAdicionar(null);
  }

  async function aoSubmeterAdicionar(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setEnviandoAdicionar(true);
    setErroAdicionar(null);
    const controlador = new AbortController();
    abortadorRef.current = controlador;
    try {
      const dados: CriarUsuarioEntrada = formAdicionar;
      const resposta = await criarUsuario(dados, controlador.signal);
      setResultadoAdicionar({ nome: resposta.usuario.nome, senha: resposta.senha_provisoria });
      setRecarregarToken((token) => token + 1);
    } catch (falha) {
      if (ehCancelamento(falha)) return;
      setErroAdicionar(falha instanceof ApiError ? falha.message : "Não foi possível criar a conta agora.");
    } finally {
      setEnviandoAdicionar(false);
    }
  }

  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalho}>
        <div>
          <h1 className={styles.titulo}>Pessoas com acesso</h1>
          <p className={styles.subtitulo}>Contas que entram na Vitalis por login — perfil, estado e histórico de mudanças.</p>
        </div>
        {!semPermissao && (
          <button type="button" className={`${chipStyles.chip} ${chipStyles.ativo}`} onClick={abrirModalAdicionar}>
            Adicionar pessoa
          </button>
        )}
      </div>

      {mensagemStatus ? (
        <p role="status" aria-live="polite" className={mensagemStatus.tipo === "erro" ? styles.statusErro : styles.statusOk}>
          {mensagemStatus.texto}
        </p>
      ) : null}

      {semPermissao ? (
        <Card>
          <EstadoVazio titulo="Esta área é só para a Direção" descricao={semPermissao} />
        </Card>
      ) : (
        <>
          <Card semPadding className={styles.cartaoTabela}>
            {erro ? (
              <p role="alert" className={styles.erro}>
                {erro}
              </p>
            ) : carregando && usuarios.length === 0 ? (
              <p role="status" className={styles.carregando}>
                Carregando pessoas…
              </p>
            ) : usuarios.length === 0 ? (
              <EstadoVazio titulo="Nenhuma pessoa cadastrada" descricao="Use “Adicionar pessoa” para criar a primeira conta." />
            ) : (
              <div className={styles.wrapperRolagem}>
                <Tabela captionOculto caption="Pessoas com acesso à Vitalis">
                  <Tabela.Cabecalho>
                    <tr>
                      <Tabela.CelulaCabecalho scope="col">Nome</Tabela.CelulaCabecalho>
                      <Tabela.CelulaCabecalho scope="col">Perfil</Tabela.CelulaCabecalho>
                      <Tabela.CelulaCabecalho scope="col">Estado</Tabela.CelulaCabecalho>
                      <Tabela.CelulaCabecalho scope="col">Último acesso</Tabela.CelulaCabecalho>
                      <Tabela.CelulaCabecalho scope="col">Ações</Tabela.CelulaCabecalho>
                    </tr>
                  </Tabela.Cabecalho>
                  <Tabela.Corpo>
                    {usuarios.map((usuario) => (
                      <LinhaUsuario
                        key={usuario.id}
                        usuario={usuario}
                        souEu={usuario.id === eu?.id}
                        processando={processandoId === usuario.id}
                        aoTrocarPapel={(papel) => void trocarPapel(usuario, papel)}
                        aoPedirDesativar={() => pedirDesativar(usuario)}
                        aoReativar={() => void reativar(usuario)}
                        aoPedirRedefinirSenha={() => pedirRedefinirSenha(usuario)}
                      />
                    ))}
                  </Tabela.Corpo>
                </Tabela>
              </div>
            )}
          </Card>

          <Card>
            <h2 className={styles.h2}>Movimentações recentes</h2>
            {eventos.length === 0 ? (
              <p className={styles.semMovimentacoes}>Nenhuma movimentação registrada ainda.</p>
            ) : (
              <ul className={styles.listaMovimentacoes}>
                {eventos.map((evento) => (
                  <li key={evento.id} className={styles.movimentacaoItem}>
                    <p className={styles.movimentacaoTexto}>{descreverEvento(evento)}</p>
                    <span className={styles.movimentacaoData}>{formatarDataHoraBrasilia(evento.ocorridoEmUtc)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      <Modal
        aberto={acaoConfirmacao !== null}
        titulo={acaoConfirmacao?.tipo === "desativar" ? "Desativar acesso" : "Redefinir senha"}
        aoFechar={fecharConfirmacao}
      >
        {resultadoRedefinicao ? (
          <>
            <ResultadoSenhaProvisoria nome={resultadoRedefinicao.nome} senha={resultadoRedefinicao.senha} />
            <div className={styles.rodapeModal}>
              <button type="button" className={styles.botaoPrimario} onClick={fecharConfirmacao}>
                Fechar
              </button>
            </div>
          </>
        ) : (
          <>
            <p className={styles.textoConfirmacao}>
              {acaoConfirmacao?.tipo === "desativar"
                ? `Desativar o acesso de ${acaoConfirmacao.usuario.nome}? A pessoa deixa de conseguir entrar até ser reativada.`
                : `Gerar uma nova senha provisória para ${acaoConfirmacao?.usuario.nome}? A senha atual dela para de funcionar.`}
            </p>
            {erroConfirmacao ? (
              <p role="alert" className={styles.erro}>
                {erroConfirmacao}
              </p>
            ) : null}
            <div className={styles.rodapeModal}>
              <button type="button" className={styles.botaoSecundario} onClick={fecharConfirmacao} disabled={enviandoConfirmacao}>
                Cancelar
              </button>
              <button type="button" className={styles.botaoPrimario} onClick={() => void confirmarAcao()} disabled={enviandoConfirmacao}>
                {enviandoConfirmacao ? "Enviando…" : "Confirmar"}
              </button>
            </div>
          </>
        )}
      </Modal>

      <Modal aberto={modalAdicionarAberto} titulo="Adicionar pessoa" aoFechar={fecharModalAdicionar}>
        {resultadoAdicionar ? (
          <>
            <ResultadoSenhaProvisoria nome={resultadoAdicionar.nome} senha={resultadoAdicionar.senha} />
            <div className={styles.rodapeModal}>
              <button type="button" className={styles.botaoPrimario} onClick={fecharModalAdicionar}>
                Fechar
              </button>
            </div>
          </>
        ) : (
          <form className={styles.formAdicionar} onSubmit={(evento) => void aoSubmeterAdicionar(evento)}>
            <CampoFormulario idCampo="adicionar-nome" rotulo="Nome" obrigatorio>
              <input
                id="adicionar-nome"
                type="text"
                required
                value={formAdicionar.nome}
                onChange={(evento) => setFormAdicionar((atual) => ({ ...atual, nome: evento.target.value }))}
              />
            </CampoFormulario>
            <CampoFormulario idCampo="adicionar-email" rotulo="E-mail" obrigatorio>
              <input
                id="adicionar-email"
                type="email"
                required
                value={formAdicionar.email}
                onChange={(evento) => setFormAdicionar((atual) => ({ ...atual, email: evento.target.value }))}
              />
            </CampoFormulario>
            <CampoFormulario idCampo="adicionar-papel" rotulo="Perfil" obrigatorio>
              <select
                id="adicionar-papel"
                value={formAdicionar.papel}
                onChange={(evento) => setFormAdicionar((atual) => ({ ...atual, papel: evento.target.value as PapelSessao }))}
              >
                <option value="SECRETARIA">Secretaria</option>
                <option value="FINANCEIRO">Financeiro</option>
                <option value="DIRECAO">Direção</option>
              </select>
            </CampoFormulario>
            {erroAdicionar ? (
              <p role="alert" className={styles.erro}>
                {erroAdicionar}
              </p>
            ) : null}
            <div className={styles.rodapeModal}>
              <button type="button" className={styles.botaoSecundario} onClick={fecharModalAdicionar} disabled={enviandoAdicionar}>
                Cancelar
              </button>
              <button type="submit" className={styles.botaoPrimario} disabled={enviandoAdicionar}>
                {enviandoAdicionar ? "Criando…" : "Criar conta"}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
