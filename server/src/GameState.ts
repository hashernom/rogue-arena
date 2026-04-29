/**
 * GameState: Estado autoritativo del juego.
 * El servidor es la fuente de verdad para posiciones, salud, oleadas, etc.
 * Los clientes envían inputs, el servidor valida y actualiza el estado.
 */
import { Vector3 } from '@rogue-arena/shared';
import { logger } from './logger.js';

// ============================================================
// Interfaces de estado
// ============================================================

export interface ServerPlayer {
  id: string;
  socketId: string;
  name: string;
  position: Vector3;
  rotation: number;
  health: number;
  maxHealth: number;
  speed: number;
  damage: number;
  alive: boolean;
  lastInputSeq: number;
}

export interface ServerEnemy {
  id: string;
  type: 'basic' | 'fast' | 'tank' | 'ranged' | 'miniboss';
  position: Vector3;
  rotation: number;
  health: number;
  maxHealth: number;
  speed: number;
  damage: number;
  alive: boolean;
  targetId: string | null;
}

export interface WaveConfig {
  round: number;
  enemyCount: number;
  enemiesSpawned: number;
  enemiesAlive: number;
  active: boolean;
  startedAt: number;
}

export interface GameStateSnapshot {
  players: Array<{
    id: string;
    name: string;
    position: Vector3;
    rotation: number;
    health: number;
    maxHealth: number;
    alive: boolean;
  }>;
  enemies: Array<{
    id: string;
    type: string;
    position: Vector3;
    rotation: number;
    health: number;
    alive: boolean;
  }>;
  wave: {
    round: number;
    active: boolean;
    enemyCount: number;
    enemiesAlive: number;
  };
  timestamp: number;
}

// ============================================================
// Configuración de oleadas
// ============================================================

const WAVE_BASE_ENEMIES = 5;
const WAVE_ENEMY_INCREMENT = 3;
const WAVE_SPAWN_INTERVAL_MS = 800;
const WAVE_PREP_TIME_MS = 10_000; // 10 segundos entre oleadas

// ============================================================
// GameState class
// ============================================================

export class GameState {
  public players: Map<string, ServerPlayer> = new Map();
  public enemies: Map<string, ServerEnemy> = new Map();
  public wave: WaveConfig = {
    round: 0,
    enemyCount: 0,
    enemiesSpawned: 0,
    enemiesAlive: 0,
    active: false,
    startedAt: 0,
  };

  private nextEnemyId = 0;
  private spawnTimer: ReturnType<typeof setInterval> | null = null;
  private waveTimer: ReturnType<typeof setTimeout> | null = null;
  private onStateChange: (() => void) | null = null;
  /** Indica si el juego está pausado (por desconexión) */
  public paused = false;

  // Callbacks para notificar al RoomManager / GameServer
  public onWaveStart: ((round: number, count: number) => void) | null = null;
  public onWaveEnd: ((round: number) => void) | null = null;
  public onEnemyDied: ((enemyId: string, position: Vector3, reward: number, attackerId?: string) => void) | null = null;
  public onPlayerDied: ((playerId: string) => void) | null = null;

  constructor(onStateChange?: () => void) {
    this.onStateChange = onStateChange ?? null;
  }

  // ============================================================
  // Jugadores
  // ============================================================

  addPlayer(id: string, socketId: string, name: string): ServerPlayer {
    const player: ServerPlayer = {
      id,
      socketId,
      name,
      position: { x: 0, y: 0, z: 0 },
      rotation: 0,
      health: 100,
      maxHealth: 100,
      speed: 5,
      damage: 10,
      alive: true,
      lastInputSeq: 0,
    };
    this.players.set(id, player);
    logger.info(`Player ${id} (${name}) added to game state`);
    this.notifyChange();
    return player;
  }

  removePlayer(id: string): void {
    this.players.delete(id);
    logger.info(`Player ${id} removed from game state`);
    this.notifyChange();
  }

  getPlayer(id: string): ServerPlayer | undefined {
    return this.players.get(id);
  }

  getAlivePlayers(): ServerPlayer[] {
    return Array.from(this.players.values()).filter(p => p.alive);
  }

  updatePlayerPosition(id: string, position: Vector3, rotation: number, seq: number): void {
    const player = this.players.get(id);
    if (!player || !player.alive) return;

    // Validar que el sequence number sea mayor al último (evitar reordenamiento)
    if (seq <= player.lastInputSeq) return;

    player.position = { ...position };
    player.rotation = rotation;
    player.lastInputSeq = seq;
  }

  damagePlayer(id: string, amount: number): void {
    const player = this.players.get(id);
    if (!player || !player.alive) return;

    player.health = Math.max(0, player.health - amount);
    logger.info(`Player ${id} took ${amount} damage, health now ${player.health}`);

    if (player.health <= 0) {
      player.alive = false;
      logger.info(`Player ${id} died`);
      this.onPlayerDied?.(id);
    }
    this.notifyChange();
  }

  healPlayer(id: string, amount: number): void {
    const player = this.players.get(id);
    if (!player || !player.alive) return;

    player.health = Math.min(player.maxHealth, player.health + amount);
    this.notifyChange();
  }

  // ============================================================
  // Enemigos
  // ============================================================

  spawnEnemy(
    type: ServerEnemy['type'],
    position: Vector3,
    round: number
  ): ServerEnemy {
    const id = `enemy_${this.nextEnemyId++}`;
    const baseHealth = 20 + round * 5;
    const baseDamage = 5 + round * 2;
    const baseSpeed = 2 + round * 0.2;

    const stats: Record<string, { health: number; damage: number; speed: number }> = {
      basic: { health: baseHealth, damage: baseDamage, speed: baseSpeed },
      fast: { health: baseHealth * 0.6, damage: baseDamage * 0.7, speed: baseSpeed * 1.8 },
      tank: { health: baseHealth * 2.5, damage: baseDamage * 0.8, speed: baseSpeed * 0.6 },
      ranged: { health: baseHealth * 0.7, damage: baseDamage * 1.3, speed: baseSpeed * 0.9 },
      miniboss: { health: baseHealth * 5, damage: baseDamage * 2, speed: baseSpeed * 0.7 },
    };

    const s = stats[type] ?? stats.basic;

    const enemy: ServerEnemy = {
      id,
      type,
      position: { ...position },
      rotation: 0,
      health: s.health,
      maxHealth: s.health,
      speed: s.speed,
      damage: s.damage,
      alive: true,
      targetId: null,
    };

    this.enemies.set(id, enemy);
    this.wave.enemiesAlive++;
    this.notifyChange();
    return enemy;
  }

  damageEnemy(enemyId: string, amount: number, attackerId?: string): boolean {
    const enemy = this.enemies.get(enemyId);
    if (!enemy || !enemy.alive) return false;

    enemy.health = Math.max(0, enemy.health - amount);

    if (enemy.health <= 0) {
      enemy.alive = false;
      this.wave.enemiesAlive--;
      const reward = this.getEnemyReward(enemy.type);
      this.onEnemyDied?.(enemyId, enemy.position, reward, attackerId);
      logger.info(`Enemy ${enemyId} (${enemy.type}) died, reward: ${reward}`);
      this.notifyChange();
      return true;
    }

    this.notifyChange();
    return false;
  }

  private getEnemyReward(type: string): number {
    switch (type) {
      case 'basic': return 10;
      case 'fast': return 12;
      case 'tank': return 20;
      case 'ranged': return 15;
      case 'miniboss': return 50;
      default: return 10;
    }
  }

  // ============================================================
  // Oleadas (Waves)
  // ============================================================

  startWave(round: number): void {
    if (this.wave.active) return;

    const enemyCount = WAVE_BASE_ENEMIES + (round - 1) * WAVE_ENEMY_INCREMENT;

    this.wave = {
      round,
      enemyCount,
      enemiesSpawned: 0,
      enemiesAlive: 0,
      active: true,
      startedAt: Date.now(),
    };

    logger.info(`Wave ${round} started with ${enemyCount} enemies`);
    this.onWaveStart?.(round, enemyCount);

    // Iniciar spawn periódico de enemigos
    this.startSpawning();
    this.notifyChange();
  }

  private startSpawning(): void {
    this.stopSpawning();

    this.spawnTimer = setInterval(() => {
      if (!this.wave.active || this.wave.enemiesSpawned >= this.wave.enemyCount) {
        this.stopSpawning();
        return;
      }

      const type = this.getRandomEnemyType();
      const position = this.getSpawnPosition();
      this.spawnEnemy(type, position, this.wave.round);
      this.wave.enemiesSpawned++;
    }, WAVE_SPAWN_INTERVAL_MS);
  }

  private stopSpawning(): void {
    if (this.spawnTimer) {
      clearInterval(this.spawnTimer);
      this.spawnTimer = null;
    }
  }

  private getRandomEnemyType(): ServerEnemy['type'] {
    const roll = Math.random();
    if (roll < 0.4) return 'basic';
    if (roll < 0.65) return 'fast';
    if (roll < 0.85) return 'tank';
    if (roll < 0.95) return 'ranged';
    return 'miniboss';
  }

  private getSpawnPosition(): Vector3 {
    // Spawnear enemigos en un círculo alrededor del centro
    const angle = Math.random() * Math.PI * 2;
    const radius = 15 + Math.random() * 5;
    return {
      x: Math.cos(angle) * radius,
      y: 0,
      z: Math.sin(angle) * radius,
    };
  }

  checkWaveComplete(): void {
    if (!this.wave.active) return;
    if (this.wave.enemiesAlive > 0) return;
    if (this.wave.enemiesSpawned < this.wave.enemyCount) return;

    // Todos los enemigos de la oleada han muerto
    this.wave.active = false;
    logger.info(`Wave ${this.wave.round} completed`);
    this.onWaveEnd?.(this.wave.round);

    // Programar siguiente oleada
    this.scheduleNextWave();
    this.notifyChange();
  }

  /**
   * Pausa el juego: detiene spawn de enemigos y el timer de siguiente oleada.
   * Se usa cuando un jugador se desconecta durante la partida.
   */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.stopSpawning();
    if (this.waveTimer) {
      clearTimeout(this.waveTimer);
      this.waveTimer = null;
    }
    logger.info('GameState paused');
  }

  /**
   * Reanuda el juego: reinicia el spawn de enemigos si la oleada está activa.
   * Se usa cuando un jugador reconecta.
   */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.wave.active) {
      this.startSpawning();
      logger.info('GameState resumed (spawning restarted)');
    } else {
      // Si la oleada no está activa, programar la siguiente
      this.scheduleNextWave();
      logger.info('GameState resumed (next wave scheduled)');
    }
  }

  private scheduleNextWave(): void {
    if (this.waveTimer) {
      clearTimeout(this.waveTimer);
    }

    this.waveTimer = setTimeout(() => {
      const nextRound = this.wave.round + 1;
      this.startWave(nextRound);
    }, WAVE_PREP_TIME_MS);

    logger.info(`Next wave ${this.wave.round + 1} scheduled in ${WAVE_PREP_TIME_MS / 1000}s`);
  }

  // ============================================================
  // Snapshot para enviar a clientes
  // ============================================================

  getSnapshot(): GameStateSnapshot {
    return {
      players: Array.from(this.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        position: { ...p.position },
        rotation: p.rotation,
        health: p.health,
        maxHealth: p.maxHealth,
        alive: p.alive,
        lastProcessedSeq: p.lastInputSeq,
      })),
      enemies: Array.from(this.enemies.values())
        .filter(e => e.alive)
        .map(e => ({
          id: e.id,
          type: e.type,
          position: { ...e.position },
          rotation: e.rotation,
          health: e.health,
          alive: e.alive,
        })),
      wave: {
        round: this.wave.round,
        active: this.wave.active,
        enemyCount: this.wave.enemyCount,
        enemiesAlive: this.wave.enemiesAlive,
      },
      timestamp: Date.now(),
    };
  }

  // ============================================================
  // Utilidades
  // ============================================================

  private notifyChange(): void {
    this.onStateChange?.();
  }

  reset(): void {
    this.stopSpawning();
    if (this.waveTimer) {
      clearTimeout(this.waveTimer);
      this.waveTimer = null;
    }

    this.players.clear();
    this.enemies.clear();
    this.wave = {
      round: 0,
      enemyCount: 0,
      enemiesSpawned: 0,
      enemiesAlive: 0,
      active: false,
      startedAt: 0,
    };
    this.nextEnemyId = 0;
    logger.info('Game state reset');
    this.notifyChange();
  }

  destroy(): void {
    this.stopSpawning();
    if (this.waveTimer) {
      clearTimeout(this.waveTimer);
      this.waveTimer = null;
    }
    this.players.clear();
    this.enemies.clear();
    this.onStateChange = null;
    this.onWaveStart = null;
    this.onWaveEnd = null;
    this.onEnemyDied = null;
    this.onPlayerDied = null;
  }
}
