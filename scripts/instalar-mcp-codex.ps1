<#
.SYNOPSIS
  Registra o MCP da Barreira de Glosas no Codex CLI (OpenAI), uma entrada por área.

.DESCRIPTION
  O Codex lê o Bearer de uma variável de ambiente (`bearer_token_env_var` em ~/.codex/config.toml),
  então o token nunca entra no arquivo de configuração. Este script lê os dois tokens de
  `.secrets.local.md` (ignorado pelo Git), define as variáveis e registra os dois servidores.

  São duas entradas para o MESMO endereço, uma por área: é assim que dá para demonstrar que o
  papel vem da credencial, nunca de um parâmetro de tool.

.PARAMETER Persistente
  Grava as variáveis de ambiente no perfil do usuário (setx) em vez de só nesta sessão do terminal.
  Sem isso, elas valem apenas enquanto este terminal estiver aberto — e o Codex precisa ser aberto
  a partir dele.

.EXAMPLE
  pwsh -File scripts/instalar-mcp-codex.ps1
  pwsh -File scripts/instalar-mcp-codex.ps1 -Persistente
#>
[CmdletBinding()]
param(
  [switch]$Persistente,
  # Faz tudo menos registrar: confere que os tokens foram lidos e mostra o comando que seria executado.
  [switch]$Simular,
  [string]$Url = "https://vitalis-barreira-glosas.bjrcarlos04.workers.dev/mcp",
  [string]$ArquivoSegredos
)

$ErrorActionPreference = "Stop"

# $PSScriptRoot não está disponível no bloco param(), então o caminho padrão é resolvido aqui.
if (-not $ArquivoSegredos) { $ArquivoSegredos = Join-Path $PSScriptRoot "..\.secrets.local.md" }

if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
  throw "Codex CLI não encontrado no PATH. Instale-o antes: npm i -g @openai/codex"
}

if (-not (Test-Path $ArquivoSegredos)) {
  throw "Não achei $ArquivoSegredos. Os tokens de produção ficam nesse arquivo (ignorado pelo Git)."
}

$conteudo = Get-Content -Raw -Encoding UTF8 $ArquivoSegredos

function Get-Token([string]$Nome) {
  $achado = [regex]::Match($conteudo, "$Nome``?[^``]*``([A-Za-z0-9_-]{16,})``")
  if (-not $achado.Success) { throw "Não achei o valor de $Nome em $ArquivoSegredos." }
  return $achado.Groups[1].Value
}

$areas = @(
  @{ Servidor = "vitalis-secretaria"; Variavel = "VITALIS_MCP_SECRETARIA"; Token = (Get-Token "MCP_SECRETARIA_TOKEN") },
  @{ Servidor = "vitalis-financeiro"; Variavel = "VITALIS_MCP_FINANCEIRO"; Token = (Get-Token "MCP_FINANCEIRO_TOKEN") }
)

foreach ($area in $areas) {
  if ($Simular) {
    Write-Host "  [simulação] token de $($area.Servidor) lido: $($area.Token.Length) caracteres."
    Write-Host "  [simulação] codex mcp add $($area.Servidor) --url $Url --bearer-token-env-var $($area.Variavel)"
    continue
  }

  # Sessão atual: vale para o `codex` aberto a partir deste terminal.
  Set-Item -Path "Env:$($area.Variavel)" -Value $area.Token
  if ($Persistente) {
    [Environment]::SetEnvironmentVariable($area.Variavel, $area.Token, "User")
    Write-Host "  $($area.Variavel) gravada no perfil do usuário."
  }

  & codex mcp add $area.Servidor --url $Url --bearer-token-env-var $area.Variavel
  Write-Host "  $($area.Servidor) registrado ($($area.Token.Length) caracteres de token, lidos do arquivo)."
}

if ($Simular) {
  Write-Host ""
  Write-Host "Simulação: nada foi registrado nem gravado. Rode sem -Simular para instalar."
  return
}

Write-Host ""
Write-Host "Servidores registrados no Codex:"
& codex mcp list

Write-Host ""
if (-not $Persistente) {
  Write-Host "As variáveis valem só neste terminal. Para fixá-las no perfil, rode de novo com -Persistente."
}
Write-Host "Para remover depois: codex mcp remove vitalis-secretaria  (e vitalis-financeiro)."
