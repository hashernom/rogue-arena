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
  // Netlify production (legacy)
  'https://rogue-arena.netlify.app',
  // Vercel production
  'https://rogue-arena.vercel.app',
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

// Middleware CORS manual - permite TODOS los orígenes
// Necesario para que Express también responda con headers CORS
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

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

// Crear HTTP server SIN requestListener para que Socket.io se adjunte primero
const httpServer = createServer();

// Adjuntar GameServer (Socket.io) PRIMERO - así maneja /socket.io/ antes que Express
const gameServer = new GameServer(httpServer, {
  port: PORT,
  host: HOST,
  corsOrigins: CORS_ORIGINS,
});

// Adjuntar Express DESPUÉS de Socket.io - Express solo maneja /health y /metrics
httpServer.on('request', app);

// Log para diagnosticar si Socket.io está activo
logger.info(`Socket.io path: /socket.io/`);

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
