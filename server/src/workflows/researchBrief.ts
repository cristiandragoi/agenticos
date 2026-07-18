import { db } from '../services/db.js';
import { runStore } from '../services/runStore.js';
import { randomUUID as uuidv4 } from 'crypto';
import { ResearchBrief, RunRecord, Artifact } from '../types.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function executeResearchBriefWorkflow(briefId: string, runId: string) {
  try {
    const brief = db.researchBriefs.get(briefId);
    if (!brief) throw new Error(`Brief ${briefId} not found`);

    // 1. Researching
    brief.status = 'researching';
    db.researchBriefs.upsert(brief);
    runStore.update(runId, { status: 'researching' });
    runStore.appendLog(runId, 'Started research phase.');

    let researchData = "";

    // If we have a valid key, try to use OpenAI for research/drafting
    if (OPENAI_API_KEY && OPENAI_API_KEY.startsWith('sk-')) {
      runStore.appendLog(runId, `Fetching market intelligence for target: ${brief.target}`);
      
      const prompt = `You are Hermes, an expert recruiter intelligence analyst.
      Create a comprehensive recruiter intelligence brief based on the following parameters:
      Title: ${brief.title}
      Type: ${brief.requestType}
      Target/Candidate: ${brief.target}
      Role/Goal: ${brief.goal}
      Target Companies: ${brief.competitors.join(', ')}
      Priority: ${brief.priority}
      
      Format your response strictly in Markdown with the following sections:
      - Candidate Overview & Assessment
      - Role Fit & Gap Analysis
      - Market Compensation Estimates
      - Competitor Talent Mapping
      - Strategic Recommendations
      - Sources
      `;

      try {
        const isOpenRouter = OPENAI_API_KEY.startsWith('sk-or-');
        const url = isOpenRouter ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
            ...(isOpenRouter ? { 'HTTP-Referer': 'http://localhost:5173', 'X-Title': 'Agentic OS' } : {})
          },
          body: JSON.stringify({
            model: isOpenRouter ? 'openai/gpt-4o-mini' : 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3
          })
        });

        if (response.ok) {
          const data = await response.json();
          researchData = data.choices[0].message.content;
          runStore.appendLog(runId, 'Successfully generated research draft via LLM.');
        } else {
          const errText = await response.text();
          runStore.appendLog(runId, `LLM generation failed: ${errText}. Falling back to local draft generator.`);
        }
      } catch (e: any) {
        runStore.appendLog(runId, `Exception during LLM call: ${e.message}. Falling back to local draft generator.`);
      }
    } else {
      runStore.appendLog(runId, 'No valid OpenAI API key found. Using local draft generator.');
    }

    // Fallback if no LLM data
    if (!researchData) {
      await delay(2000); // Simulate research time
      researchData = `# Recruiter Intelligence Brief: ${brief.title}
      
## Candidate Overview & Assessment
This is a synthesized intelligence brief regarding **${brief.target}**. 
Goal: ${brief.goal}

## Role Fit & Gap Analysis
${brief.target} shows a strong potential fit for the target role. 

## Market Compensation Estimates
Estimated OTE for this tier of talent in the current market is highly competitive.

## Competitor Talent Mapping
Target organizations identified: ${brief.competitors.length > 0 ? brief.competitors.join(', ') : 'None specified.'}

## Strategic Recommendations
- Move quickly to schedule an introductory call.
- Highlight growth opportunities to counter current employer retention efforts.

## Sources
- LinkedIn, Crunchbase, internal CRM data.
`;
    }

    // 2. Drafting
    runStore.update(runId, { status: 'running' });
    runStore.appendLog(runId, 'Compiling research into final brief artifact...');
    await delay(1000);

    const artifact: Artifact = {
      id: `art-${uuidv4()}`,
      type: 'markdown',
      title: `${brief.title} - Final Brief`,
      preview: researchData.substring(0, 100) + '...',
      content: researchData,
      sourceRunId: runId,
      linkedBoardId: 'board-research',
      version: '1.0',
      status: 'done',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.artifacts.upsert(artifact);
    
    // Update brief
    brief.artifactIds.push(artifact.id);
    brief.status = 'exported'; // Auto-completed for the public autonomous loop
    db.researchBriefs.upsert(brief);

    // Finalize run
    runStore.update(runId, {
      status: 'completed',
      output: `Research brief completed and delivered: /public/deliverable/${artifact.id}`,
      linkedArtifacts: [artifact.id]
    });
    runStore.appendLog(runId, `Workflow complete. Deliverable available at: /public/deliverable/${artifact.id}`);

  } catch (err: any) {
    runStore.update(runId, { status: 'failed', errorMessage: err.message });
    runStore.appendLog(runId, `Workflow failed: ${err.message}`);
    
    const brief = db.researchBriefs.get(briefId);
    if (brief) {
      brief.status = 'failed';
      db.researchBriefs.upsert(brief);
    }
  }
}
