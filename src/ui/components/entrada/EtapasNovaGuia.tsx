import { CampoFormulario } from "./CampoFormulario";
import {
  centavosParaTextoDeValor,
  ETAPAS_NOVA_GUIA,
  PADRAO_DATA_BR,
  PADRAO_INTEIRO,
  PADRAO_VALOR,
  ROTULO_CAMPO,
  SUGESTOES_UNIDADE,
  type CamposGuia,
} from "./camposNovaGuia";
import type { RegrasParaExibicao } from "./regrasAtivas";
import styles from "./FormularioNovaGuia.module.css";

interface PropsEtapa {
  readonly campos: CamposGuia;
  readonly regras: RegrasParaExibicao | null;
  readonly atualizarCampo: <K extends keyof CamposGuia>(campo: K, valor: string) => void;
}

/**
 * Faixa com o que o convênio escolhido exige. Fica dentro da etapa, logo abaixo dos campos que
 * ela explica — no lugar da antiga coluna lateral de três cartões, que repetia a mesma regra em
 * todas as telas e dobrava a altura do formulário.
 */
function ContextoConvenio({
  regras,
  campos,
  mostrarCobertura,
}: {
  readonly regras: RegrasParaExibicao | null;
  readonly campos: CamposGuia;
  readonly mostrarCobertura: boolean;
}) {
  const convenio = regras?.convenioPorNome(campos.convenio) ?? null;
  if (convenio === null) return null;

  const aplicavel = regras?.regraAplicavel(campos.convenio, campos.procedimento_codigo) ?? null;
  const descoberto = mostrarCobertura && aplicavel !== null && !aplicavel.procedimento_coberto;

  return (
    <aside className={`${styles.contexto} ${descoberto ? styles.contextoAtencao : ""}`} aria-live="polite">
      <div className={styles.contextoCabecalho}>
        <b>{convenio.nome}</b>
        <span className={styles.contextoVersao}>regras de agosto/2026</span>
      </div>
      {descoberto ? (
        <p className={styles.contextoAviso}>
          {convenio.nome} não cobre {campos.procedimento_codigo}. Dá para salvar assim mesmo — quem decide é a
          verificação, no servidor.
        </p>
      ) : null}
      <ul className={styles.listaChips}>
        {convenio.campos_obrigatorios.map((campo) => {
          const preenchido = Boolean(campos[campo as keyof CamposGuia]);
          return (
            <li key={campo} className={`${styles.chip} ${preenchido ? styles.chipPreenchido : ""}`}>
              <span aria-hidden="true">{preenchido ? "✓" : "•"}</span>
              {ROTULO_CAMPO[campo as keyof CamposGuia] ?? campo}
            </li>
          );
        })}
      </ul>
      <p className={styles.contextoNota}>
        Autorização vale até {convenio.validade_maxima_autorizacao_dias} dias · limite de{" "}
        {convenio.limite_sessoes_por_autorizacao} sessões por autorização · envio em até {convenio.prazo_envio_dias}{" "}
        dias após o atendimento.
      </p>
    </aside>
  );
}

export function EtapaAtendimento({ campos, regras, atualizarCampo }: PropsEtapa) {
  return (
    <>
      <div className={styles.gradeCampos}>
        <CampoFormulario
          idCampo="id_guia"
          rotulo={ROTULO_CAMPO.id_guia}
          obrigatorio
          dica="Como a guia é identificada na origem"
        >
          <input
            id="id_guia"
            type="text"
            required
            value={campos.id_guia}
            onChange={(e) => atualizarCampo("id_guia", e.target.value)}
          />
        </CampoFormulario>

        <CampoFormulario idCampo="unidade" rotulo={ROTULO_CAMPO.unidade} obrigatorio>
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

        <CampoFormulario idCampo="paciente" rotulo={ROTULO_CAMPO.paciente} obrigatorio className={styles.campoTotal}>
          <input
            id="paciente"
            type="text"
            required
            value={campos.paciente}
            onChange={(e) => atualizarCampo("paciente", e.target.value)}
          />
        </CampoFormulario>

        {/* O formato já está no placeholder — repeti-lo na dica só enche a tela. */}
        <CampoFormulario idCampo="data_atendimento" rotulo={ROTULO_CAMPO.data_atendimento} obrigatorio>
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

        <CampoFormulario idCampo="carteirinha" rotulo={ROTULO_CAMPO.carteirinha} obrigatorio>
          <input
            id="carteirinha"
            type="text"
            required
            value={campos.carteirinha}
            onChange={(e) => atualizarCampo("carteirinha", e.target.value)}
          />
        </CampoFormulario>

        <CampoFormulario
          idCampo="convenio"
          rotulo={ROTULO_CAMPO.convenio}
          obrigatorio
          className={styles.campoTotal}
          dica="Define os campos obrigatórios das próximas etapas"
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
      </div>

      <ContextoConvenio regras={regras} campos={campos} mostrarCobertura={false} />
    </>
  );
}

export function EtapaProcedimento({
  campos,
  regras,
  atualizarCampo,
  aoTrocarProcedimento,
}: PropsEtapa & { readonly aoTrocarProcedimento: (codigo: string) => void }) {
  const aplicavel = regras?.regraAplicavel(campos.convenio, campos.procedimento_codigo) ?? null;

  return (
    <>
      <div className={styles.gradeCampos}>
        <CampoFormulario
          idCampo="procedimento_codigo"
          rotulo={ROTULO_CAMPO.procedimento_codigo}
          obrigatorio
          className={styles.campoTotal}
          estado={aplicavel !== null && !aplicavel.procedimento_coberto ? "atencao" : "normal"}
          dica={
            aplicavel
              ? aplicavel.procedimento_coberto
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

        <CampoFormulario idCampo="cid" rotulo={ROTULO_CAMPO.cid}>
          <input
            id="cid"
            type="text"
            placeholder="ex.: M79.7"
            value={campos.cid}
            onChange={(e) => atualizarCampo("cid", e.target.value)}
          />
        </CampoFormulario>

        <CampoFormulario idCampo="numero_autorizacao" rotulo={ROTULO_CAMPO.numero_autorizacao}>
          <input
            id="numero_autorizacao"
            type="text"
            value={campos.numero_autorizacao}
            onChange={(e) => atualizarCampo("numero_autorizacao", e.target.value)}
          />
        </CampoFormulario>

        <CampoFormulario
          idCampo="autorizacao_validade"
          rotulo={ROTULO_CAMPO.autorizacao_validade}
          dica="Vale no próprio dia do vencimento"
        >
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

        <CampoFormulario idCampo="sessao_numero_na_autorizacao" rotulo={ROTULO_CAMPO.sessao_numero_na_autorizacao}>
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

        <CampoFormulario
          idCampo="autorizacao_sessoes_limite"
          rotulo={ROTULO_CAMPO.autorizacao_sessoes_limite}
          dica={aplicavel ? `${aplicavel.convenio}: até ${aplicavel.limite_sessoes_por_autorizacao}` : undefined}
        >
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

        <CampoFormulario idCampo="profissional" rotulo={ROTULO_CAMPO.profissional} obrigatorio>
          <input
            id="profissional"
            type="text"
            required
            value={campos.profissional}
            onChange={(e) => atualizarCampo("profissional", e.target.value)}
          />
        </CampoFormulario>

        <CampoFormulario idCampo="profissional_registro" rotulo={ROTULO_CAMPO.profissional_registro}>
          <input
            id="profissional_registro"
            type="text"
            value={campos.profissional_registro}
            onChange={(e) => atualizarCampo("profissional_registro", e.target.value)}
          />
        </CampoFormulario>
      </div>

      <ContextoConvenio regras={regras} campos={campos} mostrarCobertura />
    </>
  );
}

export function EtapaFechamento({
  campos,
  regras,
  atualizarCampo,
  irParaEtapa,
}: PropsEtapa & { readonly irParaEtapa: (indice: number) => void }) {
  const aplicavel = regras?.regraAplicavel(campos.convenio, campos.procedimento_codigo) ?? null;

  return (
    <>
      <div className={styles.gradeCampos}>
        <CampoFormulario
          idCampo="valor"
          rotulo={ROTULO_CAMPO.valor}
          obrigatorio
          dica={
            aplicavel?.procedimento
              ? `Referência do convênio: R$ ${centavosParaTextoDeValor(aplicavel.procedimento.valor_referencia_cents)}`
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
          rotulo={ROTULO_CAMPO.data_lancamento}
          obrigatorio
          dica="Geralmente hoje"
        >
          <input
            id="data_lancamento"
            type="text"
            required
            placeholder="dd/mm/aaaa"
            pattern={PADRAO_DATA_BR}
            title="Formato dd/mm/aaaa"
            value={campos.data_lancamento}
            onChange={(e) => atualizarCampo("data_lancamento", e.target.value)}
          />
        </CampoFormulario>

        <CampoFormulario
          idCampo="observacao_recepcao"
          rotulo={ROTULO_CAMPO.observacao_recepcao}
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

      <div className={styles.revisao}>
        {ETAPAS_NOVA_GUIA.slice(0, 2).map((etapa, indice) => (
          <section key={etapa.rotulo} className={styles.revisaoBloco}>
            <div className={styles.revisaoCabecalho}>
              <h4 className={styles.revisaoTitulo}>{etapa.rotulo}</h4>
              <button type="button" className={styles.botaoTexto} onClick={() => irParaEtapa(indice)}>
                Editar
              </button>
            </div>
            <dl className={styles.revisaoLista}>
              {etapa.campos.map((campo) => (
                <div key={campo} className={styles.revisaoItem}>
                  <dt>{ROTULO_CAMPO[campo]}</dt>
                  <dd className={campos[campo] ? "" : styles.revisaoVazio}>{campos[campo] || "—"}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </>
  );
}
