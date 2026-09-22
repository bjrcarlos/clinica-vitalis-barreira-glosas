import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import type {
  CadastrarProtocoloResposta,
  ImportarGuiasResposta,
  ListaProtocolosResposta,
  ProtocoloListagemItemWire,
} from "../../http/contracts";
import type { ValidacaoStatus } from "../../domain/statuses";
import { Card } from "../components/Card";
import { Chip } from "../components/Chip";
import { Tabela } from "../components/Tabela";
import { BadgeValidacao } from "../components/BadgeValidacao";
import { EstadoFluxo } from "../components/EstadoFluxo";
import { EstadoVazio } from "../components/EstadoVazio";
import { Paginacao } from "../components/Paginacao";
import { Modal } from "../components/Modal";
import { FormularioImportacao } from "../components/entrada/FormularioImportacao";
import { FormularioNovaGuia } from "../components/entrada/FormularioNovaGuia";
import { formatarCentavos, formatarRotuloArea } from "../lib/format";
import { formatarDataCalendario } from "../components/protocolo/campos";
import chipStyles from "../components/Chip.module.css";
import styles from "./Guias.module.css";

const UNIDADES = ["Norte", "Sul", "Centro"] as const;
const TAMANHO_PAGINA = 20;
/** Cobre as 80 guias semeadas numa página só — usado só para somar contagens dos chips, nunca para exibir a tabela. */
const TAMANHO_CONTAGEM = 100;

type OpcaoStatus = "todas" | "atencao" | ValidacaoStatus;

const OPCOES_STATUS: ReadonlyArray<{ valor: OpcaoStatus; rotulo: string; statusValidacao?: string }> = [
  { valor: "todas", rotulo: "Todas" },
  { valor: "atencao", rotulo: "Exigem atenção", statusValidacao: "CORRIGIR,REVISAO_HUMANA,NAO_FATURAR_CONVENIO" },
  { valor: "OK", rotulo: "OK", statusValidacao: "OK" },
  { valor: "CORRIGIR", rotulo: "Corrigir", statusValidacao: "CORRIGIR" },
  { valor: "REVISAO_HUMANA", rotulo: "Revisão humana", statusValidacao: "REVISAO_HUMANA" },
  { valor: "NAO_FATURAR_CONVENIO", rotulo: "Não faturar", statusValidacao: "NAO_FATURAR_CONVENIO" },
];

/** Deriva qual chip de status está ativo a partir do valor cru do parâmetro `status_validacao` na URL. */
function opcaoStatusAtiva(paramAtual: string | null): OpcaoStatus {
  if (!paramAtual) return "todas";
  const encontrada = OPCOES_STATUS.find((opcao) => opcao.statusValidacao === paramAtual);
  return encontrada?.valor ?? "todas";
}

interface Contagens {
  readonly total: number;
  readonly ok: number;
  readonly corrigir: number;
  readonly revisao: number;
  readonly naoFaturar: number;
}

function contarPorStatus(itens: readonly ProtocoloListagemItemWire[]): Contagens {
  const contagem = { total: itens.length, ok: 0, corrigir: 0, revisao: 0, naoFaturar: 0 };
  for (const item of itens) {
    if (item.status_validacao === "OK") contagem.ok++;
    else if (item.status_validacao === "CORRIGIR") contagem.corrigir++;
    else if (item.status_validacao === "REVISAO_HUMANA") contagem.revisao++;
    else contagem.naoFaturar++;
  }
  return contagem;
}

/**
 * Todas as guias (RF-14/RF-16, design-reference/Guias.dc.html). Filtros vivem na URL (query
 * string) para serem compartilháveis; sem filtro, a lista mostra as 80.
 *
 * As contagens dos chips vêm de uma busca auxiliar sem filtro (`tamanho=100`, cobre as 80 guias
 * semeadas numa página só) — `GET /api/protocols` não tem uma rota de agregação própria por
 * status nesta fase, e este é o jeito mais simples de mostrar números reais do banco em vez dos
 * ilustrativos do design-reference.
 */
export function Guias() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [buscaLocal, setBuscaLocal] = useState(searchParams.get("busca") ?? "");
  const [resultado, setResultado] = useState<ListaProtocolosResposta | null>(null);
  const [contagens, setContagens] = useState<Contagens | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const primeiraRenderizacao = useRef(true);
  // Incrementado depois de importar ou cadastrar com sucesso, para as duas buscas abaixo
  // refazerem a chamada sem precisar recarregar a página inteira.
  const [recarregarToken, setRecarregarToken] = useState(0);
  // Resultado da última guia cadastrada pelo modal "+ Nova guia" — o modal fecha ao salvar
  // (ver `aoConcluirNovaGuia`), e este aviso é onde "o resultado da validação após salvar" e o
  // link direto para o protocolo criado continuam aparecendo.
  const [avisoNovaGuia, setAvisoNovaGuia] = useState<CadastrarProtocoloResposta | null>(null);

  const modalParam = searchParams.get("modal");
  const modalAberto: "importar" | "nova-guia" | null =
    modalParam === "importar" || modalParam === "nova-guia" ? modalParam : null;

  const statusValidacaoParam = searchParams.get("status_validacao");
  const areaParam = searchParams.get("area") ?? "";
  const unidadeParam = searchParams.get("unidade") ?? "";
  const dataInicioParam = searchParams.get("data_atendimento_inicio") ?? "";
  const dataFimParam = searchParams.get("data_atendimento_fim") ?? "";
  const buscaParam = searchParams.get("busca") ?? "";
  const pagina = Number(searchParams.get("pagina") ?? "1") || 1;

  const queryFiltrada = useMemo(() => {
    const parametros = new URLSearchParams();
    if (statusValidacaoParam) parametros.set("status_validacao", statusValidacaoParam);
    if (areaParam) parametros.set("area", areaParam);
    if (unidadeParam) parametros.set("unidade", unidadeParam);
    if (dataInicioParam) parametros.set("data_atendimento_inicio", dataInicioParam);
    if (dataFimParam) parametros.set("data_atendimento_fim", dataFimParam);
    if (buscaParam) parametros.set("busca", buscaParam);
    parametros.set("pagina", String(pagina));
    parametros.set("tamanho", String(TAMANHO_PAGINA));
    return parametros.toString();
  }, [statusValidacaoParam, areaParam, unidadeParam, dataInicioParam, dataFimParam, buscaParam, pagina]);

  const algumFiltroAtivo = Boolean(statusValidacaoParam || areaParam || unidadeParam || dataInicioParam || dataFimParam || buscaParam);

  // Contagens dos chips: buscadas uma vez (não dependem dos filtros escolhidos pela pessoa).
  useEffect(() => {
    const controlador = new AbortController();
    api
      .get<ListaProtocolosResposta>(`/protocols?tamanho=${TAMANHO_CONTAGEM}`, controlador.signal)
      .then((resposta) => setContagens(contarPorStatus(resposta.protocolos)))
      .catch(() => {
        // Sem contagem não impede o uso da lista filtrada — os chips só ficam sem número.
      });
    return () => controlador.abort();
  }, [recarregarToken]);

  // Lista filtrada/paginada — refeita a cada mudança de filtro na URL.
  useEffect(() => {
    const controlador = new AbortController();
    setCarregando(true);
    setErro(null);
    api
      .get<ListaProtocolosResposta>(`/protocols?${queryFiltrada}`, controlador.signal)
      .then(setResultado)
      .catch((falha) => {
        if (falha instanceof ApiError) setErro(falha.message);
        else if (!(falha instanceof DOMException && falha.name === "AbortError")) setErro("Não foi possível carregar as guias agora.");
      })
      .finally(() => setCarregando(false));
    return () => controlador.abort();
  }, [queryFiltrada, recarregarToken]);

  // Busca com debounce: só grava na URL (e dispara a busca acima) 350ms depois de parar de digitar.
  useEffect(() => {
    if (primeiraRenderizacao.current) {
      primeiraRenderizacao.current = false;
      return;
    }
    const temporizador = setTimeout(() => {
      atualizarFiltros({ busca: buscaLocal || null, pagina: null });
    }, 350);
    return () => clearTimeout(temporizador);
  }, [buscaLocal]);

  function atualizarFiltros(mudancas: Record<string, string | null>) {
    setSearchParams((atual) => {
      const proximo = new URLSearchParams(atual);
      for (const [chave, valor] of Object.entries(mudancas)) {
        if (valor === null || valor === "") proximo.delete(chave);
        else proximo.set(chave, valor);
      }
      return proximo;
    });
  }

  function abrirModalImportar() {
    atualizarFiltros({ modal: "importar" });
  }

  function abrirModalNovaGuia() {
    atualizarFiltros({ modal: "nova-guia" });
  }

  function fecharModal() {
    atualizarFiltros({ modal: null });
  }

  /** Importação confirmada: fecha o modal e refaz a busca — sem recarregar a página. */
  function aoConcluirImportacao(_resultado: ImportarGuiasResposta) {
    fecharModal();
    setRecarregarToken((token) => token + 1);
  }

  /** Guia cadastrada: fecha o modal, refaz a busca e guarda o resultado para o aviso com link direto ao protocolo. */
  function aoConcluirNovaGuia(resposta: CadastrarProtocoloResposta) {
    fecharModal();
    setRecarregarToken((token) => token + 1);
    setAvisoNovaGuia(resposta);
  }

  function selecionarStatus(opcao: (typeof OPCOES_STATUS)[number]) {
    atualizarFiltros({ status_validacao: opcao.statusValidacao ?? null, pagina: null });
  }

  function limparFiltros() {
    setBuscaLocal("");
    setSearchParams(new URLSearchParams());
  }

  const opcaoAtiva = opcaoStatusAtiva(statusValidacaoParam);
  const protocolos = resultado?.protocolos ?? [];
  const paginacao = resultado?.paginacao;

  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalho}>
        <div>
          <h1 className={styles.titulo}>Todas as guias</h1>
          <p className={styles.subtitulo}>
            {algumFiltroAtivo && paginacao
              ? `Filtro aplicado · ${paginacao.total} de ${contagens?.total ?? 80} guias.`
              : "Sem filtro, a lista mostra as 80 guias."}
          </p>
        </div>
        <div className={styles.acoesTopo}>
          <button type="button" className={chipStyles.chip} onClick={abrirModalImportar}>
            Importar CSV/XLSX
          </button>
          <button type="button" className={`${chipStyles.chip} ${chipStyles.ativo}`} onClick={abrirModalNovaGuia}>
            + Nova guia
          </button>
        </div>
      </div>

      {avisoNovaGuia ? (
        <div className={styles.avisoNovaGuia} role="status">
          <div className={styles.avisoLinha}>
            {avisoNovaGuia.resultado_validacao ? <BadgeValidacao status={avisoNovaGuia.resultado_validacao.status} /> : null}
            <p className={styles.avisoTexto}>
              Guia <span className="num">{avisoNovaGuia.protocolo.numero_protocolo}</span>{" "}
              {avisoNovaGuia.resultado_validacao
                ? "cadastrada e verificada — já está na lista abaixo."
                : "já tinha protocolo — cadastro é idempotente por id_guia, nenhuma nova validação foi executada."}
            </p>
            <Link
              to={`/protocolos/${encodeURIComponent(avisoNovaGuia.protocolo.numero_protocolo)}`}
              className={styles.avisoLink}
            >
              Ver protocolo →
            </Link>
            <button
              type="button"
              className={styles.avisoFechar}
              onClick={() => setAvisoNovaGuia(null)}
              aria-label="Dispensar aviso"
            >
              ×
            </button>
          </div>
          {avisoNovaGuia.resultado_validacao ? <p className={styles.avisoResumo}>{avisoNovaGuia.resultado_validacao.resumo}</p> : null}
        </div>
      ) : null}

      <div className={styles.barraFiltros}>
        <label className={styles.buscaCampo}>
          <span className={styles.somenteLeitor}>Buscar protocolo, id da guia ou paciente</span>
          <input
            type="search"
            value={buscaLocal}
            onChange={(evento) => setBuscaLocal(evento.target.value)}
            placeholder="Buscar protocolo, id da guia, paciente…"
          />
        </label>
      </div>

      <div className={styles.linhaChips}>
        {OPCOES_STATUS.map((opcao) => (
          <Chip
            key={opcao.valor}
            ativo={opcaoAtiva === opcao.valor}
            contagem={
              contagens
                ? opcao.valor === "todas"
                  ? contagens.total
                  : opcao.valor === "atencao"
                    ? contagens.total - contagens.ok
                    : opcao.valor === "OK"
                      ? contagens.ok
                      : opcao.valor === "CORRIGIR"
                        ? contagens.corrigir
                        : opcao.valor === "REVISAO_HUMANA"
                          ? contagens.revisao
                          : contagens.naoFaturar
                : undefined
            }
            onClick={() => selecionarStatus(opcao)}
          >
            {opcao.rotulo}
          </Chip>
        ))}
        <span className={styles.divisoria} aria-hidden="true" />
        <label className={styles.filtroSelect}>
          <span>Área:</span>
          <select value={areaParam} onChange={(evento) => atualizarFiltros({ area: evento.target.value || null, pagina: null })}>
            <option value="">todas</option>
            <option value="SECRETARIA">Secretaria</option>
            <option value="FINANCEIRO">Financeiro</option>
          </select>
        </label>
        <label className={styles.filtroSelect}>
          <span>Unidade:</span>
          <select value={unidadeParam} onChange={(evento) => atualizarFiltros({ unidade: evento.target.value || null, pagina: null })}>
            <option value="">todas</option>
            {UNIDADES.map((unidade) => (
              <option key={unidade} value={unidade}>
                {unidade}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filtroPeriodo}>
          <span>Atendimento:</span>
          <input
            type="date"
            aria-label="Atendimento a partir de"
            value={dataInicioParam}
            onChange={(evento) => atualizarFiltros({ data_atendimento_inicio: evento.target.value || null, pagina: null })}
          />
          <span aria-hidden="true">–</span>
          <input
            type="date"
            aria-label="Atendimento até"
            value={dataFimParam}
            onChange={(evento) => atualizarFiltros({ data_atendimento_fim: evento.target.value || null, pagina: null })}
          />
        </label>
        {algumFiltroAtivo && (
          <button type="button" className={styles.limpar} onClick={limparFiltros}>
            Limpar filtros
          </button>
        )}
      </div>

      <Card semPadding className={styles.cartaoTabela}>
        {erro ? (
          <p role="alert" className={styles.erro}>
            {erro}
          </p>
        ) : carregando && protocolos.length === 0 ? (
          <p role="status" className={styles.carregando}>
            Carregando guias…
          </p>
        ) : protocolos.length === 0 ? (
          <EstadoVazio
            titulo="Nenhuma guia encontrada"
            descricao="Ajuste os filtros ou limpe-os para ver todas as guias."
            acao={
              algumFiltroAtivo ? (
                <button type="button" className={styles.limpar} onClick={limparFiltros}>
                  Limpar filtros
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className={styles.wrapperRolagem}>
            <Tabela>
              <Tabela.Cabecalho>
                <tr>
                  <Tabela.CelulaCabecalho>Protocolo</Tabela.CelulaCabecalho>
                  <Tabela.CelulaCabecalho>Atendimento</Tabela.CelulaCabecalho>
                  <Tabela.CelulaCabecalho>Paciente · convênio</Tabela.CelulaCabecalho>
                  <Tabela.CelulaCabecalho>Procedimento</Tabela.CelulaCabecalho>
                  <Tabela.CelulaCabecalho>Próxima ação</Tabela.CelulaCabecalho>
                  <Tabela.CelulaCabecalho>Fluxo</Tabela.CelulaCabecalho>
                  <Tabela.CelulaCabecalho>Área</Tabela.CelulaCabecalho>
                  <Tabela.CelulaCabecalho style={{ textAlign: "right" }}>Valor</Tabela.CelulaCabecalho>
                  <Tabela.CelulaCabecalho style={{ textAlign: "right" }}>Versão</Tabela.CelulaCabecalho>
                </tr>
              </Tabela.Cabecalho>
              <Tabela.Corpo>
                {protocolos.map((item) => (
                  <tr key={item.numero_protocolo}>
                    <Tabela.Celula>
                      <Link to={`/protocolos/${item.numero_protocolo}`} className={`${styles.linkProtocolo} num`}>
                        {item.numero_protocolo}
                      </Link>
                      <div className={styles.linhaSecundaria}>{item.id_guia_origem ?? "—"}</div>
                    </Tabela.Celula>
                    <Tabela.Celula>
                      <span className="num" style={{ fontWeight: 500 }}>
                        {formatarDataCalendario(item.data_atendimento)}
                      </span>
                      <div className={styles.linhaSecundaria}>{item.unidade}</div>
                    </Tabela.Celula>
                    <Tabela.Celula>
                      {item.paciente}
                      <div className={styles.linhaSecundaria}>
                        {item.convenio} · {item.carteirinha}
                      </div>
                    </Tabela.Celula>
                    <Tabela.Celula>
                      {item.procedimento_descricao}
                      <div className={styles.linhaSecundaria}>{item.procedimento_codigo}</div>
                    </Tabela.Celula>
                    <Tabela.Celula>
                      <BadgeValidacao status={item.status_validacao} />
                      <div className={styles.linhaSecundaria}>{item.resumo_validacao}</div>
                    </Tabela.Celula>
                    <Tabela.Celula>
                      <EstadoFluxo status={item.status_fluxo} />
                    </Tabela.Celula>
                    <Tabela.Celula>{item.area_responsavel ? formatarRotuloArea(item.area_responsavel) : "—"}</Tabela.Celula>
                    <Tabela.CelulaNumerica>{formatarCentavos(item.risco_cents)}</Tabela.CelulaNumerica>
                    <Tabela.CelulaNumerica style={{ color: "var(--cor-texto-3)" }}>v{item.numero_versao_atual}</Tabela.CelulaNumerica>
                  </tr>
                ))}
              </Tabela.Corpo>
            </Tabela>
            </div>
            {paginacao && (
              <div className={styles.rodapeTabela}>
                <span>
                  Mostrando {(paginacao.pagina - 1) * paginacao.tamanho + 1}–{Math.min(paginacao.pagina * paginacao.tamanho, paginacao.total)} de{" "}
                  {paginacao.total}
                </span>
                <Paginacao paginaAtual={paginacao.pagina} totalPaginas={paginacao.total_paginas} aoMudarPagina={(p) => atualizarFiltros({ pagina: String(p) })} />
              </div>
            )}
          </>
        )}
      </Card>

      <Modal aberto={modalAberto === "importar"} titulo="Importar guias" aoFechar={fecharModal} tamanho="largo">
        <FormularioImportacao aoConcluir={aoConcluirImportacao} />
      </Modal>
      <Modal aberto={modalAberto === "nova-guia"} titulo="Nova guia" aoFechar={fecharModal} tamanho="medio">
        <FormularioNovaGuia aoConcluir={aoConcluirNovaGuia} />
      </Modal>
    </div>
  );
}
