import express, { Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { canAccessJourney } from '../services/journeyService';
import * as luluService from '../services/lulu/luluService';
import { LuluAuthError, LuluRequestError } from '../services/lulu/luluClient';

const router = express.Router();
router.use(authenticate);

function handleLuluError(err: unknown, res: Response): void {
  if (err instanceof Error && err.message === 'NO_PRINT_VENDOR_KEY') {
    res.status(503).json({ error: 'Print-on-demand is not configured. An admin needs to set a Lulu API key first.' });
    return;
  }
  if (err instanceof LuluAuthError) {
    res.status(502).json({ error: 'Lulu rejected the configured API credentials.' });
    return;
  }
  if (err instanceof LuluRequestError) {
    res.status(502).json({ error: `Lulu error: ${err.message}` });
    return;
  }
  console.error('[print-orders] unexpected error:', err);
  res.status(500).json({ error: 'Something went wrong placing the print order.' });
}

function resolvePackage(preset: unknown, res: Response): string | null {
  if (typeof preset !== 'string') {
    res.status(400).json({ error: 'preset is required' });
    return null;
  }
  const podPackageId = luluService.mapPresetToPackage(preset);
  if (!podPackageId) {
    res.status(422).json({ error: `Page size "${preset}" has no matching print product yet.` });
    return null;
  }
  return podPackageId;
}

router.post('/estimate', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { journeyId, preset, pageCount, quantity, shippingAddress, shippingLevel } = req.body || {};
  if (!journeyId || !canAccessJourney(Number(journeyId), authReq.user.id)) return res.status(404).json({ error: 'Journey not found' });
  if (!pageCount || !quantity || !shippingAddress || !shippingLevel) return res.status(400).json({ error: 'pageCount, quantity, shippingAddress and shippingLevel are required' });
  const podPackageId = resolvePackage(preset, res);
  if (!podPackageId) return;

  try {
    const estimate = await luluService.estimateCost({ podPackageId, pageCount: Number(pageCount), quantity: Number(quantity), shippingAddress, shippingLevel });
    res.json(estimate);
  } catch (err) {
    handleLuluError(err, res);
  }
});

router.post('/orders', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { journeyId, preset, pageCount, quantity, interiorPdfUrl, coverPdfUrl, shippingAddress, shippingLevel, contactEmail, title } = req.body || {};
  if (!journeyId || !canAccessJourney(Number(journeyId), authReq.user.id)) return res.status(404).json({ error: 'Journey not found' });
  if (!pageCount || !quantity || !interiorPdfUrl || !shippingAddress || !shippingLevel || !contactEmail) {
    return res.status(400).json({ error: 'pageCount, quantity, interiorPdfUrl, shippingAddress, shippingLevel and contactEmail are required' });
  }
  const podPackageId = resolvePackage(preset, res);
  if (!podPackageId) return;

  const orderId = luluService.createOrderRecord({
    userId: authReq.user.id,
    journeyId: Number(journeyId),
    podPackageId,
    quantity: Number(quantity),
    pageCount: Number(pageCount),
    interiorPdfUrl,
    coverPdfUrl,
    shippingAddress,
    shippingLevel,
    contactEmail,
  });

  try {
    const job = await luluService.createLuluPrintJob({
      podPackageId, pageCount: Number(pageCount), quantity: Number(quantity),
      title: title || 'Travel journal', interiorPdfUrl, coverPdfUrl,
      shippingAddress, shippingLevel, contactEmail, externalId: `trek-order-${orderId}`,
    });
    luluService.updateOrderAfterLuluCall(orderId, { luluJobId: job.luluJobId, status: job.status });
    res.json(luluService.getOrderForUser(orderId, authReq.user.id));
  } catch (err) {
    luluService.updateOrderAfterLuluCall(orderId, { status: 'error', errorMessage: err instanceof Error ? err.message : 'Unknown error' });
    handleLuluError(err, res);
  }
});

router.get('/orders', (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  res.json({ orders: luluService.listOrdersForUser(authReq.user.id) });
});

router.get('/orders/:id', async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const order = luluService.getOrderForUser(Number(req.params.id), authReq.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  if (req.query.refresh === 'true' && order.lulu_job_id) {
    try {
      const { status } = await luluService.getLuluPrintJobStatus(order.lulu_job_id);
      luluService.updateOrderAfterLuluCall(order.id, { status });
      return res.json(luluService.getOrderForUser(order.id, authReq.user.id));
    } catch (err) {
      return handleLuluError(err, res);
    }
  }
  res.json(order);
});

export default router;
