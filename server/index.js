import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { setupWebSocket } from './websocket.js';
import agentsRouter from './routes/agents.js';
import tasksRouter from './routes/tasks.js';
import chatsRouter from './routes/chats.js';
import statsRouter from './routes/stats.js';
import sessionsRouter from './routes/sessions.js';
import memoryRouter from './routes/memory.js';
import a2aRouter from './routes/a2a.js';
import a2aTasksRouter from './routes/a2a-tasks.js';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const distPath = path.join(__dirname, '..', 'dist');

app.use(cors());
app.use(express.json());

app.use('/api/agents', agentsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api', chatsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/memory', memoryRouter);
app.use('/', a2aRouter);  // Agent Card endpoint
app.use('/a2a', a2aTasksRouter);  // A2A task endpoints

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

const PORT = process.env.PORT || 3000;

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`端口 ${PORT} 已被占用。请先关闭占用该端口的进程，或使用: PORT=其他端口 npm run server`);
    process.exit(1);
  }
  throw err;
});

httpServer.listen(PORT, () => {
  logger.log(`Server running at http://localhost:${PORT}`);
});

setupWebSocket(httpServer);
