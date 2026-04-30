import * as THREE from 'three';

// =================================================================
// INTERFACES
// =================================================================

/**
 * Representa un agente (enemigo) para cálculos de steering.
 * Solo contiene la información geométrica necesaria.
 */
export interface SteeringAgent {
  position: THREE.Vector3;
}

/**
 * Pesos para combinar steering forces.
 * Cada peso determina la influencia de ese comportamiento en la dirección final.
 */
export interface SteeringWeights {
  seek: number;
  separation: number;
  flee: number;
  strafe: number;
}

/**
 * Resultado de combinar steering forces.
 * La dirección está normalizada (o es zero si no hay movimiento).
 */
export interface SteeringResult {
  /** Dirección normalizada de movimiento (x, z) */
  direction: THREE.Vector2;
  /** Indica si hay dirección de movimiento válida */
  hasMovement: boolean;
}

// =================================================================
// CONSTANTES POR DEFECTO
// =================================================================

/** Pesos por defecto para enemigos cuerpo a cuerpo */
export const DEFAULT_MELEE_WEIGHTS: SteeringWeights = {
  seek: 1.0,
  separation: 1.2,
  flee: 0.0,
  strafe: 0.0,
};

/** Pesos por defecto para enemigos ranged */
export const DEFAULT_RANGED_WEIGHTS: SteeringWeights = {
  seek: 0.5,
  separation: 1.0,
  flee: 1.5,
  strafe: 1.0,
};

/** Radio de separación por defecto (0.8m) */
export const DEFAULT_SEPARATION_RADIUS = 0.8;

/** Máximo de vecinos a considerar para separación */
export const MAX_SEPARATION_NEIGHBORS = 5;

/** Distancia máxima de detección de obstáculos */
export const DEFAULT_AVOID_LOOK_AHEAD = 8;

/** Radio de influencia de repulsión de obstáculos */
export const DEFAULT_AVOID_RADIUS = 6;

/** Peso del avoidance al combinar fuerzas */
export const DEFAULT_AVOID_WEIGHT = 2.5;

// =================================================================
// FUNCIONES PURAS DE STEERING
// =================================================================

/**
 * Calcula la fuerza de seek (persecución) hacia un target.
 * Retorna un vector 2D (x, z) normalizado apuntando al target.
 *
 * @param agent - Posición del agente
 * @param target - Posición del objetivo
 * @returns Vector 2D normalizado hacia el target (o zero si ya está encima)
 */
export function seek(
  agent: SteeringAgent,
  target: THREE.Vector3
): THREE.Vector2 {
  const dx = target.x - agent.position.x;
  const dz = target.z - agent.position.z;
  const distSq = dx * dx + dz * dz;

  if (distSq < 0.0001) {
    return new THREE.Vector2(0, 0);
  }

  const dist = Math.sqrt(distSq);
  return new THREE.Vector2(dx / dist, dz / dist);
}

/**
 * Calcula la fuerza de flee (huida) desde un threat.
 * Retorna un vector 2D (x, z) normalizado alejándose del threat.
 *
 * @param agent - Posición del agente
 * @param threat - Posición de la amenaza
 * @returns Vector 2D normalizado alejándose del threat (o zero si ya está encima)
 */
export function flee(
  agent: SteeringAgent,
  threat: THREE.Vector3
): THREE.Vector2 {
  const dx = agent.position.x - threat.x;
  const dz = agent.position.z - threat.z;
  const distSq = dx * dx + dz * dz;

  if (distSq < 0.0001) {
    return new THREE.Vector2(0, 0);
  }

  const dist = Math.sqrt(distSq);
  return new THREE.Vector2(dx / dist, dz / dist);
}

/**
 * Calcula la fuerza de strafe (orbitar alrededor de un target).
 * Retorna un vector 2D (x, z) perpendicular a la dirección hacia el target.
 *
 * @param agent - Posición del agente
 * @param target - Posición del objetivo
 * @param direction - Dirección del strafe (+1 = derecha, -1 = izquierda)
 * @returns Vector 2D normalizado perpendicular a la dirección target->agente
 */
export function strafeAround(
  agent: SteeringAgent,
  target: THREE.Vector3,
  direction: number = 1
): THREE.Vector2 {
  const dx = target.x - agent.position.x;
  const dz = target.z - agent.position.z;
  const distSq = dx * dx + dz * dz;

  if (distSq < 0.0001) {
    return new THREE.Vector2(0, 0);
  }

  const dist = Math.sqrt(distSq);
  const dirX = dx / dist;
  const dirZ = dz / dist;

  // Perpendicular en 2D: (-dirZ, dirX) para izquierda, (dirZ, -dirX) para derecha
  return new THREE.Vector2(
    -dirZ * direction,
    dirX * direction
  );
}

/**
 * Calcula la fuerza de separación para evitar que los enemigos se apilen.
 * Solo considera los N vecinos más cercanos (maxNeighbors) dentro del radio.
 *
 * @param agent - Posición del agente
 * @param neighbors - Lista de agentes vecinos
 * @param radius - Radio de separación
 * @param maxNeighbors - Máximo de vecinos a considerar (default: 5)
 * @returns Vector 2D de fuerza de separación (sin normalizar, escala con proximidad)
 */
export function separation(
  agent: SteeringAgent,
  neighbors: SteeringAgent[],
  radius: number = DEFAULT_SEPARATION_RADIUS,
  maxNeighbors: number = MAX_SEPARATION_NEIGHBORS
): THREE.Vector2 {
  const result = new THREE.Vector2(0, 0);

  if (!neighbors || neighbors.length === 0) {
    return result;
  }

  const radiusSq = radius * radius;

  // Calcular distancia al cuadrado para cada vecino y filtrar los que están dentro del radio
  const closeNeighbors: { distSq: number; ex: number; ez: number }[] = [];

  for (let i = 0; i < neighbors.length; i++) {
    const other = neighbors[i];
    if (!other || !other.position) continue;

    const ex = agent.position.x - other.position.x;
    const ez = agent.position.z - other.position.z;
    const distSq = ex * ex + ez * ez;

    // Ignorar si está fuera del radio o es el mismo agente
    if (distSq < 0.0001 || distSq >= radiusSq) continue;

    closeNeighbors.push({ distSq, ex, ez });
  }

  if (closeNeighbors.length === 0) {
    return result;
  }

  // Ordenar por distancia (más cercanos primero) y limitar a maxNeighbors
  closeNeighbors.sort((a, b) => a.distSq - b.distSq);
  const limited = closeNeighbors.slice(0, maxNeighbors);

  // Calcular fuerza de separación para cada vecino
  for (const neighbor of limited) {
    const dist = Math.sqrt(neighbor.distSq);
    // La fuerza es inversamente proporcional a la distancia:
    // mientras más cerca, más fuerza de separación
    const strength = (radius - dist) / radius;
    result.x += (neighbor.ex / dist) * strength;
    result.y += (neighbor.ez / dist) * strength;
  }

  return result;
}

// \=================================================================
// OBSTACLE AVOIDANCE
// \=================================================================

/**
 * Calcula fuerza de evasión de obstáculos usando repulsión radial con
 * filtro de cono frontal.
 *
 * Detecta obstáculos dentro del cono de avance y genera una fuerza de
 * repulsión radial (desde el centro del obstáculo hacia afuera). A
 * diferencia de la proyección lateral pura, la repulsión radial tiene
 * componentes tanto laterales como de retroceso, lo que permite que el
 * enemigo se aleje del obstáculo mientras la fuerza de seek lo redirige
 * alrededor de él.
 *
 * @param agent - Posición del agente
 * @param obstacles - Array de posiciones {x, z} de obstáculos
 * @param seekDirection - Dirección de persecución actual (normalizada)
 * @param lookAhead - Distancia máxima de detección
 * @param avoidRadius - Radio de influencia de repulsión
 * @returns Vector 2D de fuerza de avoidance (sin normalizar)
 */
export function avoidObstacles(
  agent: SteeringAgent,
  obstacles: { x: number; z: number }[],
  seekDirection: THREE.Vector2,
  lookAhead: number = DEFAULT_AVOID_LOOK_AHEAD,
  avoidRadius: number = DEFAULT_AVOID_RADIUS
): THREE.Vector2 {
  const result = new THREE.Vector2(0, 0);
  if (!obstacles || obstacles.length === 0) return result;

  const radiusSq = avoidRadius * avoidRadius;

  for (let i = 0; i < obstacles.length; i++) {
    const obs = obstacles[i];

    // Vector desde el centro del obstáculo hacia el agente
    const dx = agent.position.x - obs.x;
    const dz = agent.position.z - obs.z;
    const distSq = dx * dx + dz * dz;

    // Ignorar si está demasiado lejos o encima del centro
    if (distSq < 0.01 || distSq > radiusSq) continue;

    const dist = Math.sqrt(distSq);

    // Verificar que el obstáculo esté en el cono frontal respecto a seekDirection
    const toObsX = obs.x - agent.position.x;
    const toObsZ = obs.z - agent.position.z;
    const toObsDist = Math.sqrt(toObsX * toObsX + toObsZ * toObsZ);
    const dot = (toObsX / toObsDist) * seekDirection.x + (toObsZ / toObsDist) * seekDirection.y;

    // Ignorar obstáculos detrás o demasiado lejos en el frente
    if (dot < 0 || toObsDist > lookAhead) continue;

    // Repulsión radial: más fuerte cuanto más cerca del obstáculo
    // Fade frontal: obstáculos directamente adelante tienen más peso
    const strength = (avoidRadius - dist) / avoidRadius;
    const fade = Math.max(0.1, dot);

    // (dx/dist, dz/dist) apunta desde obstáculo → agente = dirección de huida
    result.x += (dx / dist) * strength * fade;
    result.y += (dz / dist) * strength * fade;
  }

  return result;
}

// \=================================================================
// FUNCIONES DE COMBINACIÓN Y APLICACIÓN
// \=================================================================

/**
 * Combina múltiples steering forces con pesos y normaliza el resultado.
 * Esta función es pura — no modifica ningún estado externo.
 *
 * @param forces - Array de tuplas (force: Vector2, weight: number)
 * @returns Dirección 2D normalizada resultante
 */
export function combineForces(forces: [THREE.Vector2, number][]): SteeringResult {
  let totalX = 0;
  let totalZ = 0;

  for (const [force, weight] of forces) {
    totalX += force.x * weight;
    totalZ += force.y * weight;
  }

  const magnitudeSq = totalX * totalX + totalZ * totalZ;

  if (magnitudeSq < 0.0001) {
    return { direction: new THREE.Vector2(0, 0), hasMovement: false };
  }

  const magnitude = Math.sqrt(magnitudeSq);
  return {
    direction: new THREE.Vector2(totalX / magnitude, totalZ / magnitude),
    hasMovement: true,
  };
}

/**
 * Aplica aceleración suave a la velocidad actual hacia una dirección deseada.
 * Útil para movimiento no-snap (evita que los enemigos cambien de dirección instantáneamente).
 *
 * @param currentVel - Velocidad 2D actual (se modifica in-place para evitar alloc)
 * @param desiredDir - Dirección 2D deseada (normalizada)
 * @param maxSpeed - Velocidad máxima
 * @param maxAccel - Aceleración máxima (units/s²)
 * @param dt - Delta time en segundos
 * @returns La velocidad resultante (misma referencia que currentVel)
 */
export function applyAcceleration(
  currentVel: THREE.Vector2,
  desiredDir: THREE.Vector2,
  maxSpeed: number,
  maxAccel: number,
  dt: number
): THREE.Vector2 {
  // Calcular la velocidad deseada
  const targetVelX = desiredDir.x * maxSpeed;
  const targetVelZ = desiredDir.y * maxSpeed;

  // Calcular diferencia
  const diffX = targetVelX - currentVel.x;
  const diffZ = targetVelZ - currentVel.y;

  // Limitar por aceleración máxima
  const diffMag = Math.sqrt(diffX * diffX + diffZ * diffZ);
  if (diffMag > 0.0001) {
    const maxDelta = maxAccel * dt;
    const clampedDelta = Math.min(diffMag, maxDelta);
    const scale = clampedDelta / diffMag;

    currentVel.x += diffX * scale;
    currentVel.y += diffZ * scale;
  }

  return currentVel;
}
