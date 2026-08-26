import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { routeApolloQuery } from './router.js';
export function startApolloService(port = 4100) {
    const app = express();
    const server = createServer(app);
    const wss = new WebSocketServer({ server });
    app.use(express.json());
    app.post('/apollo/query', async (req, res) => {
        try {
            const { query } = req.body;
            if (!query) {
                return res.status(400).json({ error: 'Missing query' });
            }
            const { intent, response, runId } = await routeApolloQuery(query);
            res.json({ intent, response, runId });
        }
        catch (err) {
            console.error('[Apollo REST] Error:', err);
            res.status(500).json({ error: err.message });
        }
    });
    app.get('/apollo/briefing', async (req, res) => {
        try {
            // Stub for briefing endpoint
            const { intent, response, runId } = await routeApolloQuery("briefing");
            res.json({ intent, response, runId });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    wss.on('connection', (ws) => {
        console.log('[Apollo WS] Client connected');
        ws.on('message', async (data) => {
            try {
                const message = JSON.parse(data.toString());
                if (message.type === 'audio_transcription' || message.type === 'query') {
                    const query = message.text;
                    console.log('[Apollo WS] Received query:', query);
                    ws.send(JSON.stringify({ type: 'status', status: 'processing' }));
                    const { intent, response, runId } = await routeApolloQuery(query, (chunk) => {
                        // We can stream chunks back if needed
                        ws.send(JSON.stringify({ type: 'stream_chunk', chunk }));
                    });
                    ws.send(JSON.stringify({
                        type: 'final_response',
                        intent,
                        response,
                        runId
                    }));
                }
            }
            catch (err) {
                console.error('[Apollo WS] Message error:', err);
                ws.send(JSON.stringify({ type: 'error', error: err.message }));
            }
        });
        ws.on('close', () => {
            console.log('[Apollo WS] Client disconnected');
        });
    });
    server.listen(port, () => {
        console.log(`[Apollo Service] Running on http://localhost:${port}`);
        console.log(`[Apollo WS] WebSocket server on ws://localhost:${port}`);
    });
}
