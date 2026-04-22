import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { Character } from '../characters/Character';

/**
 * Configuración del knockback.
 */
export interface KnockbackConfig {
  /** Fuerza base del knockback (unidades de impulso) */
  baseStrength: number;
  /** Duración del knockback en segundos */
  duration: number;
  /** Escala con el daño? (multiplicador adicional basado en daño) */
  scaleWithDamage: boolean;
  /** Factor de escala por daño (fuerza = baseStrength * (1 + damage * damageScaleFactor)) */
  damageScaleFactor: number;
}

/**
 * Estado de knockback activo en un personaje.
 */
export interface KnockbackState {
  /** Fuerza aplicada (vector dirección * magnitud) */
  force: THREE.Vector3;
  /** Tiempo restante en segundos */
  remainingTime: number;
  /** Si el knockback está activo */
  active: boolean;
  /** Callback para restaurar el steering */
  onFinish?: () => void;
}

/**
 * Sistema de knockback que aplica impulso cinemático a los enemigos.
 * Maneja el estado de knockback y deshabilita el steering temporalmente.
 */
export class KnockbackSystem {
  private physicsWorld: PhysicsWorld | null = null;
  private knockbackStates: Map<string, KnockbackState> = new Map();

  /**
   * Establece la referencia al PhysicsWorld.
   */
  setPhysicsWorld(world: PhysicsWorld): void {
    this.physicsWorld = world;
  }

  /**
   * Aplica knockback a un personaje.
   * @param character El personaje (enemigo) a afectar
   * @param attackerPos Posición del atacante
   * @param config Configuración del knockback
   * @param damage Daño infligido (para escalar)
   * @param knockbackResistance Resistencia al knockback (0-1)
   */
  applyKnockback(
    character: Character,
    attackerPos: THREE.Vector3,
    config: KnockbackConfig,
    damage: number,
    knockbackResistance: number
  ): void {
    if (!this.physicsWorld) {
      console.warn('[Knockback] PhysicsWorld no establecido, no se puede aplicar knockback');
      return;
    }

    const bodyHandle = (character as any).physicsBody;
    if (!bodyHandle) {
      console.warn('[Knockback] Personaje no tiene cuerpo físico, ignorando knockback');
      return;
    }

    const body = this.physicsWorld.getBody(bodyHandle);
    if (!body) {
      console.warn('[Knockback] No se pudo obtener cuerpo físico del personaje');
      return;
    }

    // Calcular dirección del knockback (desde atacante hacia enemigo)
    const enemyPos = new THREE.Vector3();
    const translation = body.translation();
    enemyPos.set(translation.x, translation.y, translation.z);
    
    const dir = enemyPos.clone().sub(attackerPos).normalize();
    if (dir.lengthSq() < 0.001) {
      dir.set(1, 0, 0); // fallback
    }

    // Calcular fuerza base
    let strength = config.baseStrength;
    if (config.scaleWithDamage) {
      strength *= (1 + damage * config.damageScaleFactor);
    }

    // Aplicar resistencia
    const effectiveStrength = strength * (1 - knockbackResistance);
    if (effectiveStrength <= 0.01) {
      console.log(`[Knockback] Knockback resistido completamente (resistencia: ${knockbackResistance})`);
      return;
    }

    const force = dir.multiplyScalar(effectiveStrength);

    // Aplicar impulso al cuerpo Rapier
    // Rapier usa applyImpulse para aplicar un impulso lineal instantáneo
    body.applyImpulse({ x: force.x, y: force.y, z: force.z }, true);

    console.log(`[Knockback] Aplicado knockback a ${character.id}: fuerza=(${force.x.toFixed(2)}, ${force.y.toFixed(2)}, ${force.z.toFixed(2)}), resistencia=${knockbackResistance}`);

    // Registrar estado de knockback
    const state: KnockbackState = {
      force: force.clone(),
      remainingTime: config.duration,
      active: true,
      onFinish: () => {
        // Restaurar steering (debe ser implementado por el enemigo)
        if ((character as any).enableSteering) {
          (character as any).enableSteering();
        }
      }
    };

    this.knockbackStates.set(character.id, state);

    // Deshabilitar steering temporalmente
    if ((character as any).disableSteering) {
      (character as any).disableSteering();
    }

    // Emitir evento de knockback (opcional)
    if ((character as any).eventBus) {
      (character as any).eventBus.emit('enemy:knockback', {
        enemyId: character.id,
        force: { x: force.x, y: force.y, z: force.z },
        duration: config.duration
      });
    }
  }

  /**
   * Actualiza los estados de knockback (debe llamarse cada frame).
   * @param deltaTime Tiempo transcurrido en segundos
   */
  update(deltaTime: number): void {
    for (const [id, state] of this.knockbackStates) {
      if (!state.active) continue;

      state.remainingTime -= deltaTime;
      if (state.remainingTime <= 0) {
        state.active = false;
        if (state.onFinish) {
          state.onFinish();
        }
        console.log(`[Knockback] Knockback terminado para ${id}`);
      }
    }

    // Limpiar estados inactivos
    for (const [id, state] of this.knockbackStates) {
      if (!state.active) {
        this.knockbackStates.delete(id);
      }
    }
  }

  /**
   * Cancela el knockback activo para un personaje.
   */
  cancelKnockback(characterId: string): void {
    const state = this.knockbackStates.get(characterId);
    if (state) {
      state.active = false;
      if (state.onFinish) {
        state.onFinish();
      }
      this.knockbackStates.delete(characterId);
    }
  }

  /**
   * Verifica si un personaje está bajo efecto de knockback.
   */
  isKnockedBack(characterId: string): boolean {
    const state = this.knockbackStates.get(characterId);
    return state ? state.active : false;
  }
}

/**
 * Configuraciones predefinidas de knockback.
 */
export const KnockbackPresets = {
  /** Knockback ligero (para enemigos básicos) */
  LIGHT: {
    baseStrength: 8,
    duration: 0.3,
    scaleWithDamage: true,
    damageScaleFactor: 0.05
  } as KnockbackConfig,
  /** Knockback medio (para golpes fuertes) */
  MEDIUM: {
    baseStrength: 15,
    duration: 0.5,
    scaleWithDamage: true,
    damageScaleFactor: 0.08
  } as KnockbackConfig,
  /** Knockback fuerte (para habilidades especiales) */
  HEAVY: {
    baseStrength: 25,
    duration: 0.8,
    scaleWithDamage: true,
    damageScaleFactor: 0.1
  } as KnockbackConfig,
  /** Sin knockback (para tanques) */
  NONE: {
    baseStrength: 0,
    duration: 0,
    scaleWithDamage: false,
    damageScaleFactor: 0
  } as KnockbackConfig
};