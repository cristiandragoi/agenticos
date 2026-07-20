import { TeamSheet } from '../../types/teamSheet.js';

export function renderTeamSheetToMarkdown(teamSheet: TeamSheet): string {
  let md = `# Team Sheet: ${teamSheet.teamName}\n\n`;
  md += `**Objective**: ${teamSheet.objective}\n`;
  md += `**Workspace Root**: \`${teamSheet.workspaceRoot}\`\n\n`;

  if (teamSheet.acceptanceCriteria && teamSheet.acceptanceCriteria.length > 0) {
    md += `## Acceptance Criteria\n\n`;
    teamSheet.acceptanceCriteria.forEach(criteria => {
      md += `- ${criteria}\n`;
    });
    md += `\n`;
  }

  md += `## Execution Sequence\n\n`;
  teamSheet.executionSequence.forEach((agentId, index) => {
    const agent = teamSheet.agents.find(a => a.id === agentId);
    md += `${index + 1}. **${agent?.name || agentId}** (${agent?.role || 'Unknown'})\n`;
  });
  md += `\n`;

  if (teamSheet.handoffs && teamSheet.handoffs.length > 0) {
    md += `## Handoffs\n\n`;
    teamSheet.handoffs.forEach(handoff => {
      const req = handoff.required ? '(Required)' : '(Optional)';
      md += `- **${handoff.from}** ➔ **${handoff.to}**: \`${handoff.artifact}\` ${req}\n`;
    });
    md += `\n`;
  }

  md += `## Agent Definitions\n\n`;
  teamSheet.agents.forEach(agent => {
    md += `### ${agent.name} (${agent.id})\n\n`;
    md += `- **Role**: ${agent.role}\n`;
    if (agent.responsibilities && agent.responsibilities.length > 0) {
      md += `- **Responsibilities**: ${agent.responsibilities.join(', ')}\n`;
    }
    if (agent.dependencies && agent.dependencies.length > 0) {
      md += `- **Dependencies**: ${agent.dependencies.join(', ')}\n`;
    }
    
    md += `\n#### Permissions & Artifacts\n\n`;
    md += `- **Allowed Tools**: ${agent.allowedTools.join(', ') || 'None'}\n`;
    md += `- **Read Scopes**: ${agent.readScopes.length ? agent.readScopes.map(s => `\`${s}\``).join(', ') : 'None'}\n`;
    md += `- **Write Scopes**: ${agent.writeScopes.length ? agent.writeScopes.map(s => `\`${s}\``).join(', ') : 'None'}\n`;
    md += `- **Output Artifacts**: ${agent.outputArtifacts.length ? agent.outputArtifacts.map(s => `\`${s}\``).join(', ') : 'None'}\n`;

    md += `\n#### Instructions\n\n`;
    md += `> [!NOTE]\n> Instructions provide guidance only and do not grant permissions.\n\n`;
    md += `\`\`\`text\n${agent.instructions}\n\`\`\`\n\n`;
  });

  return md;
}
