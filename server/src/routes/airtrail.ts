import express, { Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { isAddonEnabled } from '../services/adminService';
import { ADDON_IDS } from '../addons';
import { getClientIp } from '../services/auditLog';
import {
  getConnectionSettings,
  getConnectionStatus,
  getFlightsForPicker,
  saveSettings,
  testConnection,
} from '../services/airtrail/airtrailService';
import { runAirtrailSyncForUser } from '../services/airtrail/airtrailSync';

const router = express.Router();

/** Gate every route on the global airtrail addon being enabled. */
function addonGate(req: Request, res: Response, next: express.NextFunction): void {
  if (!isAddonEnabled(ADDON_IDS.AIRTRAIL)) {
    res.status(404).json({ error: 'AirTrail addon is not enabled' });
    return;
  }
  next();
}

router.get('/settings', addonGate, authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  res.json(getConnectionSettings(authReq.user.id));
});

router.put('/settings', addonGate, authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { url, apiKey, allowInsecureTls } = req.body as {
    url?: string;
    apiKey?: string;
    allowInsecureTls?: boolean;
  };
  try {
    const result = await saveSettings(
      authReq.user.id,
      url,
      apiKey,
      !!allowInsecureTls,
      getClientIp(req),
    );
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    return res.json(result.warning ? { success: true, warning: result.warning } : { success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to save AirTrail settings' });
  }
});

router.get('/status', addonGate, authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  try {
    const status = await getConnectionStatus(authReq.user.id);
    res.json(status);
  } catch (err: any) {
    res.json({ connected: false, error: err?.message || 'Status check failed' });
  }
});

router.get('/flights', addonGate, authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  try {
    const flights = await getFlightsForPicker(authReq.user.id);
    res.json({ flights });
  } catch (err: any) {
    const status = err?.status === 400 ? 400 : 502;
    res.status(status).json({ error: err?.message || 'Could not load AirTrail flights' });
  }
});

router.post('/sync', addonGate, authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  try {
    const result = await runAirtrailSyncForUser(authReq.user.id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Sync failed' });
  }
});

router.post('/test', addonGate, authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { url, apiKey, allowInsecureTls } = req.body as {
    url?: string;
    apiKey?: string;
    allowInsecureTls?: boolean;
  };
  try {
    const result = await testConnection(authReq.user.id, url, apiKey, !!allowInsecureTls);
    res.json(result);
  } catch (err: any) {
    res.json({ connected: false, error: err?.message || 'Connection test failed' });
  }
});

export default router;
