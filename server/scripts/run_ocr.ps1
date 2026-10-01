param([string]$ImagePath)

[Windows.Media.Ocr.OcrEngine, Windows.Foundation.UniversalApiContract, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation.UniversalApiContract, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile, Windows.Foundation.UniversalApiContract, ContentType = WindowsRuntime] | Out-Null

function Await-WinRT($asyncOp) {
    while ($asyncOp.Status -eq [Windows.Foundation.AsyncStatus]::Started) {
        [System.Threading.Thread]::Sleep(10)
    }
    if ($asyncOp.Status -eq [Windows.Foundation.AsyncStatus]::Completed) {
        return $asyncOp.GetResults()
    }
    throw "WinRT async operation failed with status: $($asyncOp.Status)"
}

$lang = [Windows.Globalization.Language]::new("en-US")
if (-not [Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($lang)) {
    $lang = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages[0]
}
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)

$fullPath = [System.IO.Path]::GetFullPath($ImagePath)
$fileOp = [Windows.Storage.StorageFile]::GetFileFromPathAsync($fullPath)
$file = Await-WinRT $fileOp

$streamOp = $file.OpenAsync([Windows.Storage.FileAccessMode]::Read)
$stream = Await-WinRT $streamOp

$decoderOp = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)
$decoder = Await-WinRT $decoderOp

$sbmpOp = $decoder.GetSoftwareBitmapAsync()
$sbmp = Await-WinRT $sbmpOp

$ocrOp = $engine.RecognizeAsync($sbmp)
$ocrResult = Await-WinRT $ocrOp

Write-Output $ocrResult.Text
