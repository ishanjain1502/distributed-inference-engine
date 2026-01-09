import { Router, Request, Response } from 'express';
import { healthTable, HeartbeatPayload } from './healthTable';

const router = Router();

// Health check endpoint
router.get('/', (_req: Request, res: Response) => {
  res.sendStatus(200);
});

// Heartbeat ingestion endpoint
router.post('/heartbeat', (req: Request, res: Response) => {
  const payload = req.body as HeartbeatPayload;
  const result = healthTable.ingest(payload);

  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.status(200).json({ ack: true });
});

// Get all workers with status (for monitoring)
router.get('/workers', (_req: Request, res: Response) => {
  const workers = healthTable.getAllWorkers();
  const counts = healthTable.getCounts();
  res.json({ workers, counts, total: healthTable.size });
});

// Get workers available for scheduling
router.get('/workers/available', (_req: Request, res: Response) => {
  const workers = healthTable.getWorkersForScheduler();
  res.json({ workers, count: workers.length });
});

export default router;