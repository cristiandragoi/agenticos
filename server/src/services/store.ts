import { logger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';

export class JsonStore<T extends { id: string }> {
  private filepath: string;
  private data: Map<string, T> = new Map();

  constructor(filepath: string) {
    this.filepath = filepath;
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filepath)) {
        const fileData = fs.readFileSync(this.filepath, 'utf-8');
        const parsed = JSON.parse(fileData);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            this.data.set(item.id, item);
          }
        }
      } else {
        // Ensure directory exists
        const dir = path.dirname(this.filepath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        this.flush(); // Create empty file
      }
    } catch (err) {
      logger.error(`[JsonStore] Failed to load ${this.filepath}:`, err);
    }
  }

  public flush(): void {
    try {
      const items = Array.from(this.data.values());
      fs.writeFileSync(this.filepath, JSON.stringify(items, null, 2), 'utf-8');
    } catch (err) {
      logger.error(`[JsonStore] Failed to flush ${this.filepath}:`, err);
    }
  }

  public get(id: string): T | undefined {
    return this.data.get(id);
  }

  public list(filter?: Partial<T>): T[] {
    let results = Array.from(this.data.values());
    if (filter) {
      for (const [key, value] of Object.entries(filter)) {
        if (value !== undefined) {
          results = results.filter((item: any) => item[key] === value);
        }
      }
    }
    return results;
  }

  public upsert(item: T): T {
    this.data.set(item.id, item);
    this.flush();
    return item;
  }

  public delete(id: string): boolean {
    const deleted = this.data.delete(id);
    if (deleted) this.flush();
    return deleted;
  }
}
