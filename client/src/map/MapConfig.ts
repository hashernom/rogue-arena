/**
 * Tipos para la configuración de mapas/arenas cargados desde JSON.
 *
 * Cada mapa define:
 * - Tamaño del suelo
 * - Array de obstáculos (columnas, muros, etc.)
 * - Puntos de spawn para enemigos
 *
 * Formato del JSON:
 * ```json
 * {
 *   "name": "Arena 01",
 *   "size": { "width": 30, "height": 30 },
 *   "obstacles": [
 *     { "type": "box", "x": 5, "z": 5, "w": 2, "h": 2, "d": 2 }
 *   ],
 *   "spawnPoints": [
 *     { "x": -14, "z": 0 }
 *   ]
 * }
 * ```
 */

/** Tipo de obstáculo soportado */
export type ObstacleType = 'box' | 'cylinder';

/** Definición de un obstáculo en el mapa */
export interface MapObstacle {
  type: ObstacleType;
  /** Centro X en el plano del juego */
  x: number;
  /** Centro Z en el plano del juego */
  z: number;
  /** Ancho (eje X) en metros */
  w: number;
  /** Alto (eje Y) en metros */
  h: number;
  /** Profundidad (eje Z) en metros */
  d: number;
}

/** Punto de spawn para enemigos */
export interface SpawnPoint {
  x: number;
  z: number;
}

/** Configuración completa de un mapa */
export interface MapConfig {
  /** Nombre descriptivo del mapa */
  name: string;
  /** Tamaño del suelo de la arena */
  size: {
    width: number;
    height: number;
  };
  /** Lista de obstáculos estáticos */
  obstacles: MapObstacle[];
  /** Puntos de spawn para enemigos */
  spawnPoints: SpawnPoint[];
}
