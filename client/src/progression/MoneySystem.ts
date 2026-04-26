import { EventBus } from '../engine/EventBus';
import type { Character } from '../characters/Character';

// =================================================================
// CONSTANTES DE RECOMPENSA POR TIPO DE ENEMIGO
// =================================================================

/**
 * Tabla de recompensas por tipo de enemigo.
 * Cada entrada define un rango [min, max] de monedas otorgadas al matar.
 */
const KILL_REWARDS: Record<string, { min: number; max: number }> = {
  basic:  { min: 2, max: 4 },
  fast:   { min: 1, max: 2 },
  tank:   { min: 6, max: 10 },
  ranged: { min: 3, max: 5 },
  mini_boss: { min: 15, max: 25 },
};

// =================================================================
// EVENTOS DEL SISTEMA DE DINERO
// =================================================================

export interface MoneyChangedEvent {
  playerId: string;
  newBalance: number;
  delta: number;
  reason: 'kill' | 'wave_reward' | 'spend' | 'refund';
}

// =================================================================
// MONEY SYSTEM
// =================================================================

/**
 * Sistema de economía individual por jugador.
 *
 * Cada jugador tiene su propio saldo de monedas que gana al matar
 * enemigos y al completar rondas. El dinero es estrictamente individual:
 * lo que gana P1 no lo tiene P2.
 *
 * Responsabilidades:
 * - Escuchar `enemy:died` para otorgar recompensas por kills
 * - Proveer métodos `addMoney` y `spendMoney` con validación de saldo
 * - Emitir `money:changed` para actualizar el HUD en tiempo real
 */
export class MoneySystem {
  /** Saldos individuales: playerId → balance */
  private balances: Map<string, number> = new Map();
  /** EventBus para emitir cambios de saldo */
  private eventBus: EventBus;
  /** Flag para evitar duplicación de wave reward en reconexión */
  private lastWaveRewardApplied: { round: number; timestamp: number } | null = null;
  /** Referencias a los personajes jugadores (para verificar efectos como doubleDropNextWave) */
  private players: Character[] = [];

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Establece las referencias a los personajes jugadores para
   * verificar efectos como doubleDropNextWave.
   * @param players - Array con los personajes de los jugadores
   */
  setPlayers(players: Character[]): void {
    this.players = players;
    this.setupListeners();
  }

  // =================================================================
  // LISTENERS
  // =================================================================

  /**
   * Configura los listeners de eventos necesarios.
   */
  private setupListeners(): void {
    // Escuchar muertes de enemigos para otorgar recompensa al atacante
    this.eventBus.on('enemy:died', (data: {
      enemyId: string;
      position: { x: number; y: number; z: number };
      reward: number;
      attackerId?: string;
    }) => {
      this.handleEnemyDied(data);
    });
  }

  /**
   * Maneja el evento `enemy:died`.
   * Si hay un `attackerId` conocido, el reward va a ese jugador.
   * Si no hay attackerId (muerte ambiental/simultánea), se ignora.
   */
  private handleEnemyDied(data: {
    enemyId: string;
    position: { x: number; y: number; z: number };
    reward: number;
    attackerId?: string;
  }): void {
    const { attackerId, reward } = data;

    // Sin attackerId → muerte ambiental, no hay recompensa
    if (!attackerId) return;

    // Solo jugadores humanos reciben dinero
    if (attackerId !== 'player1' && attackerId !== 'player2') return;

    // Calcular recompensa con un pequeño random dentro del rango
    // Usamos el reward base del enemigo como referencia
    let finalReward = Math.max(1, Math.round(reward * (0.8 + Math.random() * 0.4)));

    // Verificar si el atacante tiene el efecto doubleDropNextWave activo
    const attacker = this.players.find(p => p.id === attackerId);
    if (attacker && attacker.doubleDropNextWave) {
      const originalReward = finalReward;
      finalReward *= 2;
      console.log(
        `[MoneySystem] ${attackerId}: doubleDropNextWave activo! ` +
        `recompensa ×2: ${originalReward} → ${finalReward}`
      );
    }

    this.addMoney(attackerId, finalReward, 'kill');
  }

  // =================================================================
  // MÉTODOS PÚBLICOS
  // =================================================================

  /**
   * Agrega dinero al saldo de un jugador.
   * @param playerId - ID del jugador ('player1' | 'player2')
   * @param amount - Cantidad a agregar (debe ser positiva)
   * @param reason - Razón del ingreso
   */
  addMoney(playerId: string, amount: number, reason: MoneyChangedEvent['reason'] = 'wave_reward'): void {
    if (amount <= 0) return;

    const currentBalance = this.balances.get(playerId) ?? 0;
    const newBalance = currentBalance + amount;
    this.balances.set(playerId, newBalance);

    console.log(
      `[MoneySystem] ${playerId}: +${amount} monedas (${reason}). Balance: ${newBalance}`
    );

    this.emitMoneyChanged(playerId, newBalance, amount, reason);
  }

  /**
   * Intenta gastar dinero del saldo de un jugador.
   * @param playerId - ID del jugador
   * @param amount - Cantidad a gastar
   * @returns true si se pudo descontar, false si no hay saldo suficiente
   */
  spendMoney(playerId: string, amount: number): boolean {
    if (amount <= 0) return true;

    const currentBalance = this.balances.get(playerId) ?? 0;

    if (currentBalance < amount) {
      console.warn(
        `[MoneySystem] ${playerId}: saldo insuficiente (tiene ${currentBalance}, necesita ${amount})`
      );
      return false;
    }

    const newBalance = currentBalance - amount;
    this.balances.set(playerId, newBalance);

    console.log(
      `[MoneySystem] ${playerId}: -${amount} monedas (spend). Balance: ${newBalance}`
    );

    this.emitMoneyChanged(playerId, newBalance, -amount, 'spend');
    return true;
  }

  /**
   * Obtiene el saldo actual de un jugador.
   * @param playerId - ID del jugador
   * @returns Saldo actual (0 si no tiene registro)
   */
  getBalance(playerId: string): number {
    return this.balances.get(playerId) ?? 0;
  }

  /**
   * Aplica la recompensa de ronda completada a ambos jugadores.
   * Incluye protección contra duplicación en reconexión.
   * @param round - Número de ronda completada
   * @param reward - Cantidad base de recompensa
   */
  applyWaveReward(round: number, reward: number): void {
    const now = Date.now();

    // Protección contra duplicación: si ya aplicamos esta ronda en los últimos 5s, ignorar
    if (
      this.lastWaveRewardApplied &&
      this.lastWaveRewardApplied.round === round &&
      now - this.lastWaveRewardApplied.timestamp < 5000
    ) {
      console.warn(
        `[MoneySystem] Recompensa de ronda ${round} ya aplicada, ignorando duplicado`
      );
      return;
    }

    this.lastWaveRewardApplied = { round, timestamp: now };

    // Ambos jugadores reciben la misma recompensa de ronda
    this.addMoney('player1', reward, 'wave_reward');
    this.addMoney('player2', reward, 'wave_reward');

    console.log(
      `[MoneySystem] Recompensa de ronda ${round}: +${reward} monedas para cada jugador`
    );
  }

  /**
   * Resetea todos los saldos y el estado.
   */
  reset(): void {
    this.balances.clear();
    this.lastWaveRewardApplied = null;
    console.log('[MoneySystem] Sistema de dinero reiniciado');
  }

  /**
   * Obtiene una copia de todos los saldos.
   */
  getAllBalances(): Record<string, number> {
    const result: Record<string, number> = {};
    this.balances.forEach((balance, playerId) => {
      result[playerId] = balance;
    });
    return result;
  }

  // =================================================================
  // MÉTODOS PRIVADOS
  // =================================================================

  /**
   * Emite el evento `money:changed` para actualizar el HUD.
   */
  private emitMoneyChanged(
    playerId: string,
    newBalance: number,
    delta: number,
    reason: MoneyChangedEvent['reason']
  ): void {
    // Emitir como evento genérico en el EventBus
    // El HUD se suscribe a este evento para actualizarse
    (this.eventBus as any).emit('money:changed', {
      playerId,
      newBalance,
      delta,
      reason,
    } as MoneyChangedEvent);
  }
}
