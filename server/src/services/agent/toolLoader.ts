import { logger } from '../../utils/logger.js';
/**
 * Tool Loader — imports all tool modules and registers them with the tool registry.
 * Must be called at startup.
 */
import { toolRegistry } from './toolRegistry.js';
import { terminalTool } from './tools/terminalTool.js';
import { readFileTool, writeFileTool, searchFilesTool } from './tools/fileTool.js';
import { patchFileTool } from './tools/patchTool.js';
import { webSearchTool } from './tools/webSearchTool.js';
import { webExtractTool } from './tools/webExtractTool.js';
import { getPipelineStatusTool, runPipelineTool, readObsidianFileTool } from './tools/apiTools.js';
import { speakTool } from './tools/speakTool.js';
import { workspaceSearchTool } from './tools/workspaceSearchTool.js';

export function registerAllTools(): void {
  toolRegistry.register(terminalTool);
  toolRegistry.register(readFileTool);
  toolRegistry.register(writeFileTool);
  toolRegistry.register(searchFilesTool);
  toolRegistry.register(patchFileTool);
  toolRegistry.register(webSearchTool);
  toolRegistry.register(webExtractTool);
  toolRegistry.register(getPipelineStatusTool);
  toolRegistry.register(runPipelineTool);
  toolRegistry.register(readObsidianFileTool);
  toolRegistry.register(speakTool);
  toolRegistry.register(workspaceSearchTool);
  logger.info(`[ToolRegistry] Registered ${toolRegistry.list().length} tools: ${toolRegistry.list().join(', ')}`);
}
