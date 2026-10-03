# Reproduce the selected original walking/idle in-betweens without per-pose fitting.
# Previous candidates stay under generated/smooth-v1; prompts.json records selection history.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$taskAssetRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'assets/characters/h1'
function Bounds($bitmap, $threshold) {
    $rect = [System.Drawing.Rectangle]::new(0, 0, $bitmap.Width, $bitmap.Height)
    $data = $bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $bytes = New-Object byte[] ($data.Stride * $bitmap.Height)
        [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
        $l=$bitmap.Width; $t=$bitmap.Height; $r=-1; $b=-1
        for($y=0;$y -lt $bitmap.Height;$y++) { for($x=0;$x -lt $bitmap.Width;$x++) {
            if($bytes[$y*$data.Stride+$x*4+3] -ge $threshold) {
                $l=[Math]::Min($l,$x); $r=[Math]::Max($r,$x); $t=[Math]::Min($t,$y); $b=[Math]::Max($b,$y)
            }
        }}
        if($b -lt 0) { throw 'Empty sprite' }
        return @{left=$l;top=$t;right=$r;bottom=$b}
    } finally { $bitmap.UnlockBits($data) }
}
$ids=@('walk-mid-00','walk-mid-01','walk-mid-02','walk-mid-03','walk-mid-04','walk-mid-05','walk-mid-06','walk-mid-07','walk-mid-08','walk-mid-09','walk-mid-10','walk-mid-11','idle-in','idle-out')
$outputDir=Join-Path $taskAssetRoot 'derived/smooth-v1'
[void](New-Item -ItemType Directory -Path $outputDir -Force)
$frames=foreach($id in $ids) {
    $selected = switch ($id) { 'walk-mid-02' { 'walk-mid-02-v3' } 'walk-mid-03' { 'walk-mid-03-v2' } 'walk-mid-07' { 'walk-mid-07-v2' } 'walk-mid-10' { 'walk-mid-10-v5' } default { $id } }
    $source=Join-Path $taskAssetRoot "generated/smooth-v1/$selected.png"
    $output=Join-Path $outputDir "$id.png"
    $bitmap=[System.Drawing.Bitmap]::new($source)
    $target=[System.Drawing.Bitmap]::new(512,512,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics=[System.Drawing.Graphics]::FromImage($target)
    try {
        if($bitmap.Width -ne 1254 -or $bitmap.Height -ne 1254) { throw 'Review shared source canvas scale before normalizing' }
        $bounds=Bounds $bitmap 8; $alpha=Bounds $bitmap 1
        $scale=384.0/1120; $rootX=$bitmap.Width/2.0; $rootY=$bounds.bottom+1
        $offsetX=256-$rootX*$scale; $offsetY=448-$rootY*$scale
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.CompositingMode=[System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $destination=[System.Drawing.RectangleF]::new($offsetX,$offsetY,$bitmap.Width*$scale,$bitmap.Height*$scale)
        $graphics.DrawImage($bitmap,$destination,[System.Drawing.RectangleF]::new(0,0,$bitmap.Width,$bitmap.Height),[System.Drawing.GraphicsUnit]::Pixel)
        $target.Save($output,[System.Drawing.Imaging.ImageFormat]::Png)
        @{
            id=$id;source="generated/smooth-v1/$selected.png";output="derived/smooth-v1/$id.png"
            sourceSha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLower()
            outputSha256=(Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLower()
            sourceSize=@($bitmap.Width,$bitmap.Height);sourceBounds=$bounds;sourceBoundsAlpha0=$alpha
            sourceRoot=@($rootX,$rootY);scale=$scale;sourceCanvasScale=1;offset=@($offsetX,$offsetY)
            rootMode='sole-bottom';outputBounds=(Bounds $target 8);outputBoundsAlpha0=(Bounds $target 1)
        }
    } finally { $graphics.Dispose();$target.Dispose();$bitmap.Dispose() }
}
$manifest=@{
    status='Normalized with one calibrated anatomical scale; verify-assets and sequence review are separate.'
    canvas=@(512,512);root=@(256,448);displayScale=0.625;alphaThreshold=8
    method='Uniform calibrated anatomical scale 384/1120 from original idle. Full 1254 source canvas, midpoint X and sole-bottom Y; no bbox fitting, crop, repaint or sheet splitting.'
    referenceSha256=(Get-FileHash -LiteralPath (Join-Path $taskAssetRoot 'reference.png') -Algorithm SHA256).Hash.ToLower()
    frames=@($frames)
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputDir 'manifest.json') -Encoding UTF8
$frames | ForEach-Object { Write-Output "$($_.id): source $($_.sourceBounds.top)..$($_.sourceBounds.bottom), output $($_.outputBounds.top)..$($_.outputBounds.bottom), alpha $($_.outputBoundsAlpha0.left)..$($_.outputBoundsAlpha0.right)" }
