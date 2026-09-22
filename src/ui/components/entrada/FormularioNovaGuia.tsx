import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Card } from "../Card";
import { ResultadoCadastro } from "./ResultadoCadastro";
import { TrilhaEtapas } from "./TrilhaEtapas";
import { EtapaAtendimento, EtapaFechamento, EtapaProcedimento } from "./EtapasNovaGuia";
import { obterRegrasParaExibicao, type RegrasParaExibicao } from "./regrasAtivas";
import {
  centavosParaTextoDeValor,
  estadoInicial,
  ETAPAS_NOVA_GUIA,
  type CamposGuia,
} from "./camposNovaGuia";
import { ApiError, cadastrarProtocolo } from "../../lib/api";
import type { CadastrarProtocoloEntrada, CadastrarProtocoloResposta } from "../../../http/contracts";
import styles from "./FormularioNovaGuia.module.css";

interface FormularioNovaGuiaProps {
  /** Chamado depois que o cadastro é salvo com sucesso no servidor — o pai reage (fecha o modal, atualiza a lista). */
  readonly aoConcluir: (resposta: CadastrarProtocoloResposta) => void;
}

/**
 * Cadastro individual de guia (RF-02), em três etapas. O formulário só confere FORMATO (campo
 * obrigatório estrutural, padrão de data/valor) — quem decide o que é obrigatório para cada
 * convênio é o motor de regras, no servidor, depois de salvar. `convenio`/`procedimento` vêm da
 * regra ativa real via `GET /api/rules` (ver `entrada/regrasAtivas.ts`) para não deixar digitar
 * um convênio ou código que a regra não reconhece.
 *
 * As 18 colunas de `guias.csv` numa tela só viravam um paredão dentro do modal; foram divididas
 * em atendimento → procedimento → valor e revisão (`ETAPAS_NOVA_GUIA`). Cada etapa monta só os
 * seus campos, então `reportValidity()` do formulário valida exatamente a etapa visível e o
 * navegador aponta o campo errado sem precisar de validação própria.
 */
export function FormularioNovaGuia({ aoConcluir }: FormularioNovaGuiaProps) {
  const [regras, setRegras] = useState<RegrasParaExibicao | null>(null);
  const [campos, setCampos] = useState<CamposGuia>(() => estadoInicial("", "", "", ""));
  const [indiceEtapa, setIndiceEtapa] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resposta, setResposta] = useState<CadastrarProtocoloResposta | null>(null);
  const padraoJaAplicado = useRef(false);
  const formularioRef = useRef<HTMLFormElement>(null);
  const tituloEtapaRef = useRef<HTMLHeadingElement>(null);
  const jaTrocouDeEtapa = useRef(false);

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

  // Ao trocar de etapa o foco vai para o título novo: dentro de um modal, quem navega por teclado
  // ou leitor de tela perderia a referência se ele continuasse no botão "Continuar", que sai da
  // tela. Na primeira renderização não mexe — o modal já põe o foco no primeiro campo.
  useEffect(() => {
    if (!jaTrocouDeEtapa.current) return;
    tituloEtapaRef.current?.focus();
  }, [indiceEtapa]);

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

  function irParaEtapa(indice: number): void {
    jaTrocouDeEtapa.current = true;
    setIndiceEtapa(indice);
  }

  function avancar(): void {
    // Só os campos da etapa atual estão montados, então isto valida exatamente ela.
    if (formularioRef.current && !formularioRef.current.reportValidity()) return;
    irParaEtapa(Math.min(indiceEtapa + 1, ETAPAS_NOVA_GUIA.length - 1));
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
    setIndiceEtapa(0);
    setErro(null);
    setResposta(null);
  }

  async function salvar(): Promise<void> {
    setEnviando(true);
    setErro(null);
    try {
      const guia: CadastrarProtocoloEntrada["guia"] = { ...campos };
      const resultado = await cadastrarProtocolo<CadastrarProtocoloResposta, CadastrarProtocoloEntrada>({ guia });
      setResposta(resultado);
      aoConcluir(resultado);
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : "Não foi possível salvar a guia agora.");
    } finally {
      setEnviando(false);
    }
  }

  function aoSubmeter(evento: FormEvent<HTMLFormElement>): void {
    evento.preventDefault();
    // Enter no meio do formulário avança a etapa em vez de salvar pela metade.
    if (indiceEtapa < ETAPAS_NOVA_GUIA.length - 1) {
      avancar();
      return;
    }
    void salvar();
  }

  if (resposta) {
    return (
      <div className={styles.conclusao}>
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

  const etapa = ETAPAS_NOVA_GUIA[indiceEtapa];
  const ultimaEtapa = indiceEtapa === ETAPAS_NOVA_GUIA.length - 1;
  const percentual = ((indiceEtapa + 1) / ETAPAS_NOVA_GUIA.length) * 100;

  return (
    <div className={styles.assistente}>
      <aside className={styles.colunaTrilha}>
        <TrilhaEtapas etapas={ETAPAS_NOVA_GUIA} etapaAtual={indiceEtapa} aoVoltarPara={irParaEtapa} />
        <p className={styles.notaTrilha}>
          Nada vai para o convênio aqui. Ao salvar, o sistema cria o protocolo e roda a verificação.
        </p>
      </aside>

      <div className={styles.painel}>
        <div className={styles.trilhoProgresso} aria-hidden="true">
          <span className={styles.progresso} style={{ width: `${percentual}%` }} />
        </div>

        <header className={styles.cabecalhoEtapa}>
          <p className={styles.contador}>
            Etapa {indiceEtapa + 1} de {ETAPAS_NOVA_GUIA.length}
          </p>
          <h3 ref={tituloEtapaRef} tabIndex={-1} className={styles.tituloEtapa}>
            {etapa.titulo}
          </h3>
          <p className={styles.apoio}>{etapa.apoio}</p>
        </header>

        {erro ? (
          <p role="alert" className={styles.erro}>
            {erro}
          </p>
        ) : null}

        <form ref={formularioRef} className={styles.formulario} onSubmit={aoSubmeter}>
          {/* `key` remonta o bloco a cada etapa: a animação de entrada reexecuta e o scroll volta ao topo. */}
          <div key={indiceEtapa} className={styles.corpoEtapa}>
            {indiceEtapa === 0 ? (
              <EtapaAtendimento campos={campos} regras={regras} atualizarCampo={atualizarCampo} />
            ) : null}
            {indiceEtapa === 1 ? (
              <EtapaProcedimento
                campos={campos}
                regras={regras}
                atualizarCampo={atualizarCampo}
                aoTrocarProcedimento={aoTrocarProcedimento}
              />
            ) : null}
            {indiceEtapa === 2 ? (
              <EtapaFechamento
                campos={campos}
                regras={regras}
                atualizarCampo={atualizarCampo}
                irParaEtapa={irParaEtapa}
              />
            ) : null}
          </div>

          <div className={styles.rodape}>
            <span className={styles.notaRodape}>
              {ultimaEtapa
                ? "Ao salvar: protocolo + versão 1 + validação + tarefas. Você não libera nem envia."
                : "Nada é salvo enquanto você não terminar as três etapas."}
            </span>
            {indiceEtapa > 0 ? (
              <button type="button" className={styles.botaoSecundario} onClick={() => irParaEtapa(indiceEtapa - 1)}>
                ← Voltar
              </button>
            ) : null}
            <button type="submit" className={styles.botaoPrimario} disabled={enviando}>
              {ultimaEtapa ? (enviando ? "Salvando…" : "Salvar e verificar") : "Continuar →"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
