param([ValidateSet('v1','v2','movement-v1','combat-v1')][string]$Version = 'v2')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path $PSScriptRoot -Parent
$assetRoot = Join-Path $projectRoot 'assets/characters/h1'
function Get-AlphaBounds($bitmap) {
    $rectangle = [System.Drawing.Rectangle]::new(0, 0, $bitmap.Width, $bitmap.Height)
    $data = $bitmap.LockBits($rectangle, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $bytes = New-Object byte[] ($data.Stride * $bitmap.Height)
        [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
        $left = $bitmap.Width; $top = $bitmap.Height; $right = -1; $bottom = -1
        for ($y = 0; $y -lt $bitmap.Height; $y++) {
            for ($x = 0; $x -lt $bitmap.Width; $x++) {
                if ($bytes[$y * $data.Stride + $x * 4 + 3] -ge 8) {
                    $left = [Math]::Min($left, $x); $right = [Math]::Max($right, $x)
                    $top = [Math]::Min($top, $y); $bottom = [Math]::Max($bottom, $y)
                }
            }
        }
        if ($bottom -lt 0) { throw 'Empty sprite' }
        return @{left=$left; top=$top; right=$right; bottom=$bottom}
    } finally { $bitmap.UnlockBits($data) }
}
$names = @('idle', 'startup', 'active', 'recovery')
if ($Version -eq 'v2') { $names += @('crouch', 'crouch-startup', 'crouch-active', 'crouch-recovery') }
if ($Version -eq 'movement-v1') { $names = @('idle-1','walk-0','walk-1','walk-2','walk-3','jump-rise','jump-apex','jump-fall') }
if ($Version -eq 'combat-v1') {
    $names = @()
    foreach ($attack in @('stand-hp','stand-lk','stand-hk','crouch-lp','crouch-hp','crouch-hk')) {
        foreach ($phase in @('startup','active','recovery')) { $names += "$attack-$phase" }
    }
    $names += @('stand-guard','crouch-guard','stand-hit','crouch-hit','ko-0','ko-1','ko-2')
}
$idle = [System.Drawing.Bitmap]::new((Join-Path $assetRoot 'generated/v1/idle.png'))
try { $idleBounds = Get-AlphaBounds $idle; $scale = 384.0 / ($idleBounds.bottom + 1 - $idleBounds.top); $sourceWidth = $idle.Width } finally { $idle.Dispose() }
$outputDir = Join-Path $assetRoot "derived/$Version"
[void](New-Item -ItemType Directory -Path $outputDir -Force)
$frames = foreach ($name in $names) {
    $sourceName = $name
    if ($Version -eq 'combat-v1' -and $name -in @('crouch-lp-recovery','crouch-hp-startup','crouch-hk-startup')) { $sourceName = "$name-v2" }
    $source = Join-Path $assetRoot "generated/$Version/$sourceName.png"
    $output = Join-Path $outputDir "$name.png"
    $bitmap = [System.Drawing.Bitmap]::new($source)
    $target = [System.Drawing.Bitmap]::new(512, 512, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($target)
    try {
        if ($bitmap.Width -ne $sourceWidth) { throw 'Source sizes differ; review shared scale first' }
        $bounds = Get-AlphaBounds $bitmap
        $rootX = $bitmap.Width / 2.0; $rootY = $bounds.bottom + 1
        $rootMode = 'sole-bottom'
        if ($name.StartsWith('ko-')) { $rootMode = 'body-bottom' }
        if ($name.StartsWith('jump-')) { $rootY = $idleBounds.bottom + 1; $rootMode = 'idle-virtual-ground' }
        $offsetX = 256 - $rootX * $scale; $offsetY = 448 - $rootY * $scale
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $destination = [System.Drawing.RectangleF]::new($offsetX, $offsetY, $bitmap.Width * $scale, $bitmap.Height * $scale)
        $graphics.DrawImage($bitmap, $destination, [System.Drawing.RectangleF]::new(0,0,$bitmap.Width,$bitmap.Height), [System.Drawing.GraphicsUnit]::Pixel)
        $target.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
        @{
            id=$name; source="generated/$Version/$sourceName.png"; output="derived/$Version/$name.png"
            sourceSha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLower()
            outputSha256=(Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLower()
            sourceSize=@($bitmap.Width,$bitmap.Height); sourceBounds=$bounds
            sourceRoot=@($rootX,$rootY); scale=$scale; offset=@($offsetX,$offsetY)
            rootMode=$rootMode
            outputBounds=(Get-AlphaBounds $target)
        }
    } finally { $graphics.Dispose(); $target.Dispose(); $bitmap.Dispose() }
}
$manifest = @{
    status='draft'; canvas=@(512,512); root=@(256,448); displayScale=0.625; alphaThreshold=8
    method='Shared scale from idle alpha height (384px); source canvas midpoint X; sole bottom Y except jumping uses idle virtual ground. No repainting.'
    referenceSha256=(Get-FileHash -LiteralPath (Join-Path $assetRoot 'reference.png') -Algorithm SHA256).Hash.ToLower()
    frames=@($frames)
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputDir 'manifest.json') -Encoding UTF8
$manifest | ConvertTo-Json -Depth 8
