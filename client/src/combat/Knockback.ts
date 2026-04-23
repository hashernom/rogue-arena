import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { Character } from '../characters/Character';

/**
 * Configuración del knockback.
 */
export interface KnockbackConfig {
  /** Fuerza base del knockback (unidades/segundo de velocidad) */
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
 * Almacena la velocidad de knockback que se aplica cada frame via setLinvel().
 */
export interface KnockbackState {
  /** Handle del cuerpo Rapier */
  bodyHandle: any;
  /** Velocidad de knockback a aplicar cada frame (unidades/segundo) */
  velocity: THREE.Vector3;
  /** Duración total del knockback en segundos */
  duration: number;
  /** Tiempo transcurrido desde que comenzó el knockback */
  elapsedTime: number;
  /** Si el knockback está activo */
  active: boolean;
  /** Callback para restaurar el steering */
  onFinish?: () => void;
}

/**
 * Sistema de knockback para cuerpos dinámicos con masa alta.
 *
 * Los cuerpos dinámicos con masa alta (10000) ignoran fuerzas externas
 * como colisiones con el player, pero setLinvel() funciona para controlar
 * su movimiento. Esto permite colisiones confiables player-enemy.
 *
 * Esto permite:
 * - Enemigos que NO son empujados por personajes al colisionar
 * - Enemigos que SÍ reciben knockback vía setLinvel()
 * - Colisiones entre personajes y enemigos funcionan correctamente
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
   * Aplica knockback a un personaje (enemigo).
   * Calcula la velocidad de knockback y la almacena en el estado.
   * La velocidad se aplica cada frame en update() via setLinvel().
   *
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

    // Obtener posición actual del cuerpo
    const translation = body.translation();
    const enemyPos = new THREE.Vector3(translation.x, translation.y, translation.z);

    // Calcular dirección del knockback (desde atacante hacia enemigo)
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

    // Calcular velocidad de knockback = dirección * fuerza (unidades/segundo)
    const velocity = dir.clone().multiplyScalar(effectiveStrength);

    console.log(
      `[Knockback] Aplicado knockback a ${character.id}: ` +
      `velocidad=(${velocity.x.toFixed(2)}, ${velocity.y.toFixed(2)}, ${velocity.z.toFixed(2)}), ` +
      `resistencia=${knockbackResistance}, duración=${config.duration}s`
    );

    // Registrar estado de knockback
    const state: KnockbackState = {
      bodyHandle: bodyHandle,
      velocity: velocity.clone(),
      duration: config.duration,
      elapsedTime: 0,
      active: true,
      onFinish: () => {
        // Restaurar steering
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

    // Emitir evento de knockback
    if ((character as any).eventBus) {
      (character as any).eventBus.emit('enemy:knockback', {
        enemyId: character.id,
        force: { x: velocity.x, y: velocity.y, z: velocity.z },
        duration: config.duration
      });
    }
  }

  /**
   * Actualiza los estados de knockback cada frame.
   * Aplica setLinvel() para mover el cuerpo dinámico.
   *
   * @param deltaTime Tiempo transcurrido en segundos
   */
  update(deltaTime: number): void {
    if (!this.physicsWorld) return;

    for (const [id, state] of this.knockbackStates) {
      if (!state.active) continue;

      // Avanzar tiempo
      state.elapsedTime += deltaTime;

      // Aplicar velocidad de knockback via setLinvel
      const body = this.physicsWorld.getBody(state.bodyHandle);
      if (body) {
        body.setLinvel({
          x: state.velocity.x,
          y: 0,
          z: state.velocity.z
        }, true);
      }

      // Si se completó la duración, finalizar
      if (state.elapsedTime >= state.duration) {
        state.active = false;

        // Restaurar velocidad a 0 para que el enemigo no siga deslizándose
        const finishBody = this.physicsWorld.getBody(state.bodyHandle);
        if (finishBody) {
          finishBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }

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

      // Restaurar velocidad a 0
      if (this.physicsWorld) {
        const body = this.physicsWorld.getBody(state.bodyHandle);
        if (body) {
          body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
      }

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
};
