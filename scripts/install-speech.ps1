param([string] $AppDataDirectory = (Join-Path $env:LOCALAPPDATA 'id.aura.interview'))

$ErrorActionPreference = 'Stop'
$modelName = 'ggml-base-q5_1.bin'
$binaryNames = @('whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll')
$speechDirectory = Join-Path $AppDataDirectory 'speech'
$destination = Join-Path $speechDirectory 'whisper-v1.8.3'
New-Item -ItemType Directory -Path $speechDirectory -Force | Out-Null
$scratch = Join-Path $speechDirectory ('download-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch | Out-Null

function Get-VerifiedFile($Url, $Path, $Expected) {
    & curl.exe --proto '=https' --proto-redir '=https' --fail --silent --show-error --location --retry 2 --max-time 180 --output $Path $Url
    if ($LASTEXITCODE -ne 0) { throw ('Unduhan Whisper gagal: ' + [IO.Path]::GetFileName($Path)) }
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $Expected) {
        throw ('SHA-256 unduhan tidak sesuai: ' + [IO.Path]::GetFileName($Path))
    }
}

try {
    $archive = Join-Path $scratch 'whisper.zip'
    $unpacked = Join-Path $scratch 'archive'
    $ready = Join-Path $scratch 'ready'
    New-Item -ItemType Directory -Path $ready | Out-Null
    Get-VerifiedFile 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.3/whisper-bin-x64.zip' $archive 'd824b1e37599f882b396e73f1ee0bfd5d0529f700314c48311dcbd00b803321d'
    Expand-Archive -LiteralPath $archive -DestinationPath $unpacked
    foreach ($name in $binaryNames) {
        $binary = @(Get-ChildItem -LiteralPath $unpacked -File -Recurse -Filter $name)
        if ($binary.Count -ne 1) { throw ('Isi paket tidak valid: ' + $name) }
        Copy-Item -LiteralPath $binary[0].FullName -Destination $ready
    }
    Get-VerifiedFile 'https://huggingface.co/ggerganov/whisper.cpp/resolve/f281eb45af861ab5e5297d23694b7d46e090c02c/ggml-base-q5_1.bin' (Join-Path $ready $modelName) '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898'
    if (Test-Path -LiteralPath $destination) {
        throw ('Berkas versi ini sudah ada. Tutup AURA dan pindahkan folder ini jika perlu memasang ulang: ' + $destination)
    }
    Move-Item -LiteralPath $ready -Destination $destination
    Write-Output ('Whisper lokal siap di ' + $destination)
} finally {
    $resolved = (Resolve-Path -LiteralPath $scratch).Path
    $parent = (Resolve-Path -LiteralPath $speechDirectory).Path
    if ([IO.Path]::GetDirectoryName($resolved) -eq $parent -and [IO.Path]::GetFileName($resolved) -match '^download-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
