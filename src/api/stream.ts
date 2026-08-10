import { apiUrl } from './client';

export function subscribeToRun(runId: string, onChunk: (chunk: string) => void, onStatus: (status: string) => void) {
  const eventSource = new EventSource(apiUrl(`/api/chat/stream/${runId}`));

  eventSource.addEventListener('chat_chunk', (e) => {
    try {
      const data = JSON.parse(e.data);
      onChunk(data.chunk);
    } catch (err) {}
  });

  eventSource.addEventListener('run_status', (e) => {
    try {
      const data = JSON.parse(e.data);
      onStatus(data.status);
      if (data.status === 'completed' || data.status === 'failed') {
        eventSource.close();
      }
    } catch (err) {}
  });

  eventSource.onerror = () => {
    eventSource.close();
    onStatus('failed');
  };

  return () => {
    eventSource.close();
  };
}

