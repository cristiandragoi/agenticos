import * as fs from 'fs';
import * as path from 'path';

export function detectGitRepository(basePath: string): { isValid: boolean, targetPath: string, gitRoot: string | null, errorMessage: string | null } {
  const targetPath = path.normalize(path.resolve(basePath));
  
  if (!fs.existsSync(targetPath)) {
    return { isValid: false, targetPath, gitRoot: null, errorMessage: 'The specified path does not exist.' };
  }

  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    return { isValid: false, targetPath, gitRoot: null, errorMessage: 'The specified path is not a directory.' };
  }

  let currentPath = targetPath;
  let gitRoot: string | null = null;
  
  while (true) {
    const gitPath = path.join(currentPath, '.git');
    if (fs.existsSync(gitPath)) {
      gitRoot = currentPath;
      break;
    }
    
    const parent = path.dirname(currentPath);
    if (parent === currentPath) {
      break;
    }
    currentPath = parent;
  }
  
  const isValid = gitRoot !== null;
  const errorMessage = isValid ? null : 'No Git repository found in this folder tree.';

  return { isValid, targetPath, gitRoot, errorMessage };
}
