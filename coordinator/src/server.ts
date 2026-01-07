import express from 'express';
const app = express();
import dotenv from 'dotenv';
dotenv.config();

import healthRouter from './health';



const port = process.env.PORT || 1337;
const host = process.env.HOST || '0.0.0.0';

app.use(express.json());

app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.get('/coordinator/infer', (req, res) => {
    res.sendStatus(200);
});

app.use('/coordinator/health', healthRouter);

app.listen(Number(port), host, () => {
  return console.log(`Express is listening at http://${host}:${port}`);
});

