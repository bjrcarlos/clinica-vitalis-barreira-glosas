import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "../Card";
import { Tabela } from "../Tabela";
import { PainelEtapas } from "./PainelEtapas";
import { CartaoEstatistica } from "./CartaoEstatistica";
import { calcularSha256Hex, truncarHash } from "./hashArquivo";
import { lerXlsxComoTextoCsv } from "./xlsxCliente";
import { prepararPreviaImportacao, type PreviaImportacao } from "./previaImportacao";
import { buscarIdsGuiaExistentes } from "./buscarIdsGuiaExistentes";
import { ApiError, importarArquivo } from "../../lib/api";
import { CABECALHO_GUIA_CSV } from "../../../domain/parse-csv";
import type { GuiaBrutaWire, ImportarGuiasEntrada, ImportarGuiasResposta } from "../../../http/contracts";
import styles from "./FormularioImportacao.module.css";

type Etapa = "escolher" | "conferir" | "concluido";

const ROTULOS_ETAPA = ["Enviar arquivo", "Conferir resumo", "Confirmar"] as const;

interface FormularioImportacaoProps {
  /** Chamado depois que a importação é confirmada com sucesso no servidor — o pai reage (fecha o modal, atualiza a lista). */
  readonly aoConcluir: (resultado: ImportarGuiasResposta) => void;
}

function extensaoSuportada(nomeArquivo: string): "csv" | "xlsx" | null {
  const nome = nomeArquivo.toLowerCase();
  if (nome.endsWith(".csv")) return "csv";
  if (nome.endsWith(".xlsx")) return "xlsx";
  return null;
}

function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Importar guias (RF-01). Lê CSV/XLSX no navegador, mostra o resumo (aceitas, rejeitadas com
 * motivo, duplicadas no arquivo, já existentes na base) e só então confirma via
 * `POST /api/imports`. Nenhuma regra de negócio aqui: `parseCsv`/`normalizarGuia` (Fase 1)
 * fazem a leitura e a normalização; o servidor roda a validação de verdade.
 *
 * Extraído de `src/ui/pages/Importar.tsx` para ser aberto num `Modal` a partir de "Todas as
 * guias" — o título da tela agora vive no cabeçalho do modal, por isso não repete `<h1>` aqui.
 */
export function FormularioImportacao({ aoConcluir }: FormularioImportacaoProps) {
  const [etapa, setEtapa] = useState<Etapa>("escolher");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [formato, setFormato] = useState<"csv" | "xlsx" | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [textoCsvOriginal, setTextoCsvOriginal] = useState<string | null>(null);
  const [previa, setPrevia] = useState<PreviaImportacao | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<ImportarGuiasResposta | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function reiniciar() {
    setEtapa("escolher");
    setArquivo(null);
    setFormato(null);
    setHash(null);
    setTextoCsvOriginal(null);
    setPrevia(null);
    setErro(null);
    setResultado(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function processarArquivo(arquivoEscolhido: File) {
    setErro(null);
    setResultado(null);
    setPrevia(null);
    setArquivo(arquivoEscolhido);
    setCarregando(true);
    try {
      const fmt = extensaoSuportada(arquivoEscolhido.name);
      if (fmt === null) {
        throw new Error("Formato não suportado: envie um arquivo .csv ou .xlsx.");
      }
      setFormato(fmt);

      const [hashHex, textoCsv, idsExistentes] = await Promise.all([
        calcularSha256Hex(arquivoEscolhido),
        fmt === "csv" ? arquivoEscolhido.text() : lerXlsxComoTextoCsv(arquivoEscolhido),
        buscarIdsGuiaExistentes(),
      ]);

      setHash(hashHex);
      setTextoCsvOriginal(fmt === "csv" ? textoCsv : null);
      setPrevia(prepararPreviaImportacao(fmt, textoCsv, idsExistentes));
      setEtapa("conferir");
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível ler o arquivo.");
    } finally {
      setCarregando(false);
    }
  }

  async function confirmarImportacao() {
    if (!arquivo || !formato || !previa || previa.aceitas.length === 0) return;
    setEnviando(true);
    setErro(null);
    try {
      const payload: ImportarGuiasEntrada =
        formato === "csv"
          ? { formato: "csv", nome_arquivo: arquivo.name, conteudo_csv: textoCsvOriginal ?? "" }
          : {
              formato: "json",
              nome_arquivo: arquivo.name,
              // `GuiaBruta` (domínio) é `Record<string, string>` genérico; `parseCsv` garante em
              // tempo de execução que as chaves são exatamente as 18 de `CABECALHO_GUIA_CSV`,
              // as mesmas do wire — daí a asserção de tipo em vez de reconstruir o objeto campo a campo.
              linhas: previa.aceitas.map((linha) => linha.guia as unknown as GuiaBrutaWire),
            };
      const resposta = await importarArquivo<ImportarGuiasResposta, ImportarGuiasEntrada>(payload);
      setResultado(resposta);
      setEtapa("concluido");
      aoConcluir(resposta);
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : "Não foi possível confirmar a importação agora.");
    } finally {
      setEnviando(false);
    }
  }

  const etapaAtual = etapa === "escolher" ? 0 : etapa === "conferir" ? 1 : 2;
  const totalNormalizadas = previa?.aceitas.filter((linha) => linha.avisos.length > 0).length ?? 0;

  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalho}>
        <p className={styles.subtitulo}>
          Nada é criado até você confirmar. O arquivo original fica guardado como evidência da importação.
        </p>
        <PainelEtapas etapas={ROTULOS_ETAPA} etapaAtual={etapaAtual} />
      </div>

      {erro ? (
        <p role="alert" className={styles.erro}>
          {erro}
        </p>
      ) : null}

      {etapa === "escolher" ? (
        <Card className={styles.cartaoEscolha}>
          <label className={styles.areaArquivo}>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx"
              className={styles.inputArquivo}
              disabled={carregando}
              onChange={(evento) => {
                const arquivoEscolhido = evento.target.files?.[0];
                if (arquivoEscolhido) void processarArquivo(arquivoEscolhido);
              }}
            />
            <span className={styles.areaArquivoTitulo}>
              {carregando ? "Lendo arquivo…" : "Escolher arquivo .csv ou .xlsx"}
            </span>
            <span className={styles.areaArquivoDica}>
              CSV é lido linha a linha; XLSX é convertido no navegador antes do envio.
            </span>
          </label>
          {carregando ? (
            <p role="status" aria-live="polite" className={styles.status}>
              Lendo e conferindo o arquivo…
            </p>
          ) : null}
        </Card>
      ) : null}

      {etapa === "conferir" && previa && arquivo ? (
        <div className={styles.grade}>
          <div className={styles.coluna}>
            <Card className={styles.cartaoArquivo}>
              <div className={styles.arquivoLinha}>
                <span className={styles.formatoSelo}>{formato?.toUpperCase()}</span>
                <div>
                  <b>{arquivo.name}</b>
                  <div className={styles.arquivoMeta}>{tamanhoLegivel(arquivo.size)}</div>
                </div>
              </div>
              {hash ? (
                <p className={styles.hashTexto}>
                  sha256{" "}
                  <span className={`${styles.hashValor} num`} title={hash}>
                    {truncarHash(hash)}
                  </span>
                </p>
              ) : null}
              <button type="button" className={styles.botaoSecundario} onClick={reiniciar}>
                Trocar arquivo
              </button>
            </Card>

            <Card className={styles.cartaoEstrutura}>
              <h2 className={styles.h2}>Estrutura validada</h2>
              <ul className={styles.listaEstrutura}>
                <li>✓ {CABECALHO_GUIA_CSV.length} colunas esperadas no cabeçalho</li>
                {totalNormalizadas > 0 ? (
                  <li className={styles.itemAtencao}>
                    ! {totalNormalizadas} linha(s) com data ou valor em formato não padrão, normalizada(s)
                  </li>
                ) : (
                  <li>✓ nenhuma normalização de formato necessária</li>
                )}
                {formato === "xlsx" ? <li>✓ planilha convertida para o formato de guias no navegador</li> : null}
              </ul>
            </Card>

            <Card className={styles.cartaoInfo}>
              Reenviar o mesmo arquivo não cria protocolos de novo: a importação é idempotente por
              id de origem da guia.
            </Card>
          </div>

          <div className={styles.colunaPrincipal}>
            <div className={styles.estatisticas}>
              <CartaoEstatistica rotulo="Linhas lidas" valor={previa.linhasLidas} descricao="no arquivo" />
              <CartaoEstatistica
                rotulo="Aceitas"
                valor={previa.totalNovas}
                descricao="vão virar protocolo"
                tom="positivo"
              />
              <CartaoEstatistica
                rotulo="Já na base"
                valor={previa.totalJaExistentes}
                descricao="reenvio idempotente"
                tom="info"
              />
              <CartaoEstatistica
                rotulo="Duplicadas no arquivo"
                valor={previa.totalDuplicadasNoArquivo}
                descricao="mantida a primeira"
                tom="info"
              />
              <CartaoEstatistica
                rotulo="Rejeitadas"
                valor={previa.rejeitadas.length}
                descricao="motivo em cada linha"
                tom="negativo"
              />
            </div>

            <Card semPadding className={styles.cartaoTabela}>
              <Tabela caption="Linhas aceitas">
                <Tabela.Cabecalho>
                  <tr>
                    <Tabela.CelulaCabecalho>id_guia</Tabela.CelulaCabecalho>
                    <Tabela.CelulaCabecalho>Paciente · convênio</Tabela.CelulaCabecalho>
                    <Tabela.CelulaCabecalho>Atendimento</Tabela.CelulaCabecalho>
                    <Tabela.CelulaCabecalho>Valor</Tabela.CelulaCabecalho>
                    <Tabela.CelulaCabecalho>Resultado</Tabela.CelulaCabecalho>
                    <Tabela.CelulaCabecalho>Detalhe</Tabela.CelulaCabecalho>
                  </tr>
                </Tabela.Cabecalho>
                <Tabela.Corpo>
                  {previa.aceitas.map((linha, indice) => {
                    const duplicada = linha.duplicataDaLinhaAceita !== null;
                    const normalizada = linha.avisos.length > 0;
                    const tom = duplicada
                      ? styles.badgeInfo
                      : linha.jaExisteNaBase
                        ? styles.badgeAtencao
                        : normalizada
                          ? styles.badgeAtencao
                          : styles.badgePositivo;
                    const rotuloBadge = duplicada
                      ? "Duplicada no arquivo"
                      : linha.jaExisteNaBase
                        ? "Já existe na base"
                        : normalizada
                          ? "Aceita · normalizada"
                          : "Aceita";
                    const detalhe = duplicada
                      ? `Repete a linha ${linha.duplicataDaLinhaAceita} deste arquivo; mantida a primeira.`
                      : linha.jaExisteNaBase
                        ? "Já tem protocolo na base — reenvio não cria de novo."
                        : normalizada
                          ? linha.avisos.map((aviso) => `${aviso.campo}: "${aviso.valor_original}" → "${aviso.valor_normalizado}"`).join("; ")
                          : "—";
                    return (
                      <tr key={`${linha.guia.id_guia}-${indice}`}>
                        <Tabela.Celula className="num">{linha.guia.id_guia || "—"}</Tabela.Celula>
                        <Tabela.Celula>
                          {linha.guia.paciente} · {linha.guia.convenio}
                        </Tabela.Celula>
                        <Tabela.CelulaNumerica>{linha.guia.data_atendimento}</Tabela.CelulaNumerica>
                        <Tabela.CelulaNumerica>{linha.guia.valor}</Tabela.CelulaNumerica>
                        <Tabela.Celula>
                          <span className={`${styles.badge} ${tom}`}>{rotuloBadge}</span>
                        </Tabela.Celula>
                        <Tabela.Celula className={styles.detalheCelula}>{detalhe}</Tabela.Celula>
                      </tr>
                    );
                  })}
                </Tabela.Corpo>
              </Tabela>
              {previa.aceitas.length === 0 ? (
                <p className={styles.semLinhas}>Nenhuma linha aceita neste arquivo — nada para importar.</p>
              ) : null}
            </Card>

            {previa.rejeitadas.length > 0 ? (
              <Card className={styles.cartaoRejeitadas}>
                <h2 className={styles.h2}>Linhas rejeitadas</h2>
                <ul className={styles.listaRejeitadas}>
                  {previa.rejeitadas.map((linha) => (
                    <li key={linha.numero_linha}>
                      <b className="num">Linha {linha.numero_linha}</b> — {linha.motivo}
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            <div className={styles.rodape}>
              <button type="button" className={styles.botaoSecundario} onClick={reiniciar} disabled={enviando}>
                Cancelar
              </button>
              <button
                type="button"
                className={styles.botaoPrimario}
                onClick={() => void confirmarImportacao()}
                disabled={enviando || previa.aceitas.length === 0}
              >
                {enviando ? "Confirmando…" : `Confirmar importação de ${previa.totalNovas} guia(s)`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {etapa === "concluido" && resultado ? (
        <Card className={styles.cartaoConcluido}>
          <h2 className={styles.h2}>Importação concluída</h2>
          <p className={styles.subtitulo}>
            {resultado.linhas_aceitas} linha(s) aceita(s) do arquivo — arquivo original preservado como
            evidência da importação.
          </p>
          <div className={styles.estatisticas}>
            <CartaoEstatistica
              rotulo="Protocolos criados"
              valor={resultado.protocolos_criados.length}
              tom="positivo"
            />
            <CartaoEstatistica
              rotulo="Já existiam"
              valor={resultado.protocolos_ja_existentes.length}
              tom="info"
            />
            <CartaoEstatistica
              rotulo="Rejeitadas"
              valor={resultado.linhas_rejeitadas.length}
              tom="negativo"
            />
          </div>
          {resultado.protocolos_criados.length > 0 ? (
            <div>
              <h3 className={styles.h3}>Novos protocolos</h3>
              <ul className={styles.listaProtocolos}>
                {resultado.protocolos_criados.map((protocolo) => (
                  <li key={protocolo.numero_protocolo}>
                    <Link to={`/protocolos/${encodeURIComponent(protocolo.numero_protocolo)}`}>
                      {protocolo.numero_protocolo}
                    </Link>{" "}
                    · {protocolo.id_guia_origem}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {resultado.protocolos_ja_existentes.length > 0 ? (
            <div>
              <h3 className={styles.h3}>Já existiam na base</h3>
              <ul className={styles.listaProtocolos}>
                {resultado.protocolos_ja_existentes.map((protocolo) => (
                  <li key={protocolo.numero_protocolo}>
                    <Link to={`/protocolos/${encodeURIComponent(protocolo.numero_protocolo)}`}>
                      {protocolo.numero_protocolo}
                    </Link>{" "}
                    · {protocolo.id_guia_origem}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {resultado.linhas_rejeitadas.length > 0 ? (
            <div>
              <h3 className={styles.h3}>Linhas rejeitadas</h3>
              <ul className={styles.listaRejeitadas}>
                {resultado.linhas_rejeitadas.map((linha) => (
                  <li key={linha.numero_linha}>
                    <b className="num">Linha {linha.numero_linha}</b> — {linha.motivo}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <button type="button" className={styles.botaoPrimario} onClick={reiniciar}>
            Importar outro arquivo
          </button>
        </Card>
      ) : null}
    </div>
  );
}
