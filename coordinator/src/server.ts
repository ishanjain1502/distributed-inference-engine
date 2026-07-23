import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
dotenv.config();

import healthRouter from './health';
import inferRouter from './infer';
import statsRouter from './stats';

const app = express();
const port = process.env.PORT || 1337;
const host = process.env.HOST || '0.0.0.0';

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
