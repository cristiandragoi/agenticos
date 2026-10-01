#!/usr/bin/env node

/**
 * Blank Word Document Launcher - Opens Microsoft Word and creates a blank document
 */

import { execSync } from 'child_process';

function main() {
  console.log('📝 Opening Microsoft Word and creating a blank document...');
  
  // Use PowerShell to launch Word with a new blank document
  const script = `
    # Launch Word and create blank document
    $word = Start-Process -FilePath "winword.exe" -ArgumentList "/n" -PassThru
    
    if ($word) {
      Write-Host "✅ Microsoft Word launched successfully!" -ForegroundColor Green
      
      # Wait briefly for Word to initialize  
      Start-Sleep -Seconds 2
      
      Write-Host "📄 Blank document created successfully!" -ForegroundColor Cyan
      exit 0
    } else {
      Write-Host "❌ Failed to launch Microsoft Word (winword.exe not found)" -ForegroundColor Red
      exit 1
    }\n`;
  
  try {
    execSync(script, { stdio: 'inherit' });
  } catch (error) {
    console.error('❌ Error launching Word:', error.message);
    process.exit(1);
  }
}

main();
