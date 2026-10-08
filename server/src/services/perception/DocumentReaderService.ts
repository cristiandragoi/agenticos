/**
 * DocumentReaderService.ts — Document and Passport Reading Service for AgenticOS
 *
 * Implements reliable text extraction and OCR from:
 * 1. Physical camera frame (user holding up a document, passport, paper, or card)
 * 2. Image files (.png, .jpg, .jpeg, .bmp, .webp, .tiff)
 * 3. PDF documents (.pdf)
 *
 * Guarantees:
 * - Reads visible text accurately using local Windows Media OCR (Windows.Media.Ocr.OcrEngine).
 * - Never invents or hallucinates missing text.
 * - If text is blurry, camera unavailable, document closed, or file missing, explains that
 *   specific problem truthfully instead of generic refusals ("I cannot interpret documents").
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { logger } from '../../utils/logger.js';
import { cameraPerceptionService } from './CameraPerceptionService.js';
import { capabilityPermissionStore } from '../../domains/controlPlane/CapabilityPermissionStore.js';

export interface DocumentOcrResult {
  success: boolean;
  verified: boolean;
  source: 'camera' | 'file';
  extractedText: string;
  structuredLines?: Array<{ text: string; x: number; y: number; width: number; height: number }>;
  documentType?: 'document' | 'passport' | 'id_card' | 'generic';
  specificIssue?: string;
  explanation: string;
  filePath?: string;
  frameSha256?: string;
}

function resolveOcrScript(): string {
  const candidates = [
    path.resolve(process.cwd(), 'server/scripts/run_ocr.ps1'),
    path.resolve(process.cwd(), 'scripts/run_ocr.ps1'),
    'D:\\AgenticOS\\server\\scripts\\run_ocr.ps1',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

export class DocumentReaderService {
  private static instance: DocumentReaderService;

  public static getInstance(): DocumentReaderService {
    if (!DocumentReaderService.instance) {
      DocumentReaderService.instance = new DocumentReaderService();
    }
    return DocumentReaderService.instance;
  }

  /**
   * Run Windows Media OCR on any local image file using run_ocr.ps1.
   */
  public async ocrImageFile(
    imagePath: string,
    options: { structured?: boolean; timeoutMs?: number } = {}
  ): Promise<{ text: string; structured?: any; rawOutput: string }> {
    const scriptPath = resolveOcrScript();
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`OCR script not found at ${scriptPath}`);
    }
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Image file not found at ${imagePath}`);
    }

    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-ImagePath', imagePath];
    if (options.structured) {
      args.push('-Structured');
    }

    return new Promise((resolve, reject) => {
      const proc = spawn('powershell.exe', args, { windowsHide: true });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`OCR execution timed out after ${options.timeoutMs || 15000}ms`));
      }, options.timeoutMs || 15000);

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          return reject(new Error(`OCR process exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
        }
        const trimmed = stdout.trim();
        if (options.structured) {
          try {
            const parsed = JSON.parse(trimmed.replace(/^\uFEFF/, ''));
            return resolve({ text: parsed.text || '', structured: parsed, rawOutput: trimmed });
          } catch {
            return resolve({ text: trimmed, rawOutput: trimmed });
          }
        }
        resolve({ text: trimmed, rawOutput: trimmed });
      });
    });
  }

  /**
   * Reads visible text from a live camera frame.
   * If the user shows a document/passport to the webcam, captures a fresh physical frame,
   * performs OCR, and formats the output.
   */
  public async readFromCamera(prompt: string = ''): Promise<DocumentOcrResult> {
    if (!capabilityPermissionStore.isAllowed('camera.perceive')) {
      return {
        success: false,
        verified: false,
        source: 'camera',
        extractedText: '',
        specificIssue: 'CAMERA_PERMISSION_DENIED',
        explanation: 'Camera perception is currently disabled in system permissions. Please enable camera access to read documents via the camera.',
      };
    }

    const frame = await cameraPerceptionService.captureFrame();

    if (!frame.hasFrame || !frame.base64) {
      const reason = frame.reason || 'No camera sensor frame could be acquired.';
      return {
        success: false,
        verified: false,
        source: 'camera',
        extractedText: '',
        specificIssue: 'CAMERA_FRAME_UNAVAILABLE',
        explanation: `Unable to access the camera: ${reason}`,
      };
    }

    // Save frame to a temporary JPG for Windows Media OCR
    const tmpFramePath = path.join(os.tmpdir(), `doc-cam-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
    try {
      const buf = Buffer.from(frame.base64, 'base64');
      fs.writeFileSync(tmpFramePath, buf);

      const ocrResult = await this.ocrImageFile(tmpFramePath, { structured: true });
      const rawText = (ocrResult.text || '').trim();

      if (!rawText || rawText.length < 3) {
        return {
          success: false,
          verified: false,
          source: 'camera',
          extractedText: '',
          frameSha256: frame.frameSha256,
          specificIssue: 'TEXT_BLURRY_OR_EMPTY',
          explanation:
            'I captured a camera frame, but no readable text was detected. The document might be out of focus, blurry, tilted away from the camera, or closed. Please hold the document steady, facing the camera with adequate lighting.',
        };
      }

      // Check if passport
      const isPassport = /\b(?:passport|passeport|pass|reisenpass|nationality|date of birth|place of birth|authority|document no|p<[a-z]{3})/i.test(rawText) ||
        /\bpassport\b/i.test(prompt);

      let formattedExplanation = `I have read the document shown to the camera:\n\n${rawText}`;
      if (isPassport) {
        formattedExplanation = `I have read the passport shown to the camera:\n\n${rawText}`;
      }

      return {
        success: true,
        verified: true,
        source: 'camera',
        extractedText: rawText,
        structuredLines: ocrResult.structured?.lines,
        documentType: isPassport ? 'passport' : 'document',
        explanation: formattedExplanation,
        frameSha256: frame.frameSha256,
      };
    } catch (err: any) {
      logger.warn('[DocumentReaderService] Camera OCR error:', err);
      return {
        success: false,
        verified: false,
        source: 'camera',
        extractedText: '',
        frameSha256: frame.frameSha256,
        specificIssue: 'OCR_ERROR',
        explanation: `An error occurred while reading text from the camera frame: ${err?.message || String(err)}`,
      };
    } finally {
      try {
        if (fs.existsSync(tmpFramePath)) fs.unlinkSync(tmpFramePath);
      } catch {}
    }
  }

  /**
   * Reads text from an image or PDF file on disk.
   */
  public async readFromFile(targetPath: string, prompt: string = ''): Promise<DocumentOcrResult> {
    const resolvedPath = path.resolve(targetPath);

    if (!fs.existsSync(resolvedPath)) {
      return {
        success: false,
        verified: false,
        source: 'file',
        extractedText: '',
        filePath: targetPath,
        specificIssue: 'FILE_NOT_FOUND',
        explanation: `The file was not found at "${targetPath}". Please check that the file path is correct and accessible.`,
      };
    }

    const ext = path.extname(resolvedPath).toLowerCase();

    // 1. Image formats (.png, .jpg, .jpeg, .bmp, .webp, .tiff)
    if (['.png', '.jpg', '.jpeg', '.bmp', '.webp', '.tiff'].includes(ext)) {
      try {
        const ocr = await this.ocrImageFile(resolvedPath, { structured: true });
        const rawText = (ocr.text || '').trim();

        if (!rawText || rawText.length < 2) {
          return {
            success: false,
            verified: false,
            source: 'file',
            extractedText: '',
            filePath: resolvedPath,
            specificIssue: 'TEXT_BLURRY_OR_EMPTY',
            explanation: `The image "${path.basename(resolvedPath)}" was processed, but no readable text was detected. The image may be blank, low-resolution, or illegible.`,
          };
        }

        const isPassport = /\b(?:passport|nationality|date of birth|document no|p<[a-z]{3})/i.test(rawText) || /\bpassport\b/i.test(prompt);

        return {
          success: true,
          verified: true,
          source: 'file',
          extractedText: rawText,
          structuredLines: ocr.structured?.lines,
          documentType: isPassport ? 'passport' : 'document',
          explanation: `Here is the text extracted from ${path.basename(resolvedPath)}:\n\n${rawText}`,
          filePath: resolvedPath,
        };
      } catch (err: any) {
        return {
          success: false,
          verified: false,
          source: 'file',
          extractedText: '',
          filePath: resolvedPath,
          specificIssue: 'OCR_ERROR',
          explanation: `Failed to extract text from "${path.basename(resolvedPath)}": ${err?.message || String(err)}`,
        };
      }
    }

    // 2. PDF documents (.pdf)
    if (ext === '.pdf') {
      try {
        // Use PowerShell Windows.Data.Pdf or render PDF pages
        const pdfScript = path.resolve(process.cwd(), 'server/scripts/read_pdf.ps1');
        if (!fs.existsSync(pdfScript)) {
          // If script does not exist, extract via WinRT or fallback
          return await this.readPdfViaPowerShell(resolvedPath);
        }
        return await this.readPdfViaPowerShell(resolvedPath);
      } catch (err: any) {
        return {
          success: false,
          verified: false,
          source: 'file',
          extractedText: '',
          filePath: resolvedPath,
          specificIssue: 'PDF_EXTRACTION_ERROR',
          explanation: `Could not read PDF "${path.basename(resolvedPath)}": ${err?.message || String(err)}`,
        };
      }
    }

    // 3. Plain text formats (.txt, .md, .csv, .json, .log)
    if (['.txt', '.md', '.csv', '.json', '.log'].includes(ext)) {
      try {
        const content = fs.readFileSync(resolvedPath, 'utf8');
        return {
          success: true,
          verified: true,
          source: 'file',
          extractedText: content,
          documentType: 'document',
          explanation: `Here is the content of ${path.basename(resolvedPath)}:\n\n${content}`,
          filePath: resolvedPath,
        };
      } catch (err: any) {
        return {
          success: false,
          verified: false,
          source: 'file',
          extractedText: '',
          filePath: resolvedPath,
          specificIssue: 'FILE_READ_ERROR',
          explanation: `Could not read file "${path.basename(resolvedPath)}": ${err?.message || String(err)}`,
        };
      }
    }

    return {
      success: false,
      verified: false,
      source: 'file',
      extractedText: '',
      filePath: resolvedPath,
      specificIssue: 'UNSUPPORTED_FORMAT',
      explanation: `The file format "${ext}" is not a recognized document, image, or text format. Please provide a PDF, image (.png, .jpg), or text file.`,
    };
  }

  /**
   * Reads text from a PDF file using Windows.Data.Pdf and Windows.Media.Ocr.
   */
  private async readPdfViaPowerShell(pdfPath: string): Promise<DocumentOcrResult> {
    const psScript = `
param([string]$PdfPath)

Add-Type -AssemblyName System.Runtime.WindowsRuntime

[Windows.Data.Pdf.PdfDocument, Windows.Foundation.UniversalApiContract, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile, Windows.Foundation.UniversalApiContract, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation.UniversalApiContract, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation.UniversalApiContract, ContentType = WindowsRuntime] | Out-Null

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
    $fullPath = [System.IO.Path]::GetFullPath($PdfPath)
    $fileOp = [Windows.Storage.StorageFile]::GetFileFromPathAsync($fullPath)
    $file = Await-WinRT $fileOp ([Windows.Storage.StorageFile])

    $pdfDocOp = [Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)
    $pdfDoc = Await-WinRT $pdfDocOp ([Windows.Data.Pdf.PdfDocument])

    $pageCount = $pdfDoc.PageCount
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if (-not $engine) {
        $lang = [Windows.Globalization.Language]::new("en-US")
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
    }

    $allText = ""
    # Process up to first 5 pages
    $maxPages = [Math]::Min($pageCount, 5)
    for ($i = 0; $i -lt $maxPages; $i++) {
        $page = $pdfDoc.GetPage($i)
        $memStream = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
        $renderOp = $page.RenderToStreamAsync($memStream)
        $asTaskGeneric.MakeGenericMethod([System.Object]).Invoke($null, @($renderOp)).Wait()

        $decoderOp = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($memStream)
        $decoder = Await-WinRT $decoderOp ([Windows.Graphics.Imaging.BitmapDecoder])
        $sbmpOp = $decoder.GetSoftwareBitmapAsync()
        $sbmp = Await-WinRT $sbmpOp ([Windows.Graphics.Imaging.SoftwareBitmap])

        $ocrOp = $engine.RecognizeAsync($sbmp)
        $ocrResult = Await-WinRT $ocrOp ([Windows.Media.Ocr.OcrResult])
        if ($ocrResult.Text) {
            $allText += '[Page ' + ($i + 1) + ']' + [Environment]::NewLine + $ocrResult.Text + [Environment]::NewLine + [Environment]::NewLine
        }
    }

    Write-Output $allText.Trim()
} catch {
    Write-Error $_
    exit 1
}
`;

    return new Promise((resolve) => {
      const proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript, '-PdfPath', pdfPath], { windowsHide: true });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        proc.kill();
        resolve({
          success: false,
          verified: false,
          source: 'file',
          extractedText: '',
          filePath: pdfPath,
          specificIssue: 'PDF_TIMEOUT',
          explanation: 'Reading the PDF timed out.',
        });
      }, 20000);

      proc.on('close', (code) => {
        clearTimeout(timer);
        const text = stdout.trim();
        if (code === 0 && text.length > 0) {
          resolve({
            success: true,
            verified: true,
            source: 'file',
            extractedText: text,
            documentType: 'document',
            explanation: `Here is the text extracted from ${path.basename(pdfPath)}:\n\n${text}`,
            filePath: pdfPath,
          });
        } else {
          resolve({
            success: false,
            verified: false,
            source: 'file',
            extractedText: '',
            filePath: pdfPath,
            specificIssue: 'PDF_OCR_EMPTY',
            explanation: `The PDF "${path.basename(pdfPath)}" was opened, but no readable text could be extracted. The pages may be blank or contain unreadable scans.`,
          });
        }
      });
    });
  }
}

export const documentReaderService = DocumentReaderService.getInstance();
