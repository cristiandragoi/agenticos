param(
    [string]$ImagePath,
    [switch]$Structured
)

Add-Type -AssemblyName System.Runtime.WindowsRuntime

[Windows.Media.Ocr.OcrEngine, Windows.Foundation.UniversalApiContract, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation.UniversalApiContract, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile, Windows.Foundation.UniversalApiContract, ContentType = WindowsRuntime] | Out-Null

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1
})[0]

function Await-WinRT($asyncOp, [type]$resultType) {
    $method = $asTaskGeneric.MakeGenericMethod($resultType)
    $netTask = $method.Invoke($null, @($asyncOp))
    $netTask.Wait()
    return $netTask.Result
}

try {
    $fullPath = [System.IO.Path]::GetFullPath($ImagePath)
    if (-not (Test-Path $fullPath)) {
        throw "File not found: $fullPath"
    }

    $fileOp = [Windows.Storage.StorageFile]::GetFileFromPathAsync($fullPath)
    $file = Await-WinRT $fileOp ([Windows.Storage.StorageFile])

    $streamOp = $file.OpenAsync([Windows.Storage.FileAccessMode]::Read)
    $stream = Await-WinRT $streamOp ([Windows.Storage.Streams.IRandomAccessStream])

    $decoderOp = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)
    $decoder = Await-WinRT $decoderOp ([Windows.Graphics.Imaging.BitmapDecoder])

    $sbmpOp = $decoder.GetSoftwareBitmapAsync()
    $sbmp = Await-WinRT $sbmpOp ([Windows.Graphics.Imaging.SoftwareBitmap])

    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if (-not $engine) {
        $lang = [Windows.Globalization.Language]::new("en-US")
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
    }
    if (-not $engine -and [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages.Count -gt 0) {
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages[0])
    }
    if (-not $engine) {
        throw "No supported OCR engine language found on system."
    }

    $ocrOp = $engine.RecognizeAsync($sbmp)
    $ocrResult = Await-WinRT $ocrOp ([Windows.Media.Ocr.OcrResult])

    if ($Structured) {
        $lines = @()
        foreach ($line in $ocrResult.Lines) {
            $words = $line.Words
            if ($words.Count -gt 0) {
                $minX = [double]::MaxValue
                $minY = [double]::MaxValue
                $maxX = [double]::MinValue
                $maxY = [double]::MinValue
                foreach ($w in $words) {
                    $r = $w.BoundingRect
                    if ($r.X -lt $minX) { $minX = $r.X }
                    if ($r.Y -lt $minY) { $minY = $r.Y }
                    if (($r.X + $r.Width) -gt $maxX) { $maxX = ($r.X + $r.Width) }
                    if (($r.Y + $r.Height) -gt $maxY) { $maxY = ($r.Y + $r.Height) }
                }
                $lines += [PSCustomObject]@{
                    text   = $line.Text
                    x      = [int]$minX
                    y      = [int]$minY
                    width  = [int]($maxX - $minX)
                    height = [int]($maxY - $minY)
                }
            } else {
                $lines += [PSCustomObject]@{
                    text   = $line.Text
                    x      = 0
                    y      = 0
                    width  = 0
                    height = 0
                }
            }
        }

        $output = [PSCustomObject]@{
            width  = [int]$sbmp.PixelWidth
            height = [int]$sbmp.PixelHeight
            lines  = $lines
            text   = $ocrResult.Text
        }
        $json = $output | ConvertTo-Json -Depth 5 -Compress
        Write-Output $json
    } else {
        Write-Output $ocrResult.Text
    }
} catch {
    Write-Error $_
    exit 1
}
