// Tipos de eventos del juego, compartidos entre cliente y servidor
import { Vector3 } from '../index.js';

/** Alias para compatibilidad con Three.js y otros sistemas */
export type Vector3Like = Vector3;

/**
 * Mapa de eventos del juego con sus payloads tipados.
 * Cada clave es el nombre del evento, y el valor es el tipo de datos que se pasa al listener.
 */
export interface GameEvents {
  // Jugador
  "player:died": { playerId: string };
  "player:damaged": { playerId: string; amount: number };
  // Enemigos
  "enemy:died": { enemyId: string; position: Vector3Like; reward: number };
  // Oleadas
  "wave:started": { round: number; enemyCount: number };
  "wave:ended": { round: number };
  // Tienda
  "shop:opened": void;
  "shop:itemBought": { itemId: string; playerId: string };
  // Estado del juego
  "game:over": { rounds: number };
}