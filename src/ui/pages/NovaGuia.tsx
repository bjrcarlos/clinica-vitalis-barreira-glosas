import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Card } from "../components/Card";
import { CampoFormulario } from "../components/entrada/CampoFormulario";
import { ResultadoCadastro } from "../components/entrada/ResultadoCadastro";
import { obterRegrasParaExibicao, type RegrasParaExibicao } from "../components/entrada/regrasAtivas";
import { ApiError, cadastrarProtocolo } from "../lib/api";
import { CABECALHO_GUIA_CSV } from "../../domain/parse-csv";
import type { CadastrarProtocoloEntrada, CadastrarProtocoloResposta } from "../../http/contracts";
import styles from "./NovaGuia.module.css";

type CamposGuia = Record<(typeof CABECALHO_GUIA_CSV)[number], string>;

/** Unidades observadas em `guias.csv` (docs/BASELINE.md) — sugestão, não trava: o domínio trata `unidade` como texto livre. */
const SUGESTOES_UNIDADE = ["Centro", "Norte", "Sul"] as const;

const PADRAO_DATA_BR = "\\d{2}/\\d{2}/\\d{4}";
const PADRAO_VALOR = "(R\\$\\s*)?\\d+([.,]\\d{2})?";
const PADRAO_INTEIRO = "\\d+";

function hojeDDMMAAAA(): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/** "62,00" (sem "R$") — formato que `normalizarGuia` já reconhece direto, sem símbolo para não obrigar o usuário a apagá-lo. */
function centavosParaTextoDeValor(centavos: number): string {
  return (centavos / 100).toFixed(2).replace(".", ",");
}

function estadoInicial(convenioPadrao: string, procedimentoCodigoPadrao: string, procedimentoDescricaoPadrao: string, valorPadrao: string): CamposGuia {
  return {
    id_guia: "",
    unidade: "",
    data_atendimento: "",
    paciente: "",
    convenio: convenioPadrao,
    carteirinha: "",
    cid: "",
    procedimento_codigo: procedimentoCodigoPadrao,
    procedimento_descricao: procedimentoDescricaoPadrao,
    numero_autorizacao: "",
    autorizacao_validade: "",
    autorizacao_sessoes_limite: "",
    sessao_numero_na_autorizacao: "",
    profissional: "",
    profissional_registro: "",
    valor: valorPadrao,
    observacao_recepcao: "",
    data_lancamento: hojeDDMMAAAA(),
  };
}

/**
 * Cadastro individual de guia (RF-02). O formulário só confere FORMATO (campo obrigatório
 * estrutural, padrão de data/valor) — quem decide o que é obrigatório para cada convênio é o
 * motor de regras, no servidor, depois de salvar. `convenio`/`procedimento` vêm da regra ativa
 * real via `GET /api/rules` (ver `entrada/regrasAtivas.ts`) para não deixar digitar um convênio
 * ou código que a regra não reconhece.
 */
export function NovaGuia() {
  const [regras, setRegras] = useState<RegrasParaExibicao | null>(null);
  const [campos, setCampos] = useState<CamposGuia>(() => estadoInicial("", "", "", ""));
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resposta, setResposta] = useState<CadastrarProtocoloResposta | null>(null);
  const padraoJaAplicado = useRef(false);

  // Carrega o catálogo (convênios/procedimentos) via API — não trava o formulário se falhar,
  // já que a validação real (e o motivo de bloqueio, se houver) sempre vem do servidor ao salvar.
  useEffect(() => {
    const controlador = new AbortController();
    obterRegrasParaExibicao(controlador.signal)
      .then((carregadas) => {
        setRegras(carregadas);
        if (padraoJaAplicado.current) return;
        padraoJaAplicado.current = true;
        const convenioPadrao = carregadas.convenios[0]?.nome ?? "";
        const procedimentoPadrao = carregadas.procedimentos[0] ?? null;
        // Só preenche o padrão se a pessoa ainda não tiver escolhido nada nesses dois campos —
        // nunca sobrescreve o que ela já começou a digitar enquanto o catálogo carregava.
        setCampos((atual) =>
          atual.convenio === "" && atual.procedimento_codigo === ""
            ? {
                ...atual,
                convenio: convenioPadrao,
                procedimento_codigo: procedimentoPadrao?.codigo ?? "",
                procedimento_descricao: procedimentoPadrao?.descricao ?? "",
                valor: procedimentoPadrao ? centavosParaTextoDeValor(procedimentoPadrao.valor_referencia_cents) : atual.valor,
              }
            : atual,
        );
      })
      .catch(() => {
        // Sem catálogo carregado, os campos de convênio/procedimento ficam vazios — a pessoa
        // ainda consegue preencher o resto e salvar; o servidor valida de qualquer forma.
      });
    return () => controlador.abort();
  }, []);

  function atualizarCampo<K extends keyof CamposGuia>(campo: K, valor: string): void {
    setCampos((anterior) => ({ ...anterior, [campo]: valor }));
  }

  function aoTrocarProcedimento(codigo: string): void {
    const procedimento = regras?.procedimentoPorCodigo(codigo) ?? null;
    setCampos((anterior) => ({
      ...anterior,
      procedimento_codigo: codigo,
      procedimento_descricao: procedimento?.descricao ?? "",
      valor: procedimento ? centavosParaTextoDeValor(procedimento.valor_referencia_cents) : anterior.valor,
    }));
  }

  function reiniciar(): void {
    const convenioPadrao = regras?.convenios[0]?.nome ?? "";
    const procedimentoPadrao = regras?.procedimentos[0] ?? null;
    setCampos(
      estadoInicial(
        convenioPadrao,
        procedimentoPadrao?.codigo ?? "",
        procedimentoPadrao?.descricao ?? "",
        procedimentoPadrao ? centavosParaTextoDeValor(procedimentoPadrao.valor_referencia_cents) : "",
      ),
    );
    setErro(null);
    setResposta(null);
  }

  async function aoSubmeter(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      const guia: CadastrarProtocoloEntrada["guia"] = { ...campos };
      const resultado = await cadastrarProtocolo<CadastrarProtocoloResposta, CadastrarProtocoloEntrada>({ guia });
      setResposta(resultado);
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : "Não foi possível salvar a guia agora.");
    } finally {
      setEnviando(false);
    }
  }

  if (resposta) {
    return (
      <div className={styles.pagina}>
        <h1 className={styles.titulo}>Nova guia</h1>
        {resposta.resultado_validacao ? (
          <ResultadoCadastro
            numeroProtocolo={resposta.protocolo.numero_protocolo}
            resultado={resposta.resultado_validacao}
          />
        ) : (
          <Card className={styles.cartaoJaExistia}>
            <p>
              Esta guia já tinha um protocolo — nenhuma nova validação foi executada
              (cadastro é idempotente por <code>id_guia</code>).
            </p>
            <Link to={`/protocolos/${encodeURIComponent(resposta.protocolo.numero_protocolo)}`}>
              Ver protocolo {resposta.protocolo.numero_protocolo} →
            </Link>
          </Card>
        )}
        <button type="button" className={styles.botaoPrimario} onClick={reiniciar}>
          Cadastrar outra guia
        </button>
      </div>
    );
  }

  const regraConvenioAtual = regras?.convenioPorNome(campos.convenio) ?? null;
  const regraAplicavelAtual = regras?.regraAplicavel(campos.convenio, campos.procedimento_codigo) ?? null;

  return (
    <div className={styles.pagina}>
      <div className={styles.grade}>
        <form className={styles.formulario} onSubmit={(evento) => void aoSubmeter(evento)}>
          <div>
            <h1 className={styles.titulo}>Nova guia</h1>
            <p className={styles.subtitulo}>
              Os campos obrigatórios mudam conforme o convênio — o resultado real da verificação
              aparece assim que você salvar.
            </p>
          </div>

          {erro ? (
            <p role="alert" className={styles.erro}>
              {erro}
            </p>
          ) : null}

          <div className={styles.gradeCampos}>
            <CampoFormulario idCampo="id_guia" rotulo="id_guia (origem)" obrigatorio>
              <input
                id="id_guia"
                type="text"
                required
                value={campos.id_guia}
                onChange={(e) => atualizarCampo("id_guia", e.target.value)}
              />
            </CampoFormulario>

            <CampoFormulario idCampo="unidade" rotulo="Unidade" obrigatorio>
              <input
                id="unidade"
                type="text"
                required
                list="sugestoes-unidade"
                value={campos.unidade}
                onChange={(e) => atualizarCampo("unidade", e.target.value)}
              />
              <datalist id="sugestoes-unidade">
                {SUGESTOES_UNIDADE.map((unidade) => (
                  <option key={unidade} value={unidade} />
                ))}
              </datalist>
            </CampoFormulario>

            <CampoFormulario idCampo="data_atendimento" rotulo="Data do atendimento" obrigatorio dica="dd/mm/aaaa">
              <input
                id="data_atendimento"
                type="text"
                required
                placeholder="dd/mm/aaaa"
                pattern={PADRAO_DATA_BR}
                title="Formato dd/mm/aaaa"
                value={campos.data_atendimento}
                onChange={(e) => atualizarCampo("data_atendimento", e.target.value)}
              />
            </CampoFormulario>

            <CampoFormulario idCampo="paciente" rotulo="Paciente" obrigatorio>
              <input
                id="paciente"
                type="text"
                required
                value={campos.paciente}
                onChange={(e) => atualizarCampo("paciente", e.target.value)}
              />
            </CampoFormulario>

            <CampoFormulario
              idCampo="convenio"
              rotulo="Convênio"
              obrigatorio
              dica={
                regraConvenioAtual
                  ? `${regraConvenioAtual.nome} exige: ${regraConvenioAtual.campos_obrigatorios.join(", ")}`
                  : undefined
              }
            >
              <select
                id="convenio"
                required
                value={campos.convenio}
                onChange={(e) => atualizarCampo("convenio", e.target.value)}
              >
                {(regras?.convenios ?? []).map((convenio) => (
                  <option key={convenio.nome} value={convenio.nome}>
                    {convenio.nome}
                  </option>
                ))}
              </select>
            </CampoFormulario>

            <CampoFormulario idCampo="carteirinha" rotulo="Carteirinha" obrigatorio>
              <input
                id="carteirinha"
                type="text"
                required
                value={campos.carteirinha}
                onChange={(e) => atualizarCampo("carteirinha", e.target.value)}
              />
            </CampoFormulario>

            <CampoFormulario
              idCampo="procedimento_codigo"
              rotulo="Procedimento"
              obrigatorio
              className={styles.campoLargo}
              dica={
                regraAplicavelAtual
                  ? regraAplicavelAtual.procedimento_coberto
                    ? `Coberto por ${campos.convenio}`
                    : `${campos.convenio} não cobre este procedimento`
                  : undefined
              }
            >
              <select
                id="procedimento_codigo"
                required
                value={campos.procedimento_codigo}
                onChange={(e) => aoTrocarProcedimento(e.target.value)}
              >
                {(regras?.procedimentos ?? []).map((procedimento) => (
                  <option key={procedimento.codigo} value={procedimento.codigo}>
                    {procedimento.codigo} · {procedimento.descricao} · R${" "}
                    {centavosParaTextoDeValor(procedimento.valor_referencia_cents)}
                  </option>
                ))}
              </select>
            </CampoFormulario>

            <CampoFormulario idCampo="cid" rotulo="CID">
              <input
                id="cid"
                type="text"
                placeholder="ex.: M79.7"
                value={campos.cid}
                onChange={(e) => atualizarCampo("cid", e.target.value)}
              />
            </CampoFormulario>

            <CampoFormulario idCampo="numero_autorizacao" rotulo="Nº da autorização">
              <input
                id="numero_autorizacao"
                type="text"
                value={campos.numero_autorizacao}
                onChange={(e) => atualizarCampo("numero_autorizacao", e.target.value)}
              />
            </CampoFormulario>

            <CampoFormulario idCampo="autorizacao_validade" rotulo="Validade da autorização" dica="dd/mm/aaaa">
              <input
                id="autorizacao_validade"
                type="text"
                placeholder="dd/mm/aaaa"
                pattern={PADRAO_DATA_BR}
                title="Formato dd/mm/aaaa"
                value={campos.autorizacao_validade}
                onChange={(e) => atualizarCampo("autorizacao_validade", e.target.value)}
              />
            </CampoFormulario>

            <CampoFormulario idCampo="sessao_numero_na_autorizacao" rotulo="Sessão nº">
              <input
                id="sessao_numero_na_autorizacao"
                type="text"
                inputMode="numeric"
                pattern={PADRAO_INTEIRO}
                title="Somente números"
                value={campos.sessao_numero_na_autorizacao}
                onChange={(e) => atualizarCampo("sessao_numero_na_autorizacao", e.target.value)}
              />
            </CampoFormulario>

            <CampoFormulario idCampo="autorizacao_sessoes_limite" rotulo="Limite de sessões">
              <input
                id="autorizacao_sessoes_limite"
                type="text"
                inputMode="numeric"
                pattern={PADRAO_INTEIRO}
                title="Somente números"
                value={campos.autorizacao_sessoes_limite}
                onChange={(e) => atualizarCampo("autorizacao_sessoes_limite", e.target.value)}
              />
            </CampoFormulario>

            <CampoFormulario idCampo="profissional" rotulo="Profissional" obrigatorio>
              <input
                id="profissional"
                type="text"
                required
                value={campos.profissional}
                onChange={(e) => atualizarCampo("profissional", e.target.value)}
              />
            </CampoFormulario>

            <CampoFormulario idCampo="profissional_registro" rotulo="Registro profissional">
              <input
                id="profissional_registro"
                type="text"
                value={campos.profissional_registro}
                onChange={(e) => atualizarCampo("profissional_registro", e.target.value)}
              />
            </CampoFormulario>

            <CampoFormulario
              idCampo="valor"
              rotulo="Valor"
              obrigatorio
              dica={
                regraAplicavelAtual?.procedimento
                  ? `Referência do convênio: R$ ${centavosParaTextoDeValor(regraAplicavelAtual.procedimento.valor_referencia_cents)}`
                  : "ex.: 62,00"
              }
            >
              <input
                id="valor"
                type="text"
                required
                pattern={PADRAO_VALOR}
                title="Ex.: 62,00 ou R$ 62,00"
                value={campos.valor}
                onChange={(e) => atualizarCampo("valor", e.target.value)}
              />
            </CampoFormulario>

            <CampoFormulario
              idCampo="data_lancamento"
              rotulo="Data de lançamento"
              obrigatorio
              dica="dd/mm/aaaa · geralmente hoje"
            >
              <input
                id="data_lancamento"
                type="text"
                required
                pattern={PADRAO_DATA_BR}
                title="Formato dd/mm/aaaa"
                value={campos.data_lancamento}
                onChange={(e) => atualizarCampo("data_lancamento", e.target.value)}
              />
            </CampoFormulario>

            <CampoFormulario
              idCampo="observacao_recepcao"
              rotulo="Observação da recepção"
              className={styles.campoTotal}
              dica="Texto livre. A IA só interpreta; quem decide é uma pessoa."
            >
              <textarea
                id="observacao_recepcao"
                rows={2}
                value={campos.observacao_recepcao}
                onChange={(e) => atualizarCampo("observacao_recepcao", e.target.value)}
              />
            </CampoFormulario>
          </div>

          <div className={styles.rodapeFormulario}>
            <span className={styles.notaRodape}>
              Ao salvar: protocolo + versão 1 + validação + tarefas. Você não libera nem envia.
            </span>
            <button type="submit" className={styles.botaoPrimario} disabled={enviando}>
              {enviando ? "Salvando…" : "Salvar e verificar"}
            </button>
          </div>
        </form>

        <div className={styles.colunaLateral}>
          <Card className={styles.cartaoLateral}>
            <h2 className={styles.h2}>Como funciona</h2>
            <p className={styles.paragrafoLateral}>
              Este formulário só confere formato. Quem decide se a guia fica <b>OK</b>, precisa de{" "}
              <b>correção</b> ou vai para <b>revisão humana</b> é o mesmo motor de regras da
              importação e do MCP — ele roda no servidor assim que você salva.
            </p>
          </Card>
          {regraConvenioAtual ? (
            <Card className={styles.cartaoLateral}>
              <h2 className={styles.h2}>{regraConvenioAtual.nome} · agosto/2026</h2>
              <ul className={styles.listaChips}>
                {regraConvenioAtual.campos_obrigatorios.map((campo) => (
                  <li key={campo} className={styles.chip}>
                    {campo}
                  </li>
                ))}
              </ul>
              <p className={styles.paragrafoLateral}>
                Validade máxima da autorização: {regraConvenioAtual.validade_maxima_autorizacao_dias} dias ·
                limite de {regraConvenioAtual.limite_sessoes_por_autorizacao} sessões por autorização.
              </p>
            </Card>
          ) : null}
          <Card className={styles.cartaoLateral}>
            Datas e valores em formato inequívoco são normalizados com aviso. O que você digitou fica
            guardado como valor original.
          </Card>
        </div>
      </div>
    </div>
  );
}
