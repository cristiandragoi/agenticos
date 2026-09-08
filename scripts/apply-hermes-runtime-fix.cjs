const fs = require('fs');

function replaceOnce(text, before, after, label) {
  const count = text.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly one match, found ${count}`);
  }
  return text.replace(before, after);
}

function edit(path, transform) {
  const original = fs.readFileSync(path, 'utf8');
  const updated = transform(original);
  if (updated === original) throw new Error(`${path}: transform made no changes`);
  fs.writeFileSync(path, updated, 'utf8');
  console.log(`patched ${path}`);
}

edit('server/src/services/agent/agentLoop.ts', (src) => {
  src = replaceOnce(
    src,
    "    { name: 'Qwen 3.8', url: (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434') + '/v1/chat/completions', model: 'qwen3.8:latest', key: process.env.OLLAMA_API_KEY || 'ollama' },\n",
    '',
    'remove nonexistent qwen3.8 provider'
  );

  src = replaceOnce(
    src,
    "    } else if (nameLower.includes('hermes')) {\n      // Hermes local operation prefers Qwen 3.8 (Ollama)\n      prioritize('qwen 3.8');\n    }",
    "    } else if (nameLower.includes('hermes')) {\n      // Hermes local operation prefers the configurable Ollama provider.\n      prioritize('ollama (local)');\n    }",
    'Hermes provider preference'
  );

  src = replaceOnce(
    src,
    "  agentName?: string,\n  executionOptions?: ExecutionOptions\n): Promise<{ message: ChatMessage; provider: string; model: string }> {",
    "  agentName?: string,\n  executionOptions?: ExecutionOptions,\n  forceToolUse: boolean = false\n): Promise<{ message: ChatMessage; provider: string; model: string }> {",
    'callLLM forceToolUse parameter'
  );

  src = replaceOnce(
    src,
    "      // Force tool use on first iteration to avoid generic chat responses\n      body.tool_choice = messages.length <= 2 ? 'required' : 'auto';",
    "      // Execution policy, not message count, decides whether a real tool is mandatory.\n      body.tool_choice = forceToolUse ? 'required' : 'auto';",
    'tool_choice execution policy'
  );

  src = replaceOnce(
    src,
    "export interface AgentLoopOptions {\n  workspaceRoot?: string;\n  onToolEvent?: (event: ToolEvent) => void;\n  finalizeAfterTestCommand?: boolean;\n}",
    "export interface AgentLoopOptions {\n  workspaceRoot?: string;\n  onToolEvent?: (event: ToolEvent) => void;\n  finalizeAfterTestCommand?: boolean;\n  /** Fail closed until at least one registered tool executes successfully. */\n  requireToolExecution?: boolean;\n}",
    'AgentLoopOptions requireToolExecution'
  );

  src = replaceOnce(
    src,
    "  const toolEvents: ToolEvent[] = [];\n  let forceFinalizeNext = false;",
    "  const toolEvents: ToolEvent[] = [];\n  let forceFinalizeNext = false;\n  const requireToolExecution = loopOptions?.requireToolExecution === true;",
    'runtime execution requirement'
  );

  src = replaceOnce(
    src,
    "    // Determine if tools are available (after first call, only if we just had tool calls)\n    const hasTools = forceFinalizeNext ? false : toolRegistry.list().length > 0;\n    const activeMessages = compactMessageHistory(messages);",
    "    const hasSuccessfulToolExecution = toolEvents.some((event) => event.success);\n    const mustUseTool = requireToolExecution && !hasSuccessfulToolExecution;\n    const hasTools = forceFinalizeNext ? false : toolRegistry.list().length > 0;\n\n    if (mustUseTool && !hasTools) {\n      return {\n        text: 'This task requires real tool execution, but no registered tools are available.',\n        provider: 'system',\n        model: 'N/A',\n        toolCalls,\n        iterations,\n        completionStatus: 'failed',\n        failureReason: 'NO_REGISTERED_TOOLS_AVAILABLE',\n        toolEvents,\n      };\n    }\n\n    const activeMessages = compactMessageHistory(messages);",
    'derive mustUseTool from execution evidence'
  );

  src = replaceOnce(
    src,
    "      response = await callLLM(activeMessages, hasTools, providerIndex, systemPrompt, agentName, executionOptions);",
    "      response = await callLLM(activeMessages, hasTools, providerIndex, systemPrompt, agentName, executionOptions, mustUseTool);",
    'pass forceToolUse to callLLM'
  );

  src = replaceOnce(
    src,
    "      for (const tc of response.message.tool_calls) {\n        toolCalls++;\n\n        let args: Record<string, unknown>;",
    "      for (const tc of response.message.tool_calls) {\n        let args: Record<string, unknown>;",
    'do not count unexecuted tool calls'
  );

  src = replaceOnce(
    src,
    "        try {\n          result = await toolRegistry.execute(tc.function.name, args);\n        } catch (err: any) {",
    "        try {\n          result = await toolRegistry.execute(tc.function.name, args);\n          toolCalls++;\n        } catch (err: any) {",
    'count only successful registered tool execution'
  );

  const oldGuard = "      const operationalRequest = /\\b(?:git\\s+(?:branch|status|diff|log)|package\\.json|terminal|read(?:\\s+the)?\\s+(?:file|repository)|inspect(?:\\s+the)?\\s+repository|search\\s+files|run\\s+(?:the\\s+)?tests?|read-only)\\b/i.test(`${systemPrompt}\\n${userMessage}`);\n      if (operationalRequest && toolCalls === 0) {\n        if (iterations < maxIterations) {\n          messages.push({\n            role: 'user',\n            content: 'This is an operational task. Use the provided function tools now; Markdown or imagined shell commands do not count as execution.',\n          });\n          continue;\n        }\n        return {\n          text: normalizeAgentFinalText(response.message.content),\n          provider: response.provider,\n          model: response.model,\n          toolCalls,\n          iterations,\n          completionStatus: 'failed',\n          failureReason: 'NO_REAL_TOOL_CALLS',\n          toolEvents,\n        };\n      }";
  const newGuard = "      if (requireToolExecution && !toolEvents.some((event) => event.success)) {\n        if (iterations < maxIterations) {\n          messages.push({\n            role: 'user',\n            content: 'Execution is required. Use a registered function tool now; prose, Markdown, or imagined commands do not count.',\n          });\n          continue;\n        }\n        return {\n          text: normalizeAgentFinalText(response.message.content),\n          provider: response.provider,\n          model: response.model,\n          toolCalls,\n          iterations,\n          completionStatus: 'failed',\n          failureReason: 'NO_REAL_TOOL_CALLS',\n          toolEvents,\n        };\n      }";
  src = replaceOnce(src, oldGuard, newGuard, 'replace regex operational guard');

  return src;
});

edit('server/src/domains/hermes/service.ts', (src) => replaceOnce(
  src,
  "      {\n        workspaceRoot: input.workspaceRoot,\n      } as any",
  "      {\n        workspaceRoot: input.workspaceRoot,\n        requireToolExecution: true,\n      } as any",
  'Hermes agent mode requires real tool execution'
));

edit('server/src/__tests__/hermesExecutionMode.test.ts', (src) => replaceOnce(
  src,
  "    expect(agentRunner.mock.calls[0][7]).toMatchObject({ workspaceRoot: 'D:\\\\AgenticOS' });",
  "    expect(agentRunner.mock.calls[0][7]).toMatchObject({ workspaceRoot: 'D:\\\\AgenticOS', requireToolExecution: true });",
  'execution mode test expects tool requirement'
));

edit('server/src/__tests__/hermesOperationalLoop.test.ts', (src) => {
  src = replaceOnce(
    src,
    "      workspaceRoot: 'D:\\\\AgenticOS', onToolEvent,\n    });",
    "      workspaceRoot: 'D:\\\\AgenticOS', onToolEvent, requireToolExecution: true,\n    });",
    'grounding test execution requirement'
  );
  src = replaceOnce(
    src,
    "{ workspaceRoot: 'D:\\\\AgenticOS', finalizeAfterTestCommand: true });",
    "{ workspaceRoot: 'D:\\\\AgenticOS', finalizeAfterTestCommand: true, requireToolExecution: true });",
    'progress test execution requirement'
  );
  src = replaceOnce(
    src,
    "{ workspaceRoot: 'D:\\\\AgenticOS' });\n    expect(result.completionStatus).toBe('max_iterations');",
    "{ workspaceRoot: 'D:\\\\AgenticOS', requireToolExecution: true });\n    expect(result.completionStatus).toBe('max_iterations');",
    'max iteration test execution requirement'
  );

  const anchor = "  it('preserves inline code contents while removing voice markdown', () => {";
  const inserted = `  it('keeps tool_choice required until real execution succeeds', async () => {\n    (global.fetch as any)\n      .mockImplementationOnce(() => response({ content: 'I can inspect that.' }))\n      .mockImplementationOnce(() => response({ tool_calls: [{ id: 't1', type: 'function', function: { name: 'terminal', arguments: '{\\"command\\":\\"git branch --show-current\\"}' } }] }))\n      .mockImplementationOnce(() => response({ content: 'Branch inspected.' }));\n    executeTool.mockResolvedValue(JSON.stringify({ stdout: 'hermes-runtime-fix-20260908', exitCode: 0 }));\n\n    const result = await runAgentLoop('Hermes operational', 'Inspect repository', 4, 'Hermes', undefined, undefined, undefined, {\n      workspaceRoot: 'D:\\\\AgenticOS', requireToolExecution: true,\n    });\n\n    const firstRequest = JSON.parse((global.fetch as any).mock.calls[0][1].body);\n    const secondRequest = JSON.parse((global.fetch as any).mock.calls[1][1].body);\n    expect(firstRequest.tool_choice).toBe('required');\n    expect(secondRequest.tool_choice).toBe('required');\n    expect(result.toolCalls).toBe(1);\n    expect(result.completionStatus).toBe('completed');\n  });\n\n  it('does not count failed tool dispatch as execution evidence', async () => {\n    (global.fetch as any)\n      .mockImplementationOnce(() => response({ tool_calls: [{ id: 'bad', type: 'function', function: { name: 'terminal', arguments: '{\\"command\\":\\"git status\\"}' } }] }))\n      .mockImplementationOnce(() => response({ content: 'Done.' }));\n    executeTool.mockRejectedValue(new Error('terminal unavailable'));\n\n    const result = await runAgentLoop('Hermes operational', 'Inspect repository', 2, 'Hermes', undefined, undefined, undefined, {\n      workspaceRoot: 'D:\\\\AgenticOS', requireToolExecution: true,\n    });\n\n    expect(result.toolCalls).toBe(0);\n    expect(result.completionStatus).toBe('failed');\n    expect(result.failureReason).toBe('NO_REAL_TOOL_CALLS');\n    expect(result.toolEvents?.[0].success).toBe(false);\n  });\n\n  it('allows conversational mode to finish without a tool', async () => {\n    (global.fetch as any).mockImplementationOnce(() => response({ content: 'Hello from Hermes.' }));\n    const result = await runAgentLoop('Hermes chat', 'Say hello', 2, 'Hermes');\n    expect(result.completionStatus).toBe('completed');\n    expect(result.toolCalls).toBe(0);\n    expect(result.text).toBe('Hello from Hermes.');\n  });\n\n`;
  src = replaceOnce(src, anchor, inserted + anchor, 'insert execution contract tests');
  return src;
});

console.log('Hermes runtime repair patch applied successfully.');
