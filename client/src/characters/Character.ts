import { EventBus } from '../engine/EventBus';
import type { InputState } from '../engine/InputManager';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { RigidBodyHandle } from '../physics/PhysicsWorld';

/**
 * Estadísticas base de un personaje.
 */
export interface CharacterStats {
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  attackSpeed: number;
  range: number;
  armor: number;
}

/**
 * Tipo de modificador de estadística.
 */
export enum ModifierType {
  /** Suma un valor fijo (ej: +10 daño) */
  Additive = 'additive',
  /** Multiplica el valor base (ej: ×1.5 daño) */
  Multiplicative = 'multiplicative',
}

/**
 * Representa un modificador aplicado a una estadística.
 */
export interface StatModifier {
  /** Nombre de la estadística afectada (ej: 'damage', 'speed') */
  stat: keyof CharacterStats;
  /** Valor del modificador */
  value: number;
  /** Tipo de modificador */
  type: ModifierType;
  /** Identificador único para poder eliminar el modificador después */
  id?: string;
  /** Descripción opcional para debugging */
  description?: string;
}

/**
 * Estados posibles de un personaje.
 */
export enum CharacterState {
  Idle = 'idle',
  Moving = 'moving',
  Attacking = 'attacking',
  Dead = 'dead',
}

/**
 * Clase abstracta base para todos los personajes (jugadores y enemigos).
 * Define la interfaz de stats, sistema de modificadores y máquina de estados simple.
 */
export abstract class Character {
  /** Estadísticas base del personaje */
  protected baseStats: CharacterStats;
  /** Modificadores activos */
  protected modifiers: StatModifier[] = [];
  /** Estado actual */
  protected state: CharacterState = CharacterState.Idle;
  /** Referencia al mundo de física (opcional) */
  protected physicsWorld?: PhysicsWorld;
  /** Cuerpo de física asociado (opcional) */
  protected physicsBody?: RigidBodyHandle;
  /** Identificador único del personaje */
  public readonly id: string;
  /** EventBus para emitir eventos de personaje */
  protected eventBus: EventBus;

  constructor(
    id: string,
    baseStats: CharacterStats,
    eventBus: EventBus,
    physicsWorld?: PhysicsWorld,
    physicsBody?: RigidBodyHandle
  ) {
    this.id = id;
    this.baseStats = { ...baseStats };
    this.eventBus = eventBus;
    this.physicsWorld = physicsWorld;
    this.physicsBody = physicsBody;
  }

  /**
   * Obtiene el valor efectivo de una estadística, aplicando todos los modificadores.
   * Orden de aplicación: primero aditivos, luego multiplicativos.
   */
  getEffectiveStat(stat: keyof CharacterStats): number {
    let base = this.baseStats[stat];
    const relevantModifiers = this.modifiers.filter(m => m.stat === stat);

    // Aplicar modificadores aditivos
    const additiveSum = relevantModifiers
      .filter(m => m.type === ModifierType.Additive)
      .reduce((sum, m) => sum + m.value, 0);
    base += additiveSum;

    // Aplicar modificadores multiplicativos
    const multiplicativeProduct = relevantModifiers
      .filter(m => m.type === ModifierType.Multiplicative)
      .reduce((product, m) => product * m.value, 1);
    base *= multiplicativeProduct;

    // Para hp y maxHp, asegurar que no sean negativos
    if (stat === 'hp' || stat === 'maxHp') {
      return Math.max(0, base);
    }

    return base;
  }

  /**
   * Aplica un modificador a una estadística.
   */
  applyModifier(stat: keyof CharacterStats, value: number, type: ModifierType, id?: string, description?: string): void {
    this.modifiers.push({ stat, value, type, id, description });
  }

  /**
   * Elimina un modificador por su ID.
   */
  removeModifier(id: string): void {
    this.modifiers = this.modifiers.filter(m => m.id !== id);
  }

  /**
   * Elimina todos los modificadores de una estadística específica.
   */
  clearModifiersForStat(stat: keyof CharacterStats): void {
    this.modifiers = this.modifiers.filter(m => m.stat !== stat);
  }

  /**
   * Recibe daño, aplicando reducción por armadura.
   * Fórmula: finalDmg = dmg * (100 / (100 + armor))
   */
  takeDamage(amount: number): void {
    if (this.state === CharacterState.Dead) return;

    const armor = this.getEffectiveStat('armor');
    const finalDamage = amount * (100 / (100 + armor));
    const currentHp = this.getEffectiveStat('hp');
    const newHp = Math.max(0, currentHp - finalDamage);

    // Actualizar hp en baseStats (no en modificadores)
    this.baseStats.hp = newHp;

    // Emitir evento de daño si es jugador
    this.eventBus.emit('player:damaged', { playerId: this.id, amount: finalDamage });

    if (newHp <= 0) {
      this.die();
    }
  }

  /**
   * Cura al personaje, sin exceder maxHp.
   */
  heal(amount: number): void {
    if (this.state === CharacterState.Dead) return;

    const currentHp = this.getEffectiveStat('hp');
    const maxHp = this.getEffectiveStat('maxHp');
    const newHp = Math.min(maxHp, currentHp + amount);
    this.baseStats.hp = newHp;
  }

  /**
   * Mata al personaje y emite el evento correspondiente.
   */
  die(): void {
    if (this.state === CharacterState.Dead) return;

    this.state = CharacterState.Dead;
    this.baseStats.hp = 0;

    // Emitir evento de muerte
    this.eventBus.emit('player:died', { playerId: this.id });
  }

  /**
   * Cambia el estado del personaje.
   */
  setState(newState: CharacterState): void {
    if (this.state === CharacterState.Dead && newState !== CharacterState.Dead) {
      // No se puede salir del estado Dead
      return;
    }
    this.state = newState;
  }

  /**
   * Obtiene el estado actual.
   */
  getState(): CharacterState {
    return this.state;
  }

  /**
   * Verifica si el personaje está vivo.
   */
  isAlive(): boolean {
    return this.state !== CharacterState.Dead && this.getEffectiveStat('hp') > 0;
  }

  /**
   * Actualiza la lógica del personaje cada frame.
   * Método abstracto que debe implementar cada subclase.
   */
  abstract update(dt: number, inputState?: InputState): void;

  /**
   * Establece el cuerpo de física asociado.
   */
  setPhysicsBody(body: RigidBodyHandle): void {
    this.physicsBody = body;
  }

  /**
   * Obtiene el cuerpo de física asociado.
   */
  getPhysicsBody(): RigidBodyHandle | undefined {
    return this.physicsBody;
  }

  /**
   * Establece la referencia al mundo de física.
   */
  setPhysicsWorld(world: PhysicsWorld): void {
    this.physicsWorld = world;
  }

  /**
   * Obtiene las estadísticas base (sin modificadores).
   */
  getBaseStats(): CharacterStats {
    return { ...this.baseStats };
  }

  /**
   * Obtiene las estadísticas efectivas (con modificadores aplicados).
   */
  getEffectiveStats(): CharacterStats {
    return {
      hp: this.getEffectiveStat('hp'),
      maxHp: this.getEffectiveStat('maxHp'),
      speed: this.getEffectiveStat('speed'),
      damage: this.getEffectiveStat('damage'),
      attackSpeed: this.getEffectiveStat('attackSpeed'),
      range: this.getEffectiveStat('range'),
      armor: this.getEffectiveStat('armor'),
    };
  }
}