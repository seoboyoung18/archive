param([Parameter(Mandatory=$true)][ValidateSet('flip-v1','supplement-v1','reaction-smooth-v1')][string]$Version)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path $PSScriptRoot -Parent
$assetRoot = Join-Path $projectRoot 'assets/characters/h1'
$sourceDir = Join-Path $assetRoot "generated/$Version"
$outputDir = Join-Path $assetRoot "derived/$Version"
$scale = 512.0 / 1254.0

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

$sources = @(Get-ChildItem -LiteralPath $sourceDir -File -Filter '*.png' |
    Where-Object { $_.BaseName -notmatch 'rejected' } | Sort-Object Name)
if ($sources.Count -eq 0) { throw "No accepted PNG sources in $sourceDir" }
# Validate the complete source set before replacing any derived file.
foreach ($source in $sources) {
    if ($source.BaseName -cnotmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$') { throw "Unsafe sprite name: $($source.Name)" }
    $bitmap = [System.Drawing.Bitmap]::new($source.FullName)
    try {
        if ($bitmap.Width -ne 1254 -or $bitmap.Height -ne 1254) { throw "Expected 1254x1254 source: $($source.Name)" }
    } finally { $bitmap.Dispose() }
}
[void](New-Item -ItemType Directory -Path $outputDir -Force)
$frames = foreach ($source in $sources) {
    $name = $source.BaseName
    $output = Join-Path $outputDir "$name.png"
    $bitmap = [System.Drawing.Bitmap]::new($source.FullName)
    $target = [System.Drawing.Bitmap]::new(512, 512, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($target)
    try {
        $bounds = Get-AlphaBounds $bitmap
        $rootX = $bitmap.Width / 2.0
        $rootY = $bounds.bottom + 1
        $rootMode = if ($name -match '^(ko-|thrown-down)') { 'body-bottom' } else { 'sole-bottom' }
        if ($Version -eq 'flip-v1') { $rootY = $bitmap.Height * 0.875; $rootMode = 'canvas-virtual-ground' }
        $offsetX = 256 - $rootX * $scale
        $offsetY = if ($Version -eq 'flip-v1') { 0.0 } else { 448 - $rootY * $scale }
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $destination = [System.Drawing.RectangleF]::new($offsetX, $offsetY, $bitmap.Width * $scale, $bitmap.Height * $scale)
        $graphics.DrawImage($bitmap, $destination, [System.Drawing.RectangleF]::new(0, 0, $bitmap.Width, $bitmap.Height), [System.Drawing.GraphicsUnit]::Pixel)
        $target.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
        @{
            id=$name; source="generated/$Version/$name.png"; output="derived/$Version/$name.png"
            sourceSha256=(Get-FileHash -LiteralPath $source.FullName -Algorithm SHA256).Hash.ToLower()
            outputSha256=(Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLower()
            sourceSize=@($bitmap.Width,$bitmap.Height); sourceBounds=$bounds
            sourceRoot=@($rootX,$rootY); scale=$scale; offset=@($offsetX,$offsetY); rootMode=$rootMode
            outputBounds=(Get-AlphaBounds $target)
        }
    } finally { $graphics.Dispose(); $target.Dispose(); $bitmap.Dispose() }
}
$manifest = @{
    status='draft'; canvas=@(512,512); root=@(256,448); displayScale=0.625; alphaThreshold=8
    method='Fixed full-canvas scale 512/1254 from derived-512 reference proportions; source canvas midpoint X; sole/body bottom Y, or canvas 0.875 virtual ground for flip-v1. No per-pose scaling or repainting.'
    referenceSha256=(Get-FileHash -LiteralPath (Join-Path $assetRoot 'reference.png') -Algorithm SHA256).Hash.ToLower()
    frames=@($frames)
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputDir 'manifest.json') -Encoding UTF8
$manifest | ConvertTo-Json -Depth 8
