/**
 * System router — machine-level diagnostics.
 *
 * GET /api/system/hardware-profile?refresh=1
 *   Normalized HardwareProfile (see services/system/hardwareProfiler.ts).
 *   Cached for HARDWARE_PROFILE_CACHE_TTL_MS (default 60s) so expensive
 *   exec probes never run on every UI poll; ?refresh=1 forces re-detection.
 *   Never returns environment variables or secrets.
 */
import { Router } from 'express';
import { getHardwareProfile } from '../services/system/hardwareProfiler.js';

const router = Router();

router.get('/hardware-profile', async (req, res) => {
  try {
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const profile = await getHardwareProfile(refresh);
    res.json(profile);
  } catch (err: any) {
    // Honest error, no crash of the poll loop, no secret leakage.
    res.status(500).json({ error: err?.message || 'hardware profile unavailable' });
  }
});

export default router;
