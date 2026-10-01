using System;
using System.IO;
using System.Threading.Tasks;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage;

public class WinOcrHelper {
    public static async Task<string> RecognizeImageAsync(string filePath) {
        StorageFile file = await StorageFile.GetFileFromPathAsync(Path.GetFullPath(filePath));
        using (var stream = await file.OpenAsync(FileAccessMode.Read)) {
            BitmapDecoder decoder = await BitmapDecoder.CreateAsync(stream);
            SoftwareBitmap bitmap = await decoder.GetSoftwareBitmapAsync();
            
            OcrEngine engine = OcrEngine.TryCreateFromUserProfileLanguages();
            if (engine == null) {
                engine = OcrEngine.TryCreateFromLanguage(new Windows.Globalization.Language("en-US"));
            }
            if (engine == null && OcrEngine.AvailableRecognizerLanguages.Count > 0) {
                engine = OcrEngine.TryCreateFromLanguage(OcrEngine.AvailableRecognizerLanguages[0]);
            }
            if (engine == null) return "";
            
            OcrResult result = await engine.RecognizeAsync(bitmap);
            return result.Text;
        }
    }

    public static string RecognizeImage(string filePath) {
        return RecognizeImageAsync(filePath).GetAwaiter().GetResult();
    }
}
