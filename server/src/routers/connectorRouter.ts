import { logger } from '../utils/logger.js';
import { Router } from 'express';
import { mockTikTokConnector } from '../connectors/mock/MockTikTokConnector.js';

export const connectorRouter = Router();

// A generic webhook receiver. In production, this would dispatch based on the `source` parameter.
connectorRouter.post('/webhook/:source', async (req, res) => {
  const { source } = req.params;
  const payload = req.body;

  try {
    if (source === 'tiktok_shop') {
      await mockTikTokConnector.ingest(payload);
      return res.status(200).json({ success: true, message: 'Event ingested via mock TikTok connector' });
    }
    
    // Fallback/Unknown
    return res.status(400).json({ success: false, message: `Unknown connector source: ${source}` });
  } catch (error: any) {
    logger.error(`[ConnectorRouter] Error processing webhook for ${source}:`, error);
    return res.status(500).json({ success: false, message: error.message });
  }
});
