import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
dotenv.config();

import healthRouter from './health';
import inferRouter from './infer';
import statsRouter from './stats';
import { conversationRegistry } from './conversationRegistry';

const app = express();
const port = process.env.PORT || 1337;
const host = process.env.HOST || '0.0.0.0';

// Sweep idle-expired conversations that were abandoned outright (no further
// requests ever arrived for that conversation_id, so ConversationRegistry.get()
// never ran to reclaim them). Without this, sessionTracker capacity leaks
// until it hits its cap and starts 503ing new requests.
const CONVERSATION_SWEEP_INTERVAL_MS = 60_000;
setInterval(() => {
  const expired = conversationRegistry.sweepExpired();
  if (expired.length > 0) {
    console.log(
      JSON.stringify({ event: 'conversation.sweep_expired', count: expired.length })
    );
  }
}, CONVERSATION_SWEEP_INTERVAL_MS).unref();

const frontendIndex = path.join(__dirname, '../../frontend/index.html');
const frontendStats = path.join(__dirname, '../../frontend/stats.html');

app.use(express.json());

app.get('/', (_req, res) => {
  res.sendFile(frontendIndex);
});

app.get('/stats', (_req, res) => {
  res.sendFile(frontendStats);
});

app.use('/coordinator/health', healthRouter);
app.use('/coordinator/infer', inferRouter);
app.use('/coordinator/stats', statsRouter);

app.listen(Number(port), host, () => {
  console.log(`Coordinator listening at http://${host}:${port}`);
});
