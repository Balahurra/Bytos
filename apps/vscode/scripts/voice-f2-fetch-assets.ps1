# Fetches the pinned whisper.cpp engine and models into test-assets/voice-f2.
#
# Development/test helper only. It downloads exact upstream artifacts and then
# CHECKS THEM against the hashes pinned in src/core/voice/transcription/models/
# modelCatalog.ts. A mismatch fails the script: nothing unverified is kept.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\voice-f2-fetch-assets.ps1

$ErrorActionPreference = 'Stop'
$assetsRoot = Join-Path $PSScriptRoot '..\test-assets\voice-f2' | Resolve-Path -ErrorAction SilentlyContinue
if (-not $assetsRoot) { $assetsRoot = Join-Path $PSScriptRoot '..\test-assets\voice-f2' }
$assetsRoot = [System.IO.Path]::GetFullPath($assetsRoot)

$engineDir = Join-Path $assetsRoot 'whisper\b5454'
$modelDir  = Join-Path $assetsRoot 'models'
New-Item -ItemType Directory -Force -Path $engineDir, $modelDir | Out-Null

# Pinned archive (release b5454) and its pinned SHA-256.
$archiveUrl = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip'
$archiveSha = '6BA69E3482D7826214F90A6A9C84CA07782AEC1E1D0C6A7C30C994FD5D816CCB'

# Runtime files whisper-cli.exe needs, with sizes and hashes from the pin table.
$engineFiles = @(
  @{ Name = 'whisper-cli.exe';          Size = 479744;  Sha = '331DBA46D6427105D2B802CDBC7EAE916EA1C5ABF9B0D3B5CFE460D8DB8E4366' },
  @{ Name = 'whisper.dll';              Size = 1370112; Sha = '034396D75BB5720C1851674FF64A96192B58F6927B68D334EBD254CE6CAD9674' },
  @{ Name = 'ggml.dll';                 Size = 62464;   Sha = '31FE18616D872AF9B6134B47A6DFF8072AE4ECBE5DF0273F4F8DC36766C9DB8E' },
  @{ Name = 'ggml-base.dll';            Size = 693248;  Sha = 'BEDE0D6B2D387236ECD2B5DD676D51C8984B5B6E0AE461A12174E9C01345C5F0' },
  @{ Name = 'llama.dll';                Size = 2755072; Sha = '74B7857B05951C0DFF4C7BAF796205433C84EE40C9BBB0BDA3F182D4425CE339' },
  @{ Name = 'ggml-cpu-alderlake.dll';   Size = 1009664; Sha = 'D8F5C56EA490394EEAE8B271650F2647AECD039A542D6DF9E0140726E62A4603' },
  @{ Name = 'ggml-cpu-cannonlake.dll';  Size = 1049600; Sha = '74127B40ABD4F595D9DB6AF0FA313A02E18FF42FC228BFA05281E7C788DD4507' },
  @{ Name = 'ggml-cpu-cascadelake.dll'; Size = 1061376; Sha = '4B11C427B844EEAC87529AF9A8D94B35AAD2024666BEB2A35E59FE3077E4B81E' },
  @{ Name = 'ggml-cpu-haswell.dll';     Size = 1010688; Sha = '1306B1014C8118D27234D8DDC0E66CED1F8C8476BF85071595FD182EA9B7263B' },
  @{ Name = 'ggml-cpu-icelake.dll';     Size = 1061376; Sha = '2B4DC4C66E7D8FE2807283816E9CF3B7F7D0556F59DF34069871E37EAB8AED40' },
  @{ Name = 'ggml-cpu-sandybridge.dll'; Size = 1026560; Sha = '04EDBDEBC01A1D421062A960881A4F34D520D99693999518243F332406444C6E' },
  @{ Name = 'ggml-cpu-skylakex.dll';    Size = 1049600; Sha = '1774714CF93621406FF35344B54715619A83242AE3E331E44D98A3B35CE801BE' },
  @{ Name = 'ggml-cpu-sse42.dll';       Size = 862720;  Sha = 'F060318772C4C2DBAC312BBFFF6EA700B85DBC502BB38585A7186D06D549301A' },
  @{ Name = 'ggml-cpu-x64.dll';         Size = 866816;  Sha = '4B4B05CABA40D4309B5D710EF74C59BA190516B8489F27BDB1BA11AE33C6E9D3' }
)

$models = @(
  @{ Name = 'ggml-tiny.bin'; Size = 77691713;  Sha = 'BE07E048E1E599AD46341C8D2A135645097A538221678B7ACDD1B1919C6E1B21';
     Url = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin' },
  @{ Name = 'ggml-base.bin'; Size = 147951465; Sha = '60ED5BC3DD14EEA856493D334349B405782DDCAF0028D4B5DF4088345FBA2EFE';
     Url = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin' }
)

function Assert-File([string]$Path, [long]$Size, [string]$Sha) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "missing: $Path" }
  $actualSize = (Get-Item -LiteralPath $Path).Length
  if ($actualSize -ne $Size) { throw "size mismatch for $Path : $actualSize != $Size" }
  $actualSha = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
  if ($actualSha -ne $Sha) { throw "SHA-256 mismatch for $Path : $actualSha != $Sha" }
  Write-Host ("  OK {0} ({1} bytes)" -f (Split-Path -Leaf $Path), $Size)
}

Write-Host 'Downloading pinned whisper.cpp engine archive...'
$zip = Join-Path $env:TEMP 'bytos-whisper-b5454.zip'
Invoke-WebRequest -Uri $archiveUrl -OutFile $zip -UseBasicParsing
Assert-File -Path $zip -Size 8928640 -Sha $archiveSha

$extract = Join-Path $env:TEMP ('bytos-whisper-b5454-' + [guid]::NewGuid().ToString('N'))
Write-Host "Extracting to $extract ..."
Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force

Write-Host 'Installing and verifying engine files...'
foreach ($file in $engineFiles) {
  $source = Join-Path $extract ('Release\' + $file.Name)
  $target = Join-Path $engineDir $file.Name
  Copy-Item -LiteralPath $source -Destination $target -Force
  Assert-File -Path $target -Size $file.Size -Sha $file.Sha
}
Remove-Item -LiteralPath $extract -Recurse -Force
Remove-Item -LiteralPath $zip -Force

Write-Host 'Downloading and verifying models...'
foreach ($model in $models) {
  $target = Join-Path $modelDir $model.Name
  if (Test-Path -LiteralPath $target) {
    Write-Host "  (already present) $($model.Name)"
  } else {
    Write-Host "  downloading $($model.Name) ..."
    Invoke-WebRequest -Uri $model.Url -OutFile $target -UseBasicParsing
  }
  Assert-File -Path $target -Size $model.Size -Sha $model.Sha
}

Write-Host ''
Write-Host 'All F2 assets verified. Now generate the speech corpus with:'
Write-Host '  python .\scripts\voice-f2-corpus.py'
