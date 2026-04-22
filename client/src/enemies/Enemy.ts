import * as THREE from 'three';
import { Character, type CharacterStats, CharacterState } from '../characters/Character';
import type { PhysicsWorld, RigidBodyHandle } from '../physics/PhysicsWorld';
import { EventBus } from '../engine/EventBus';
import { SceneManager } from '../engine/SceneManager';
import { BodyFactory } from '../physics/BodyFactory';

/**
 * Tipos de enemigos disponibles en el juego
 */
export enum EnemyType {
  SkeletonMinion = 'skeleton_minion',
  SkeletonWarrior = 'skeleton_warrior',
  SkeletonRogue = 'skeleton_rogue',
  SkeletonMage = 'skeleton_mage',
  // Futuros tipos pueden agregarse aquí
}

/**
 * Estadísticas específicas de enemigos (extiende CharacterStats)
 */
export interface EnemyStats extends CharacterStats {
  /** Resistencia al knockback (0-1 donde 1 es inmune) */
  knockbackResistance: number;
  /** Recompensa en monedas al morir */
  reward: number;
}

/**
 * Estados específicos de enemigos
 */
export enum EnemyState {
  /** Enemigo siendo creado (invisible, sin colisiones) */
  Spawning = 'spawning',
  /** Enemigo activo y listo para interactuar */
  Active = 'active',
  /** Enemigo muerto (en animación de muerte) */
  Dying = 'dying',
  /** Enemigo completamente muerto (listo para liberar) */
  Dead = 'dead',
}

/**
 * Opciones para spawnear un enemigo
 */
export interface SpawnOptions {
  position: THREE.Vector3;
  rotation?: number;
  scale?: number;
}

/**
 * Clase abstracta base para todos los enemigos del juego.
 * Extiende Character y añade funcionalidades específicas de enemigos:
 * - Gestión de ciclo de vida (spawn, die, pool)
 * - Recompensas
 * - Estados específicos
 * - IA abstracta
 */
export abstract class Enemy extends Character {
  /** Tipo de enemigo */
  public readonly type: EnemyType;
  /** Recompensa en monedas al morir */
  protected reward: number;
  /** Estado específico del enemigo */
  protected enemyState: EnemyState = EnemyState.Spawning;
  /** Referencia al SceneManager para agregar/remover modelos */
  protected sceneManager?: SceneManager;
  /** Modelo visual del enemigo */
  protected model: THREE.Object3D | null = null;
  /** Tiempo de inicio del spawn (para animaciones) */
  protected spawnStartTime: number = 0;
  /** Duración del spawn en ms */
  protected readonly SPAWN_DURATION = 500;
  /** Indica si el enemigo está listo para ser reutilizado por el pool */
  private isPooled: boolean = false;

  /**
   * Crea un nuevo enemigo
   * @param enemyId - Identificador único del enemigo (UUID)
   * @param type - Tipo de enemigo
   * @param stats - Estadísticas del enemigo
   * @param eventBus - Bus de eventos para comunicación
   * @param sceneManager - Manager de escena para agregar modelos
   * @param physicsWorld - Mundo físico opcional para colisiones
   * @param physicsBody - Cuerpo físico opcional (si ya existe)
   */
  constructor(
    enemyId: string,
    type: EnemyType,
    stats: EnemyStats,
    eventBus: EventBus,
    sceneManager?: SceneManager,
    physicsWorld?: PhysicsWorld,
    physicsBody?: RigidBodyHandle
  ) {
    super(enemyId, stats, eventBus, physicsWorld, physicsBody);
    
    this.type = type;
    this.reward = stats.reward;
    this.knockbackResistance = stats.knockbackResistance;
    this.sceneManager = sceneManager;
    this.enemyState = EnemyState.Spawning;
    this.spawnStartTime = Date.now();
  }

  /**
   * Método abstracto para la IA del enemigo
   * @param dt - Delta time en segundos
   * @param players - Lista de jugadores en el juego
   * @param world - Referencia al mundo del juego (opcional)
   */
  abstract updateAI(dt: number, players: any[], world?: any): void;

  /**
   * Actualiza el enemigo (llamado cada frame)
   * @param dt - Delta time en segundos
   */
  update(dt: number): void {
    // Manejar lógica de spawn si está en estado Spawning
    if (this.enemyState === EnemyState.Spawning) {
      this.updateSpawnAnimation();
    }

    // Si está activo, ejecutar IA
    if (this.enemyState === EnemyState.Active) {
      // Obtener jugadores del juego (por ahora placeholder)
      const players: any[] = [];
      this.updateAI(dt, players);
    }

    // Sincronizar modelo con física si existe
    if (this.model && this.physicsBody && this.physicsWorld) {
      this.syncModelWithPhysics();
    }
  }

  /**
   * Actualiza la animación de spawn (aparecer gradualmente)
   */
  protected updateSpawnAnimation(): void {
    const elapsed = Date.now() - this.spawnStartTime;
    const progress = Math.min(elapsed / this.SPAWN_DURATION, 1);

    if (this.model) {
      // Escalar de 0 a 1 durante el spawn
      const scale = progress;
      this.model.scale.set(scale, scale, scale);
    }

    // Si la animación de spawn ha terminado, activar el enemigo
    if (progress >= 1) {
      this.enemyState = EnemyState.Active;
      console.log(`[Enemy ${this.id}] Spawn completado`);
    }
  }

  /**
   * Sincroniza el modelo visual con la posición física
   */
  protected syncModelWithPhysics(): void {
    if (!this.model || !this.physicsBody || !this.physicsWorld) return;

    const body = this.physicsWorld.getBody(this.physicsBody);
    if (!body) return;

    const pos = body.translation();
    this.model.position.set(pos.x, pos.y, pos.z);
  }

  /**
   * Aplica daño al enemigo
   * @param amount - Cantidad de daño a aplicar
   */
  takeDamage(amount: number): void {
    // Solo puede recibir daño si está activo
    if (this.enemyState !== EnemyState.Active) return;

    // Aplicar daño usando la lógica del padre
    super.takeDamage(amount);

    // Emitir evento de daño recibido
    const position = this.model ? this.model.position : new THREE.Vector3(0, 0, 0);
    this.eventBus.emit('enemy:damage', {
      enemyId: this.id,
      damage: amount,
      attackerId: 'unknown',
      position: { x: position.x, y: position.y, z: position.z } as THREE.Vector3,
    });

    // Si el enemigo muere, iniciar muerte
    if (!this.isAlive()) {
      this.die();
    }
  }

  /**
   * Mata al enemigo e inicia la animación de muerte
   */
  die(): void {
    if (this.enemyState === EnemyState.Dying || this.enemyState === EnemyState.Dead) return;

    this.enemyState = EnemyState.Dying;
    this.state = CharacterState.Dead;

    // Emitir evento de muerte con recompensa
    const position = this.model ? this.model.position : new THREE.Vector3(0, 0, 0);
    this.eventBus.emit('enemy:died', {
      enemyId: this.id,
      position: { x: position.x, y: position.y, z: position.z } as THREE.Vector3,
      reward: this.reward,
    });

    console.log(`[Enemy ${this.id}] Murió, recompensa: ${this.reward}`);

    // Iniciar animación de muerte
    this.startDeathAnimation();
  }

  /**
   * Inicia la animación de muerte (debe ser implementada por subclases)
   */
  protected abstract startDeathAnimation(): void;

  /**
   * Spawnea el enemigo en una posición específica
   * @param options - Opciones de spawn (posición, rotación, escala)
   */
  spawn(options: SpawnOptions): void {
    this.enemyState = EnemyState.Spawning;
    this.spawnStartTime = Date.now();
    this.isPooled = false;

    // Establecer posición
    if (this.model) {
      this.model.position.copy(options.position);
      if (options.rotation !== undefined) {
        this.model.rotation.y = options.rotation;
      }
      if (options.scale !== undefined) {
        this.model.scale.set(options.scale, options.scale, options.scale);
      }
    }

    // Establecer posición física si existe
    if (this.physicsBody && this.physicsWorld) {
      const body = this.physicsWorld.getBody(this.physicsBody);
      if (body) {
        body.setTranslation(options.position, true);
      }
    }

    console.log(`[Enemy ${this.id}] Spawneado en ${options.position.x}, ${options.position.y}, ${options.position.z}`);
  }

  /**
   * Libera recursos del enemigo (para ser reutilizado por el pool)
   */
  release(): void {
    if (this.isPooled) return;

    // Ocultar modelo
    if (this.model) {
      this.model.visible = false;
    }

    // Desactivar cuerpo físico si existe
    if (this.physicsBody && this.physicsWorld) {
      const body = this.physicsWorld.getBody(this.physicsBody);
      if (body) {
        body.setEnabled(false);
      }
    }

    this.enemyState = EnemyState.Dead;
    this.isPooled = true;
    console.log(`[Enemy ${this.id}] Liberado al pool`);
  }

  /**
   * Prepara el enemigo para reutilización (reset de estado)
   */
  reset(): void {
    // Restaurar HP
    const maxHp = this.statsSystem.getStat('maxHp');
    this.statsSystem.setBaseStat('hp', maxHp);

    // Resetear estado
    this.enemyState = EnemyState.Spawning;
    this.spawnStartTime = Date.now();
    this.state = CharacterState.Idle;
    this.isPooled = false;

    // Mostrar modelo
    if (this.model) {
      this.model.visible = true;
      this.model.scale.set(0, 0, 0); // Comenzar escalado a cero para animación de spawn
    }

    // Activar cuerpo físico si existe
    if (this.physicsBody && this.physicsWorld) {
      const body = this.physicsWorld.getBody(this.physicsBody);
      if (body) {
        body.setEnabled(true);
      }
    }
  }

  /**
   * Verifica si el enemigo está vivo
   * @returns true si el enemigo está activo
   */
  isAlive(): boolean {
    return this.enemyState === EnemyState.Active || this.enemyState === EnemyState.Spawning;
  }

  /**
   * Verifica si el enemigo está listo para ser reutilizado por el pool
   * @returns true si el enemigo está en estado Dead y marcado como pooled
   */
  isReadyForPool(): boolean {
    return this.isPooled && this.enemyState === EnemyState.Dead;
  }

  /**
   * Obtiene el estado actual del enemigo
   */
  getEnemyState(): EnemyState {
    return this.enemyState;
  }

  /**
   * Obtiene la recompensa del enemigo
   */
  getReward(): number {
    return this.reward;
  }

  /**
   * Libera todos los recursos del enemigo (disposición completa, no para pool)
   */
  dispose(): void {
    // Remover modelo de la escena
    if (this.model && this.sceneManager) {
      this.sceneManager.remove(this.model);
      // Nota: No disponemos la geometría/material aquí porque pueden ser reutilizados por el pool
      this.model = null;
    }

    // Remover cuerpo físico (si no es manejado por el pool)
    if (this.physicsBody && this.physicsWorld && !this.isPooled) {
      this.physicsWorld.removeBody(this.physicsBody);
      this.physicsBody = undefined;
    }

    console.log(`[Enemy ${this.id}] Recursos liberados completamente`);
  }
}