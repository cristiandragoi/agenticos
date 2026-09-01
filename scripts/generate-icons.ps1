# generate-icons.ps1
$ErrorActionPreference = "Stop"

$masterCandidates = @(
    "D:\AgenticOS\build\icons\master_transparent.png",
    "C:\Users\cd-pr\.gemini\antigravity\brain\688c7cad-929c-4ad0-8ab8-f524efb134ca\.user_uploaded\media_1788034947890.jpg",
    "D:\AgenticOS\AgenticOS-LOGO.jpg"
)

$masterPath = $null
foreach ($c in $masterCandidates) {
    if (Test-Path $c) {
        $masterPath = $c
        break
    }
}

if (-not $masterPath) {
    Write-Error "Master artwork not found!"
    exit 1
}

Write-Host "[Icons] Using master artwork: $masterPath"
Add-Type -AssemblyName System.Drawing

$srcImg = [System.Drawing.Image]::FromFile($masterPath)
$sizes = @(16, 24, 32, 48, 64, 128, 256, 512, 1024)
$iconSizes = @(256, 128, 64, 48, 32, 24, 16)

$buildIconsDir = "D:\AgenticOS\build\icons"
$publicDir = "D:\AgenticOS\public"

if (-not (Test-Path $buildIconsDir)) { New-Item -ItemType Directory -Force -Path $buildIconsDir | Out-Null }
if (-not (Test-Path $publicDir)) { New-Item -ItemType Directory -Force -Path $publicDir | Out-Null }

$pngBytesMap = @{}

foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $s, $s
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($srcImg, 0, 0, $s, $s)
    $g.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBytes = $ms.ToArray()
    $ms.Dispose()

    $pngPath = Join-Path $buildIconsDir "$($s)x$($s).png"
    [System.IO.File]::WriteAllBytes($pngPath, $pngBytes)
    $pngBytesMap[$s] = $pngBytes
    $bmp.Dispose()
}

# Generate multi-res ICO (256, 128, 64, 48, 32, 16)
$icoMs = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $icoMs

$bw.Write([uint16]0) # Reserved
$bw.Write([uint16]1) # Type = 1 (ICO)
$bw.Write([uint16]$iconSizes.Count) # Number of images

$offset = 6 + (16 * $iconSizes.Count)

foreach ($s in $iconSizes) {
    $bytes = $pngBytesMap[$s]
    $wByte = if ($s -ge 256) { [byte]0 } else { [byte]$s }
    $hByte = if ($s -ge 256) { [byte]0 } else { [byte]$s }
    $bw.Write($wByte)
    $bw.Write($hByte)
    $bw.Write([byte]0) # Colors (0 = 32bpp)
    $bw.Write([byte]0) # Reserved
    $bw.Write([uint16]1) # Planes
    $bw.Write([uint16]32) # Bit count
    $bw.Write([uint32]$bytes.Length) # Image size in bytes
    $bw.Write([uint32]$offset) # Image offset
    $offset += $bytes.Length
}

foreach ($s in $iconSizes) {
    $bw.Write($pngBytesMap[$s])
}

$icoBytes = $icoMs.ToArray()
$bw.Dispose()
$icoMs.Dispose()

# Save ICOs
$icoTargets = @(
    (Join-Path $buildIconsDir "agenticos.ico"),
    (Join-Path $buildIconsDir "icon.ico"),
    (Join-Path $publicDir "favicon.ico")
)

foreach ($t in $icoTargets) {
    [System.IO.File]::WriteAllBytes($t, $icoBytes)
    Write-Host "[Icons] Saved ICO: $t"
}

# Save PNGs to build/icons and public/
[System.IO.File]::WriteAllBytes((Join-Path $buildIconsDir "agenticos.png"), $pngBytesMap[512])
[System.IO.File]::WriteAllBytes((Join-Path $publicDir "logo.png"), $pngBytesMap[512])
[System.IO.File]::WriteAllBytes((Join-Path $publicDir "favicon.png"), $pngBytesMap[256])

# Save master jpg to D:\AgenticOS\AgenticOS-LOGO.jpg and public\logo.jpg
Copy-Item -Path $masterPath -Destination "D:\AgenticOS\AgenticOS-LOGO.jpg" -Force
Copy-Item -Path $masterPath -Destination (Join-Path $publicDir "logo.jpg") -Force

# Create crisp SVG favicon embedding high-res PNG
$b64 = [Convert]::ToBase64String($pngBytesMap[256])
$svgContent = @"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <image href="data:image/png;base64,$b64" width="256" height="256" />
</svg>
"@
[System.IO.File]::WriteAllText((Join-Path $publicDir "favicon.svg"), $svgContent, [System.Text.Encoding]::UTF8)
Write-Host "[Icons] Saved SVG favicon: $(Join-Path $publicDir 'favicon.svg')"

$srcImg.Dispose()
Write-Host "[Icons] All Core icon and logo assets successfully generated!"
