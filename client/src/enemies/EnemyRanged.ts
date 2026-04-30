  import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Enemy, type EnemyStats, type SpawnOptions, EnemyType, EnemyState } from './Enemy';
import { EventBus } from '../engine/EventBus';
import { SceneManager } from '../engine/SceneManager';
import { PhysicsWorld, RigidBodyHandle } from '../physics/PhysicsWorld';
import { BodyFactory } from '../physics/BodyFactory';
import { AssetLoader } from '../engine/AssetLoader';
import { ProjectilePool } from '../combat/ProjectilePool';
import { Groups, Masks } from '../physics/CollisionGroups';
import RAPIER from '@dimforge/rapier3d-compat';
import { TilemapLoader } from '../map/TilemapLoader';
import {
  seek,
  flee,
  strafeAround,
  separation,
  avoidObstacles,
  combineForces,
  applyAcceleration,
  DEFAULT_RANGED_WEIGHTS,
  DEFAULT_SEPARATION_RADIUS,
  MAX_SEPARATION_NEIGHBORS,
  DEFAULT_AVOID_LOOK_AHEAD,
  DEFAULT_AVOID_RADIUS,
  DEFAULT_AVOID_WEIGHT,
  type SteeringAgent,
} from './SteeringBehaviors';

// =================================================================
// STATS DEL ENEMIGO A DISTANCIA
// =================================================================

export const ENEMY_RANGED_STATS: EnemyStats = {
  hp: 30,
  maxHp: 30,
  speed: 2.0,
  damage: 10,
  attackSpeed: 0.67, // 1 disparo cada ~1.5s
  range: 6.0,        // Distancia preferida de combate
  armor: 0,
  knockbackResistance: 0.1,
  reward: 4,
};

// =================================================================
// CARGA ESTÁTICA DEL MODELO SKELETON_MAGE
// =================================================================

const mageAssetLoader = new AssetLoader();
let mageModelScene: THREE.Group | null = null;
let mageLoadPromise: Promise<THREE.Group> | null = null;

/**
 * Precarga el modelo Skeleton_Mage.glb de forma estática.
 * Es seguro llamarlo múltiples veces.
 */
export async function ensureMageModelLoaded(): Promise<void> {
  if (mageModelScene) return;
  if (mageLoadPromise) {
    await mageLoadPromise;
    return;
  }

  mageLoadPromise = new Promise(async (resolve, reject) => {
    try {
      const gltf = await mageAssetLoader.load('/models/enemies/Skeleton_Mage.glb');
      const model = gltf.scene;

      model.scale.set(1.0, 1.0, 1.0);
      model.rotation.y = Math.PI;

      model.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      mageModelScene = model;
      resolve(model);
    } catch (error) {
      mageLoadPromise = null;
      console.error('[EnemyRanged] Error cargando modelo Mage:', error);
      reject(error);
    }
  });

  await mageLoadPromise;
}

// =================================================================
// ENEMYRANGED
// =================================================================

/**
 * Enemigo a distancia con AI de kiting.
 * - Se mantiene a 5m del jugador más cercano
 * - Si el jugador se acerca (<4m), huye
 * - Si el jugador se aleja (>6m), se acerca
 * - Entre 4-6m, orbita (strafe) alrededor del jugador
 * - Dispara proyectiles rojos cada 1.5s si hay línea de vista
 */
export class EnemyRanged extends Enemy {
  // ========== CONSTANTES DE AI ==========

  /** Distancia preferida de combate */
  private readonly PREFERRED_DISTANCE: number = 5.0;
  /** Distancia mínima para huir */
  private readonly FLEE_THRESHOLD: number = 4.0;
  /** Distancia máxima para acercarse */
  private readonly SEEK_THRESHOLD: number = 6.0;
  /** Velocidad del proyectil enemigo */
  private readonly PROJECTILE_SPEED: number = 6.0;
  /** Rango del proyectil antes de autodestruirse */
  private readonly PROJECTILE_RANGE: number = 12.0;
  /** Intervalo entre disparos (ms) */
  private readonly SHOOT_INTERVAL_MS: number = 1500;
  /** Tiempo del último disparo */
  private lastShootTime: number = 0;
  /** Dirección de strafe actual (1 = derecha, -1 = izquierda) */
  private strafeDirection: number = 1;
  /** Tiempo del último cambio de strafe */
  private lastStrafeChangeTime: number = 0;
  /** Intervalo para cambiar dirección de strafe (ms) */
  private readonly STRAFE_CHANGE_INTERVAL_MS: number = 2000;

  /** Pool de proyectiles para disparar */
  private projectilePool: ProjectilePool | null = null;
  /** Escena Three.js para crear proyectiles */
  private scene: THREE.Scene | null = null;

  /**
   * @param id Identificador único del enemigo
   * @param eventBus Bus de eventos del sistema
   * @param sceneManager Manager de escena
   * @param physicsWorld Mundo físico (opcional)
   * @param physicsBody Handle de cuerpo físico (opcional)
   * @param color Color del esqueleto (por defecto textura original)
   * @param size Escala del modelo
   * @param knockbackResistance Resistencia al knockback
   * @param type Tipo de enemigo
   * @param stats Estadísticas del enemigo
   */
  constructor(
    id: string,
    eventBus: EventBus,
    sceneManager: SceneManager,
    physicsWorld?: PhysicsWorld,
    physicsBody?: RigidBodyHandle,
    color: number = 0xcccccc,
    size: number = 1.0,
    knockbackResistance: number = 0.1,
    type: EnemyType = EnemyType.Ranged,
    stats?: EnemyStats
  ) {
    const effectiveStats = stats || ENEMY_RANGED_STATS;

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
      true // skipModelLoad — nosotros manejamos la carga del Mage
    );

    // Cargar el modelo de Mage inmediatamente
    this.loadMageModel();
  }

  /**
   * Asigna el pool de proyectiles para que este enemigo pueda disparar.
   */
  setProjectilePool(pool: ProjectilePool): void {
    this.projectilePool = pool;
  }

  /**
   * Asigna la escena Three.js (necesaria para crear proyectiles si no hay pool).
   */
  setScene(scene: THREE.Scene): void {
    this.scene = scene;
  }

  // =================================================================
  // CARGA DEL MODELO
  // =================================================================

  /**
   * Carga el modelo Skeleton_Mage (similar a loadWarriorModel en EnemyTank).
   */
  private loadMageModel(): void {
    if (mageModelScene) {
      this.cloneMageSkeleton(mageModelScene);
      return;
    }

    if (mageLoadPromise) {
      mageLoadPromise.then((scene: THREE.Group) => {
        this.cloneMageSkeleton(scene);
      }).catch(err => {
        console.error(`[EnemyRanged ${this.id}] Error en carga del Mage:`, err);
      });
      return;
    }

    console.warn(`[EnemyRanged ${this.id}] Modelo Mage no precargado — cargando ahora`);
    ensureMageModelLoaded().then(() => {
      if (mageModelScene) {
        this.cloneMageSkeleton(mageModelScene);
      }
    }).catch(err => {
      console.error(`[EnemyRanged ${this.id}] Error cargando modelo Mage:`, err);
    });
  }

  /**
   * Clona el esqueleto del Mage y configura el modelo.
   */
  private cloneMageSkeleton(sourceScene: THREE.Group): void {
    try {
      const cloned = SkeletonUtils.clone(sourceScene) as THREE.Group;
      this.setupModel(cloned);

      this.model!.position.copy(this.targetPosition);

      if (this.enemyState === EnemyState.Spawning) {
        this.model!.scale.set(0.0001, 0.0001, 0.0001);
      }

      this.storeOriginalColor();

      if (!this.physicsBody && this.physicsWorld) {
        this.createPhysicsBody();
      }

      console.log(`[EnemyRanged ${this.id}] Modelo Mage cargado y configurado en (${this.targetPosition.x}, ${this.targetPosition.y}, ${this.targetPosition.z})`);
    } catch (error) {
      console.error(`[EnemyRanged ${this.id}] Error clonando modelo Mage:`, error);
    }
  }

  // =================================================================
  // CUERPO FÍSICO
  // =================================================================

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
        'small', // Hitbox pequeña (radio 0.3, halfHeight 0.3)
        this.id,
        this
      );

      this.physicsBody = bodyHandle;
      console.log(`[EnemyRanged ${this.id}] Cuerpo físico creado (small)`);
    } catch (error) {
      console.error(`[EnemyRanged ${this.id}] Error creando cuerpo físico:`, error);
    }
  }

  // =================================================================
  // LINE OF SIGHT (RAYCAST)
  // =================================================================

  /**
   * Verifica si hay línea de vista hacia el jugador usando raycast de Rapier.
   * @param fromPos Posición del enemigo
   * @param toPos Posición del jugador
   * @returns true si hay línea de vista despejada
   */
  private hasLineOfSight(fromPos: THREE.Vector3, toPos: THREE.Vector3): boolean {
    if (!this.physicsWorld) return true; // Sin física, asumir que siempre hay LoS

    const world = this.physicsWorld.getWorld();
    if (!world) return true;

    const rayDir = new THREE.Vector3().copy(toPos).sub(fromPos);
    const distance = rayDir.length();
    if (distance < 0.1) return false;

    rayDir.normalize();

    // Lanzar raycast desde el pecho del enemigo hacia el pecho del jugador
    const rayPos = { x: fromPos.x, y: fromPos.y + 1.0, z: fromPos.z };
    const rayDirRapier = { x: rayDir.x, y: rayDir.y, z: rayDir.z };

    const ray = new RAPIER.Ray(rayPos, rayDirRapier);
    const maxToi = distance;

    // Rapier castRay con solid=true para detectar el primer obstáculo sólido
    const hit = world.castRay(ray, maxToi, true);

    // Si no hay hit, línea de vista despejada
    if (!hit) return true;

    // Si hay hit, verificar si es contra un collider de jugador
    // (los proyectiles enemigos colisionan con PLAYER, así que el raycast
    //  debería detectar al jugador si no hay obstáculos)
    const hitCollider = hit.collider;
    const hitUserData = hitCollider.parent()?.userData as any;

    // Si el hit es contra un jugador (tiene entity con método shootProjectile o getPosition),
    // consideramos que hay línea de vista
    if (hitUserData) {
      const entity = hitUserData.entity;
      if (entity && typeof entity.getPosition === 'function' && typeof entity.isAlive === 'function') {
        return true;
      }
    }

    // Si el hit es contra cualquier otra cosa (wall, etc.), no hay línea de vista
    return false;
  }

  // =================================================================
  // DISPARO DE PROYECTIL
  // =================================================================

  /**
   * Dispara un proyectil enemigo hacia el target.
   */
  private shootAtTarget(target: any): void {
    if (!this.model || !this.physicsWorld) return;

    const enemyPos = this.model.position;
    const targetPos = target.getPosition();
    if (!targetPos) return;

    // Posición de spawn: desde el pecho del enemigo (~1.0 sobre el suelo)
    const spawnPos = new THREE.Vector3(
      enemyPos.x,
      enemyPos.y + 1.0,
      enemyPos.z
    );

    // Dirección 3D completa desde el spawn hasta el centro del target
    // Incluye componente Y para que el projectile viaje en línea recta 3D
    // y alcance la hitbox del player (capsule: y=-0.5 a y=0.5)
    const dir = new THREE.Vector3()
      .copy(targetPos)
      .sub(spawnPos);
    const dist = dir.length();
    if (dist < 0.1) return;
    dir.normalize();

    // Velocidad del proyectil en 3D (incluye Y)
    const velocity = new THREE.Vector3(
      dir.x * this.PROJECTILE_SPEED,
      dir.y * this.PROJECTILE_SPEED,
      dir.z * this.PROJECTILE_SPEED
    );

    if (this.projectilePool) {
      // Usar el pool de proyectiles
      const projectile = this.projectilePool.acquire();
      if (projectile) {
        projectile.activate(spawnPos, {
          velocity,
          damage: this.getEffectiveStat('damage'),
          pierce: false,
          ownerId: this.id,
          range: this.PROJECTILE_RANGE,
          radius: 0.12, // Un poco más grande que los proyectiles del ADC
          collisionGroup: Groups.ENEMY_PROJECTILE, // Grupo especial para no dañar enemigos
          collisionMask: Masks.ENEMY_PROJECTILE,   // Solo colisiona con PLAYER y WALL
        });

        // Cambiar color del mesh a rojo
        this.tintProjectileRed(projectile);
      }
    } else {
      // Fallback: crear proyectil visual simple (sin física)
      this.createSimpleProjectile(spawnPos, velocity);
    }
  }

  /**
   * Tiñe el mesh del proyectil a rojo.
   */
  private tintProjectileRed(projectile: any): void {
    try {
      // El Projectile tiene un mesh interno con material MeshBasicMaterial
      // No tenemos acceso directo, pero podemos intentar cambiarlo via la propiedad
      if (projectile['mesh']) {
        const mesh = projectile['mesh'] as THREE.Mesh;
        if (mesh.material instanceof THREE.Material) {
          (mesh.material as THREE.MeshBasicMaterial).color.setHex(0xff2222);
        }
      }
    } catch {
      // Ignorar errores de tinte
    }
  }

  /**
   * Crea un proyectil visual simple (fallback sin pool).
   */
  private createSimpleProjectile(position: THREE.Vector3, velocity: THREE.Vector3): void {
    if (!this.scene) return;

    const geometry = new THREE.SphereGeometry(0.12, 8, 8);
    const material = new THREE.MeshBasicMaterial({ color: 0xff2222 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    this.scene.add(mesh);

    // Animar el proyectil visualmente
    const startTime = Date.now();
    const maxDuration = (this.PROJECTILE_RANGE / this.PROJECTILE_SPEED) * 1000;

    const animate = () => {
      const elapsed = Date.now() - startTime;
      if (elapsed >= maxDuration) {
        this.scene?.remove(mesh);
        geometry.dispose();
        material.dispose();
        return;
      }

      mesh.position.x += velocity.x * 0.016; // ~60fps
      mesh.position.z += velocity.z * 0.016;

      requestAnimationFrame(animate);
    };
    animate();
  }

  // =================================================================
  // AI DE KITING
  // =================================================================

  /**
   * Encuentra el jugador más cercano (similar a getClosestPlayer en EnemyTank).
   */
  private getClosestPlayer(players: any[]): any | null {
    if (players.length === 0) return null;

    let closest: any | null = null;
    let closestDist = Infinity;
    const enemyPos = this.model ? this.model.position : null;
    if (!enemyPos) return null;

    for (let i = 0; i < players.length; i++) {
      const player = players[i];
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
   * Actualiza la AI de kiting cada frame.
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

    // 2. Calcular dirección y distancia hacia el target
    const dx = targetPos.x - enemyPos.x;
    const dz = targetPos.z - enemyPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 0.001) return;

    // Dirección normalizada hacia el target
    const dirX = dx / dist;
    const dirZ = dz / dist;

    // 3. Determinar comportamiento según distancia usando steering behaviors
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

    // Calcular steering forces según distancia
    let primaryForce: THREE.Vector2;
    let primaryWeight: number;

    if (dist < this.FLEE_THRESHOLD) {
      // === FLEE: huir del jugador ===
      primaryForce = flee(agent, targetPos);
      primaryWeight = DEFAULT_RANGED_WEIGHTS.flee;
    } else if (dist > this.SEEK_THRESHOLD) {
      // === SEEK: acercarse al jugador ===
      primaryForce = seek(agent, targetPos);
      primaryWeight = DEFAULT_RANGED_WEIGHTS.seek;
    } else {
      // === STRAFE: orbitar alrededor del jugador ===
      // Cambiar dirección de strafe periódicamente
      const now = Date.now();
      if (now - this.lastStrafeChangeTime >= this.STRAFE_CHANGE_INTERVAL_MS) {
        this.strafeDirection *= -1;
        this.lastStrafeChangeTime = now;
      }
      primaryForce = strafeAround(agent, targetPos, this.strafeDirection);
      primaryWeight = DEFAULT_RANGED_WEIGHTS.strafe;
    }

    const sepForce = separation(agent, neighbors, DEFAULT_SEPARATION_RADIUS, MAX_SEPARATION_NEIGHBORS);
    const avoidForce = avoidObstacles(agent, TilemapLoader.obstaclePositions, primaryForce, DEFAULT_AVOID_LOOK_AHEAD, DEFAULT_AVOID_RADIUS);

    // Combinar con pesos
    const { direction, hasMovement } = combineForces([
      [primaryForce, primaryWeight],
      [sepForce, DEFAULT_RANGED_WEIGHTS.separation],
      [avoidForce, DEFAULT_AVOID_WEIGHT],
    ]);

    if (!hasMovement) return;

    // Aplicar aceleración suave
    const moveSpeed = this.getEffectiveStat('speed');
    applyAcceleration(this.currentSteeringVel, direction, moveSpeed, this.maxAcceleration, dt);

    // 5. ROTACIÓN: mirar hacia el target
    const targetAngle = Math.atan2(dirX, dirZ) + Math.PI;
    this.model.rotation.y = THREE.MathUtils.lerp(
      this.model.rotation.y,
      targetAngle,
      0.1
    );

    // 6. MOVIMIENTO con velocidad suave
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

    // 7. Animación de caminar (siempre que se mueva)
    this.playAnimation('Walk');

    // 8. DISPARO: cada 1.5s si hay línea de vista
    const now = Date.now();
    if (now - this.lastShootTime >= this.SHOOT_INTERVAL_MS) {
      // Verificar línea de vista
      const hasLoS = this.hasLineOfSight(enemyPos, targetPos);
      if (hasLoS) {
        this.shootAtTarget(target);
        this.lastShootTime = now;
        this.playAnimation('Attack');
      }
    }
  }

  // =================================================================
  // SPAWN / RELEASE / RESET
  // =================================================================

  spawn(options: SpawnOptions): void {
    super.spawn(options);
    this.lastShootTime = 0;
    this.strafeDirection = Math.random() > 0.5 ? 1 : -1;
    this.lastStrafeChangeTime = Date.now();
  }

  release(): void {
    super.release();
  }

  reset(): void {
    super.reset();
    this.lastShootTime = 0;
    this.strafeDirection = 1;
    this.lastStrafeChangeTime = 0;
  }

  dispose(): void {
    super.dispose();
  }
}
