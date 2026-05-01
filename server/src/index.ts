/**
 * Entry point del servidor de Rogue Arena.
 * Crea el servidor HTTP, monta el GameServer con Socket.io,
 * y maneja el lifecycle completo.
 */
import express from 'express';
import { createServer } from 'http';
import { GameServer } from './GameServer.js';
import { logger } from './logger.js';

// ============================================================
// Configuración
// ============================================================

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Orígenes CORS permitidos
const CORS_ORIGINS = [
  'http://localhost:5173',  // Vite dev
  'http://localhost:4173',  // Vite preview
  'http://localhost:3001',  // Self (para debugging)
  // Netlify production
  'https://rogue-arena.netlify.app',
];

// Dominio de producción custom (si está configurado en Railway)
if (process.env.CLIENT_ORIGIN) {
  // Si se configura como '*' permite cualquier origin (útil para preview branches)
  if (process.env.CLIENT_ORIGIN === '*') {
    CORS_ORIGINS.length = 0; // Vaciar
    CORS_ORIGINS.push('*');  // Permitir todos
  } else {
    CORS_ORIGINS.push(process.env.CLIENT_ORIGIN);
  }
}

// ============================================================
// Inicialización
// ============================================================

const app = express();

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    connections: gameServer?.getRoomManager().getPlayerCount() ?? 0,
    rooms: gameServer?.getRoomManager().getRoomCount() ?? 0,
  });
});

// Endpoint para métricas básicas
app.get('/metrics', (_req, res) => {
  res.json({
    players: gameServer?.getRoomManager().getPlayerCount() ?? 0,
    rooms: gameServer?.getRoomManager().getRoomCount() ?? 0,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

const httpServer = createServer(app);

// Crear GameServer (inicializa Socket.io + RoomManager + GameState)
const gameServer = new GameServer(httpServer, {
  port: PORT,
  host: HOST,
  corsOrigins: CORS_ORIGINS,
});

// ============================================================
// Startup
// ============================================================

httpServer.listen(PORT, HOST, () => {
  logger.info(`🚀 Rogue Arena server running on http://${HOST}:${PORT}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
  logger.info(`CORS origins: ${CORS_ORIGINS.join(', ')}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`CLIENT_ORIGIN: ${process.env.CLIENT_ORIGIN || 'no configurado'}`);
});

// ============================================================
// Manejo de errores del servidor
// ============================================================

httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`Port ${PORT} is already in use`);
  } else {
    logger.error(`HTTP server error: ${err.message}`);
  }
  process.exit(1);
});
