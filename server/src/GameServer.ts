/**
 * GameServer: Clase principal que orquesta el lifecycle completo del servidor.
 * Inicializa el transporte (Socket.io), la gestión de salas y el estado del juego.
 * Maneja graceful shutdown y reconexiones.
 * Incluye un game loop que emite snapshots del estado a los clientes en tiempo real.
 */
import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { SocketEvents } from '@rogue-arena/shared';
import { RoomManager, CharacterType, Room } from './RoomManager.js';
import { logger } from './logger.js';

// ============================================================
// Configuración
// ============================================================

export interface GameServerConfig {
  /** Puerto del servidor HTTP */
  port: number;
  /** Orígenes CORS permitidos */
  corsOrigins: string[];
  /** Host al que bindear */
  host?: string;
}

const DEFAULT_CONFIG: GameServerConfig = {
  port: 3001,
  corsOrigins: ['http://localhost:5173', 'http://localhost:4173'],
  host: '0.0.0.0',
};

/** Intervalo de emisión de snapshots de estado (ms) */
const STATE_BROADCAST_INTERVAL_MS = 50; // 20 Hz

// ============================================================
// GameServer class
// ============================================================

export class GameServer {
  private httpServer: HttpServer;
  private io: Server;
  private roomManager: RoomManager;
  private config: GameServerConfig;
  private isShuttingDown = false;
  private stateBroadcastTimer: ReturnType<typeof setInterval> | null = null;
  /** Timer para ping/pong health check */
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(httpServer: HttpServer, config?: Partial<GameServerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.httpServer = httpServer;

    // Inicializar Socket.io
    this.io = new Server(this.httpServer, {
      cors: {
        origin: this.config.corsOrigins,
        methods: ['GET', 'POST'],
        credentials: true,
      },
      // Configuración para graceful restart
      pingInterval: 10_000,
      pingTimeout: 5_000,
      transports: ['websocket', 'polling'],
    });

    // Inicializar RoomManager y pasarle referencia al IO Server
    this.roomManager = new RoomManager();
    this.roomManager.setIOServer(this.io);

    this.setupSocketHandlers();
    this.setupProcessHandlers();
    this.startStateBroadcast();
    this.startPingHealthCheck();

    logger.info('GameServer initialized');
    logger.info(`CORS origins: ${this.config.corsOrigins.join(', ')}`);
  }

  /**
   * Inicia el loop de broadcast de estado del juego.
   * Cada 50ms envía el snapshot de todas las salas activas a sus jugadores.
   */
  private startStateBroadcast(): void {
    this.stateBroadcastTimer = setInterval(() => {
      const rooms = this.roomManager.getAllRooms();
      for (const room of rooms) {
        if (room.state !== 'playing') continue;

        const snapshot = room.gameState.getSnapshot();
        this.io.to(room.code).emit(SocketEvents.GAME_STATE, snapshot);
      }
    }, STATE_BROADCAST_INTERVAL_MS);

    logger.info(`State broadcast started (${STATE_BROADCAST_INTERVAL_MS}ms interval)`);
  }

  private stopStateBroadcast(): void {
    if (this.stateBroadcastTimer) {
      clearInterval(this.stateBroadcastTimer);
      this.stateBroadcastTimer = null;
    }
  }

  /**
   * Inicia el health check de ping/pong para detectar conexiones zombie.
   * Cada 5 segundos envía un ping a todos los sockets conectados.
   * Socket.io maneja internamente el timeout de pong.
   */
  private startPingHealthCheck(): void {
    // Socket.io ya tiene pingInterval/pingTimeout configurado,
    // pero añadimos un check adicional para detectar zombies rápidamente
    this.pingTimer = setInterval(() => {
      const sockets = this.io?.sockets?.sockets;
      if (!sockets) return;

      const now = Date.now();
      sockets.forEach((socket) => {
        // Si el socket no ha respondido en mucho tiempo, forzar desconexión
        if (socket.data?.lastPong && (now - socket.data.lastPong) > 15_000) {
          logger.warn(`Zombie connection detected: ${socket.id}, forcing disconnect`);
          socket.disconnect(true);
        }
      });
    }, 10_000); // cada 10 segundos

    // Registrar pong handlers en nuevas conexiones
    this.io?.on('connection', (socket) => {
      socket.data.lastPong = Date.now();
      socket.on('pong', () => {
        socket.data.lastPong = Date.now();
      });
    });

    logger.info('Ping health check started');
  }

  private stopPingHealthCheck(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  // ============================================================
  // Handlers de Socket.io
  // ============================================================

  private setupSocketHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      logger.info(`Socket connected: ${socket.id}`);

      // Enviar confirmación de conexión con sessionToken si el cliente lo tiene
      socket.emit('connected', {
        socketId: socket.id,
        serverTime: Date.now(),
        message: 'Connected to Rogue Arena server',
      });

      // --- Eventos de sala ---

      // Crear sala (genera código de 6 chars)
      socket.on('room:create', (data: { playerName?: string }, callback) => {
        try {
          const playerName = data?.playerName || `Player_${socket.id.slice(0, 4)}`;
          const result = this.roomManager.createRoom(socket, playerName);
          callback(result);
          if (result.success) {
            logger.info(`Room ${result.code} created by ${playerName} (${socket.id})`);
          }
        } catch (err) {
          logger.error(`Error creating room: ${err}`);
          callback({ success: false, error: 'Error interno del servidor' });
        }
      });

      // Unirse a sala por código de 6 caracteres
      socket.on('room:join', (data: { code: string; playerName?: string }, callback) => {
        try {
          const playerName = data?.playerName || `Player_${socket.id.slice(0, 4)}`;
          const code = data?.code?.toUpperCase().trim();
          if (!code || code.length !== ROOM_CODE_LENGTH) {
            callback({ success: false, error: 'Código de sala inválido' });
            return;
          }
          const result = this.roomManager.joinRoom(code, socket, playerName);
          callback(result);
          if (result.success) {
            logger.info(`Player ${playerName} (${socket.id}) joined room ${code}`);
          }
        } catch (err) {
          logger.error(`Error joining room: ${err}`);
          callback({ success: false, error: 'Error interno del servidor' });
        }
      });

      // Salir de sala
      socket.on('room:leave', () => {
        this.roomManager.leaveCurrentRoom(socket);
        logger.info(`Socket ${socket.id} left current room`);
      });

      // Seleccionar personaje
      socket.on('player:selectCharacter', (data: { character: string }, callback) => {
        try {
          const character = data?.character as CharacterType;
          if (character !== 'melee' && character !== 'adc') {
            callback?.({ success: false, error: 'Personaje inválido' });
            return;
          }
          const result = this.roomManager.selectCharacter(socket, character);
          callback?.(result);
        } catch (err) {
          logger.error(`Error selecting character: ${err}`);
          callback?.({ success: false, error: 'Error interno del servidor' });
        }
      });

      // Iniciar juego (requiere 2 jugadores con personajes seleccionados)
      socket.on('game:start', (callback) => {
        try {
          const result = this.roomManager.startGame(socket);
          callback?.(result);
          if (result.success) {
            const room = this.roomManager.getRoomBySocketId(socket.id);
            logger.info(`Game started in room ${room?.code} by socket ${socket.id}`);
          }
        } catch (err) {
          logger.error(`Error starting game: ${err}`);
          callback?.({ success: false, error: 'Error interno del servidor' });
        }
      });

      // --- Eventos de juego ---

      // Movimiento del jugador
      socket.on(SocketEvents.PLAYER_MOVE, (data: { position: { x: number; y: number; z: number }; rotation: number; seq: number }) => {
        const room = this.roomManager.getRoomBySocketId(socket.id);
        if (!room || room.state !== 'playing') return;

        room.gameState.updatePlayerPosition(socket.id, data.position, data.rotation, data.seq);
      });

      // Ataque del jugador
      socket.on(SocketEvents.PLAYER_ATTACK, (data: { damage: number; position: { x: number; y: number; z: number }; targetId?: string }) => {
        const room = this.roomManager.getRoomBySocketId(socket.id);
        if (!room || room.state !== 'playing') return;

        const player = room.gameState.getPlayer(socket.id);
        if (!player || !player.alive) return;

        // Broadcast del ataque a los demás en la sala
        socket.to(room.code).emit(SocketEvents.PLAYER_ATTACK, {
          playerId: socket.id,
          damage: data.damage,
          position: data.position,
        });

        // Si hay un target (enemigo), aplicar daño
        if (data.targetId) {
          const killed = room.gameState.damageEnemy(data.targetId, data.damage, socket.id);
          if (killed) {
            room.gameState.checkWaveComplete();
          }
        }
      });

      // --- Reconexión ---

      socket.on(SocketEvents.RECONNECT, (data: { sessionToken: string }, callback) => {
        try {
          if (!data?.sessionToken) {
            callback?.({ success: false, error: 'Token de sesión requerido' });
            return;
          }
          const result = this.roomManager.handleReconnect(socket, data.sessionToken);
          callback?.(result);
          if (result.success) {
            logger.info(`Socket ${socket.id} reconnected to room ${result.roomCode}`);
          }
        } catch (err) {
          logger.error(`Error during reconnect: ${err}`);
          callback?.({ success: false, error: 'Error interno del servidor' });
        }
      });

      // --- Desconexión ---

      socket.on('disconnect', (reason) => {
        logger.info(`Socket disconnected: ${socket.id}, reason: ${reason}`);
        this.roomManager.handleDisconnect(socket);
      });

      // --- Errores ---

      socket.on('error', (err) => {
        logger.error(`Socket error ${socket.id}: ${err}`);
      });
    });
  }

  // ============================================================
  // Manejo de procesos (graceful shutdown)
  // ============================================================

  private setupProcessHandlers(): void {
    process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));

    process.on('uncaughtException', (err) => {
      logger.error(`Uncaught exception: ${err.message}`);
      logger.error(err.stack ?? '');
      this.gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
      logger.error(`Unhandled rejection: ${reason}`);
    });
  }

  private async gracefulShutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    logger.info(`Received ${signal}, starting graceful shutdown...`);

    this.stopStateBroadcast();
    this.stopPingHealthCheck();
    logger.info('State broadcast and ping health check stopped');

    this.io?.close(() => {
      logger.info('Socket.io server closed');
    });

    this.roomManager?.destroy();
    logger.info('RoomManager destroyed');

    return new Promise<void>((resolve) => {
      this.httpServer.close(() => {
        logger.info('HTTP server closed');
        logger.info('Graceful shutdown complete');
        resolve();
      });

      setTimeout(() => {
        logger.warn('Forced shutdown after timeout');
        process.exit(1);
      }, 10_000);
    });
  }

  // ============================================================
  // Getters
  // ============================================================

  getIO(): Server {
    return this.io;
  }

  getRoomManager(): RoomManager {
    return this.roomManager;
  }

  getConfig(): GameServerConfig {
    return { ...this.config };
  }
}

// Constante local para validación
const ROOM_CODE_LENGTH = 6;
