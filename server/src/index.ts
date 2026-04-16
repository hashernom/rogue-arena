import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { SocketEvents } from '@rogue-arena/shared';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

const PORT = process.env.PORT || 3001;

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

io.on('connection', socket => {
  console.log('Client connected:', socket.id);

  socket.emit(SocketEvents.GAME_STATE, {
    players: [],
    wave: 1,
    timeRemaining: 60,
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
