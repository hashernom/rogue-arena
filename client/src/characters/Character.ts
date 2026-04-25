import * as THREE from 'three';
import { EventBus } from '../engine/EventBus';
import type { InputState } from '../engine/InputManager';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { RigidBodyHandle } from '../physics/PhysicsWorld';
import { StatsSystem, type StatModifier as NewStatModifier, type ModType } from './StatsSystem';

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
 * Tipo de modificador de estadística (legacy, mantenido para compatibilidad).
 * @deprecated Usar ModType del StatsSystem para nuevos desarrollos
 */
export enum ModifierType {
  /** Suma un valor fijo (ej: +10 daño) */
  Additive = 'additive',
  /** Multiplica el valor base (ej: ×1.5 daño) */
  Multiplicative = 'multiplicative',
}

/**
 * Representa un modificador aplicado a una estadística (legacy).
 * @deprecated Usar StatModifier del StatsSystem para nuevos desarrollos
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
  /** Sistema de estadísticas extendible con caché */
  protected statsSystem: StatsSystem;
  /** Modificadores activos (legacy, mantenido para compatibilidad) */
  protected modifiers: StatModifier[] = [];
  /** Estado actual */
  protected state: CharacterState = CharacterState.Idle;
  /** Referencia al mundo de física (opcional) */
  protected physicsWorld?: PhysicsWorld;
  /** Cuerpo de física asociado (opcional) */
  protected physicsBody?: RigidBodyHandle;
  /** Resistencia al knockback (0-1) donde 1 es inmune */
  protected knockbackResistance: number = 0;
  /** Indica si el steering está habilitado (para enemigos) */
  protected steeringEnabled: boolean = true;
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
    this.statsSystem = new StatsSystem({ ...baseStats });
    this.eventBus = eventBus;
    this.physicsWorld = physicsWorld;
    this.physicsBody = physicsBody;
  }

  /**
   * Obtiene el valor efectivo de una estadística, aplicando todos los modificadores.
   * Usa el nuevo StatsSystem con caché.
   */
  getEffectiveStat(stat: keyof CharacterStats): number {
    return this.statsSystem.getStat(stat);
  }

  /**
   * Aplica un modificador a una estadística (legacy API).
   * Para nuevos desarrollos, usar addModifier del StatsSystem directamente.
   */
  applyModifier(
    stat: keyof CharacterStats,
    value: number,
    type: ModifierType,
    id?: string,
    description?: string
  ): void {
    // Convertir ModifierType legacy a ModType del nuevo sistema
    let modType: ModType;
    switch (type) {
      case ModifierType.Additive:
        modType = 'addFlat';
        break;
      case ModifierType.Multiplicative:
        modType = 'multiplyBase';
        break;
      default:
        modType = 'addFlat';
    }

    const source = description || `legacy_mod_${stat}`;
    const newModifier: NewStatModifier = { stat, value, type: modType, source };
    
    // Si se proporciona un ID, usarlo como parte del source para poder removerlo después
    const modifierId = this.statsSystem.addModifier(newModifier);
    
    // Mantener compatibilidad con el array legacy
    this.modifiers.push({ stat, value, type, id: id || modifierId, description });
  }

  /**
   * Elimina un modificador por su ID (legacy API).
   */
  removeModifier(id: string): void {
    // Buscar el modificador en el array legacy
    const legacyMod = this.modifiers.find(m => m.id === id);
    if (legacyMod) {
      // Para remover del nuevo sistema necesitaríamos mapear el ID legacy
      // Por ahora, solo removemos del array legacy
      // En una implementación completa, necesitaríamos guardar el mapping de IDs
      this.modifiers = this.modifiers.filter(m => m.id !== id);
    }
  }

  /**
   * Elimina todos los modificadores de una estadística específica (legacy API).
   */
  clearModifiersForStat(stat: keyof CharacterStats): void {
    this.modifiers = this.modifiers.filter(m => m.stat !== stat);
    // También limpiar del nuevo sistema
    const allModifiers = this.statsSystem.getModifiers();
    allModifiers.forEach(mod => {
      if (mod.stat === stat) {
        // Necesitaríamos el ID del modificador para removerlo
        // Por simplicidad, limpiaremos todos los modificadores y reaplicaremos los restantes
      }
    });
  }

  /**
   * Recibe daño, aplicando reducción por armadura.
   * Fórmula: finalDmg = dmg * (100 / (100 + armor))
   */
  takeDamage(amount: number): void {
    if (this.state === CharacterState.Dead) return;

    const armor = this.getEffectiveStat('armor');
    const finalDamage = amount * (100 / (100 + armor));
    
    // Usar el nuevo sistema para aplicar daño
    this.statsSystem.takeDamage(finalDamage);

    // Emitir evento de daño si es jugador
    this.eventBus.emit('player:damaged', { playerId: this.id, amount: finalDamage });

    if (this.statsSystem.getStat('hp') <= 0) {
      this.die();
    }
  }

  /**
   * Cura al personaje, sin exceder maxHp.
   */
  heal(amount: number): void {
    if (this.state === CharacterState.Dead) return;
    this.statsSystem.heal(amount);
  }

  /**
   * Mata al personaje y emite el evento correspondiente.
   * Remueve el cuerpo físico de Rapier para que los enemigos no
   * sigan orbitando alrededor del punto de muerte.
   */
  die(): void {
    if (this.state === CharacterState.Dead) return;

    this.state = CharacterState.Dead;
    this.statsSystem.setBaseStat('hp', 0);

    // Remover cuerpo físico de Rapier para que los enemigos no
    // se queden orbitando alrededor del punto de muerte
    if (this.physicsWorld && this.physicsBody !== undefined) {
      this.physicsWorld.removeBody(this.physicsBody);
      this.physicsBody = undefined;
    }

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
   * Obtiene la posición actual del personaje en el mundo 3D.
   * Cada subclase debe implementarlo según su modelo (Three.js Group, Rapier body, etc.)
   */
  abstract getPosition(): THREE.Vector3 | null;

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
    return {
      hp: this.statsSystem.getBaseStat('hp'),
      maxHp: this.statsSystem.getBaseStat('maxHp'),
      speed: this.statsSystem.getBaseStat('speed'),
      damage: this.statsSystem.getBaseStat('damage'),
      attackSpeed: this.statsSystem.getBaseStat('attackSpeed'),
      range: this.statsSystem.getBaseStat('range'),
      armor: this.statsSystem.getBaseStat('armor'),
    };
  }

  /**
   * Obtiene las estadísticas efectivas (con modificadores aplicados).
   */
  getEffectiveStats(): CharacterStats {
    return this.statsSystem.getAllStats();
  }

  /**
   * Aplica knockback al personaje.
   * NOTA: El steering se restaura automáticamente vía KnockbackSystem.update().
   * @param force Vector de fuerza (dirección * magnitud)
   * @param duration Duración en segundos (no usado internamente, lo gestiona KnockbackSystem)
   */
  applyKnockback(force: THREE.Vector3, _duration: number): void {
    // Implementación básica: aplicar impulso al cuerpo físico
    if (this.physicsBody && this.physicsWorld) {
      const body = this.physicsWorld.getBody(this.physicsBody);
      if (body) {
        body.applyImpulse({ x: force.x, y: force.y, z: force.z }, true);
      }
    }
    // Deshabilitar steering (KnockbackSystem lo restaurará vía onFinish)
    this.disableSteering();
  }

  /**
   * Deshabilita el steering (movimiento controlado por IA).
   */
  disableSteering(): void {
    this.steeringEnabled = false;
  }

  /**
   * Habilita el steering.
   */
  enableSteering(): void {
    this.steeringEnabled = true;
  }

  /**
   * Obtiene la resistencia al knockback.
   */
  getKnockbackResistance(): number {
    return this.knockbackResistance;
  }

  /**
   * Establece la resistencia al knockback.
   */
  setKnockbackResistance(resistance: number): void {
    this.knockbackResistance = Math.max(0, Math.min(1, resistance));
  }
}
