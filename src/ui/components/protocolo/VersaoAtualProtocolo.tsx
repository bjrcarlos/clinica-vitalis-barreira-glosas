import { Card } from "../Card";
import { formatarCentavos } from "../../lib/format";
import type { VersaoProtocoloWire } from "../../../http/contracts";
import { ROTULO_CAMPO_GUIA, formatarDataCalendario, normalizarNomeCampoDiff } from "./campos";
import styles from "./VersaoAtualProtocolo.module.css";

interface VersaoAtualProtocoloProps {
  readonly versao: VersaoProtocoloWire;
}

const TRACO = "—";

function celula(rotulo: string, valor: string, destacado: boolean) {
  return (
    <div className={destacado ? styles.itemDestacado : styles.item}>
      <span className={styles.rotulo}>{rotulo}</span>
      <span className={styles.valor}>{valor}</span>
    </div>
  );
}

/**
 * Dados da versão atual (PRD §12.2, item 5; RF-10). Mostra a guia já normalizada, com campos
 * alterados em relação à versão anterior destacados (`versao.diff`) e os avisos de normalização
 * bem visíveis, sem bloquear nada (RN-08) — só informar "valor original → valor normalizado".
 */
export function VersaoAtualProtocolo({ versao }: VersaoAtualProtocoloProps) {
  const guia = versao.guia;
  const camposAlterados = new Set(versao.diff.map((linha) => normalizarNomeCampoDiff(linha.campo)));
  const alterado = (campo: string) => camposAlterados.has(campo);

  return (
    <Card className={styles.cartao}>
      <div className={styles.cabecalho}>
        <div>
          <h2 className={styles.titulo}>Dados da versão atual · v{versao.numero_versao}</h2>
          <p className={styles.subtitulo}>Campos alterados em relação à versão anterior aparecem destacados.</p>
        </div>
        <details className={styles.expandir}>
          <summary>Ver dados brutos da versão</summary>
          <ul className={styles.brutos}>
            {Object.entries(versao.guia_bruta).map(([campo, valor]) => (
              <li key={campo}>
                <span>{ROTULO_CAMPO_GUIA[campo] ?? campo}</span>
                <b>{valor === "" ? TRACO : valor}</b>
              </li>
            ))}
          </ul>
        </details>
      </div>

      <div className={styles.grade}>
        {celula("Paciente", guia.paciente, alterado("paciente"))}
        {celula("Convênio", guia.convenio, alterado("convenio"))}
        {celula("Carteirinha", guia.carteirinha, alterado("carteirinha"))}
        {celula("CID", guia.cid ?? TRACO, alterado("cid"))}
        {celula("Procedimento", `${guia.procedimento_codigo} · ${guia.procedimento_descricao}`, alterado("procedimento_codigo") || alterado("procedimento_descricao"))}
        {celula("Data do atendimento", formatarDataCalendario(guia.data_atendimento), alterado("data_atendimento"))}
        {celula("Profissional", `${guia.profissional}${guia.profissional_registro ? ` · ${guia.profissional_registro}` : ""}`, alterado("profissional") || alterado("profissional_registro"))}
        {celula("Valor", guia.valor_cents === null ? TRACO : formatarCentavos(guia.valor_cents), alterado("valor_cents"))}
        {celula("Nº autorização", guia.numero_autorizacao ?? TRACO, alterado("numero_autorizacao"))}
        {celula("Validade da autorização", formatarDataCalendario(guia.autorizacao_validade), alterado("autorizacao_validade"))}
        {celula(
          "Sessão / limite",
          `${guia.sessao_numero_na_autorizacao ?? TRACO} de ${guia.autorizacao_sessoes_limite ?? TRACO}`,
          alterado("sessao_numero_na_autorizacao") || alterado("autorizacao_sessoes_limite"),
        )}
        {celula("Observação da recepção", guia.observacao_recepcao.trim() === "" ? TRACO : guia.observacao_recepcao, alterado("observacao_recepcao"))}
      </div>

      {versao.avisos_normalizacao.length > 0 && (
        <div className={styles.avisos}>
          <span className={styles.avisosTitulo}>Avisos de normalização</span>
          <ul>
            {versao.avisos_normalizacao.map((aviso, indice) => (
              <li key={indice}>
                {ROTULO_CAMPO_GUIA[aviso.campo] ?? aviso.campo}: <s>{aviso.valor_original}</s> → <b>{aviso.valor_normalizado}</b>{" "}
                <span className={styles.avisoMotivo}>({aviso.motivo})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
