[Windows.Media.Ocr.OcrEngine, Windows.Foundation.UniversalApiContract, ContentType = WindowsRuntime] | Out-Null
$lang = [Windows.Globalization.Language]::new("en-US")
if (-not [Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($lang)) {
    $lang = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages[0]
}
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
Write-Output "OCR Engine created: $($engine.RecognizerLanguage.LanguageTag)"
