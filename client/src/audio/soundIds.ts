/**
 * IDs de sonido del juego.
 * Cada constante corresponde a un AudioBuffer cacheados por AudioManager.
 */
export const SoundId = {
  /** Golpe cuerpo a cuerpo */
  HitMelee: 'hit_melee',
  /** Proyectil (flecha) */
  ShootArrow: 'shoot_arrow',
  /** Impacto de proyectil */
  HitProjectile: 'hit_projectile',
  /** Enemigo recibe daño */
  EnemyHit: 'enemy_hit',
  /** Enemigo muere */
  EnemyDeath: 'enemy_death',
  /** MiniBoss muerte */
  BossDeath: 'boss_death',
  /** Jugador recibe daño */
  PlayerHit: 'player_hit',
  /** Jugador muere */
  PlayerDeath: 'player_death',
  /** Inicio de oleada */
  WaveStart: 'wave_start',
  /** Oleada completada */
  WaveComplete: 'wave_complete',
  /** Comprar ítem en tienda */
  Purchase: 'purchase',
  /** Recoger moneda */
  CoinPickup: 'coin_pickup',
  /** Usar habilidad */
  AbilityUse: 'ability_use',
  /** Habilidad lista (cooldown terminado) */
  AbilityReady: 'ability_ready',
  /** Clic en UI */
  UIClick: 'ui_click',
  /** Botón hover */
  UIHover: 'ui_hover',
} as const;

export type SoundId = (typeof SoundId)[keyof typeof SoundId];
