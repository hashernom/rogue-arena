// Tipos compartidos entre cliente y servidor
// NOTA: Copia local para evitar dependencia del workspace @rogue-arena/shared
// en entornos de build como Vercel donde el Root Directory es client/

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Player {
  id: string;
  name: string;
  position: Vector3;
  health: number;
  maxHealth: number;
}

export interface GameState {
  players: Player[];
  wave: number;
  timeRemaining: number;
}

// ============================================================
// Tipos para sincronización en tiempo real (Snapshot)
// ============================================================

export interface SnapshotPlayer {
  id: string;
  name: string;
  position: Vector3;
  rotation: number;
  health: number;
  maxHealth: number;
  alive: boolean;
  /** Último sequence number procesado por el servidor para este jugador */
  lastProcessedSeq: number;
}

export interface SnapshotEnemy {
  id: string;
  type: string;
  position: Vector3;
  rotation: number;
  health: number;
  alive: boolean;
}

export interface SnapshotWave {
  round: number;
  active: boolean;
  enemyCount: number;
  enemiesAlive: number;
}

export interface GameStateSnapshot {
  players: SnapshotPlayer[];
  enemies: SnapshotEnemy[];
  wave: SnapshotWave;
  timestamp: number;
}

// Eventos de Socket.io
export enum SocketEvents {
  CONNECT = 'connect',
  DISCONNECT = 'disconnect',
  PLAYER_JOIN = 'player:join',
  PLAYER_LEAVE = 'player:leave',
  PLAYER_MOVE = 'player:move',
  PLAYER_ATTACK = 'player:attack',
  GAME_STATE = 'game:state',
  WAVE_START = 'wave:start',
  WAVE_END = 'wave:end',
  // Eventos de sala (room system)
  ROOM_CREATED = 'room:created',
  ROOM_JOIN = 'room:join',
  ROOM_LEAVE = 'room:leave',
  ROOM_READY = 'room:ready',
  ROOM_CLOSED = 'room:closed',
  ROOM_PLAYERS = 'room:players',
  ROOM_PLAYER_LEFT = 'room:playerLeft',
  ROOM_CHARACTERS_READY = 'room:charactersReady',
  // Selección de personaje
  PLAYER_SELECT_CHARACTER = 'player:selectCharacter',
  PLAYER_CHARACTER_SELECTED = 'player:characterSelected',
  // Juego
  GAME_STARTED = 'game:started',
  // Desconexión / Reconexión
  PLAYER_DISCONNECTED = 'player:disconnected',
  PLAYER_RECONNECTED = 'player:reconnected',
  GAME_OVER = 'game:over',
  RECONNECT_TIMEOUT = 'reconnect:timeout',
  // Reconexión
  RECONNECT = 'reconnect:attempt',
  RECONNECT_RESULT = 'reconnect:result',
}
