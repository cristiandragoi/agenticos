import crypto from 'crypto';
import { llmChat } from '../llmGateway.js';

/**
 * Uses llmGateway to generate a structured execution plan.
 */
export async function generateUltronPlan(brief: any) {
  const systemPrompt = `You are Ultron, a specialized agentic workflow planner. 
Your task is to generate a structured Execution Plan for a Revenue Production Brief.
Return ONLY valid JSON that matches this schema:
{
  "planVersion": "1.0.0",
  "objective": "A clear description of the overarching goal",
  "jobs": [
    {
      "id": "A unique identifier (e.g., job-1, job-script)",
      "agentRole": "Role of the agent (e.g., Content Writer)",
      "taskType": "draft_script | generate_images | review",
      "dependsOn": ["job-1"], // IDs of jobs that must complete first
      "input": { "topic": "...", "style": "..." },
      "expectedOutputSchema": "JSON schema name or description",
      "allowedTools": ["web_search", "image_generation"],
      "maximumAttempts": 3,
      "maximumCost": 0.05,
      "requiresHumanApproval": true
    }
  ],
  "totalMaximumCost": 0.15,
  "expectedAssets": 2,
  "warnings": ["Any compliance or generation risks"]
}
If no dependencies, leave dependsOn as an empty array. Do not output markdown code blocks outside of the JSON payload.`;

  const prompt = `Create an execution plan for the following brief:
Objective: ${brief.objective}
Target Platform: ${brief.targetPlatform}
Target Audience: ${JSON.stringify(brief.targetAudience)}
Content Type: ${brief.contentType}
Requested Asset Count: ${brief.requestedAssetCount}
Tone: ${brief.tone}
Approved Claims: ${JSON.stringify(brief.approvedClaims)}
Prohibited Claims: ${JSON.stringify(brief.prohibitedClaims)}
Estimated Generation Cost: ${brief.estimatedGenerationCost}`;

  try {
    const result = await llmChat({
      systemPrompt,
      prompt,
      maxTokens: 2000
    });

    let jsonStr = result.reply;
    // Strip markdown code blocks if any
    jsonStr = jsonStr.replace(/^```json\s*/m, '').replace(/```\s*$/m, '');
    const plan = JSON.parse(jsonStr);

    // Map the string IDs to random UUIDs while preserving dependencies
    const idMap: Record<string, string> = {};
    plan.jobs.forEach((job: any) => {
      idMap[job.id] = crypto.randomUUID();
    });

    plan.jobs = plan.jobs.map((job: any) => ({
      ...job,
      id: idMap[job.id],
      dependsOn: (job.dependsOn || []).map((dep: string) => idMap[dep] || dep),
      requiresHumanApproval: job.requiresHumanApproval !== false,
      maximumAttempts: job.maximumAttempts || 3
    }));

    plan.briefId = brief.id;
    return plan;
  } catch (err: any) {
    throw new Error(`Failed to generate Ultron plan: ${err.message}`);
  }
}
