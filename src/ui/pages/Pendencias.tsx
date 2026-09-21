import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, type PapelSessao } from "../lib/api";
import type { ListaProtocolosResposta, ProtocoloListagemItemWire } from "../../http/contracts";
import type { Area } from "../../domain/statuses";
import { Card } from "../components/Card";
import { Chip } from "../components/Chip";
import { BadgeValidacao } from "../components/BadgeValidacao";
import { EstadoVazio } from "../components/EstadoVazio";
import { TrocaDePapel } from "../components/TrocaDePapel";
import { formatarCentavos, formatarDataCurta, formatarHaDias } from "../lib/format";
import styles from "./Pendencias.module.css";

type Ordenacao = "antiguidade" | "valor";

const CHAVE_PAPEL_LOCAL = "vitalis:papel-para-pendencias";

/**
 * Não existe `GET /api/session` nesta fase para ler a identidade do cookie assinado (HttpOnly
 * por desenho — nunca legível por JS), e esta tarefa não pode tocar `App.tsx`/`routes.tsx` para
 * propagar o papel escolhido na sidebar até aqui. Por isso esta página guarda sua própria
 * lembrança de "qual identidade estou usando", em `localStorage`, só para decidir QUAL fila
 * mostrar — nunca para autorizar nada: toda mutação continua sendo conferida pelo servidor a
 * partir do cookie de verdade. Trocar de papel aqui chama a mesma `POST /api/session` da sidebar.
 */
function lerPapelGuardado(): PapelSessao {
  try {
    const valor = localStorage.getItem(CHAVE_PAPEL_LOCAL);
    if (valor === "SECRETARIA" || valor === "FINANCEIRO" || valor === "DIRECAO") return valor;
  } catch {
    // localStorage indisponível (aba privada, storage bloqueado) — segue com o padrão.
  }
  return "SECRETARIA";
}

function gravarPapelGuardado(papel: PapelSessao) {
  try {
    localStorage.setItem(CHAVE_PAPEL_LOCAL, papel);
  } catch {
    // Convite apenas — perder a lembrança só volta ao padrão na próxima visita.
  }
}

/** Minhas pendências (RF-15 na versão de interface, design-reference/Pendencias.dc.html). */
export function Pendencias() {
  const [papel, setPapel] = useState<PapelSessao>(() => lerPapelGuardado());
  const [itens, setItens] = useState<readonly ProtocoloListagemItemWire[] | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("antiguidade");

  const area: Area | null = papel === "SECRETARIA" || papel === "FINANCEIRO" ? papel : null;

  useEffect(() => {
    if (!area) {
      setItens([]);
      setCarregando(false);
      return;
    }
    const controlador = new AbortController();
    setCarregando(true);
    setErro(null);
    const query = new URLSearchParams({
      area,
      status_validacao: "CORRIGIR,REVISAO_HUMANA,NAO_FATURAR_CONVENIO",
      status_fluxo: "EM_TRATAMENTO",
      tamanho: "100",
    });
    api
      .get<ListaProtocolosResposta>(`/protocols?${query.toString()}`, controlador.signal)
      .then((resposta) => setItens(resposta.protocolos))
      .catch((falha) => {
        if (falha instanceof ApiError) setErro(falha.message);
        else if (!(falha instanceof DOMException && falha.name === "AbortError")) setErro("Não foi possível carregar as pendências agora.");
      })
      .finally(() => setCarregando(false));
    return () => controlador.abort();
  }, [area]);

  function aoTrocarPapel(novoPapel: PapelSessao) {
    setPapel(novoPapel);
    gravarPapelGuardado(novoPapel);
  }

  const ordenados = [...(itens ?? [])].sort((a, b) =>
    ordenacao === "valor" ? b.risco_cents - a.risco_cents : a.atualizado_em_utc.localeCompare(b.atualizado_em_utc),
  );
  const valorTotal = ordenados.reduce((soma, item) => soma + item.risco_cents, 0);

  return (
    <div className={styles.pagina}>
      <div className={styles.coluna}>
        <div className={styles.cabecalho}>
          <div>
            <h1 className={styles.titulo}>
              Pendências <em className={styles.destaque}>{papel === "FINANCEIRO" ? "do Financeiro" : papel === "SECRETARIA" ? "da Secretaria" : ""}</em>
            </h1>
            <p className={styles.subtitulo}>
              A área vem da sua identidade atual, não de um filtro.{" "}
              {area && (
                <>
                  <b>
                    {ordenados.length} pendência{ordenados.length === 1 ? "" : "s"} · {formatarCentavos(valorTotal)}
                  </b>{" "}
                  aguardando decisão sua.
                </>
              )}
            </p>
          </div>
          {area && (
            <div className={styles.ordenacao}>
              <Chip ativo={ordenacao === "antiguidade"} onClick={() => setOrdenacao("antiguidade")}>
                Mais antigas primeiro
              </Chip>
              <Chip ativo={ordenacao === "valor"} onClick={() => setOrdenacao("valor")}>
                Maior valor
              </Chip>
            </div>
          )}
        </div>

        {!area ? (
          <Card>
            <EstadoVazio
              titulo="Direção não opera uma fila própria"
              descricao="Pendências pertencem à Secretaria ou ao Financeiro. Escolha uma dessas identidades ao lado para ver a fila; a Direção acompanha pelo Relatório."
            />
          </Card>
        ) : erro ? (
          <Card>
            <p role="alert" className={styles.erro}>
              {erro}
            </p>
          </Card>
        ) : carregando && ordenados.length === 0 ? (
          <p role="status" className={styles.carregando}>
            Carregando pendências…
          </p>
        ) : ordenados.length === 0 ? (
          <Card>
            <EstadoVazio titulo="Nenhuma pendência" descricao="Não há guias aguardando decisão desta área agora." />
          </Card>
        ) : (
          <Card semPadding>
            <ul className={styles.lista}>
              {ordenados.map((item) => (
                <li key={item.numero_protocolo} className={styles.linha}>
                  <Link to={`/protocolos/${item.numero_protocolo}`} className={`${styles.protocolo} num`}>
                    {item.numero_protocolo}
                  </Link>
                  <div className={styles.oQueDecidir}>
                    <div className={styles.linhaTitulo}>
                      <b>{item.resumo_validacao}</b>
                      <BadgeValidacao status={item.status_validacao} />
                    </div>
                    <div className={styles.contexto}>
                      {item.paciente} · {item.convenio} · {item.procedimento_descricao}
                    </div>
                  </div>
                  <span className={`${styles.desde} num`}>
                    {formatarDataCurta(item.atualizado_em_utc)} · {formatarHaDias(item.atualizado_em_utc)}
                  </span>
                  <span className={`${styles.valor} num`}>{formatarCentavos(item.risco_cents)}</span>
                  <Link to={`/protocolos/${item.numero_protocolo}`} className={styles.ir}>
                    Abrir
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <div className={styles.lateral}>
        <Card className={styles.identidade}>
          <h2 className={styles.tituloLateral}>Ver fila como</h2>
          <TrocaDePapel papelInicial={papel} aoTrocar={aoTrocarPapel} />
        </Card>
        {/*
          Demonstração do MCP (tool `minhas_pendencias` devolvendo esta mesma fila para o agente
          autenticado) é Fase 4 — fora de escopo desta tarefa. Espaço reservado de propósito.
        */}
      </div>
    </div>
  );
}
