/**
 * Formatadores de apresentação do domínio — a única implementação de "centavos → reais" e
 * "ISO UTC → horário de Brasília" do projeto. A interface (`src/ui/lib/format.ts`) e o MCP
 * (`src/mcp/**`) consomem daqui, então uma pessoa e um assistente conectado leem o mesmo
 * número escrito do mesmo jeito.
 *
 * Puro: sem relógio implícito, sem rede, sem banco. `Intl` é determinístico dado o fuso.
 */
import type { TipoEvento } from "./events";

const FUSO_BRASILIA = "America/Sao_Paulo";

function partesEmFuso(isoUtc: string, opcoes: Intl.DateTimeFormatOptions): Record<string, string> {
  const formatador = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO_BRASILIA, ...opcoes });
  const partes: Record<string, string> = {};
  for (const parte of formatador.formatToParts(new Date(isoUtc))) {
    if (parte.type !== "literal") partes[parte.type] = parte.value;
  }
  return partes;
}

/** `dd/MM/aaaa HH:mm:ss · horário de Brasília` (CLAUDE.md, exibição de datas). */
export function formatarDataHoraBrasilia(isoUtc: string): string {
  const p = partesEmFuso(isoUtc, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second} · horário de Brasília`;
}

/** `dd/MM/aaaa` em horário de Brasília, sem hora — para colunas de tabela. */
export function formatarDataCurta(isoUtc: string): string {
  const p = partesEmFuso(isoUtc, { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${p.day}/${p.month}/${p.year}`;
}

const REGEX_DATA_DE_CALENDARIO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `AAAA-MM-DD` → `dd/MM/aaaa` por manipulação de texto, nunca via `Date`: é uma data de
 * calendário (atendimento, validade), não um instante, e converter por fuso deslocaria o dia.
 * Qualquer outro valor volta inalterado.
 */
export function formatarDataCalendario(valor: string): string {
  if (!REGEX_DATA_DE_CALENDARIO.test(valor)) return valor;
  const [ano, mes, dia] = valor.split("-");
  return `${dia}/${mes}/${ano}`;
}

/** Centavos inteiros (invariante de domínio) → `R$ 1.234,56`. Nunca receber float. */
export function formatarCentavos(centavos: number): string {
  // Intl usa espaço não separável entre "R$" e o número; um espaço comum lê e copia igual em todo lugar.
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(centavos / 100).replace(/ /g, " ");
}

const ROTULOS_TIPO_EVENTO: Readonly<Record<TipoEvento, string>> = {
  IMPORTACAO: "Protocolo criado por importação",
  CADASTRO: "Protocolo cadastrado",
  VALIDACAO: "Validação executada",
  CORRECAO: "Nova versão criada",
  REVISAO: "Revisão registrada",
  LIBERACAO: "Liberado para envio",
  ENVIO: "Envio registrado",
  ENCERRAMENTO: "Protocolo encerrado",
  MERGE: "Protocolos mesclados",
};

/** Rótulo em português de um `TipoEvento`; tipo desconhecido volta como veio. */
export function apresentarTipoEvento(tipo: string): string {
  return (ROTULOS_TIPO_EVENTO as Readonly<Record<string, string>>)[tipo] ?? tipo;
}

/** Rótulos operacionais dos campos de uma guia, como a recepção os conhece. */
export const ROTULO_CAMPO_GUIA: Readonly<Record<string, string>> = {
  id_guia: "ID da guia (origem)",
  unidade: "Unidade",
  data_atendimento: "Data do atendimento",
  paciente: "Paciente",
  convenio: "Convênio",
  carteirinha: "Carteirinha",
  cid: "CID",
  procedimento_codigo: "Código do procedimento",
  procedimento_descricao: "Procedimento",
  numero_autorizacao: "Nº autorização",
  autorizacao_validade: "Validade da autorização",
  autorizacao_sessoes_limite: "Limite de sessões",
  sessao_numero_na_autorizacao: "Sessão nº",
  profissional: "Profissional",
  profissional_registro: "Registro profissional",
  valor: "Valor",
  valor_cents: "Valor",
  observacao_recepcao: "Observação da recepção",
  data_lancamento: "Data de lançamento",
};

/** Rótulo de um campo da guia; campo desconhecido vira texto legível (`_` → espaço, inicial maiúscula). */
export function apresentarCampoGuia(campo: string): string {
  const conhecido = ROTULO_CAMPO_GUIA[campo];
  if (conhecido) return conhecido;
  const texto = campo.replace(/_/g, " ");
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
