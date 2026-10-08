/**
 * quartzIndexer.ts — Source code map and symbol lookup (quartz-ctx implementation).
 *
 * Indexes AgenticOS server source code only (excluding node_modules, dist, logs, secrets).
 * Extracts exported functions, classes, interfaces, and methods for real-time symbol lookup.
 */

import fs from 'node:fs';
import path from 'node:path';
import { cortexDb } from './cortexDb.js';
import { logger } from '../../utils/logger.js';

export interface CodeUnit {
  id: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'module';
  name: string;
  modulePath: string;
  summary: string;
  compressed: string;
  indexedAt: string;
}

export interface CodeMember {
  parentId: string;
  kind: 'method' | 'property' | 'field';
  name: string;
  typeSig: string;
  doc: string;
}

export class QuartzIndexer {
  private readonly sourceRoot: string;

  constructor() {
    this.sourceRoot = path.resolve('D:\\AgenticOS', 'server', 'src');
  }

  /** Walk server/src recursively, ignoring dependencies and generated output */
  private scanSourceFiles(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const name = entry.name.toLowerCase();
        if (
          name === 'node_modules' ||
          name === 'dist' ||
          name === 'build' ||
          name === '.cortex' ||
          name === 'vault' ||
          name === 'coverage'
        ) {
          continue;
        }
        results.push(...this.scanSourceFiles(fullPath));
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.mts')) && !entry.name.endsWith('.d.ts')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  /** Run indexing across AgenticOS server/src source tree */
  public indexWorkspace(): { indexedFiles: number; totalSymbols: number } {
    const db = cortexDb.init();
    if (!db) return { indexedFiles: 0, totalSymbols: 0 };

    const files = this.scanSourceFiles(this.sourceRoot);
    let totalSymbols = 0;

    const insertUnit = db.prepare(`
      INSERT OR REPLACE INTO code_units (id, kind, name, module_path, summary, compressed, term_vector, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMember = db.prepare(`
      INSERT INTO code_members (parent_id, kind, name, type_sig, doc)
      VALUES (?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();

    const tx = db.transaction(() => {
      // Clear old entries before reindexing
      db.prepare('DELETE FROM code_members').run();
      db.prepare('DELETE FROM code_units').run();

      for (const filePath of files) {
        const relPath = path.relative(this.sourceRoot, filePath).replace(/\\/g, '/');
        const content = fs.readFileSync(filePath, 'utf-8');

        // Extract exported functions, classes, interfaces, types
        const exportClassMatches = content.matchAll(/export\s+(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/g);
        for (const m of exportClassMatches) {
          const name = m[1];
          const id = `${relPath}#class#${name}`;
          insertUnit.run(id, 'class', name, relPath, `Class ${name} in ${relPath}`, name, '[]', now);
          totalSymbols++;
        }

        const exportFuncMatches = content.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/g);
        for (const m of exportFuncMatches) {
          const name = m[1];
          const args = m[2].trim();
          const id = `${relPath}#function#${name}`;
          insertUnit.run(id, 'function', name, relPath, `Function ${name}(${args}) in ${relPath}`, name, '[]', now);
          totalSymbols++;
        }

        const exportInterfaceMatches = content.matchAll(/export\s+interface\s+([A-Za-z0-9_]+)/g);
        for (const m of exportInterfaceMatches) {
          const name = m[1];
          const id = `${relPath}#interface#${name}`;
          insertUnit.run(id, 'interface', name, relPath, `Interface ${name} in ${relPath}`, name, '[]', now);
          totalSymbols++;
        }

        const exportTypeMatches = content.matchAll(/export\s+type\s+([A-Za-z0-9_]+)/g);
        for (const m of exportTypeMatches) {
          const name = m[1];
          const id = `${relPath}#type#${name}`;
          insertUnit.run(id, 'type', name, relPath, `Type ${name} in ${relPath}`, name, '[]', now);
          totalSymbols++;
        }

        const exportConstMatches = content.matchAll(/export\s+const\s+([A-Za-z0-9_]+)/g);
        for (const m of exportConstMatches) {
          const name = m[1];
          const id = `${relPath}#const#${name}`;
          insertUnit.run(id, 'function', name, relPath, `Exported constant ${name} in ${relPath}`, name, '[]', now);
          totalSymbols++;
        }
      }
    });

    try {
      tx();
      logger.info(`[QuartzIndexer] Indexed ${files.length} files, extracted ${totalSymbols} symbols into Cortex store.`);
    } catch (err: any) {
      logger.warn('[QuartzIndexer] Reindex transaction failed: ' + err?.message);
    }

    return { indexedFiles: files.length, totalSymbols };
  }

  /** Match symbols against hint for get_api_context */
  public getApiContext(hint: string): string[] {
    const db = cortexDb.init();
    if (!db) return [];

    try {
      const q = `%${hint.trim()}%`;
      const rows = db.prepare(`
        SELECT id, kind, name, module_path, summary
        FROM code_units
        WHERE name LIKE ? OR module_path LIKE ? OR summary LIKE ?
        ORDER BY name ASC LIMIT 25
      `).all(q, q, q) as any[];

      return rows.map((r) => `[${r.kind}] ${r.name} (${r.module_path}): ${r.summary}`);
    } catch (err: any) {
      logger.warn('[QuartzIndexer] getApiContext failed: ' + err?.message);
      return [];
    }
  }

  /** Search symbols across the codebase */
  public searchSymbols(query: string): CodeUnit[] {
    const db = cortexDb.init();
    if (!db) return [];

    try {
      const q = `%${query.trim()}%`;
      const rows = db.prepare(`
        SELECT id, kind, name, module_path, summary, compressed, indexed_at
        FROM code_units
        WHERE name LIKE ? OR module_path LIKE ?
        ORDER BY name ASC LIMIT 20
      `).all(q, q) as any[];

      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        modulePath: r.module_path,
        summary: r.summary,
        compressed: r.compressed,
        indexedAt: r.indexed_at,
      }));
    } catch (err: any) {
      logger.warn('[QuartzIndexer] searchSymbols failed: ' + err?.message);
      return [];
    }
  }
}

export const quartzIndexer = new QuartzIndexer();
