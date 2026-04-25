import { EventBus } from '../engine/EventBus';
import { EnemyType } from '../enemies/Enemy';
import { Spawner } from './Spawner';

/**
 * Configuración de una oleada de enemigos.
 */
export interface WaveConfig {
  /** Número de ronda */
  round: number;
  /** Si es una oleada de jefe */
  isBossWave: boolean;
  /** Grupos de enemigos a spawnear */
  enemyGroups: { type: EnemyType; count: number; spawnDelay: number }[];
  /** Tiempo de pausa entre oleadas en segundos */
  betweenRoundDuration: number;
}

/**
 * Estados del WaveManager.
 */
export enum WaveState {
  Inactive = 'inactive',
  WaveInProgress = 'wave_in_progress',
  BetweenRound = 'between_round',
}

/**
 * Genera la configuración de una oleada según la ronda.
 * @param round - Número de ronda (1-based)
 * @returns Configuración de la oleada
 */
export function generateWaveConfig(round: number): WaveConfig {
  const enemyCount = 5 + round * 2;

  // Progresión de enemigos especiales:
  // - Rondas 1-2: solo Básicos (100%)
  // - Ronda 3: aparecen primeros Fast (10%)
  // - Ronda 5: aparecen primeros Tank (5%)
  // - Ronda 7: aparecen primeros Ranged (5%)
  // - Las ratios escalan lentamente hasta rondas altas
  const basicRatio = round <= 2 ? 1.0 : Math.max(0.35, 0.85 - (round - 2) * 0.04);
  const fastRatio = round < 3 ? 0 : Math.min(0.30, (round - 2) * 0.04);
  const tankRatio = round < 5 ? 0 : Math.min(0.20, (round - 4) * 0.025);
  const rangedRatio = round < 7 ? 0 : Math.min(0.15, (round - 6) * 0.02);

  const groups: { type: EnemyType; count: number; spawnDelay: number }[] = [];

  const addGroup = (type: EnemyType, ratio: number) => {
    const count = Math.max(1, Math.round(enemyCount * ratio));
    if (count > 0) {
      groups.push({ type, count, spawnDelay: 0.5 });
    }
  };

  addGroup(EnemyType.Basic, basicRatio);
  addGroup(EnemyType.Fast, fastRatio);
  addGroup(EnemyType.Tank, tankRatio);
  addGroup(EnemyType.Ranged, rangedRatio);

  // Ajustar para que la suma total sea exacta
  // Si hay muy pocos básicos, los faltantes van a Básicos
  const currentTotal = groups.reduce((sum, g) => sum + g.count, 0);
  if (currentTotal < enemyCount) {
    const basicGroup = groups.find(g => g.type === EnemyType.Basic);
    if (basicGroup) {
      basicGroup.count += enemyCount - currentTotal;
    } else {
      groups.push({ type: EnemyType.Basic, count: enemyCount - currentTotal, spawnDelay: 0.5 });
    }
  }

  const isBossWave = round % 5 === 0;

  // En oleadas de jefe, agregar un grupo extra de Tanques
  if (isBossWave) {
    const bossCount = Math.ceil(round / 5);
    groups.push({ type: EnemyType.Tank, count: bossCount, spawnDelay: 1.0 });
  }

  return {
    round,
    isBossWave,
    enemyGroups: groups,
    betweenRoundDuration: 5,
  };
}

/**
 * Gestor central de oleadas.
 * Lee una configuración declarativa y orquesta el progreso del juego.
 *
 * Estados: Inactive → WaveInProgress → BetweenRound → WaveInProgress → ...
 *
 * El WaveManager delega el spawn visual al Spawner.
 */
export class WaveManager {
  private eventBus: EventBus;
  private spawner: Spawner;
  private state: WaveState = WaveState.Inactive;
  private currentRound: number = 0;
  private remainingEnemies: number = 0;
  private totalEnemiesInWave: number = 0;
  private betweenRoundTimer: number = 0;
  private currentWaveConfig: WaveConfig | null = null;
  private isSpawning: boolean = false;

  constructor(eventBus: EventBus, spawner: Spawner) {
    this.eventBus = eventBus;
    this.spawner = spawner;
  }

  /**
   * Inicia una nueva oleada.
   * @param round - Número de ronda a iniciar
   */
  startWave(round: number): void {
    if (this.state === WaveState.WaveInProgress) {
      console.warn(`[WaveManager] Ya hay una oleada en progreso (ronda ${this.currentRound})`);
      return;
    }

    this.currentRound = round;
    this.currentWaveConfig = generateWaveConfig(round);
    this.state = WaveState.WaveInProgress;
    this.isSpawning = true;

    this.totalEnemiesInWave = this.currentWaveConfig.enemyGroups.reduce(
      (sum, g) => sum + g.count, 0
    );
    this.remainingEnemies = this.totalEnemiesInWave;

    // Delegar el spawn visual al Spawner
    this.spawner.spawnWave(this.currentWaveConfig);

    console.log(
      `[WaveManager] Ronda ${round} iniciada: ${this.totalEnemiesInWave} enemigos` +
      (this.currentWaveConfig.isBossWave ? ' [BOSS WAVE]' : '')
    );

    this.eventBus.emit('wave:started', {
      round,
      enemyCount: this.totalEnemiesInWave,
    });
  }

  /**
   * Notifica al WaveManager que un enemigo ha muerto.
   */
  onEnemyDied(): void {
    if (this.state !== WaveState.WaveInProgress) return;

    this.remainingEnemies--;

    if (this.remainingEnemies <= 0 && !this.isSpawning) {
      this.endWave();
    }
  }

  /**
   * Obtiene la cantidad de enemigos restantes en la oleada actual.
   */
  getRemainingEnemies(): number {
    return this.remainingEnemies;
  }

  /**
   * Obtiene el estado actual del WaveManager.
   */
  getState(): WaveState {
    return this.state;
  }

  /**
   * Obtiene la ronda actual.
   */
  getCurrentRound(): number {
    return this.currentRound;
  }

  /**
   * Obtiene la configuración de la oleada actual.
   */
  getCurrentWaveConfig(): WaveConfig | null {
    return this.currentWaveConfig;
  }

  /**
   * Obtiene el total de enemigos en la oleada actual.
   */
  getTotalEnemiesInWave(): number {
    return this.totalEnemiesInWave;
  }

  /**
   * Actualiza el WaveManager cada frame.
   * @param dt - Delta time en segundos
   */
  update(dt: number): void {
    switch (this.state) {
      case WaveState.WaveInProgress:
        this.updateSpawning(dt);
        break;
      case WaveState.BetweenRound:
        this.updateBetweenRound(dt);
        break;
      default:
        break;
    }
  }

  /**
   * Actualiza la lógica de spawn durante una oleada.
   * El Spawner maneja los temporizadores de indicadores visuales y animaciones.
   * El WaveManager solo verifica si ya no hay enemigos por spawnear.
   */
  private updateSpawning(_dt: number): void {
    // Verificar si el Spawner ya terminó de encolar todos los enemigos
    // El Spawner procesa su propia cola internamente en su update()
    if (this.remainingEnemies <= 0) {
      this.isSpawning = false;
      this.endWave();
    }
  }

  /**
   * Actualiza el timer entre rondas.
   */
  private updateBetweenRound(dt: number): void {
    this.betweenRoundTimer -= dt;

    if (this.betweenRoundTimer <= 0) {
      // Iniciar siguiente ronda automáticamente
      this.startWave(this.currentRound + 1);
    }
  }

  /**
   * Finaliza la oleada actual y transiciona a BetweenRound.
   */
  private endWave(): void {
    if (this.state !== WaveState.WaveInProgress) return;

    this.state = WaveState.BetweenRound;
    this.isSpawning = false;
    this.betweenRoundTimer = this.currentWaveConfig?.betweenRoundDuration ?? 5;

    console.log(`[WaveManager] Ronda ${this.currentRound} completada`);

    this.eventBus.emit('wave:ended', {
      round: this.currentRound,
    });
  }

  /**
   * Inicia el juego desde la ronda 1.
   */
  startGame(): void {
    this.state = WaveState.Inactive;
    this.currentRound = 0;
    this.remainingEnemies = 0;
    this.isSpawning = false;
    this.startWave(1);
  }

  /**
   * Resetea el WaveManager a su estado inicial.
   */
  reset(): void {
    this.state = WaveState.Inactive;
    this.currentRound = 0;
    this.remainingEnemies = 0;
    this.totalEnemiesInWave = 0;
    this.betweenRoundTimer = 0;
    this.currentWaveConfig = null;
    this.isSpawning = false;
    this.spawner.reset();
  }
}
