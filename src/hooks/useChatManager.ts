import { useState, useCallback } from 'react';
import { useAppDispatch } from '../store/appStore';
import { apiClient, apiFetch } from '../api/client';
import { subscribeToRun } from '../api/stream';

export function useChatManager() {
  const dispatch = useAppDispatch();
  const [isTyping, setIsTyping] = useState(false);

  const sendMessage = useCallback(async (text: string, preferredTarget: string) => {
    let targetAgentId = preferredTarget === 'auto' ? null : preferredTarget;
      
    if (!targetAgentId) {
       const resolved = await apiClient.resolveIntent(text);
       targetAgentId = resolved.agentId || 'agent-hermes';
    }

    const userMsg = {
      id: `msg-${Date.now()}`,
      role: 'user' as const,
      content: text,
      agentId: targetAgentId,
      timestamp: new Date().toISOString()
    };
    dispatch({ type: 'SEND_MESSAGE', message: userMsg });
    setIsTyping(true);

    try {
      let payloadText = text;
      if (targetAgentId === 'agent-hermes') {
        payloadText += '\n\n[SYSTEM INSTRUCTION: You are the primary orchestrator for the Agentic OS. When asked to plan, break down tasks, or delegate work, respond with a JSON block in the format: {"action": "create_kanban_tasks", "tasks": [{"title": "...", "description": "...", "agent": "...", "model": "..."}]} along with your text explanation.]';
      }

      const { runId } = await apiClient.sendMessage(targetAgentId, payloadText);

      const agentMsgId = `msg-${runId}`;
      const agentMsg = {
        id: agentMsgId, 
        role: 'agent' as const, 
        agentId: targetAgentId, 
        content: '', 
        timestamp: new Date().toISOString() 
      };
      dispatch({ type: 'SEND_MESSAGE', message: agentMsg });

      let accumulatedContent = '';

      subscribeToRun(
        runId,
        (chunk) => {
          accumulatedContent += chunk;
          dispatch({
            type: 'APPEND_MESSAGE_CHUNK',
            payload: { id: agentMsgId, chunk }
          });
        },
        (status) => {
          if (status === 'completed' || status === 'failed') {
            setIsTyping(false);
            
            // Interceptor: Check for heavy-gen trigger JSON
            if (status === 'completed') {
              try {
                // Look for {"action": "trigger_fugu", ...} or {"action": "trigger_fusion", ...}
                const match = accumulatedContent.match(/\{[\s\S]*"action"\s*:\s*"trigger_(fugu|fusion)"[\s\S]*\}/);
                if (match) {
                  const triggerJson = JSON.parse(match[0]);
                  const endpoint = triggerJson.action === 'trigger_fugu' ? 'fugu' : 'fusion';
                  const cleanContent = accumulatedContent.replace(match[0], '').trim();
                  
                  // Hide the JSON from the UI
                  dispatch({
                    type: 'UPDATE_MESSAGE_CONTENT',
                    payload: { id: agentMsgId, content: cleanContent || `*(Triggered ${triggerJson.action.replace('trigger_', '')} in the background)*` }
                  });

                  // Execute the background job
                  apiFetch(`/api/heavy-gen/${endpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                      projectName: triggerJson.projectName, 
                      brief: triggerJson.brief 
                    })
                  }).catch(console.error);
                }

                // Intercept trigger_welders_pipeline
                const weldersMatch = accumulatedContent.match(/\{[\s\S]*"action"\s*:\s*"trigger_welders_pipeline"[\s\S]*?\}/);
                if (weldersMatch) {
                  const cleanContent = accumulatedContent.replace(weldersMatch[0], '').trim();
                  dispatch({
                    type: 'UPDATE_MESSAGE_CONTENT',
                    payload: { id: agentMsgId, content: cleanContent || '*(Triggering Welders Lead Pipeline in the background)*' }
                  });
                  apiFetch('/api/pipeline/welders/run', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                  }).catch(console.error);
                }
                // Intercept create_kanban_tasks
                const kanbanMatch = accumulatedContent.match(/\{[\s\S]*"action"\s*:\s*"create_kanban_tasks"[\s\S]*?\}/);
                if (kanbanMatch) {
                  const kanbanJson = JSON.parse(kanbanMatch[0]);
                  const cleanContent = accumulatedContent.replace(kanbanMatch[0], '').trim();
                  dispatch({
                    type: 'UPDATE_MESSAGE_CONTENT',
                    payload: { id: agentMsgId, content: cleanContent || '*(Created tasks in Kanban board)*' }
                  });
                  // Trigger task creation for each task
                  if (Array.isArray(kanbanJson.tasks)) {
                    kanbanJson.tasks.forEach((t: any, i: number) => {
                      apiFetch('/api/kanban/cards', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          laneId: 'l-hermes-backlog',
                          title: t.title || 'New Task',
                          body: t.description || '',
                          order: Date.now() + i, // hacky way to ensure sort order
                          agent: t.agent || 'Hermes',
                          model: t.model || 'qwythos:9b'
                        })
                      }).catch(console.error);
                    });
                  }
                }
              } catch (e) {
                console.error("Interceptor failed to parse potential trigger block", e);
              }
              
              // Universal Voice for Jarvis and Hermes: dispatch event so UI components with unlocked Audio elements can handle TTS
              const speakableAgents = ['agent-jarvis', 'agent-hermes'];
              if (speakableAgents.includes(targetAgentId)) {
                const cleanText = accumulatedContent
                  .replace(/\{[\s\S]*?"action"\s*:\s*"trigger_(fugu|fusion)"[\s\S]*?\}/, '')
                  .replace(/\*\*(.*?)\*\*/g, '$1')
                  .replace(/#{1,6}\s/g, '')
                  .replace(/`{1,3}[^`]*`{1,3}/g, '')
                  .trim();
                if (cleanText) {
                  window.dispatchEvent(new CustomEvent('agent-response-ready', { 
                    detail: { agentId: targetAgentId, text: cleanText, messageId: agentMsgId, conversationId: null } 
                  }));
                }
              }
            }
          }
        }
      );

    } catch (err: any) {
      console.error('Chat error:', err);
      setIsTyping(false);
      
      // Bubble the error up to the UI so it doesn't hang infinitely
      const errorMsg = {
        id: `msg-error-${Date.now()}`,
        role: 'agent' as const,
        agentId: 'system',
        content: `[SYSTEM ERROR] Connection to backend failed: ${err.message}. Please ensure the Node server is running on port 4000.`,
        timestamp: new Date().toISOString()
      };
      dispatch({ type: 'SEND_MESSAGE', message: errorMsg });
      return false;
    }
    return true;
  }, [dispatch]);

  return { sendMessage, isTyping };
}

