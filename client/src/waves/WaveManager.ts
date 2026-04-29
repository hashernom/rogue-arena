import { EventBus } from '../engine/EventBus';
import { EnemyType } from '../enemies/Enemy';
import { Spawner } from './Spawner';
import { Character } from '../characters/Character';
import { MoneySystem } from '../progression/MoneySystem';
import { EnemyPool } from '../enemies/EnemyPool';

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
  // Progresión suave de cantidad de enemigos:
  // Ronda 1: 4 enemigos, Ronda 5: 10, Ronda 10: 18, Ronda 20: 34
  const enemyCount = 3 + Math.floor(round * 1.5);

  // Progresión de enemigos especiales (más lenta y controlada):
  // - Rondas 1-3: solo Básicos (100%)
  // - Ronda 4: primeros Fast (1 por cada ~8 enemigos)
  // - Ronda 7: primeros Tank (1 por cada ~10 enemigos)
  // - Ronda 10: primeros Ranged (1 por cada ~12 enemigos)
  // - Las ratios escalan muy lentamente
  const basicRatio = round <= 3 ? 1.0 : Math.max(0.40, 0.90 - (round - 3) * 0.035);
  const fastRatio = round < 4 ? 0 : Math.min(0.25, (round - 3) * 0.03);
  const tankRatio = round < 7 ? 0 : Math.min(0.18, (round - 6) * 0.02);
  const rangedRatio = round < 10 ? 0 : Math.min(0.12, (round - 9) * 0.015);

  const groups: { type: EnemyType; count: number; spawnDelay: number }[] = [];

  const addGroup = (type: EnemyType, ratio: number) => {
    if (ratio <= 0) return;
    const rawCount = Math.round(enemyCount * ratio);
    // Solo agregar el grupo si produce al menos 1 enemigo de forma natural
    if (rawCount >= 1) {
      groups.push({ type, count: rawCount, spawnDelay: 0.5 });
    }
  };

  // Siempre agregar Básicos primero
  const basicCount = Math.max(1, Math.round(enemyCount * basicRatio));
  groups.push({ type: EnemyType.Basic, count: basicCount, spawnDelay: 0.5 });

  addGroup(EnemyType.Fast, fastRatio);
  addGroup(EnemyType.Tank, tankRatio);
  addGroup(EnemyType.Ranged, rangedRatio);

  // Ajustar para que la suma total sea exacta
  const currentTotal = groups.reduce((sum, g) => sum + g.count, 0);
  if (currentTotal < enemyCount) {
    const basicGroup = groups.find(g => g.type === EnemyType.Basic);
    if (basicGroup) {
      basicGroup.count += enemyCount - currentTotal;
    }
  }

  const isBossWave = round % 5 === 0;

  // En oleadas de jefe (rondas 5, 10, 15...):
  // - Spawnear 1 MiniBoss con delay inicial
  // - Reducir a la mitad los enemigos normales
  if (isBossWave) {
    for (let i = 0; i < groups.length; i++) {
      groups[i].count = Math.max(1, Math.floor(groups[i].count / 2));
    }
    groups.push({ type: EnemyType.MiniBoss, count: 1, spawnDelay: 2.0 });
  }

  return {
    round,
    isBossWave,
    enemyGroups: groups,
    betweenRoundDuration: 15,
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

  // Sistema de economía
  private moneySystem: MoneySystem | null = null;

  // Pool de enemigos (para limpiar enemigos al forzar avance de ronda)
  private enemyPool: EnemyPool | null = null;

  // Límite de tiempo por ronda
  private roundTimeLimit: number = 0;
  private roundTimer: number = 0;

  constructor(eventBus: EventBus, spawner: Spawner) {
    this.eventBus = eventBus;
    this.spawner = spawner;
  }

  /**
   * Vincula el sistema de economía al WaveManager.
   * @param moneySystem - Instancia del MoneySystem
   */
  setMoneySystem(moneySystem: MoneySystem): void {
    this.moneySystem = moneySystem;
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
   * Vincula el pool de enemigos al WaveManager para poder
   * limpiar enemigos al forzar el avance de ronda.
   * @param enemyPool - Instancia del EnemyPool
   */
  setEnemyPool(enemyPool: EnemyPool): void {
    this.enemyPool = enemyPool;
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

    // Inicializar timer de límite de tiempo por ronda
    // Base: 60s + 10s por ronda (ronda 1 = 70s, ronda 5 = 110s, etc.)
    this.roundTimeLimit = 60 + round * 10;
    this.roundTimer = this.roundTimeLimit;

    // Comunicar la ronda actual al Spawner para escalado de dificultad
    this.spawner.setCurrentRound(round);

    // Delegar el spawn visual al Spawner
    this.spawner.spawnWave(this.currentWaveConfig);

    console.log(
      `[WaveManager] Ronda ${round} iniciada: ${this.totalEnemiesInWave} enemigos` +
      (this.currentWaveConfig.isBossWave ? ' [BOSS WAVE]' : '') +
      ` | Tiempo límite: ${this.roundTimeLimit}s`
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
   * Obtiene el timer restante de la ronda actual (en segundos).
   * @returns Tiempo restante en segundos, o 0 si no hay ronda activa
   */
  getRoundTimer(): number {
    return this.state === WaveState.WaveInProgress ? Math.max(0, this.roundTimer) : 0;
  }

  /**
   * Obtiene el tiempo límite total de la ronda actual (en segundos).
   */
  getRoundTimeLimit(): number {
    return this.roundTimeLimit;
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
 * Fuerza el inicio de la siguiente ronda inmediatamente.
 * Funciona en cualquier estado:
 * - WaveInProgress: fuerza el fin de la ronda actual (mata enemigos restantes)
 *   y automáticamente inicia la siguiente.
 * - BetweenRound: salta el timer de espera.
 * Útil para testing y depuración.
 */
forceNextWave(): void {
  if (this.state === WaveState.Inactive) {
    console.warn('[WaveManager] No se puede forzar: el juego no ha iniciado');
    return;
  }

  console.log(`[WaveManager] Forzando avance de ronda ${this.currentRound} → ${this.currentRound + 1}...`);

  // Limpiar todos los enemigos actuales de la escena
  if (this.enemyPool) {
    this.enemyPool.releaseAll();
    console.log('[WaveManager] Enemigos actuales eliminados de la escena');
  }

  if (this.state === WaveState.WaveInProgress) {
    // Forzar fin de la ronda actual
    this.remainingEnemies = 0;
    this.isSpawning = false;
    this.endWave();
    // Poner timer a 0 para que en el próximo update() se inicie
    // la siguiente ronda automáticamente (sin esperar 15s)
    this.betweenRoundTimer = 0;
  } else if (this.state === WaveState.BetweenRound) {
    // Saltar timer entre rondas
    this.betweenRoundTimer = 0;
  }
}


  /**
   * Actualiza el WaveManager cada frame.
   * @param dt - Delta time en segundos
   */
  update(dt: number): void {
    switch (this.state) {
      case WaveState.WaveInProgress:
        this.updateSpawning(dt);
        // Decrementar timer de límite de tiempo
        this.roundTimer -= dt;
        if (this.roundTimer <= 0) {
          this.roundTimer = 0;
          console.log(`[WaveManager] ⏰ Tiempo límite de ronda ${this.currentRound} agotado!`);
          // Forzar fin de ronda: marcar remainingEnemies a 0
          this.remainingEnemies = 0;
          this.isSpawning = false;
          this.endWave();
        }
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
    // Si todos los enemigos de la wave han muerto, finalizar la ronda.
    // NOTA: onEnemyDied() también verifica !this.isSpawning para evitar
    // transición prematura durante el spawning activo, pero este método
    // es el mecanismo de respaldo cuando isSpawning sigue true.
    if (this.remainingEnemies <= 0) {
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

    // Limpiar spawns pendientes del Spawner antes de transicionar
    this.spawner.reset();

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

    // Aplicar recompensa de ronda a ambos jugadores (con protección contra duplicación)
    if (this.moneySystem) {
      this.moneySystem.applyWaveReward(this.currentRound, reward);
    }

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

    // Limpiar efectos de una sola ronda (ej: Elixir Doble)
    for (const player of this.players) {
      if (player) {
        if (player.doubleDropNextWave) {
          console.log(`[WaveManager] Limpiando doubleDropNextWave de ${player.id}`);
          player.doubleDropNextWave = false;
        }
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
    this.roundTimeLimit = 0;
    this.roundTimer = 0;
    this.spawner.reset();
  }
}
