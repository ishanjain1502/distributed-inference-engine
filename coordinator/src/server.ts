import express from 'express';
import dotenv from 'dotenv';
dotenv.config();

import healthRouter from './health';
import inferRouter from './infer';

const app = express();
const port = process.env.PORT || 1337;
const host = process.env.HOST || '0.0.0.0';

app.use(express.json());

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.use('/coordinator/health', healthRouter);
app.use('/coordinator/infer', inferRouter);

app.listen(Number(port), host, () => {
  console.log(`Coordinator listening at http://${host}:${port}`);
});

