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
  'player:died': { playerId: string };
  'player:damaged': { playerId: string; amount: number };
  'player:attack': { playerId: string; damage: number; position: Vector3Like };
  'player:attack:start': { playerId: string };
  // Enemigos
  'enemy:died': { enemyId: string; position: Vector3Like; reward: number; attackerId?: string };
  'enemy:damage': { enemyId: string; damage: number; attackerId: string; position: Vector3Like; isCritical?: boolean };
  // Oleadas
  'wave:started': { round: number; enemyCount: number };
  'wave:ended': { round: number; reward: number };
  // Tienda
  'shop:opened': void;
  'shop:closed': void;
  'shop:itemBought': { itemId: string; playerId: string };
  // Dinero
  'money:changed': { playerId: string; newBalance: number; delta: number; reason: string };
  // Estado del juego
  'game:over': { rounds: number };
}
