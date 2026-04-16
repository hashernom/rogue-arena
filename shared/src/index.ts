// Tipos compartidos entre cliente y servidor

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
  WAVE_END = 'wave:end'
}