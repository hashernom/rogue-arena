import * as THREE from 'three';
import { EventBus } from '../engine/EventBus';
import { Character } from '../characters/Character';
import { DamageNumberSystem } from './DamageNumber';

// Interfaz mínima para entidades que pueden recibir daño
interface Damageable {
  id: string;
  takeDamage(amount: number): void;
  isAlive?(): boolean;
  /** Recompensa en monedas al morir (para enemigos) */
  reward?: number;
  /** Tipo de entidad (para calcular reward dinámico) */
  type?: string;
}

export interface DamageOptions {
  /** Posición del impacto (para mostrar números de daño) */
  position?: THREE.Vector3;
  /** Si el ataque puede ser crítico (por defecto true) */
  canCrit?: boolean;
  /** Chance de crítico (0-1, por defecto 0.1) */
  critChance?: number;
  /** Multiplicador de crítico (por defecto 1.5) */
  critMultiplier?: number;
  /** Fuente del daño (para eventos) */
  source?: string;
  /** ID del atacante */
  attackerId?: string;
  /** Armadura del objetivo (si no se proporciona, se intenta obtener del target) */
  targetArmor?: number;
}

export interface DamageResult {
  /** Daño base original */
  baseDamage: number;
  /** Daño final después de reducción por armadura */
  finalDamage: number;
  /** Si fue un golpe crítico */
  isCrit: boolean;
  /** Si el objetivo murió */
  killed: boolean;
  /** Multiplicador de crítico aplicado */
  critMultiplier?: number;
}

/**
 * Pipeline centralizado de cálculo de daño.
 * Aplica fórmulas de reducción por armadura, críticos y emite eventos.
 * Es la ÚNICA forma de aplicar daño en el juego.
 */
export class DamagePipeline {
  private damageNumberSystem: DamageNumberSystem | null = null;

  constructor(private readonly eventBus: EventBus) {}

  /**
   * Establece el sistema de números de daño flotantes.
   * Debe llamarse después de crear la escena.
   */
  setDamageNumberSystem(system: DamageNumberSystem): void {
    this.damageNumberSystem = system;
  }

  /**
   * Calcula la recompensa según el tipo de enemigo.
   */
  private static getRewardForType(type?: string): number {
    switch (type) {
      case 'basic':
      case 'skeleton_minion':
        return 3;
      case 'fast':
        return 2;
      case 'tank':
        return 8;
      case 'ranged':
        return 4;
      case 'boss':
        return 20;
      default:
        return 10; // Valor base por defecto
    }
  }

  /**
   * Aplica daño a un objetivo (jugador o enemigo).
   * @param attacker Entidad que ataca (puede ser undefined para daño ambiental)
   * @param target Entidad que recibe el daño (debe tener takeDamage y id)
   * @param baseDamage Daño base antes de reducciones
   * @param options Opciones adicionales
   * @returns Resultado del cálculo de daño
   */
  applyDamage(
    attacker: any | undefined,
    target: Damageable,
    baseDamage: number,
    options: DamageOptions = {}
  ): DamageResult {
    const {
      position = new THREE.Vector3(),
      canCrit = true,
      critChance = 0.1,
      critMultiplier = 1.5,
      source = 'unknown',
      attackerId = attacker?.id || 'unknown',
      targetArmor,
    } = options;

    // 1. Calcular crítico
    let isCrit = false;
    let damageMultiplier = 1.0;
    if (canCrit && Math.random() < critChance) {
      isCrit = true;
      damageMultiplier = critMultiplier;
    }

    const damageBeforeArmor = baseDamage * damageMultiplier;

    // 2. Reducción por armadura
    let armor = targetArmor;
    if (armor === undefined && target instanceof Character) {
      armor = target.getEffectiveStat('armor');
    } else if (armor === undefined) {
      armor = 0; // Por defecto sin armadura
    }

    const finalDamage = damageBeforeArmor * (100 / (100 + armor));

    // 3. Aplicar daño al objetivo
    const wasAlive = target.isAlive ? target.isAlive() : true;
    target.takeDamage(finalDamage);
    const isNowDead = target.isAlive ? !target.isAlive() : false;

    // 4. Emitir eventos correspondientes
    this.emitDamageEvents(target, finalDamage, isCrit, position, source, attackerId);

    // 5. Emitir evento de muerte si corresponde
    if (isNowDead && wasAlive) {
      this.emitDeathEvent(target, position, attackerId);
    }

    // 6. Mostrar número de daño flotante
    const targetType = target instanceof Character ? 'player' : 'enemy';
    this.showDamageNumber(finalDamage, isCrit, position, targetType);

    return {
      baseDamage,
      finalDamage,
      isCrit,
      killed: isNowDead,
      critMultiplier: isCrit ? critMultiplier : undefined,
    };
  }

  /**
   * Emite eventos de daño según el tipo de objetivo.
   */
  private emitDamageEvents(
    target: Damageable,
    damage: number,
    isCrit: boolean,
    position: THREE.Vector3,
    source: string,
    attackerId: string
  ): void {
    if (target instanceof Character) {
      // Daño a jugador
      this.eventBus.emit('player:damaged', {
        playerId: target.id,
        amount: damage,
      });
    } else {
      // Daño a enemigo — incluir isCritical
      this.eventBus.emit('enemy:damage', {
        enemyId: target.id,
        damage,
        attackerId,
        position: { x: position.x, y: position.y, z: position.z },
        isCritical: isCrit,
      });
    }
  }

  /**
   * Emite evento de muerte con reward calculado según tipo de enemigo.
   */
  private emitDeathEvent(
    target: Damageable,
    position: THREE.Vector3,
    attackerId: string
  ): void {
    if (target instanceof Character) {
      this.eventBus.emit('player:died', { playerId: target.id });
    } else {
      // Usar reward del target si está definido, si no calcular por tipo
      const reward = target.reward ?? DamagePipeline.getRewardForType(target.type);
      this.eventBus.emit('enemy:died', {
        enemyId: target.id,
        position: { x: position.x, y: position.y, z: position.z },
        reward,
      });
    }
  }

  /**
   * Crea un número de daño flotante 3D usando DamageNumberSystem.
   */
  private showDamageNumber(
    damage: number,
    isCrit: boolean,
    position: THREE.Vector3,
    targetType: 'player' | 'enemy'
  ): void {
    // Colores según tipo y crítico
    let color = 0xffffff; // blanco por defecto (daño a enemigo)
    if (targetType === 'player') {
      color = 0xff5555; // rojo para daño a jugador
    } else if (isCrit) {
      color = 0xff2200; // rojo fuerte para críticos
    }

    // Usar DamageNumberSystem si está disponible
    if (this.damageNumberSystem) {
      this.damageNumberSystem.createDamageNumber(damage, position, {
        color,
        isCrit,
      });
    }
  }

  /**
   * Calcula la reducción por armadura para un valor dado.
   * Útil para previsualizar daño en UI.
   */
  static calculateArmorReduction(baseDamage: number, armor: number): number {
    return baseDamage * (100 / (100 + armor));
  }

  /**
   * Calcula la probabilidad de crítico efectiva.
   */
  static calculateCritChance(baseChance: number, critBonus: number = 0): number {
    return Math.min(1, Math.max(0, baseChance + critBonus));
  }
}
