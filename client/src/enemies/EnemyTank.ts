import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Enemy, type EnemyStats, type SpawnOptions, EnemyState, EnemyType } from './Enemy';
import { CharacterState } from '../characters/Character';
import type { EventBus } from '../engine/EventBus';
import type { SceneManager } from '../engine/SceneManager';
import type { PhysicsWorld, RigidBodyHandle } from '../physics/PhysicsWorld';
import { BodyFactory } from '../physics/BodyFactory';
import { AssetLoader } from '../engine/AssetLoader';

// =================================================================
// STATS BASE PARA EnemyTank
// =================================================================

/**
 * Estadísticas base para el enemigo tanque (alta vida, lento, mucho daño).
 * - hp: 200, muy alta -> absorbe mucho daño
 * - speed: 1.5, muy lento
 * - damage: 15, alto daño por golpe
 * - armor: 5, resistencia media
 * - knockbackResistance: 1.0, inmune a knockback
 * - reward: 8, recompensa alta
 */
export const ENEMY_TANK_STATS: EnemyStats = {
  hp: 200,
  maxHp: 200,
  speed: 1.5,
  damage: 15,
  attackSpeed: 0.8,
  range: 0.8,
  armor: 5,
  knockbackResistance: 1.0,
  reward: 8,
};

// =================================================================
// CARGA ESTÁTICA DEL MODELO WARRIOR (separada del Minion compartido)
// =================================================================

/** AssetLoader dedicado para el modelo Warrior */
const warriorAssetLoader = new AssetLoader();
/** Escena original del GLTF Warrior (se clona con SkeletonUtils.clone()) */
let warriorModelScene: THREE.Group | null = null;
/** Promesa de carga del modelo Warrior */
let warriorLoadPromise: Promise<THREE.Group> | null = null;

/**
 * Carga el modelo Skeleton_Warrior.glb de forma estática (similar a
 * Enemy.ensureModelLoaded() pero para el modelo de Warrior).
 *
 * Es seguro llamarlo múltiples veces — si ya está cargado o cargando, no hace nada.
 * @returns Promesa que resuelve cuando el modelo Warrior está disponible
 */
export async function ensureWarriorModelLoaded(): Promise<void> {
  if (warriorModelScene) return;
  if (warriorLoadPromise) {
    await warriorLoadPromise;
    return;
  }

  warriorLoadPromise = new Promise(async (resolve, reject) => {
    try {
      const gltf = await warriorAssetLoader.load('/models/enemies/Skeleton_Warrior.glb');
      const model = gltf.scene;

      // Misma orientación que el Minion: rotation.y = Math.PI para que
      // el forward del modelo apunte en -Z (compatible con Three.js)
      model.scale.set(1.0, 1.0, 1.0);
      model.rotation.y = Math.PI;

      model.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      warriorModelScene = model;
      resolve(model);
    } catch (error) {
      warriorLoadPromise = null;
      console.error('[EnemyTank] Error cargando modelo Warrior:', error);
      reject(error);
    }
  });

  await warriorLoadPromise;
}

// =================================================================
// CLASE EnemyTank
// =================================================================

/**
 * Enemigo tanque que absorbe mucho daño y ejerce presión constante
 * por su alto daño de golpe.
 *
 * Características:
 * - Alta vida (200 HP) y armadura (5)
 * - Movimiento lento (1.5 speed)
 * - Alto daño por golpe (15 damage)
 * - Inmune a knockback (knockbackResistance = 1.0)
 * - Prioriza al jugador con MENOS HP actual
 * - Usa el modelo Skeleton_Warrior.glb (más imponente)
 * - Escala 1.15× el tamaño normal (ligeramente más grande que Basic/Fast)
 * - Usa cuerpo físico 'medium' (mismo que Basic/Fast)
 */
export class EnemyTank extends Enemy {
  // ========== ATAQUE MELEE ==========
  /** Timestamp del último ataque (para control de cadencia) */
  private lastAttackTime: number = 0;
  /** Indica si el enemigo está en rango de ataque */
  private isInAttackRange: boolean = false;
  /** Tiempo mínimo (ms) que la animación de ataque debe verse antes de permitir Idle */
  private readonly ATTACK_ANIM_DURATION_MS: number = 600;

  /**
   * Crea un nuevo EnemyTank
   */
  constructor(
    id: string,
    eventBus: EventBus,
    sceneManager: SceneManager,
    physicsWorld?: PhysicsWorld,
    physicsBody?: RigidBodyHandle,
    color: number = 0xcccccc,
    size: number = 1.15,
    knockbackResistance: number = 1.0,
    type: EnemyType = EnemyType.Tank,
    stats?: EnemyStats
  ) {
    // Usar ENEMY_TANK_STATS si no se proporcionan stats
    const effectiveStats = stats || ENEMY_TANK_STATS;

    // Llamar al constructor de Enemy con skipModelLoad=true para evitar
    // que Enemy cargue el modelo Minion (cargaremos el Warrior aquí)
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
      true // skipModelLoad — nosotros manejamos la carga del Warrior
    );

    // Cargar el modelo de Warrior inmediatamente
    this.loadWarriorModel();
  }

  // =================================================================
  // CARGA DE MODELO (Skeleton_Warrior.glb)
  // =================================================================

  /**
   * Carga el modelo Skeleton_Warrior reutilizando la carga estática.
   * Si el modelo aún no está disponible, se suscribe a la promesa.
   */
  private loadWarriorModel(): void {
    if (warriorModelScene) {
      // El modelo ya está cargado — clonar inmediatamente (síncrono)
      this.cloneWarriorSkeleton(warriorModelScene);
      return;
    }

    // Si no está disponible, suscribirse a la promesa de carga
    if (warriorLoadPromise) {
      warriorLoadPromise.then((scene: THREE.Group) => {
        this.cloneWarriorSkeleton(scene);
      }).catch(err => {
        console.error(`[EnemyTank ${this.id}] Error en carga del Warrior:`, err);
      });
      return;
    }

    // Si no hay promesa ni modelo, iniciar carga ahora
    console.warn(`[EnemyTank ${this.id}] Modelo Warrior no precargado — cargando ahora`);
    ensureWarriorModelLoaded().then(() => {
      if (warriorModelScene) {
        this.cloneWarriorSkeleton(warriorModelScene);
      }
    }).catch(err => {
      console.error(`[EnemyTank ${this.id}] Error cargando modelo Warrior:`, err);
    });
  }

  /**
   * Clona el modelo Warrior compartido y lo configura para esta instancia.
   *
   * NOTA: El modelo base ya tiene rotation.y = Math.PI aplicado en
   * ensureWarriorModelLoaded(). SkeletonUtils.clone() hereda esa rotación,
   * por lo que NO debemos rotar el innerMesh nuevamente.
   */
  private cloneWarriorSkeleton(sourceScene: THREE.Group): void {
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

      console.log(`[EnemyTank ${this.id}] Modelo Warrior cargado y configurado en (${this.targetPosition.x}, ${this.targetPosition.y}, ${this.targetPosition.z})`);
    } catch (error) {
      console.error(`[EnemyTank ${this.id}] Error clonando modelo Warrior:`, error);
    }
  }

  // =================================================================
  // FÍSICA (override: usa 'medium' — mismo tamaño que Basic/Fast)
  // =================================================================

  /**
   * Crea el cuerpo físico usando BodyFactory con tamaño 'medium'.
   * El tanque es ligeramente más grande visualmente (1.15x) pero
   * comparte el mismo collider que los demás enemigos.
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
        'medium', // Mismo tamaño que Basic/Fast (radio 0.3, halfHeight 0.5)
        this.id,
        this
      );

      this.physicsBody = bodyHandle;
      console.log(`[EnemyTank ${this.id}] Cuerpo físico creado (medium)`);
    } catch (error) {
      console.error(`[EnemyTank ${this.id}] Error creando cuerpo físico:`, error);
    }
  }

  // =================================================================
  // IA: PRIORIZA AL JUGADOR MÁS CERCANO
  // =================================================================

  /**
   * Encuentra al jugador vivo más cercano.
   * El tanque es lento pero va directo al target más próximo.
   *
   * Zero-garbage: no crea objetos temporales en el game loop.
   */
  private getClosestPlayer(players: any[]): any | null {
    if (players.length === 0) return null;

    let closest: any | null = null;
    let closestDist = Infinity;

    // Posición del tanque para calcular distancia
    const enemyPos = this.model ? this.model.position : null;
    if (!enemyPos) return null;

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

      if (distSq < closestDist) {
        closestDist = distSq;
        closest = player;
      }
    }

    return closest;
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
      console.log(`[EnemyTank ${this.id}] Ataque cuerpo a cuerpo a ${target.id}: ${damage} daño`);
    }

    return true;
  }

  /**
   * Actualiza la IA del enemigo: persigue al jugador más cercano.
   * Zero-garbage: no instancia nuevos objetos en el game loop.
   */
  updateAI(dt: number, players: any[], world?: any, activeEnemies?: any[]): void {
    if (!this.model || players.length === 0) return;
    if (this.enemyState !== EnemyState.Active) return;
    if (!this.steeringEnabled) return;

    // 1. Encontrar al jugador más cercano
    const target = this.getClosestPlayer(players);
    if (!target || !target.getPosition) return;

    const targetPos = target.getPosition();
    if (!targetPos) return;

    const enemyPos = this.model.position;

    // 2. Calcular dirección y distancia hacia el target
    const dx = targetPos.x - enemyPos.x;
    const dz = targetPos.z - enemyPos.z;
    const distSq = dx * dx + dz * dz;

    // 3. Verificar si está en rango de ataque (0.8m — rango mayor por ser grande)
    const attackRangeSq = 0.8 * 0.8;
    this.isInAttackRange = distSq <= attackRangeSq;

    const now = Date.now();

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
      const attackAnimFinished = (now - this.lastAttackTime) >= this.ATTACK_ANIM_DURATION_MS;
      if (!didAttack && attackAnimFinished) {
        this.playAnimation('Idle');
      }
    } else {
      // 3b. Perseguir al target
      const dist = Math.sqrt(distSq);
      if (dist < 0.001) return;

      // Dirección normalizada hacia el target
      const dirX = dx / dist;
      const dirZ = dz / dist;

      // ================================================================
      // SEPARACIÓN: evitar que los enemigos se amontonen
      // ================================================================
      const SEPARATION_DIST = 2.0; // Mayor distancia de separación por ser grande
      const SEPARATION_FORCE = 0.8;
      let sepX = 0;
      let sepZ = 0;

      if (activeEnemies && activeEnemies.length > 0) {
        for (let i = 0; i < activeEnemies.length; i++) {
          const other = activeEnemies[i];
          if (other === this || !other.model) continue;

          const otherPos = other.model.position;
          if (!otherPos) continue;

          const ex = enemyPos.x - otherPos.x;
          const ez = enemyPos.z - otherPos.z;
          const eDistSq = ex * ex + ez * ez;

          if (eDistSq < SEPARATION_DIST * SEPARATION_DIST && eDistSq > 0.001) {
            const eDist = Math.sqrt(eDistSq);
            const strength = (SEPARATION_DIST - eDist) / SEPARATION_DIST * SEPARATION_FORCE;
            sepX += (ex / eDist) * strength;
            sepZ += (ez / eDist) * strength;
          }
        }
      }

      let moveDirX = dirX + sepX;
      let moveDirZ = dirZ + sepZ;

      // Re-normalizar después de separación
      const finalDist = Math.sqrt(moveDirX * moveDirX + moveDirZ * moveDirZ);
      if (finalDist > 0.001) {
        moveDirX /= finalDist;
        moveDirZ /= finalDist;
      }

      // ================================================================
      // ROTACIÓN: el modelo base tiene rotation.y = Math.PI (aplicado en
      // ensureWarriorModelLoaded()), por lo que el forward efectivo es -Z.
      // Math.atan2(dirX, dirZ) asume forward = +Z, así que sumamos PI
      // para que el modelo (forward = -Z) mire hacia el jugador.
      // ================================================================
      const targetAngle = Math.atan2(dirX, dirZ) + Math.PI;
      this.model.rotation.y = THREE.MathUtils.lerp(
        this.model.rotation.y,
        targetAngle,
        0.1
      );

      // Mover usando setLinvel
      const moveSpeed = this.getEffectiveStat('speed');
      if (this.physicsBody && this.physicsWorld) {
        const body = this.physicsWorld.getBody(this.physicsBody);
        if (body) {
          body.setLinvel({
            x: moveDirX * moveSpeed,
            y: 0,
            z: moveDirZ * moveSpeed,
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
    console.log(`[EnemyTank ${this.id}] Spawneado en (${options.position.x}, ${options.position.y}, ${options.position.z})`);
  }

  /**
   * Libera el enemigo de vuelta al pool
   */
  release(): void {
    super.release();
    this.lastAttackTime = 0;
    this.isInAttackRange = false;
  }

  /**
   * Resetea el enemigo para reutilización
   */
  reset(): void {
    super.reset();
    this.lastAttackTime = 0;
    this.isInAttackRange = false;
  }

  /**
   * Disposición completa de recursos
   */
  dispose(): void {
    super.dispose();
  }
}
