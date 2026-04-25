import { EventBus } from '../engine/EventBus';
import { EnemyType } from '../enemies/Enemy';
import { Spawner } from './Spawner';
import { Character } from '../characters/Character';

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
    betweenRoundDuration: 15, // 15 segundos entre rondas
  };
}

/**
 * Calcula la recompensa en monedas para una ronda completada.
 * @param round - Número de ronda completada
 * @param enemyCount - Cantidad de enemigos en la ronda
 * @returns Monedas otorgadas
 */
export function calculateWaveReward(round: number, enemyCount: number): number {
  // Base: 10 monedas + 5 por ronda + 1 por enemigo
  return 10 + round * 5 + enemyCount;
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

  // Ready-up system
  private player1Ready: boolean = false;
  private player2Ready: boolean = false;
  private players: Character[] = [];

  constructor(eventBus: EventBus, spawner: Spawner) {
    this.eventBus = eventBus;
    this.spawner = spawner;
  }

  /**
   * Establece las referencias a los personajes jugadores para
   * aplicar curación entre rondas.
   * @param players - Array con los personajes de los jugadores
   */
  setPlayers(players: Character[]): void {
    this.players = players;
  }

  /**
   * Marca a un jugador como listo (Ready) durante el período entre rondas.
   * Cuando ambos jugadores están listos, se salta el timer.
   * @param playerIndex - Índice del jugador (0 o 1)
   */
  setPlayerReady(playerIndex: number): void {
    if (this.state !== WaveState.BetweenRound) return;

    if (playerIndex === 0) {
      this.player1Ready = true;
    } else if (playerIndex === 1) {
      this.player2Ready = true;
    }

    // Si ambos jugadores están listos, saltar el timer
    if (this.player1Ready && this.player2Ready) {
      this.betweenRoundTimer = 0;
    }
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

    // Comunicar la ronda actual al Spawner para escalado de dificultad
    this.spawner.setCurrentRound(round);

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
   * Obtiene el timer restante entre rondas (en segundos).
   */
  getBetweenRoundTimer(): number {
    return this.betweenRoundTimer;
  }

  /**
   * Obtiene el estado de ready de los jugadores.
   */
  getReadyState(): { player1Ready: boolean; player2Ready: boolean } {
    return {
      player1Ready: this.player1Ready,
      player2Ready: this.player2Ready,
    };
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
   * Cuando el timer llega a 0, inicia la siguiente ronda.
   */
  private updateBetweenRound(dt: number): void {
    this.betweenRoundTimer -= dt;

    if (this.betweenRoundTimer <= 0) {
      this.betweenRoundTimer = 0;

      // Cerrar la tienda antes de iniciar la siguiente ronda
      this.eventBus.emit('shop:closed', undefined);

      // Iniciar siguiente ronda automáticamente
      this.startWave(this.currentRound + 1);
    }
  }

  /**
   * Finaliza la oleada actual y transiciona a BetweenRound.
   * Calcula la recompensa, aplica cura del 20% a los jugadores,
   * y abre la tienda.
   */
  private endWave(): void {
    if (this.state !== WaveState.WaveInProgress) return;

    const reward = calculateWaveReward(this.currentRound, this.totalEnemiesInWave);

    this.state = WaveState.BetweenRound;
    this.isSpawning = false;
    this.betweenRoundTimer = this.currentWaveConfig?.betweenRoundDuration ?? 15;

    // Resetear ready-up para la nueva ronda
    this.player1Ready = false;
    this.player2Ready = false;

    console.log(
      `[WaveManager] Ronda ${this.currentRound} completada. Recompensa: ${reward} monedas`
    );

    // Emitir wave:ended con la recompensa
    this.eventBus.emit('wave:ended', {
      round: this.currentRound,
      reward,
    });

    // Aplicar cura del 20% de la vida máxima a cada jugador
    for (const player of this.players) {
      if (player) {
        const maxHp = player.getEffectiveStat('maxHp');
        const healAmount = Math.round(maxHp * 0.2);
        player.heal(healAmount);
        console.log(
          `[WaveManager] ${player.constructor.name} curado ${healAmount} HP (20% de ${maxHp})`
        );
      }
    }

    // Abrir la tienda
    this.eventBus.emit('shop:opened', undefined);
  }

  /**
   * Inicia el juego desde la ronda 1.
   */
  startGame(): void {
    this.state = WaveState.Inactive;
    this.currentRound = 0;
    this.remainingEnemies = 0;
    this.isSpawning = false;
    this.player1Ready = false;
    this.player2Ready = false;
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
    this.player1Ready = false;
    this.player2Ready = false;
    this.players = [];
    this.spawner.reset();
  }
}
