import type { GuiaBruta } from "./guide";

/** Cabeçalho oficial de `guias.csv` (Fase 1), nesta ordem exata. */
export const CABECALHO_GUIA_CSV = [
  "id_guia",
  "unidade",
  "data_atendimento",
  "paciente",
  "convenio",
  "carteirinha",
  "cid",
  "procedimento_codigo",
  "procedimento_descricao",
  "numero_autorizacao",
  "autorizacao_validade",
  "autorizacao_sessoes_limite",
  "sessao_numero_na_autorizacao",
  "profissional",
  "profissional_registro",
  "valor",
  "observacao_recepcao",
  "data_lancamento",
] as const;

/** Uma linha de dados que não pôde virar `GuiaBruta` (número de campos incompatível com o cabeçalho). */
export interface LinhaRejeitada {
  readonly numero_linha: number;
  readonly motivo: string;
}

export interface ResultadoParseCsv {
  readonly linhas: readonly GuiaBruta[];
  readonly rejeitadas: readonly LinhaRejeitada[];
}

interface LinhaTokenizada {
  readonly campos: readonly string[];
  readonly numero_linha: number;
}

/**
 * Parser de CSV próprio (sem dependência externa, RF-01): respeita aspas e vírgulas dentro
 * de campo (aspas duplicadas `""` escapam uma aspa literal, inclusive através de quebras de
 * linha dentro do campo), valida o cabeçalho contra `CABECALHO_GUIA_CSV` e devolve as linhas
 * de dados como `GuiaBruta` — texto cru, sem nenhuma normalização de formato (isso é
 * responsabilidade de `normalizarGuia`, em `src/domain/normalize.ts`).
 *
 * Cabeçalho que não bate (coluna faltando, sobrando ou fora de ordem) rejeita o arquivo
 * inteiro, sem tentar mapear linhas de dados a colunas erradas. Uma linha de dados cujo
 * número de campos diverge do cabeçalho é rejeitada individualmente; as demais continuam
 * sendo processadas.
 *
 * Movido de `src/application/import/parse-csv.ts` para cá na auditoria da Fase 2: é uma
 * função pura (sem I/O, sem D1, sem relógio) que a UI já precisava reaproveitar
 * (`previaImportacao.ts`, `Importar.tsx`, `NovaGuia.tsx`, `FormularioCorrecao.tsx`) — importar
 * de `application` direto violava a regra de dependência do CLAUDE.md (`ui → application →
 * domain+rules`); `domain` é a camada isenta desse bloqueio por conter só funções puras.
 */
export function parseCsv(texto: string): ResultadoParseCsv {
  const linhas = tokenizar(texto);

  if (linhas.length === 0) {
    return { linhas: [], rejeitadas: [{ numero_linha: 1, motivo: "Arquivo CSV vazio." }] };
  }

  const cabecalho = linhas[0];
  const cabecalhoValido =
    cabecalho.campos.length === CABECALHO_GUIA_CSV.length &&
    CABECALHO_GUIA_CSV.every((coluna, indice) => cabecalho.campos[indice]?.trim() === coluna);

  if (!cabecalhoValido) {
    return {
      linhas: [],
      rejeitadas: [
        {
          numero_linha: cabecalho.numero_linha,
          motivo: `Cabeçalho inválido: esperado "${CABECALHO_GUIA_CSV.join(",")}", recebido "${cabecalho.campos.join(",")}".`,
        },
      ],
    };
  }

  const linhasValidas: GuiaBruta[] = [];
  const rejeitadas: LinhaRejeitada[] = [];

  for (const linha of linhas.slice(1)) {
    if (linha.campos.length !== CABECALHO_GUIA_CSV.length) {
      rejeitadas.push({
        numero_linha: linha.numero_linha,
        motivo: `Linha com ${linha.campos.length} campo(s), esperado ${CABECALHO_GUIA_CSV.length}.`,
      });
      continue;
    }

    const registro: Record<string, string> = {};
    CABECALHO_GUIA_CSV.forEach((coluna, indice) => {
      registro[coluna] = linha.campos[indice];
    });
    linhasValidas.push(registro);
  }

  return { linhas: linhasValidas, rejeitadas };
}

/**
 * Divide o texto em linhas de campos, respeitando aspas (que podem conter vírgula e quebra
 * de linha) e o escape `""`. Linhas totalmente vazias (nenhum caractere entre duas quebras
 * de linha) são ignoradas — não geram registro nem rejeição. CRLF e CR isolado viram LF.
 */
function tokenizar(textoOriginal: string): LinhaTokenizada[] {
  const texto = textoOriginal.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const linhas: LinhaTokenizada[] = [];

  let campos: string[] = [];
  let campo = "";
  let dentroDeAspas = false;
  let linhaAtual = 1;
  let inicioDaLinha = 1;
  let linhaTemConteudo = false;

  function fecharLinha(): void {
    if (linhaTemConteudo || campos.length > 0) {
      campos.push(campo);
      linhas.push({ campos, numero_linha: inicioDaLinha });
    }
    campos = [];
    campo = "";
    linhaTemConteudo = false;
  }

  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];

    if (dentroDeAspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          dentroDeAspas = false;
        }
      } else {
        if (ch === "\n") linhaAtual++;
        campo += ch;
      }
      continue;
    }

    if (ch === '"') {
      dentroDeAspas = true;
      linhaTemConteudo = true;
    } else if (ch === ",") {
      campos.push(campo);
      campo = "";
      linhaTemConteudo = true;
    } else if (ch === "\n") {
      fecharLinha();
      linhaAtual++;
      inicioDaLinha = linhaAtual;
    } else {
      campo += ch;
      linhaTemConteudo = true;
    }
  }

  fecharLinha();

  return linhas;
}
