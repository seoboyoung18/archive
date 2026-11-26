# Normalize B1 review poses at one fixed R0 scale. Generated originals stay untouched.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Join-Path (Split-Path $PSScriptRoot -Parent) 'assets/characters/b1'
$inputDir = Join-Path $root 'generated/r1-v1'
$outputDir = Join-Path $root 'derived/r1-v1'
[void](New-Item -ItemType Directory -Path $outputDir -Force)
$r0 = Get-Content -LiteralPath (Join-Path $root 'derived/r0/manifest.json') -Raw | ConvertFrom-Json
$baseScale = [double]$r0.scale
$r0VisibleHeight = [int]$r0.outputBoundsAlpha8.bottom - [int]$r0.outputBoundsAlpha8.top + 1

function Get-Bounds($bitmap, [int]$threshold) {
    $rect = [System.Drawing.Rectangle]::new(0, 0, $bitmap.Width, $bitmap.Height)
    $data = $bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $bytes = New-Object byte[] ($data.Stride * $bitmap.Height)
        [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
        $l=$bitmap.Width; $t=$bitmap.Height; $r=-1; $b=-1
        for($y=0; $y -lt $bitmap.Height; $y++) {
            for($x=0; $x -lt $bitmap.Width; $x++) {
                if($bytes[$y*$data.Stride+$x*4+3] -ge $threshold) {
                    $l=[Math]::Min($l,$x); $r=[Math]::Max($r,$x)
                    $t=[Math]::Min($t,$y); $b=[Math]::Max($b,$y)
                }
            }
        }
        if($r -lt 0) { throw 'Empty source image' }
        return [ordered]@{left=$l;top=$t;right=$r;bottom=$b}
    } finally { $bitmap.UnlockBits($data) }
}

$files = Get-ChildItem -LiteralPath $inputDir -Filter '*.png' | Sort-Object Name | ForEach-Object FullName
$frames = foreach($source in $files) {
    if(!(Test-Path -LiteralPath $source)) { throw "Missing source $source" }
    $id = [IO.Path]::GetFileNameWithoutExtension($source)
    $beforeHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLower()
    $bitmap = [System.Drawing.Bitmap]::new($source)
    $target = [System.Drawing.Bitmap]::new(512, 512, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($target)
    try {
        if($bitmap.Width -ne 1254 -or $bitmap.Height -ne 1254) { throw "$($id): unexpected source size" }
        $visible = Get-Bounds $bitmap 8
        $full = Get-Bounds $bitmap 1
        # Idle generations have different transparent framing. Match their visible height to R0.
        $scale = if($id.StartsWith('idle-')) { $r0VisibleHeight / [double]($visible.bottom - $visible.top + 1) }
            else { $baseScale }
        $offsetX = 256 - $bitmap.Width / 2.0 * $scale
        $offsetY = 448 - ($visible.bottom + 1) * $scale
        if($offsetX + $full.left*$scale -lt 0 -or $offsetX + ($full.right+1)*$scale -gt 512) {
            throw "$($id): image would be clipped horizontally"
        }
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $sourceRect = [System.Drawing.RectangleF]::new(0,0,$bitmap.Width,$bitmap.Height)
        $dest = [System.Drawing.RectangleF]::new($offsetX,$offsetY,$bitmap.Width*$scale,$bitmap.Height*$scale)
        $graphics.DrawImage($bitmap,$dest,$sourceRect,[System.Drawing.GraphicsUnit]::Pixel)
        $first = Get-Bounds $target 8
        $correctionY = 447 - $first.bottom
        if($correctionY -ne 0) {
            $offsetY += $correctionY
            $graphics.Clear([System.Drawing.Color]::Transparent)
            $dest = [System.Drawing.RectangleF]::new($offsetX,$offsetY,$bitmap.Width*$scale,$bitmap.Height*$scale)
            $graphics.DrawImage($bitmap,$dest,$sourceRect,[System.Drawing.GraphicsUnit]::Pixel)
        }
        $aligned = Get-Bounds $target 8
        if($aligned.bottom -ne 447) { throw "$($id): visible foot alignment failed" }
        $output = Join-Path $outputDir "$id.png"
        $target.Save($output,[System.Drawing.Imaging.ImageFormat]::Png)
        if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLower() -ne $beforeHash) { throw "$id source changed" }
        [ordered]@{
            id=$id; source="generated/r1-v1/$id.png"; output="derived/r1-v1/$id.png"
            sourceSha256=$beforeHash; outputSha256=(Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLower()
            sourceSize=@($bitmap.Width,$bitmap.Height); sourceBoundsAlpha1=$full; sourceBoundsAlpha8=$visible
            outputBoundsAlpha1=(Get-Bounds $target 1); outputBoundsAlpha8=$aligned
            scale=$scale; offset=@($offsetX,$offsetY); visibleFootCorrectionY=$correctionY
        }
    } finally { $graphics.Dispose(); $target.Dispose(); $bitmap.Dispose() }
}
$manifest = [ordered]@{
    status='review-only'; canvas=@(512,512); footRoot=@(256,448); displayScale=0.625
    referenceSha256=(Get-FileHash -LiteralPath (Join-Path $root 'reference.png') -Algorithm SHA256).Hash.ToLower()
    r0OutputSha256=$r0.outputSha256
    method='Walk: uniform R0 scale. Idle: source alpha>=8 visible height scaled to R0 visible height. Source canvas center X; after bicubic resize visible foot bottom y447. No crop or repaint.'
    frames=@($frames)
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputDir 'manifest.json') -Encoding utf8
$frames | ForEach-Object { Write-Output "$($_.id): output y$($_.outputBoundsAlpha8.top)..$($_.outputBoundsAlpha8.bottom)" }
