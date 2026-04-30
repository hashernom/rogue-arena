import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Enemy, type EnemyStats, type SpawnOptions, EnemyState, EnemyType } from './Enemy';
import { CharacterState } from '../characters/Character';
import type { EventBus } from '../engine/EventBus';
import type { SceneManager } from '../engine/SceneManager';
import type { PhysicsWorld, RigidBodyHandle } from '../physics/PhysicsWorld';
import { BodyFactory } from '../physics/BodyFactory';
import { TilemapLoader } from '../map/TilemapLoader';
import {
  seek,
  separation,
  avoidObstacles,
  combineForces,
  applyAcceleration,
  DEFAULT_MELEE_WEIGHTS,
  DEFAULT_SEPARATION_RADIUS,
  MAX_SEPARATION_NEIGHBORS,
  DEFAULT_AVOID_LOOK_AHEAD,
  DEFAULT_AVOID_RADIUS,
  DEFAULT_AVOID_WEIGHT,
  type SteeringAgent,
} from './SteeringBehaviors';

// =================================================================
// STATS BASE PARA EnemyBasic
// =================================================================

/**
 * Estadísticas base para el enemigo básico (seek melee).
 * - hp: 40, baja vida -> se elimina rápido
 * - speed: 2.5, velocidad media
 * - damage: 8, daño moderado cuerpo a cuerpo
 * - armor: 0, sin protección
 * - knockbackResistance: 0, vulnerable a knockback
 * - reward: 3, recompensa baja
 */
export const ENEMY_BASIC_STATS: EnemyStats = {
  hp: 40,
  maxHp: 40,
  speed: 2.5,
  damage: 8,
  attackSpeed: 1.0,
  range: 0.6,
  armor: 0,
  knockbackResistance: 0,
  reward: 3,
};

// =================================================================
// CLASE EnemyBasic
// =================================================================

/**
 * Enemigo básico con comportamiento de seek hacia el jugador más cercano.
 *
 * Características:
 * - Persigue al jugador más cercano (cambia de target dinámicamente)
 * - Ataque cuerpo a cuerpo cuando está a < 0.6m con cadencia según attackSpeed
 * - Usa el mismo modelo de esqueleto que SkeletonMinion pero con color rojo
 * - Usa el pool lifecycle de Enemy (spawn, release, reset, dispose)
 * - Compatible con el sistema de knockback existente
 * - No atraviesa muros (Rapier lo maneja vía BodyFactory.createEnemyBody)
 */
export class EnemyBasic extends Enemy {
  // ========== ATAQUE MELEE ==========
  /** Timestamp del último ataque (para control de cadencia) */
  private lastAttackTime: number = 0;
  /** Indica si el enemigo está en rango de ataque */
  private isInAttackRange: boolean = false;
  /** Tiempo mínimo (ms) que la animación de ataque debe verse antes de允许 Idle */
  private readonly ATTACK_ANIM_DURATION_MS: number = 600;

  /**
   * Crea un nuevo EnemyBasic
   */
  constructor(
    id: string,
    eventBus: EventBus,
    sceneManager: SceneManager,
    physicsWorld?: PhysicsWorld,
    physicsBody?: RigidBodyHandle,
    color: number = 0xcccccc,
    size: number = 1.0,
    knockbackResistance: number = 0.0,
    type: EnemyType = EnemyType.Basic,
    stats?: EnemyStats
  ) {
    // Usar ENEMY_BASIC_STATS si no se proporcionan stats
    const effectiveStats = stats || ENEMY_BASIC_STATS;

    // Llamar al constructor de Enemy con skipModelLoad=true para evitar
    // que Enemy cargue el modelo del esqueleto (lo haremos nosotros aquí)
    super(
      id,
      eventBus,
      sceneManager,
      physicsWorld,
      physicsBody,
      color,
      size,
      knockbackResistance,
      type,
      effectiveStats,
      true // skipModelLoad — nosotros manejamos la carga
    );

    // Cargar el modelo de esqueleto inmediatamente
    this.loadSkeletonModel(color);
  }

  // =================================================================
  // CARGA DE MODELO (esqueleto con textura original)
  // =================================================================

  /**
   * Carga el modelo de esqueleto reutilizando la carga compartida de Enemy.
   * Si el modelo compartido aún no está disponible, se suscribe a la promesa.
   */
  private loadSkeletonModel(_color: number): void {
    // Intentar obtener el modelo compartido de Enemy (getter estático)
    const sharedModel = Enemy.getSharedModelScene();

    if (sharedModel) {
      // El modelo ya está cargado — clonar inmediatamente (síncrono)
      this.cloneSkeleton(sharedModel);
      return;
    }

    // Si no está disponible, suscribirse a la promesa de carga
    const loadPromise = Enemy.getSharedLoadPromise();
    if (loadPromise) {
      loadPromise.then((scene: THREE.Group) => {
        this.cloneSkeleton(scene);
      }).catch(err => {
        console.error(`[EnemyBasic ${this.id}] Error en carga compartida:`, err);
      });
      return;
    }

    // Si no hay promesa ni modelo, el modelo nunca se cargó
    // Esto no debería pasar porque los skeletons se crean antes en main.ts
    console.warn(`[EnemyBasic ${this.id}] Modelo compartido no disponible — los skeletons se crean antes`);
  }

  /**
   * Clona el modelo de esqueleto compartido (sin modificar colores,
   * preservando la textura original del GLTF).
   *
   * IMPORTANTE: Este método puede ejecutarse de forma diferida (vía promesa)
   * después de que spawn() ya haya corrido. Por eso:
   * 1. Aplica this.targetPosition al modelo (spawn() no pudo porque !this.model)
   * 2. Crea el physics body en la posición correcta
   * 3. Aplica la escala inicial de spawn animation si es necesario
   *
   * NOTA: El modelo base ya tiene rotation.y = Math.PI aplicado en
   * Enemy.ensureModelLoaded() / loadModel(). SkeletonUtils.clone() hereda
   * esa rotación, por lo que NO debemos rotar el innerMesh nuevamente.
   */
  private cloneSkeleton(sourceScene: THREE.Group): void {
    try {
      // Clonar con SkeletonUtils para preservar skinning
      const cloned = SkeletonUtils.clone(sourceScene) as THREE.Group;

      // Usar setupModel de Enemy (protected) para configurar el modelo
      this.setupModel(cloned);

      // Aplicar la posición de spawn al modelo (spawn() corrió antes sin modelo)
      this.model!.position.copy(this.targetPosition);

      // Si el enemigo está en estado Spawning, aplicar escala inicial de spawn animation
      if (this.enemyState === EnemyState.Spawning) {
        this.model!.scale.set(0.0001, 0.0001, 0.0001);
      }

      // Almacenar colores originales (para hit flash)
      this.storeOriginalColor();

      // Crear cuerpo físico en la posición correcta
      if (!this.physicsBody && this.physicsWorld) {
        this.createPhysicsBody();
      }

      console.log(`[EnemyBasic ${this.id}] Modelo de esqueleto cargado y configurado en (${this.targetPosition.x}, ${this.targetPosition.y}, ${this.targetPosition.z})`);
    } catch (error) {
      console.error(`[EnemyBasic ${this.id}] Error clonando modelo:`, error);
    }
  }

  // =================================================================
  // FÍSICA
  // =================================================================

  /**
   * Crea el cuerpo físico usando BodyFactory.
   */
  protected createPhysicsBody(): void {
    if (!this.physicsWorld || !this.model) return;

    try {
      const bodyHandle = BodyFactory.createEnemyBody(
        this.physicsWorld,
        new THREE.Vector3(
          this.model.position.x,
          this.model.position.y,
          this.model.position.z
        ),
        'small',
        this.id,
        this
      );

      this.physicsBody = bodyHandle;
      console.log(`[EnemyBasic ${this.id}] Cuerpo físico creado`);
    } catch (error) {
      console.error(`[EnemyBasic ${this.id}] Error creando cuerpo físico:`, error);
    }
  }

  // =================================================================
  // IA: SEEK AL JUGADOR MÁS CERCANO
  // =================================================================

  /**
   * Encuentra el jugador más cercano a la posición del enemigo.
   * Ignora jugadores muertos (isAlive() === false).
   * Zero-garbage: no crea objetos temporales en el game loop.
   */
  private getClosestPlayer(players: any[]): any | null {
    if (players.length === 0) return null;

    let closestPlayer: any | null = null;
    let closestDistanceSq = Infinity;

    const enemyPos = this.model ? this.model.position : new THREE.Vector3(0, 0, 0);

    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      // Ignorar jugadores sin getPosition, sin isAlive, o muertos
      if (!player || !player.getPosition || !player.isAlive) continue;
      if (!player.isAlive()) continue;

      const playerPos = player.getPosition();
      if (!playerPos) continue;

      const dx = playerPos.x - enemyPos.x;
      const dz = playerPos.z - enemyPos.z;
      const distSq = dx * dx + dz * dz;

      if (distSq < closestDistanceSq) {
        closestDistanceSq = distSq;
        closestPlayer = player;
      }
    }

    return closestPlayer;
  }

  /**
   * Aplica daño cuerpo a cuerpo al jugador objetivo.
   * Respeta la cadencia de ataque según attackSpeed.
   * Reproduce la animación de ataque (one-shot, sin loop) si está disponible.
   * @returns true si el ataque se ejecutó, false si estaba en cooldown.
   */
  private tryMeleeAttack(target: any): boolean {
    const now = Date.now();
    const attackSpeed = this.getEffectiveStat('attackSpeed');
    const cooldownMs = attackSpeed > 0 ? 1000 / attackSpeed : 1000;

    if (now - this.lastAttackTime < cooldownMs) return false;

    this.lastAttackTime = now;

    // Reproducir animación de ataque (one-shot, sin loop)
    this.playAnimation('Attack', false);

    const damage = this.getEffectiveStat('damage');
    if (target && typeof target.takeDamage === 'function') {
      target.takeDamage(damage);
      console.log(`[EnemyBasic ${this.id}] Ataque cuerpo a cuerpo a ${target.id}: ${damage} daño`);
    }

    return true;
  }

  /**
   * Actualiza la IA del enemigo: seek al jugador más cercano + ataque melee.
   * Zero-garbage: no instancia nuevos objetos en el game loop.
   */
  updateAI(dt: number, players: any[], world?: any, activeEnemies?: any[]): void {
    if (!this.model || players.length === 0) return;
    if (this.enemyState !== EnemyState.Active) return;
    if (!this.steeringEnabled) return;

    // 1. Encontrar el jugador más cercano
    const target = this.getClosestPlayer(players);
    if (!target || !target.getPosition) return;

    const targetPos = target.getPosition();
    if (!targetPos) return;

    const enemyPos = this.model.position;

    // 2. Calcular dirección y distancia
    const dx = targetPos.x - enemyPos.x;
    const dz = targetPos.z - enemyPos.z;
    const distSq = dx * dx + dz * dz;

    // 3. Verificar si está en rango de ataque (0.9m — ajustado al nuevo radio de collider 0.45)
    const attackRangeSq = 0.9 * 0.9;
    this.isInAttackRange = distSq <= attackRangeSq;

    if (this.isInAttackRange) {
      // 3a. Atacar cuerpo a cuerpo
      const didAttack = this.tryMeleeAttack(target);

      // Detener movimiento mientras ataca
      if (this.physicsBody && this.physicsWorld) {
        const body = this.physicsWorld.getBody(this.physicsBody);
        if (body) {
          body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
      }

      // Solo reproducir Idle si NO se ejecutó un ataque (está en cooldown)
      // Y si ha pasado suficiente tiempo desde el último ataque para que
      // la animación de Attack se haya visto completa.
      const now = Date.now();
      const attackAnimFinished = (now - this.lastAttackTime) >= this.ATTACK_ANIM_DURATION_MS;
      if (!didAttack && attackAnimFinished) {
        this.playAnimation('Idle');
      }
    } else {
      // 3b. Perseguir al jugador usando steering behaviors
      const dist = Math.sqrt(distSq);
      if (dist < 0.001) return;

      // Preparar agente para steering (solo posición)
      const agent: SteeringAgent = { position: enemyPos };

      // Preparar vecinos para separación
      const neighbors: SteeringAgent[] = [];
      if (activeEnemies) {
        for (let i = 0; i < activeEnemies.length; i++) {
          const other = activeEnemies[i];
          if (other === this || !other.model || !other.model.position) continue;
          neighbors.push({ position: other.model.position });
        }
      }

      // Calcular steering forces
      const seekForce = seek(agent, targetPos);
      const sepForce = separation(agent, neighbors, DEFAULT_SEPARATION_RADIUS, MAX_SEPARATION_NEIGHBORS);
      const avoidForce = avoidObstacles(agent, TilemapLoader.obstaclePositions, seekForce, DEFAULT_AVOID_LOOK_AHEAD, DEFAULT_AVOID_RADIUS);

      // Combinar con pesos
      const { direction, hasMovement } = combineForces([
        [seekForce, DEFAULT_MELEE_WEIGHTS.seek],
        [sepForce, DEFAULT_MELEE_WEIGHTS.separation],
        [avoidForce, DEFAULT_AVOID_WEIGHT],
      ]);

      if (!hasMovement) return;

      // Aplicar aceleración suave
      const moveSpeed = this.getEffectiveStat('speed');
      applyAcceleration(this.currentSteeringVel, direction, moveSpeed, this.maxAcceleration, dt);

      // ================================================================
      // ROTACIÓN: el modelo base tiene rotation.y = Math.PI (aplicado en
      // ensureModelLoaded/loadModel), por lo que el forward efectivo es -Z.
      // Math.atan2(dirX, dirZ) asume forward = +Z, así que sumamos PI
      // para que el modelo (forward = -Z) mire hacia el jugador.
      // ================================================================
      const targetAngle = Math.atan2(direction.x, direction.y) + Math.PI;
      this.model.rotation.y = THREE.MathUtils.lerp(
        this.model.rotation.y,
        targetAngle,
        0.1
      );

      // Mover usando setLinvel con velocidad suave
      if (this.physicsBody && this.physicsWorld) {
        const body = this.physicsWorld.getBody(this.physicsBody);
        if (body) {
          body.setLinvel({
            x: this.currentSteeringVel.x,
            y: 0,
            z: this.currentSteeringVel.y,
          }, true);
        }
      }

      // Animación de caminar
      this.playAnimation('Walk');
    }
  }

  // =================================================================
  // UPDATE (override)
  // =================================================================

  /**
   * Actualiza el enemigo cada frame.
   * Delega en super.update() para spawn animation, death animation,
   * HP bar, hit particles y sync de física.
   */
  update(dt: number): void {
    super.update(dt);
  }

  // =================================================================
  // POOL LIFECYCLE (override)
  // =================================================================

  /**
   * Spawnea el enemigo en una posición específica
   */
  spawn(options: SpawnOptions): void {
    super.spawn(options);

    // Recrear cuerpo físico si fue destruido
    if (!this.physicsBody && this.physicsWorld && this.model) {
      this.createPhysicsBody();
    }

    // Activar cuerpo físico
    if (this.physicsBody && this.physicsWorld) {
      const body = this.physicsWorld.getBody(this.physicsBody);
      if (body) {
        body.setTranslation(
          { x: options.position.x, y: options.position.y, z: options.position.z },
          true
        );
        body.setEnabled(true);
      }
    }
  }

  /**
   * Libera recursos del enemigo (para ser reutilizado por el pool)
   */
  release(): void {
    if (this.isPooled) return;
    super.release();
    this.isPooled = true;
    console.log(`[EnemyBasic ${this.id}] Liberado al pool`);
  }

  /**
   * Prepara el enemigo para reutilización
   */
  reset(): void {
    super.reset();

    if (this.physicsBody && this.physicsWorld) {
      const body = this.physicsWorld.getBody(this.physicsBody);
      if (body) {
        body.setEnabled(true);
      }
    }
  }

  /**
   * Libera todos los recursos del enemigo (disposición completa)
   */
  dispose(): void {
    super.dispose();
    console.log(`[EnemyBasic ${this.id}] Recursos liberados completamente`);
  }
}
