import RAPIER from '@dimforge/rapier3d-compat';

/**
 * Grupos de colisión definidos como bits individuales.
 * Cada entidad pertenece a uno o más grupos (usando OR de bits).
 *
 * Ejemplo:
 *   - PLAYER: 0b000001 (1)
 *   - ENEMY:  0b000010 (2)
 *   - PROJECTILE: 0b000100 (4)
 *   - WALL:   0b001000 (8)
 *   - PICKUP: 0b010000 (16)
 *   - SENSOR: 0b100000 (32)
 *
 * Máscaras definen con qué grupos puede colisionar cada entidad.
 * Se calculan como OR de los grupos con los que debe interactuar.
 */
export const Groups = {
  PLAYER: 0b000001, // 1
  ENEMY: 0b000010, // 2
  PROJECTILE: 0b000100, // 4
  WALL: 0b001000, // 8
  PICKUP: 0b010000, // 16
  SENSOR: 0b100000, // 32
  ENEMY_PROJECTILE: 0b1000000, // 64
} as const;

export type CollisionGroup = (typeof Groups)[keyof typeof Groups];

/**
 * Máscaras de colisión que definen qué grupos interactúan con cada entidad.
 *
 * Reglas de interacción:
 * - PLAYER: colisiona con ENEMY, WALL, PICKUP (no con PROJECTILE para evitar daño propio)
 * - ENEMY: colisiona con PLAYER, WALL, PROJECTILE (no con otros ENEMY para evitar empuje)
 * - PROJECTILE: colisiona con ENEMY, WALL (no con PLAYER ni otros PROJECTILE)
 * - WALL: colisiona con todo (máscara completa)
 * - PICKUP: solo colisiona con PLAYER
 * - SENSOR: (futuro) para triggers de área, no colisiona físicamente
 */
export const Masks = {
  PLAYER: Groups.ENEMY | Groups.WALL | Groups.PICKUP | Groups.ENEMY_PROJECTILE,
  ENEMY: Groups.PLAYER | Groups.WALL | Groups.PROJECTILE,
  PROJECTILE: Groups.ENEMY | Groups.WALL,
  WALL: 0xffffffff, // colisiona con todo (máscara de 32 bits)
  PICKUP: Groups.PLAYER,
  SENSOR: 0, // por defecto no colisiona con nada (se puede configurar según necesidad)
  ENEMY_PROJECTILE: Groups.PLAYER | Groups.WALL,
} as const;

export type CollisionMask = (typeof Masks)[keyof typeof Masks];

/**
 * Helper para crear el número de InteractionGroups de Rapier.
 * @param membership Grupo(s) al que pertenece este collider (puede ser combinación con OR)
 * @param filter Máscara de grupos con los que puede colisionar (por defecto 0xFFFF = todos los grupos de 16 bits)
 * @returns Número de 32 bits donde los 16 bits superiores son membership y los 16 inferiores son filter
 */
export function makeCollisionGroups(
  membership: CollisionGroup | number,
  filter?: CollisionMask | number
): number {
  const m = membership & 0xffff; // asegurar 16 bits
  const f = (filter ?? 0xffff) & 0xffff;
  return (m << 16) | f;
}

/**
 * Función de conveniencia para obtener la máscara predefinida para un grupo.
 * @param group Nombre del grupo (ej: 'PLAYER')
 * @returns Máscara correspondiente
 */
export function getMaskForGroup(group: keyof typeof Groups): CollisionMask {
  return Masks[group];
}

/**
 * Función de conveniencia para crear un collider Rapier con grupos predefinidos.
 * Útil para integrar con PhysicsWorld.
 * @param colliderDesc Descripción del collider Rapier
 * @param group Nombre del grupo (ej: 'PLAYER')
 * @returns El mismo colliderDesc con los grupos de colisión configurados
 */
export function setupColliderGroups(
  colliderDesc: RAPIER.ColliderDesc,
  group: keyof typeof Groups
): RAPIER.ColliderDesc {
  const membership = Groups[group];
  const filter = Masks[group];
  const groups = makeCollisionGroups(membership, filter);
  return colliderDesc.setCollisionGroups(groups);
}

/**
 * Documentación de interacciones:
 *
 * 1. PLAYER:
 *    - Colisiona con ENEMY (para recibir daño)
 *    - Colisiona con WALL (para navegación)
 *    - Colisiona con PICKUP (para recolectar items)
 *    - NO colisiona con PROJECTILE (para evitar daño propio)
 *    - NO colisiona con otros PLAYER (multijugador futuro)
 *
 * 2. ENEMY:
 *    - Colisiona con PLAYER (para infligir daño)
 *    - Colisiona con WALL (para navegación)
 *    - Colisiona con PROJECTILE (para recibir daño)
 *    - NO colisiona con otros ENEMY (evita empuje, separación manejada por steering)
 *
 * 3. PROJECTILE:
 *    - Colisiona con ENEMY (para infligir daño)
 *    - Colisiona con WALL (para destruirse al impactar)
 *    - NO colisiona con PLAYER (evita daño al jugador que disparó)
 *    - NO colisiona con otros PROJECTILE (evita interferencias)
 *
 * 4. WALL:
 *    - Colisiona con todo (es un obstáculo universal)
 *
 * 5. PICKUP:
 *    - Solo colisiona con PLAYER (para ser recolectado)
 *    - NO colisiona con ENEMY, PROJECTILE, WALL, etc.
 *
 * 6. SENSOR:
 *    - Por defecto no colisiona (se usa para triggers de área)
 *    - Puede configurarse para interactuar con grupos específicos
 */
