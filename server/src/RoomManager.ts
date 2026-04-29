/**
 * RoomManager: Gestión de salas (rooms) del juego.
 * Cada sala tiene un código único de 6 caracteres, máximo 2 jugadores,
 * y maneja estados: lobby → playing → gameOver.
 */
import { Socket } from 'socket.io';
import { SocketEvents } from '@rogue-arena/shared';
import { GameState } from './GameState.js';
import { logger } from './logger.js';

// ============================================================
// Constantes
// ============================================================

const ROOM_CODE_LENGTH = 6;
const ROOM_MAX_PLAYERS = 2;
const ROOM_CLEANUP_TIMEOUT_MS = 30_000; // 30 segundos sin jugadores → cleanup
const RECONNECT_GRACE_PERIOD_MS = 30_000; // 30 segundos para reconectar

// ============================================================
// Tipos de personaje
// ============================================================

export type CharacterType = 'melee' | 'adc';

// ============================================================
// Interfaces
// ============================================================

export interface RoomPlayer {
  id: string;
  socketId: string;
  name: string;
  character: CharacterType | null;
  /** Token único para reconexión (generado al crear la sala) */
  sessionToken?: string;
}

export type RoomState = 'lobby' | 'playing' | 'gameOver';

export interface DisconnectedPlayer {
  player: RoomPlayer;
  /** Timestamp de cuando se desconectó */
  disconnectedAt: number;
  /** Timer de reconexión (setTimeout) */
  reconnectTimer: ReturnType<typeof setTimeout>;
}

export interface Room {
  code: string; // 6 chars alfanumérico
  players: RoomPlayer[]; // máx 2
  state: RoomState;
  gameState: GameState;
  createdAt: number;
  /** Jugador desconectado temporalmente (reconnect grace period) */
  disconnectedPlayer?: DisconnectedPlayer;
}

export interface RoomInfo {
  code: string;
  playerCount: number;
  maxPlayers: number;
  state: RoomState;
}

// ============================================================
// RoomManager class
// ============================================================

export class RoomManager {
  private rooms: Map<string, Room> = new Map(); // code → Room
  private socketRoomMap: Map<string, string> = new Map(); // socketId → roomCode
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startCleanupLoop();
    logger.info('RoomManager initialized (2-player rooms)');
  }

  // ============================================================
  // Creación de sala
  // ============================================================

  /**
   * Crea una nueva sala con código único de 6 caracteres.
   * El socket creator se agrega automáticamente como P1.
   */
  createRoom(
    socket: Socket,
    playerName: string
  ): { success: true; code: string } | { success: false; error: string } {
    // Si el socket ya está en una sala, sacarlo primero
    this.leaveCurrentRoom(socket);

    const code = this.generateRoomCode();
    const gameState = new GameState();

    // Configurar callbacks del GameState
    gameState.onWaveStart = (round, count) => {
      this.broadcastToRoom(code, SocketEvents.WAVE_START, { round, enemyCount: count });
      logger.info(`Room ${code}: wave ${round} started with ${count} enemies`);
    };

    gameState.onWaveEnd = round => {
      this.broadcastToRoom(code, SocketEvents.WAVE_END, { round });
      logger.info(`Room ${code}: wave ${round} ended`);
    };

    gameState.onEnemyDied = (enemyId, position, reward, attackerId) => {
      this.broadcastToRoom(code, 'enemy:died', { enemyId, position, reward, attackerId });
    };

    gameState.onPlayerDied = playerId => {
      this.broadcastToRoom(code, 'player:died', { playerId });
      logger.info(`Room ${code}: player ${playerId} died`);
    };

    const room: Room = {
      code,
      players: [],
      state: 'lobby',
      gameState,
      createdAt: Date.now(),
    };

    // Generar token de sesión único para reconexión
    const sessionToken = this.generateSessionToken();

    // Agregar al creador como P1
    const player: RoomPlayer = {
      id: socket.id,
      socketId: socket.id,
      name: playerName,
      character: null,
      sessionToken,
    };
    room.players.push(player);
    this.socketRoomMap.set(socket.id, code);

    // Unir el socket a la room de Socket.io
    void socket.join(code);

    this.rooms.set(code, room);
    logger.info(`Room ${code} created by ${playerName} (${socket.id})`);

    // Enviar estado inicial al creador
    socket.emit('room:created', {
      code,
      players: this.getRoomPlayersData(room),
      state: room.state,
    });

    // Enviar sessionToken al cliente
    socket.emit('session:token', { sessionToken });

    return { success: true, code };
  }

  // ============================================================
  // Unión a sala por código
  // ============================================================

  /**
   * Agrega un jugador a una sala existente por código.
   * Si hay 2 jugadores, emite room:ready a ambos.
   */
  joinRoom(
    code: string,
    socket: Socket,
    playerName: string
  ): { success: true; playerId: string } | { success: false; error: string } {
    const room = this.rooms.get(code);
    if (!room) {
      return { success: false, error: 'Sala no encontrada' };
    }

    if (room.state !== 'lobby') {
      return { success: false, error: 'La partida ya comenzó' };
    }

    if (room.players.length >= ROOM_MAX_PLAYERS) {
      return { success: false, error: 'Sala llena (máximo 2 jugadores)' };
    }

    // Si el socket ya está en una sala, sacarlo primero
    this.leaveCurrentRoom(socket);

    // Generar token de sesión para el segundo jugador
    const sessionToken = this.generateSessionToken();

    const player: RoomPlayer = {
      id: socket.id,
      socketId: socket.id,
      name: playerName,
      character: null,
      sessionToken,
    };
    room.players.push(player);
    this.socketRoomMap.set(socket.id, code);

    // Unir el socket a la room de Socket.io
    void socket.join(code);

    logger.info(`Player ${playerName} (${socket.id}) joined room ${code}`);

    // Notificar a todos en la sala (incluyendo al nuevo) el cambio de jugadores
    const playersData = this.getRoomPlayersData(room);
    this.broadcastToRoom(code, 'room:players', { players: playersData });

    // Si hay 2 jugadores, emitir room:ready
    if (room.players.length === ROOM_MAX_PLAYERS) {
      room.state = 'lobby'; // sigue en lobby hasta que seleccionen personajes
      this.broadcastToRoom(code, 'room:ready', {
        code,
        players: playersData,
        message: '¡Ambos jugadores conectados! Seleccionen su personaje.',
      });
      logger.info(`Room ${code}: both players connected, ready for character select`);
    }

    // Enviar sessionToken al cliente
    socket.emit('session:token', { sessionToken });

    return { success: true, playerId: socket.id };
  }

  // ============================================================
  // Selección de personaje
  // ============================================================

  /**
   * Un jugador selecciona su personaje.
   * Se notifica al otro jugador en tiempo real.
   */
  selectCharacter(
    socket: Socket,
    character: CharacterType
  ): { success: true } | { success: false; error: string } {
    const room = this.getRoomBySocketId(socket.id);
    if (!room) {
      return { success: false, error: 'No estás en una sala' };
    }

    const player = room.players.find(p => p.id === socket.id);
    if (!player) {
      return { success: false, error: 'Jugador no encontrado en la sala' };
    }

    player.character = character;
    logger.info(`Room ${room.code}: player ${player.name} selected ${character}`);

    // Broadcast a TODOS en la sala (incluyendo al que seleccionó)
    const playersData = this.getRoomPlayersData(room);
    this.broadcastToRoom(room.code, 'player:characterSelected', {
      playerId: socket.id,
      character,
      players: playersData,
    });

    // Verificar si ambos ya seleccionaron personaje
    if (room.players.length === ROOM_MAX_PLAYERS && room.players.every(p => p.character !== null)) {
      logger.info(`Room ${room.code}: both players selected characters, ready to start`);
      this.broadcastToRoom(room.code, 'room:charactersReady', {
        code: room.code,
        players: playersData,
        message: 'Ambos jugadores listos. Iniciando partida...',
      });
    }

    return { success: true };
  }

  // ============================================================
  // Iniciar juego
  // ============================================================

  /**
   * Inicia la partida en una sala. Requiere 2 jugadores con personajes seleccionados.
   */
  startGame(socket: Socket): { success: true } | { success: false; error: string } {
    const room = this.getRoomBySocketId(socket.id);
    if (!room) {
      return { success: false, error: 'No estás en una sala' };
    }

    if (room.state !== 'lobby') {
      return { success: false, error: 'La partida ya comenzó o terminó' };
    }

    if (room.players.length < ROOM_MAX_PLAYERS) {
      return { success: false, error: 'Esperando al segundo jugador' };
    }

    if (!room.players.every(p => p.character !== null)) {
      return { success: false, error: 'Ambos jugadores deben seleccionar personaje' };
    }

    room.state = 'playing';

    // Agregar jugadores al GameState
    room.players.forEach(p => {
      room.gameState.addPlayer(p.id, p.socketId, p.name);
    });

    // Iniciar primera oleada
    room.gameState.startWave(1);

    // Enviar snapshot inicial
    const snapshot = room.gameState.getSnapshot();
    this.broadcastToRoom(room.code, SocketEvents.GAME_STATE, snapshot);

    this.broadcastToRoom(room.code, 'game:started', {
      code: room.code,
      players: this.getRoomPlayersData(room),
    });

    logger.info(`Room ${room.code}: game started with ${room.players.length} players`);
    return { success: true };
  }

  // ============================================================
  // Salir de sala / Desconexión
  // ============================================================

  /**
   * Saca a un jugador de su sala actual (salida voluntaria).
   * Si está en lobby y era P1, elimina la sala y notifica a P2.
   * Si está en partida, se maneja como desconexión temporal.
   */
  leaveCurrentRoom(socket: Socket): void {
    const code = this.socketRoomMap.get(socket.id);
    if (!code) return;

    const room = this.rooms.get(code);
    if (!room) {
      this.socketRoomMap.delete(socket.id);
      return;
    }

    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex === -1) {
      this.socketRoomMap.delete(socket.id);
      return;
    }

    const player = room.players[playerIndex];
    const wasInLobby = room.state === 'lobby';
    const wasP1 = playerIndex === 0;

    // Remover jugador
    room.players.splice(playerIndex, 1);
    this.socketRoomMap.delete(socket.id);
    void socket.leave(code);

    logger.info(`Player ${player.name} (${socket.id}) left room ${code}`);

    if (wasInLobby) {
      if (wasP1) {
        // P1 se fue del lobby → eliminar sala y notificar a P2 si existe
        if (room.players.length > 0) {
          const remainingPlayer = room.players[0];
          const remainingSocket = this.getSocketById(remainingPlayer.socketId);
          if (remainingSocket) {
            remainingSocket.emit('room:closed', {
              code,
              reason: 'El anfitrión abandonó la sala',
            });
            void remainingSocket.leave(code);
          }
        }
        this.destroyRoom(code);
        logger.info(`Room ${code}: destroyed because host left lobby`);
      } else {
        // P2 se fue del lobby → notificar a P1
        if (room.players.length > 0) {
          const p1 = room.players[0];
          const p1Socket = this.getSocketById(p1.socketId);
          if (p1Socket) {
            p1Socket.emit('room:playerLeft', {
              playerId: player.id,
              playerName: player.name,
              players: this.getRoomPlayersData(room),
            });
          }
        }
        // Si no quedan jugadores, limpiar
        if (room.players.length === 0) {
          this.scheduleCleanup(code);
        }
      }
    } else {
      // Durante la partida: notificar a los demás
      if (room.players.length > 0) {
        this.broadcastToRoom(code, SocketEvents.PLAYER_LEAVE, { playerId: player.id });
      }
      // Si no quedan jugadores, limpiar
      if (room.players.length === 0) {
        this.scheduleCleanup(code);
      }
    }
  }

  /**
   * Maneja la desconexión inesperada de un socket.
   * Si la sala está en 'playing', pausa el juego e inicia timer de reconexión.
   * Si está en 'lobby', se maneja como salida normal.
   */
  handleDisconnect(socket: Socket): void {
    const code = this.socketRoomMap.get(socket.id);
    if (!code) return;

    const room = this.rooms.get(code);
    if (!room) {
      this.socketRoomMap.delete(socket.id);
      return;
    }

    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex === -1) {
      this.socketRoomMap.delete(socket.id);
      return;
    }

    const player = room.players[playerIndex];

    // Si la sala está en lobby, manejar como salida normal
    if (room.state === 'lobby') {
      this.leaveCurrentRoom(socket);
      return;
    }

    // Si la sala está en gameOver, salida normal
    if (room.state === 'gameOver') {
      this.leaveCurrentRoom(socket);
      return;
    }

    // --- ESTADO 'playing': Iniciar protocolo de reconexión ---

    logger.info(`Player ${player.name} (${socket.id}) disconnected during game in room ${code}`);

    // Cancelar cualquier timer de reconexión previo
    if (room.disconnectedPlayer) {
      clearTimeout(room.disconnectedPlayer.reconnectTimer);
    }

    // Remover el socket de la sala (Socket.io room)
    void socket.leave(code);
    this.socketRoomMap.delete(socket.id);

    // Pausar el juego
    room.gameState.pause();

    // Notificar al otro jugador
    const otherPlayer = room.players.find(p => p.id !== player.id);
    if (otherPlayer) {
      const otherSocket = this.getSocketById(otherPlayer.socketId);
      if (otherSocket) {
        otherSocket.emit(SocketEvents.PLAYER_DISCONNECTED, {
          playerId: player.id,
          playerName: player.name,
          message: `${player.name} se ha desconectado. Esperando reconexión...`,
          reconnectTimeoutMs: RECONNECT_GRACE_PERIOD_MS,
        });
      }
    }

    // Guardar el jugador desconectado y su timer de reconexión
    const reconnectTimer = setTimeout(() => {
      logger.info(`Reconnect timeout for player ${player.name} (${player.id}) in room ${code}`);

      // Notificar al otro jugador que el tiempo expiró
      if (otherPlayer) {
        const otherSocket = this.getSocketById(otherPlayer.socketId);
        if (otherSocket) {
          otherSocket.emit(SocketEvents.GAME_OVER, {
            reason: 'player_disconnected',
            message: `${player.name} no se reconectó a tiempo. Partida finalizada.`,
            winnerId: otherPlayer.id,
          });
        }
      }

      // Limpiar el estado de desconexión
      room.disconnectedPlayer = undefined;

      // Marcar la sala como gameOver
      room.state = 'gameOver';

      // Limpiar la sala después del timeout
      this.scheduleCleanup(code);
    }, RECONNECT_GRACE_PERIOD_MS);

    room.disconnectedPlayer = {
      player: { ...player },
      disconnectedAt: Date.now(),
      reconnectTimer,
    };

    // Remover al jugador de la lista activa pero mantenerlo en disconnectedPlayer
    room.players.splice(playerIndex, 1);

    logger.info(
      `Room ${code}: reconnect timer started (${RECONNECT_GRACE_PERIOD_MS}ms) for player ${player.name}`
    );
  }

  /**
   * Intenta reconectar un socket a una sala usando su sessionToken.
   * Si el token es válido y el timer de reconexión no ha expirado,
   * asocia el nuevo socket al jugador y reanuda la partida.
   */
  handleReconnect(
    socket: Socket,
    sessionToken: string
  ): { success: true; playerId: string; roomCode: string } | { success: false; error: string } {
    // Buscar la sala que tiene este jugador desconectado
    for (const [code, room] of this.rooms.entries()) {
      if (!room.disconnectedPlayer) continue;
      if (room.disconnectedPlayer.player.sessionToken !== sessionToken) continue;

      // Verificar que el timer no haya expirado (el timer ya limpió disconnectedPlayer si expiró)
      const elapsed = Date.now() - room.disconnectedPlayer.disconnectedAt;
      if (elapsed >= RECONNECT_GRACE_PERIOD_MS) {
        room.disconnectedPlayer = undefined;
        return { success: false, error: 'Tiempo de reconexión expirado' };
      }

      // Cancelar el timer de reconexión
      clearTimeout(room.disconnectedPlayer.reconnectTimer);

      // Restaurar al jugador
      const restoredPlayer: RoomPlayer = {
        ...room.disconnectedPlayer.player,
        socketId: socket.id,
      };

      room.players.push(restoredPlayer);
      this.socketRoomMap.set(socket.id, code);
      void socket.join(code);

      // Limpiar estado de desconexión
      room.disconnectedPlayer = undefined;

      // Reanudar el juego
      room.gameState.resume();

      logger.info(`Player ${restoredPlayer.name} (${socket.id}) reconnected to room ${code}`);

      // Notificar al otro jugador
      const otherPlayer = room.players.find(p => p.id !== restoredPlayer.id);
      if (otherPlayer) {
        const otherSocket = this.getSocketById(otherPlayer.socketId);
        if (otherSocket) {
          otherSocket.emit(SocketEvents.PLAYER_RECONNECTED, {
            playerId: restoredPlayer.id,
            playerName: restoredPlayer.name,
            message: `${restoredPlayer.name} se ha reconectado. La partida continúa.`,
          });
        }
      }

      // Enviar snapshot completo al jugador reconectado
      const snapshot = room.gameState.getSnapshot();
      socket.emit(SocketEvents.GAME_STATE, snapshot);

      return { success: true, playerId: restoredPlayer.id, roomCode: code };
    }

    return { success: false, error: 'Token de sesión inválido o no hay reconexión pendiente' };
  }

  // ============================================================
  // Broadcast y comunicación
  // ============================================================

  /**
   * Envía un evento a todos los sockets en una sala.
   */
  broadcastToRoom(code: string, event: string, data: unknown): void {
    const room = this.rooms.get(code);
    if (!room) return;

    room.players.forEach(player => {
      const socket = this.getSocketById(player.socketId);
      if (socket) {
        socket.emit(event, data);
      }
    });
  }

  /**
   * Envía un evento a todos los sockets en una sala excepto el emisor.
   */
  broadcastToRoomExcept(code: string, event: string, data: unknown, exceptSocketId: string): void {
    const room = this.rooms.get(code);
    if (!room) return;

    room.players.forEach(player => {
      if (player.socketId !== exceptSocketId) {
        const socket = this.getSocketById(player.socketId);
        if (socket) {
          socket.emit(event, data);
        }
      }
    });
  }

  // ============================================================
  // Consultas
  // ============================================================

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  getRoomBySocketId(socketId: string): Room | undefined {
    const code = this.socketRoomMap.get(socketId);
    if (!code) return undefined;
    return this.rooms.get(code);
  }

  getRoomPlayersData(
    room: Room
  ): Array<{ id: string; name: string; character: CharacterType | null }> {
    return room.players.map(p => ({
      id: p.id,
      name: p.name,
      character: p.character,
    }));
  }

  /**
   * Retorna todas las salas (para broadcast de estado).
   */
  getAllRooms(): Room[] {
    return Array.from(this.rooms.values());
  }

  getPlayerCount(): number {
    return this.socketRoomMap.size;
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  // ============================================================
  // Limpieza y ciclo de vida
  // ============================================================

  private scheduleCleanup(code: string): void {
    setTimeout(() => {
      const room = this.rooms.get(code);
      if (room && room.players.length === 0) {
        this.destroyRoom(code);
      }
    }, ROOM_CLEANUP_TIMEOUT_MS);
  }

  private destroyRoom(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;

    // Cancelar timer de reconexión si existe
    if (room.disconnectedPlayer) {
      clearTimeout(room.disconnectedPlayer.reconnectTimer);
    }

    // Limpiar socketRoomMap
    room.players.forEach(p => {
      this.socketRoomMap.delete(p.socketId);
    });

    room.gameState.destroy();
    this.rooms.delete(code);
    logger.info(`Room ${code} destroyed`);
  }

  private startCleanupLoop(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      this.rooms.forEach((room, code) => {
        // Limpiar salas vacías muy viejas (más de 5 minutos)
        if (room.players.length === 0 && now - room.createdAt > 300_000) {
          this.destroyRoom(code);
        }
      });
    }, 30_000); // cada 30 segundos
  }

  private generateRoomCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // Asegurar que no exista (no colisión)
    if (this.rooms.has(code)) {
      return this.generateRoomCode();
    }
    return code;
  }

  /**
   * Genera un token único de sesión para reconexión.
   * Formato: 32 caracteres hexadecimales.
   */
  private generateSessionToken(): string {
    const chars = '0123456789abcdef';
    let token = '';
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }

  /**
   * Obtiene un socket por su ID desde el servidor Socket.io.
   * Necesita una referencia al Server de Socket.io.
   */
  private io: import('socket.io').Server | null = null;

  setIOServer(io: import('socket.io').Server): void {
    this.io = io;
  }

  private getSocketById(socketId: string): Socket | undefined {
    if (!this.io) return undefined;
    return this.io.sockets.sockets.get(socketId) as Socket | undefined;
  }

  // ============================================================
  // Destroy
  // ============================================================

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.rooms.forEach(room => {
      room.gameState.destroy();
    });
    this.rooms.clear();
    this.socketRoomMap.clear();
    this.io = null;
    logger.info('RoomManager destroyed');
  }
}
