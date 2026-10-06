param([ValidateSet('b1','r3','all')][string]$Character = 'all')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path $PSScriptRoot -Parent
$ids = if ($Character -eq 'all') { @('b1','r3') } else { @($Character) }

function Get-AlphaBounds($bitmap, [int]$threshold) {
    $rectangle = [System.Drawing.Rectangle]::new(0, 0, $bitmap.Width, $bitmap.Height)
    $data = $bitmap.LockBits($rectangle, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $bytes = New-Object byte[] ($data.Stride * $bitmap.Height)
        [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
        $left = $bitmap.Width; $top = $bitmap.Height; $right = -1; $bottom = -1
        for ($y = 0; $y -lt $bitmap.Height; $y++) {
            for ($x = 0; $x -lt $bitmap.Width; $x++) {
                if ($bytes[$y * $data.Stride + $x * 4 + 3] -ge $threshold) {
                    $left = [Math]::Min($left, $x); $right = [Math]::Max($right, $x)
                    $top = [Math]::Min($top, $y); $bottom = [Math]::Max($bottom, $y)
                }
            }
        }
        if ($right -lt 0) { throw 'Empty reference image' }
        return [ordered]@{left=$left; top=$top; right=$right; bottom=$bottom}
    } finally { $bitmap.UnlockBits($data) }
}

foreach ($id in $ids) {
    $root = Join-Path $projectRoot "assets/characters/$id"
    $source = Join-Path $root 'reference.png'
    $outDir = Join-Path $root 'derived/r0'
    [void](New-Item -ItemType Directory -Path $outDir -Force)
    $output = Join-Path $outDir 'reference-stand.png'
    $beforeHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLower()
    $bitmap = [System.Drawing.Bitmap]::new($source)
    $target = [System.Drawing.Bitmap]::new(512, 512, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($target)
    try {
        $full = Get-AlphaBounds $bitmap 1
        $visible = Get-AlphaBounds $bitmap 8
        $scale = 384.0 / ($full.bottom + 1 - $full.top)
        $rootX = $bitmap.Width / 2.0
        $rootY = $full.bottom + 1
        $offsetX = 256 - $rootX * $scale
        $offsetY = 448 - $rootY * $scale
        if ($offsetX + $full.left * $scale -lt 0 -or $offsetX + ($full.right + 1) * $scale -gt 512) {
            throw "$id reference would be clipped horizontally"
        }
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $sourceRect = [System.Drawing.RectangleF]::new(0, 0, $bitmap.Width, $bitmap.Height)
        $destination = [System.Drawing.RectangleF]::new($offsetX, $offsetY, $bitmap.Width * $scale, $bitmap.Height * $scale)
        $graphics.DrawImage($bitmap, $destination, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
        $firstBounds = Get-AlphaBounds $target 8
        $correctionY = 447 - $firstBounds.bottom
        if ($correctionY -ne 0) {
            $offsetY += $correctionY
            $graphics.Clear([System.Drawing.Color]::Transparent)
            $destination = [System.Drawing.RectangleF]::new($offsetX, $offsetY, $bitmap.Width * $scale, $bitmap.Height * $scale)
            $graphics.DrawImage($bitmap, $destination, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
        }
        $alignedBounds = Get-AlphaBounds $target 8
        if ($alignedBounds.bottom -ne 447) { throw "$id visible foot did not align to y448" }
        $target.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
        $manifest = [ordered]@{
            status = 'review-only'; character = $id
            source = 'reference.png'; output = 'derived/r0/reference-stand.png'
            sourceSha256 = $beforeHash
            outputSha256 = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLower()
            sourceSize = @($bitmap.Width, $bitmap.Height)
            sourceBoundsAlpha1 = $full; sourceBoundsAlpha8 = $visible
            sourceRoot = @($rootX, $rootY); scale = $scale; offset = @($offsetX, $offsetY)
            visibleFootCorrectionY = $correctionY
            canvas = @(512, 512); footRoot = @(256, 448); displayScale = 0.625
            outputBoundsAlpha1 = (Get-AlphaBounds $target 1)
            outputBoundsAlpha8 = $alignedBounds
            method = 'Scale full alpha height to 384px; center source canvas X; after bicubic resize align visible alpha>=8 foot bottom to y448. No repaint or crop.'
        }
        $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $outDir 'manifest.json') -Encoding utf8
        if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLower() -ne $beforeHash) { throw "$id reference changed" }
        $manifest | ConvertTo-Json -Depth 6
    } finally { $graphics.Dispose(); $target.Dispose(); $bitmap.Dispose() }
}
