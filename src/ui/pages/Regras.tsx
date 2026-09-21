import { useEffect, useState } from "react";
import { Card } from "../components/Card";
import { Tabela } from "../components/Tabela";
import { obterRegrasParaExibicao, type RegrasParaExibicao } from "../components/entrada/regrasAtivas";
import { truncarHash } from "../components/entrada/hashArquivo";
import { ApiError, obterRegraAtiva } from "../lib/api";
import { formatarCentavos, formatarDataHoraBrasilia } from "../lib/format";
import type { RegrasAtivasResposta } from "../../http/contracts";
import styles from "./Regras.module.css";

/**
 * Regras dos convênios (RN-01). Versão, hash e datas vêm de `GET /api/rules` (fonte da
 * verdade no servidor); o conteúdo por convênio/procedimento vem do mesmo `ConjuntoRegras`
 * que a validação usa (`entrada/regrasAtivas.ts`) — nunca um número inventado nesta tela.
 * RN-02: uma regra nova não recalcula decisão antiga; esta tela só mostra a regra ativa.
 */
export function Regras() {
  const [ativa, setAtiva] = useState<RegrasAtivasResposta | null>(null);
  const [erroAtiva, setErroAtiva] = useState<string | null>(null);
  const [regras, setRegras] = useState<RegrasParaExibicao | null>(null);
  const [erroRegras, setErroRegras] = useState<string | null>(null);

  useEffect(() => {
    const controlador = new AbortController();
    obterRegraAtiva<RegrasAtivasResposta>(controlador.signal)
      .then(setAtiva)
      .catch((falha: unknown) => {
        if (controlador.signal.aborted) return;
        setErroAtiva(falha instanceof ApiError ? falha.message : "Não foi possível carregar a versão ativa da regra.");
      });
    return () => controlador.abort();
  }, []);

  useEffect(() => {
    const controlador = new AbortController();
    obterRegrasParaExibicao(controlador.signal)
      .then(setRegras)
      .catch((falha: unknown) => {
        if (controlador.signal.aborted) return;
        setErroRegras(falha instanceof Error ? falha.message : "Não foi possível ler o conteúdo das regras.");
      });
    return () => controlador.abort();
  }, []);

  return (
    <div className={styles.pagina}>
      <div className={styles.grade}>
        <div className={styles.coluna}>
          <div>
            <h1 className={styles.titulo}>Regras</h1>
            <p className={styles.subtitulo}>
              Fonte da verdade: <span className="num">regras_convenio.json</span>. Regra objetiva vira
              código, não prompt.
            </p>
          </div>

          <Card className={styles.cartaoVersao}>
            <h2 className={styles.h2}>Versão ativa</h2>
            {erroAtiva ? (
              <p role="alert" className={styles.erro}>
                {erroAtiva}
              </p>
            ) : ativa ? (
              <div className={styles.versao}>
                <div className={styles.versaoConteudo}>
                  <b>{ativa.versao}</b> · ativa
                  <div className={styles.meta}>
                    importada {formatarDataHoraBrasilia(ativa.importada_em_utc)}
                    <br />
                    {ativa.ativada_em_utc ? `ativada ${formatarDataHoraBrasilia(ativa.ativada_em_utc)}` : "ainda não ativada"}
                  </div>
                  <div className={styles.meta} title={ativa.sha256}>
                    sha256 <span className="num">{truncarHash(ativa.sha256)}</span> · origem {ativa.origem}
                  </div>
                </div>
              </div>
            ) : (
              <p className={styles.carregando} role="status" aria-live="polite">
                Carregando…
              </p>
            )}
            <p className={styles.notaVersao}>
              Uma nova versão não recalcula decisões antigas. Revalidar cria uma execução nova,
              vinculada à regra nova.
            </p>
          </Card>

          {erroRegras ? (
            <Card className={styles.erroCartao}>{erroRegras}</Card>
          ) : regras ? (
            <Card className={styles.cartaoDefinicoes}>
              <h2 className={styles.h2}>Definições</h2>
              <dl className={styles.listaDefinicoes}>
                <dt>Autorização válida</dt>
                <dd>{regras.definicoes.autorizacao_valida}</dd>
                <dt>Sessão nº na autorização</dt>
                <dd>{regras.definicoes.sessao_numero_na_autorizacao}</dd>
                <dt>Prazo de envio</dt>
                <dd>{regras.definicoes.prazo_envio_dias}</dd>
                <dt>Valor</dt>
                <dd>{regras.definicoes.valor}</dd>
              </dl>
            </Card>
          ) : null}
        </div>

        <div className={styles.colunaPrincipal}>
          {regras ? (
            <>
              <Card className={styles.cartaoTabela}>
                <div>
                  <h2 className={styles.h2}>Convênios · {regras.versao}</h2>
                  <p className={styles.sub}>O que cada convênio exige para uma guia poder ser liberada</p>
                </div>
                <Tabela>
                  <Tabela.Cabecalho>
                    <tr>
                      <Tabela.CelulaCabecalho>Convênio</Tabela.CelulaCabecalho>
                      <Tabela.CelulaCabecalho>Campos obrigatórios</Tabela.CelulaCabecalho>
                      <Tabela.CelulaCabecalho>Validade máx. da autorização</Tabela.CelulaCabecalho>
                      <Tabela.CelulaCabecalho>Limite de sessões</Tabela.CelulaCabecalho>
                      <Tabela.CelulaCabecalho>Prazo de envio</Tabela.CelulaCabecalho>
                      <Tabela.CelulaCabecalho>Procedimentos cobertos</Tabela.CelulaCabecalho>
                    </tr>
                  </Tabela.Cabecalho>
                  <Tabela.Corpo>
                    {regras.convenios.map((convenio) => (
                      <tr key={convenio.nome}>
                        <Tabela.Celula>
                          <b>{convenio.nome}</b>
                        </Tabela.Celula>
                        <Tabela.Celula>
                          <div className={styles.chips}>
                            {convenio.campos_obrigatorios.map((campo) => (
                              <span key={campo} className={`${styles.chip} ${styles.chipObrigatorio}`}>
                                {campo}
                              </span>
                            ))}
                          </div>
                        </Tabela.Celula>
                        <Tabela.CelulaNumerica>{convenio.validade_maxima_autorizacao_dias} dias</Tabela.CelulaNumerica>
                        <Tabela.CelulaNumerica>{convenio.limite_sessoes_por_autorizacao} por autorização</Tabela.CelulaNumerica>
                        <Tabela.CelulaNumerica>{convenio.prazo_envio_dias} dias</Tabela.CelulaNumerica>
                        <Tabela.Celula>
                          <div className={styles.chips}>
                            {convenio.procedimentos_cobertos.map((codigo) => (
                              <span key={codigo} className={styles.chip}>
                                {codigo}
                              </span>
                            ))}
                          </div>
                        </Tabela.Celula>
                      </tr>
                    ))}
                  </Tabela.Corpo>
                </Tabela>
              </Card>

              <Card className={styles.cartaoTabela}>
                <div>
                  <h2 className={styles.h2}>Procedimentos e valores de referência</h2>
                  <p className={styles.sub}>Código, descrição e valor conferidos em toda validação</p>
                </div>
                <Tabela>
                  <Tabela.Cabecalho>
                    <tr>
                      <Tabela.CelulaCabecalho>Código</Tabela.CelulaCabecalho>
                      <Tabela.CelulaCabecalho>Descrição</Tabela.CelulaCabecalho>
                      <Tabela.CelulaCabecalho>Valor de referência</Tabela.CelulaCabecalho>
                      {regras.convenios.map((convenio) => (
                        <Tabela.CelulaCabecalho key={convenio.nome}>{convenio.nome}</Tabela.CelulaCabecalho>
                      ))}
                    </tr>
                  </Tabela.Cabecalho>
                  <Tabela.Corpo>
                    {regras.procedimentos.map((procedimento) => (
                      <tr key={procedimento.codigo}>
                        <Tabela.Celula className="num">{procedimento.codigo}</Tabela.Celula>
                        <Tabela.Celula>{procedimento.descricao}</Tabela.Celula>
                        <Tabela.CelulaNumerica>{formatarCentavos(procedimento.valor_referencia_cents)}</Tabela.CelulaNumerica>
                        {regras.convenios.map((convenio) => {
                          const coberto = convenio.procedimentos_cobertos.includes(procedimento.codigo);
                          return (
                            <Tabela.Celula
                              key={convenio.nome}
                              className={coberto ? styles.coberto : styles.naoCoberto}
                            >
                              {coberto ? "coberto" : "não coberto"}
                            </Tabela.Celula>
                          );
                        })}
                      </tr>
                    ))}
                  </Tabela.Corpo>
                </Tabela>
              </Card>
            </>
          ) : erroRegras ? null : (
            <p className={styles.carregando} role="status" aria-live="polite">
              Carregando regras…
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
