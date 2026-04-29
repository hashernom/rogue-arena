/**
 * ConnectionManager: Maneja la conexión Socket.io con el servidor.
 * Proporciona una API limpia para que la UI interactúe con el servidor.
 * También maneja el envío de inputs del jugador y recepción de snapshots.
 */
import { io, Socket } from 'socket.io-client';
import { SocketEvents, GameStateSnapshot } from '@rogue-arena/shared';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface RoomData {
  code: string;
  players: Array<{ id: string; name: string; character: string | null }>;
  state: string;
}

export type CharacterType = 'melee' | 'adc';

export interface ConnectionCallbacks {
  onStatusChange?: (status: ConnectionStatus) => void;
  onRoomCreated?: (data: { code: string }) => void;
  onRoomReady?: (data: { code: string; players: RoomData['players']; message: string }) => void;
  onRoomClosed?: (data: { code: string; reason: string }) => void;
  onRoomPlayers?: (data: { players: RoomData['players'] }) => void;
  onPlayerLeft?: (data: {
    playerId: string;
    playerName: string;
    players: RoomData['players'];
  }) => void;
  onCharacterSelected?: (data: {
    playerId: string;
    character: string;
    players: RoomData['players'];
  }) => void;
  onCharactersReady?: (data: {
    code: string;
    players: RoomData['players'];
    message: string;
  }) => void;
  onGameStarted?: (data: { code: string; players: RoomData['players']; seed?: number }) => void;
  /** Recibe el snapshot del estado del juego desde el servidor (~20Hz) */
  onGameState?: (snapshot: GameStateSnapshot) => void;
  /** Un jugador se desconectó durante la partida */
  onPlayerDisconnected?: (data: {
    playerId: string;
    playerName: string;
    message: string;
    reconnectTimeoutMs: number;
  }) => void;
  /** Un jugador se reconectó a la partida */
  onPlayerReconnected?: (data: { playerId: string; playerName: string; message: string }) => void;
  /** La partida terminó (por desconexión u otra razón) */
  onGameOver?: (data: { reason: string; message: string; winnerId?: string }) => void;
  onError?: (error: string) => void;
}

export class ConnectionManager {
  private socket: Socket | null = null;
  private serverUrl: string;
  private callbacks: ConnectionCallbacks;
  private status: ConnectionStatus = 'disconnected';
  /** Token de sesión para reconexión (persistido en sessionStorage) */
  private sessionToken: string | null = null;

  constructor(serverUrl: string = 'http://localhost:3001', callbacks: ConnectionCallbacks = {}) {
    this.serverUrl = serverUrl;
    this.callbacks = callbacks;
  }

  // ============================================================
  // Conexión / Desconexión
  // ============================================================

  connect(): void {
    if (this.socket?.connected) return;

    this.setStatus('connecting');

    this.socket = io(this.serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      console.log(`[ConnectionManager] Conectado: ${this.socket?.id}`);
      this.setStatus('connected');
    });

    this.socket.on('disconnect', reason => {
      console.log(`[ConnectionManager] Desconectado: ${reason}`);
      this.setStatus('disconnected');
    });

    this.socket.on('connect_error', err => {
      console.error(`[ConnectionManager] Error de conexión: ${err.message}`);
      this.setStatus('disconnected');
      this.callbacks.onError?.(`Error de conexión: ${err.message}`);
    });

    // --- Token de sesión ---

    this.socket.on('session:token', (data: { sessionToken: string }) => {
      console.log(`[ConnectionManager] Token de sesión recibido`);
      this.setSessionToken(data.sessionToken);
    });

    // --- Eventos de sala ---

    this.socket.on('room:created', (data: { code: string }) => {
      console.log(`[ConnectionManager] Sala creada: ${data.code}`);
      this.callbacks.onRoomCreated?.(data);
    });

    this.socket.on('room:players', (data: { players: RoomData['players'] }) => {
      this.callbacks.onRoomPlayers?.(data);
    });

    this.socket.on(
      'room:ready',
      (data: { code: string; players: RoomData['players']; message: string }) => {
        console.log(`[ConnectionManager] Sala lista: ${data.code}`);
        this.callbacks.onRoomReady?.(data);
      }
    );

    this.socket.on('room:closed', (data: { code: string; reason: string }) => {
      console.log(`[ConnectionManager] Sala cerrada: ${data.reason}`);
      this.callbacks.onRoomClosed?.(data);
    });

    this.socket.on(
      'room:playerLeft',
      (data: { playerId: string; playerName: string; players: RoomData['players'] }) => {
        this.callbacks.onPlayerLeft?.(data);
      }
    );

    this.socket.on(
      'player:characterSelected',
      (data: { playerId: string; character: string; players: RoomData['players'] }) => {
        this.callbacks.onCharacterSelected?.(data);
      }
    );

    this.socket.on(
      'room:charactersReady',
      (data: { code: string; players: RoomData['players']; message: string }) => {
        this.callbacks.onCharactersReady?.(data);
      }
    );

    this.socket.on('game:started', (data: { code: string; players: RoomData['players']; seed?: number }) => {
      console.log(`[ConnectionManager] Juego iniciado en sala ${data.code}${data.seed !== undefined ? ` (seed=${data.seed})` : ''}`);
      this.callbacks.onGameStarted?.(data);
    });

    this.socket.on(SocketEvents.GAME_STATE, (snapshot: GameStateSnapshot) => {
      this.callbacks.onGameState?.(snapshot);
    });

    // --- Eventos de desconexión / reconexión ---

    this.socket.on(
      SocketEvents.PLAYER_DISCONNECTED,
      (data: {
        playerId: string;
        playerName: string;
        message: string;
        reconnectTimeoutMs: number;
      }) => {
        console.log(`[ConnectionManager] Jugador desconectado: ${data.playerName}`);
        this.callbacks.onPlayerDisconnected?.(data);
      }
    );

    this.socket.on(
      SocketEvents.PLAYER_RECONNECTED,
      (data: { playerId: string; playerName: string; message: string }) => {
        console.log(`[ConnectionManager] Jugador reconectado: ${data.playerName}`);
        this.callbacks.onPlayerReconnected?.(data);
      }
    );

    this.socket.on(
      SocketEvents.GAME_OVER,
      (data: { reason: string; message: string; winnerId?: string }) => {
        console.log(`[ConnectionManager] Partida terminada: ${data.reason}`);
        this.callbacks.onGameOver?.(data);
      }
    );
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.close();
      this.socket = null;
    }
    this.setStatus('disconnected');
  }

  // ============================================================
  // Acciones
  // ============================================================

  createRoom(playerName: string): Promise<{ success: boolean; code?: string; error?: string }> {
    return new Promise(resolve => {
      if (!this.socket?.connected) {
        resolve({ success: false, error: 'No conectado al servidor' });
        return;
      }
      this.socket.emit(
        'room:create',
        { playerName },
        (res: { success: boolean; code?: string; error?: string }) => {
          resolve(res);
        }
      );
    });
  }

  joinRoom(
    code: string,
    playerName: string
  ): Promise<{ success: boolean; playerId?: string; error?: string }> {
    return new Promise(resolve => {
      if (!this.socket?.connected) {
        resolve({ success: false, error: 'No conectado al servidor' });
        return;
      }
      this.socket.emit(
        'room:join',
        { code: code.toUpperCase().trim(), playerName },
        (res: { success: boolean; playerId?: string; error?: string }) => {
          resolve(res);
        }
      );
    });
  }

  selectCharacter(character: CharacterType): Promise<{ success: boolean; error?: string }> {
    return new Promise(resolve => {
      if (!this.socket?.connected) {
        resolve({ success: false, error: 'No conectado al servidor' });
        return;
      }
      this.socket.emit(
        SocketEvents.PLAYER_SELECT_CHARACTER,
        { character },
        (res: { success: boolean; error?: string }) => {
          resolve(res);
        }
      );
    });
  }

  startGame(): Promise<{ success: boolean; error?: string }> {
    return new Promise(resolve => {
      if (!this.socket?.connected) {
        resolve({ success: false, error: 'No conectado al servidor' });
        return;
      }
      this.socket.emit('game:start', (res: { success: boolean; error?: string }) => {
        resolve(res);
      });
    });
  }

  leaveRoom(): void {
    this.socket?.emit('room:leave');
  }

  // ============================================================
  // Reconexión
  // ============================================================

  /**
   * Almacena el token de sesión para reconexión.
   * Se llama después de crear o unirse a una sala exitosamente.
   */
  setSessionToken(token: string): void {
    this.sessionToken = token;
    try {
      sessionStorage.setItem('rogue_arena_session_token', token);
    } catch {
      // sessionStorage puede no estar disponible
    }
  }

  /**
   * Obtiene el token de sesión almacenado.
   */
  getSessionToken(): string | null {
    if (this.sessionToken) return this.sessionToken;
    try {
      return sessionStorage.getItem('rogue_arena_session_token');
    } catch {
      return null;
    }
  }

  /**
   * Intenta reconectar a una partida en curso usando el token de sesión.
   * El servidor validará el token y si hay una reconexión pendiente,
   * restaurará al jugador en su sala.
   */
  reconnect(): Promise<{ success: boolean; playerId?: string; error?: string }> {
    return new Promise(resolve => {
      const token = this.getSessionToken();
      if (!token) {
        resolve({ success: false, error: 'No hay token de sesión' });
        return;
      }

      if (!this.socket?.connected) {
        // Si no está conectado, conectar primero y luego reintentar
        this.connect();
        // Esperar a que se conecte
        const checkConnected = setInterval(() => {
          if (this.socket?.connected) {
            clearInterval(checkConnected);
            this.socket.emit(
              SocketEvents.RECONNECT,
              { sessionToken: token },
              (res: { success: boolean; playerId?: string; error?: string }) => {
                resolve(res);
              }
            );
          }
        }, 100);
        // Timeout de 5 segundos
        setTimeout(() => {
          clearInterval(checkConnected);
          resolve({ success: false, error: 'Timeout de conexión' });
        }, 5000);
        return;
      }

      this.socket.emit(
        SocketEvents.RECONNECT,
        { sessionToken: token },
        (res: { success: boolean; playerId?: string; error?: string }) => {
          resolve(res);
        }
      );
    });
  }

  // ============================================================
  // Sincronización en tiempo real
  // ============================================================

  /**
   * Envía la posición/rotación del jugador local al servidor.
   * El servidor actualiza su estado autoritativo y lo re-emite a los demás.
   */
  sendPlayerMove(
    position: { x: number; y: number; z: number },
    rotation: number,
    seq: number
  ): void {
    if (!this.socket?.connected) return;
    this.socket.emit(SocketEvents.PLAYER_MOVE, { position, rotation, seq });
  }

  /**
   * Envía un ataque al servidor para que lo procese y lo retransmita.
   */
  sendPlayerAttack(
    damage: number,
    position: { x: number; y: number; z: number },
    targetId?: string,
    seq?: number
  ): void {
    if (!this.socket?.connected) return;
    this.socket.emit(SocketEvents.PLAYER_ATTACK, { damage, position, targetId, seq });
  }

  // ============================================================
  // Estado
  // ============================================================

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getSocketId(): string | null {
    return this.socket?.id ?? null;
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.callbacks.onStatusChange?.(status);
  }
}
