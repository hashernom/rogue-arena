import { EnemyType, EnemyStats } from '../enemies/Enemy';
import { ENEMY_BASIC_STATS } from '../enemies/EnemyBasic';
import { ENEMY_FAST_STATS } from '../enemies/EnemyFast';
import { ENEMY_TANK_STATS } from '../enemies/EnemyTank';
import { ENEMY_RANGED_STATS } from '../enemies/EnemyRanged';

// =================================================================
// MAPA DE STATS BASE POR TIPO DE ENEMIGO
// =================================================================

/**
 * Mapa que asocia cada tipo de enemigo con sus estadísticas base.
 * Se usa como fuente de verdad para los cálculos de escalado.
 */
/**
 * Mapa que asocia cada tipo de enemigo con sus estadísticas base.
 * Usamos Partial porque el enum EnemyType incluye variantes skeleton
 * (SkeletonMinion, SkeletonWarrior, etc.) que no se usan directamente
 * en el pool — solo Basic, Fast, Tank, Ranged están registrados.
 */
const BASE_STATS_MAP: Partial<Record<EnemyType, EnemyStats>> = {
  [EnemyType.Basic]: ENEMY_BASIC_STATS,
  [EnemyType.Fast]: ENEMY_FAST_STATS,
  [EnemyType.Tank]: ENEMY_TANK_STATS,
  [EnemyType.Ranged]: ENEMY_RANGED_STATS,
};

// =================================================================
// FUNCIONES DE ESCALADO INDIVIDUALES
// =================================================================

/**
 * Calcula el HP escalado para una ronda dada.
 * Fórmula: baseHP * 1.12^round
 * Cap: a partir de ronda 20, el HP no puede exceder baseHP * 8
 *
 * @param baseHP - HP base del enemigo
 * @param round - Número de ronda actual (1-based)
 * @returns HP escalado con cap aplicado si corresponde
 */
export function getScaledHP(baseHP: number, round: number): number {
  const scaled = baseHP * Math.pow(1.12, round);
  if (round >= 20) {
    return Math.min(scaled, baseHP * 8);
  }
  return scaled;
}

/**
 * Calcula la velocidad escalada para una ronda dada.
 * Fórmula: baseSpeed * 1.03^round
 * Cap: la velocidad no puede exceder baseSpeed * 2
 *
 * @param baseSpeed - Velocidad base del enemigo
 * @param round - Número de ronda actual (1-based)
 * @returns Velocidad escalada con cap aplicado
 */
export function getScaledSpeed(baseSpeed: number, round: number): number {
  const scaled = baseSpeed * Math.pow(1.03, round);
  return Math.min(scaled, baseSpeed * 2);
}

/**
 * Calcula el daño escalado para una ronda dada.
 * Fórmula: baseDamage * 1.08^round
 * Se redondea al entero más cercano.
 *
 * @param baseDamage - Daño base del enemigo
 * @param round - Número de ronda actual (1-based)
 * @returns Daño escalado redondeado
 */
export function getScaledDamage(baseDamage: number, round: number): number {
  return Math.round(baseDamage * Math.pow(1.08, round));
}

/**
 * Calcula la recompensa escalada para una ronda dada.
 * Fórmula: baseReward + floor(round / 3)
 * Cada 3 rondas, la recompensa base aumenta en 1.
 *
 * @param baseReward - Recompensa base del enemigo
 * @param round - Número de ronda actual (1-based)
 * @returns Recompensa escalada
 */
export function getScaledReward(baseReward: number, round: number): number {
  return baseReward + Math.floor(round / 3);
}

/**
 * Calcula el número de enemigos para una ronda dada.
 * Fórmula: 5 + (round * 2)
 *
 * @param round - Número de ronda actual (1-based)
 * @returns Cantidad de enemigos para la ronda
 */
export function getEnemyCountForRound(round: number): number {
  return 5 + round * 2;
}

/**
 * Calcula la recompensa total por completar una oleada.
 * Fórmula: 20 + (round * 5)
 *
 * @param round - Número de ronda actual (1-based)
 * @returns Recompensa total de la oleada
 */
export function getWaveReward(round: number): number {
  return 20 + round * 5;
}

// =================================================================
// FUNCIÓN PRINCIPAL: OBTENER STATS COMPLETOS PARA UNA RONDA
// =================================================================

/**
 * Obtiene las estadísticas completas y escaladas para un tipo de enemigo
 * en una ronda específica.
 *
 * Aplica todas las fórmulas de escalado (HP, velocidad, daño, recompensa)
 * y sus respectivos caps, devolviendo un objeto EnemyStats completo.
 *
 * @param type - Tipo de enemigo (Basic, Fast, Tank, Ranged)
 * @param round - Número de ronda actual (1-based)
 * @returns EnemyStats con todos los valores escalados para la ronda
 */
export function getEnemyStatsForRound(type: EnemyType, round: number): EnemyStats {
  const base = BASE_STATS_MAP[type];
  if (!base) {
    console.warn(`[DifficultyScaler] Tipo de enemigo desconocido: ${type}, retornando stats vacíos`);
    // Fallback: devolver stats con valores por defecto para evitar crash
    return {
      hp: 1,
      maxHp: 1,
      speed: 1,
      damage: 1,
      attackSpeed: 1,
      range: 1,
      armor: 0,
      knockbackResistance: 0,
      reward: 0,
    };
  }

  const scaledHP = getScaledHP(base.hp, round);

  return {
    ...base,
    hp: scaledHP,
    maxHp: scaledHP,
    speed: getScaledSpeed(base.speed, round),
    damage: getScaledDamage(base.damage, round),
    reward: getScaledReward(base.reward, round),
  };
}
