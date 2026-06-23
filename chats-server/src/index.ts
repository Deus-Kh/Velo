import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import http from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import { config } from './config';

import { authRouter } from './routes/auth.routes';
import { conversationsRouter } from './routes/conversations.routes';
import { usersRouter } from './routes/users.routes';
import { setupSocket } from './socket/setupSocket';
import { messagesRouter } from './routes/messages.routes';
import { keysRouter } from './routes/keys.routes';



async function main() {
  await mongoose.connect(config.MONGO_URI);

  const app = express();
  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());

  // routes WITHOUT /api
  // app.use('/',(req,res,next)=>{console.log("Request : ", req); next();})
  app.use('/auth', authRouter);
  app.use('/conversations', conversationsRouter);
  app.use('/users', usersRouter);
  app.use("/keys", keysRouter);
  app.use("/messages", messagesRouter);

  // health
  app.get('/health', (_req, res) => res.json({ ok: true }));

  const server = http.createServer(app);

  const io = new Server(server, {
    cors: { origin: true, credentials: true },
  });

  setupSocket(io);

  server.listen(config.PORT, () => {
    console.log(`Server running on http://localhost:${config.PORT}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
