import { EventBus } from '../engine/EventBus';
import { Character, ModifierType } from '../characters/Character';
import type { ReactiveEffect } from '../../../shared/src/types/Items';

// =================================================================
// PASSIVE EFFECTS (EFECTOS REACTIVOS DE ÍTEMS)
// =================================================================

/**
 * Clave única para identificar un efecto reactivo registrado.
 * Formato: `${playerId}:${itemId}`
 */
type PassiveKey = string;

/**
 * Referencia a un listener activo con su función de cleanup.
 */
interface ListenerRef {
  /** Nombre del evento al que se suscribió */
  event: string;
  /** Función de cleanup devuelta por eventBus.on() */
  cleanup: () => void;
}

/**
 * Estado interno para el speed boost (onLowHP).
 */
interface SpeedBoostState {
  /** ID del modificador de velocidad aplicado */
  modifierId: string | null;
  /** Timeout activo para remover el boost */
  timeoutId: ReturnType<typeof setTimeout> | null;
}

/**
 * Sistema de efectos reactivos de ítems.
 *
 * Los efectos reactivos (onKill, onHit, onLowHP) se registran cuando
 * un jugador compra un ítem y se limpian automáticamente en game over.
 *
 * Responsabilidades:
 * - Suscribirse a eventos del juego (enemy:died, player:damaged)
 * - Ejecutar la acción correspondiente (heal, critChance, speedBoost)
 * - Garantizar que no se dupliquen listeners si se compra el mismo ítem dos veces
 * - Proveer cleanup completo para evitar memory leaks
 */
export class PassiveEffects {
  private eventBus: EventBus;
  /** Set de claves activas para evitar duplicación: `${playerId}:${itemId}` */
  private activeKeys: Set<PassiveKey> = new Set();
  /** Mapa de listeners activos: key → listenerRef */
  private listenerRefs: Map<PassiveKey, ListenerRef> = new Map();
  /** Mapa de estado de speed boost por jugador */
  private speedBoostStates: Map<string, SpeedBoostState> = new Map();

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Registra un efecto reactivo para un jugador.
   * Si el mismo ítem ya está registrado para el mismo jugador, no hace nada.
   *
   * @param playerId - ID del jugador ('player1' | 'player2')
   * @param itemId - ID del ítem en el catálogo
   * @param effect - Configuración del efecto reactivo
   * @param character - Personaje del jugador (para aplicar heal, modifiers, etc.)
   */
  register(
    playerId: string,
    itemId: string,
    effect: ReactiveEffect,
    character: Character
  ): void {
    const key: PassiveKey = `${playerId}:${itemId}`;

    // Protección contra duplicación
    if (this.activeKeys.has(key)) {
      console.log(`[PassiveEffects] Efecto "${itemId}" ya registrado para ${playerId}, ignorando`);
      return;
    }

    this.activeKeys.add(key);

    let cleanup: () => void;

    switch (effect.trigger) {
      case 'onKill':
        cleanup = this.registerOnKill(playerId, effect, character);
        break;
      case 'onHit':
        cleanup = this.registerOnHit(playerId, effect, character);
        break;
      case 'onLowHP':
        cleanup = this.registerOnLowHP(playerId, effect, character);
        break;
      default:
        console.warn(`[PassiveEffects] Trigger desconocido: ${(effect as any).trigger}`);
        this.activeKeys.delete(key);
        return;
    }

    this.listenerRefs.set(key, { event: `passive:${effect.trigger}`, cleanup });
    console.log(`[PassiveEffects] Registrado: ${key} (trigger=${effect.trigger}, action=${effect.action}, value=${effect.value})`);
  }

  /**
   * Elimina todos los listeners reactivos registrados.
   * Debe llamarse en game over o restart para evitar memory leaks.
   */
  unregisterAll(): void {
    console.log(`[PassiveEffects] Limpiando ${this.listenerRefs.size} efectos reactivos...`);
    for (const [key, ref] of this.listenerRefs) {
      ref.cleanup();
      console.log(`  - Eliminado: ${key} (${ref.event})`);
    }
    this.listenerRefs.clear();
    this.activeKeys.clear();

    // Limpiar speed boosts pendientes
    for (const [playerId, state] of this.speedBoostStates) {
      if (state.timeoutId !== null) {
        clearTimeout(state.timeoutId);
      }
      console.log(`  - Speed boost cancelado para ${playerId}`);
    }
    this.speedBoostStates.clear();
  }

  /**
   * Resetea todo el estado (alias de unregisterAll para consistencia).
   */
  reset(): void {
    this.unregisterAll();
  }

  // =================================================================
  // IMPLEMENTACIONES POR TRIGGER
  // =================================================================

  /**
   * onKill: Al matar un enemigo, ejecuta la acción.
   * - heal: Cura `value` HP al jugador que mató.
   */
  private registerOnKill(
    playerId: string,
    effect: ReactiveEffect,
    character: Character
  ): () => void {
    const cleanup = this.eventBus.on('enemy:died', (data) => {
      // Solo para el jugador que mató
      if (data.attackerId !== playerId) return;

      switch (effect.action) {
        case 'heal': {
          const maxHp = character.getEffectiveStat('maxHp');
          const currentHp = character.getEffectiveStat('hp');
          const actualHeal = Math.min(effect.value, maxHp - currentHp);
          if (actualHeal > 0) {
            character.heal(actualHeal);
            console.log(
              `[PassiveEffects] ${playerId}: onKill heal +${actualHeal} HP ` +
              `(item effect: ${effect.value})`
            );
          }
          break;
        }
        default:
          console.warn(`[PassiveEffects] onKill: acción no soportada: ${effect.action}`);
      }
    });

    return cleanup;
  }

  /**
   * onHit: Al recibir daño, X% chance de activar la acción.
   * - critChance: Marca el próximo ataque del jugador como crítico.
   */
  private registerOnHit(
    playerId: string,
    effect: ReactiveEffect,
    character: Character
  ): () => void {
    const cleanup = this.eventBus.on('player:damaged', (data) => {
      // Solo para este jugador
      if (data.playerId !== playerId) return;

      switch (effect.action) {
        case 'critChance': {
          // effect.value es el % de chance (ej: 15 = 15%)
          const chance = effect.value / 100;
          if (Math.random() < chance) {
            character.nextAttackIsCrit = true;
            console.log(
              `[PassiveEffects] ${playerId}: onHit critChance activado! ` +
              `Próximo ataque será crítico`
            );
          }
          break;
        }
        default:
          console.warn(`[PassiveEffects] onHit: acción no soportada: ${effect.action}`);
      }
    });

    return cleanup;
  }

  /**
   * onLowHP: Cuando la vida baja del 20%, activa la acción.
   * - speedBoost: Aumenta velocidad temporalmente en `value`% por 3 segundos.
   */
  private registerOnLowHP(
    playerId: string,
    effect: ReactiveEffect,
    character: Character
  ): () => void {
    const cleanup = this.eventBus.on('player:damaged', (data) => {
      // Solo para este jugador
      if (data.playerId !== playerId) return;

      switch (effect.action) {
        case 'speedBoost': {
          const maxHp = character.getEffectiveStat('maxHp');
          const currentHp = character.getEffectiveStat('hp');
          const hpPercent = (currentHp / maxHp) * 100;

          // Solo activar si HP < 20%
          if (hpPercent >= 20) return;

          const boostPercent = effect.value; // ej: 30 = +30% speed
          const state = this.getOrCreateSpeedBoostState(playerId);

          // Si ya hay un boost activo, renovar el timeout
          if (state.timeoutId !== null) {
            clearTimeout(state.timeoutId);
          } else {
            // Aplicar modificador de velocidad
            character.applyModifier(
              'speed' as any,
              boostPercent / 100,
              ModifierType.Multiplicative,
              undefined,
              `passive:speedBoost:${playerId}`
            );
            console.log(
              `[PassiveEffects] ${playerId}: onLowHP speedBoost +${boostPercent}% ` +
              `(HP: ${currentHp}/${maxHp} = ${hpPercent.toFixed(1)}%)`
            );
          }

          // Programar remoción después de 3 segundos
          state.timeoutId = setTimeout(() => {
            character.removeModifier(`passive:speedBoost:${playerId}`);
            state.modifierId = null;
            state.timeoutId = null;
            console.log(
              `[PassiveEffects] ${playerId}: speedBoost expirado después de 3s`
            );
          }, 3000);

          break;
        }
        default:
          console.warn(`[PassiveEffects] onLowHP: acción no soportada: ${effect.action}`);
      }
    });

    return cleanup;
  }

  /**
   * Obtiene o crea el estado de speed boost para un jugador.
   */
  private getOrCreateSpeedBoostState(playerId: string): SpeedBoostState {
    let state = this.speedBoostStates.get(playerId);
    if (!state) {
      state = { modifierId: null, timeoutId: null };
      this.speedBoostStates.set(playerId, state);
    }
    return state;
  }
}
