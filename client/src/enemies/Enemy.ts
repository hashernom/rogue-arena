import * as THREE from 'three';
import { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Character, type CharacterStats, CharacterState } from '../characters/Character';
import type { PhysicsWorld, RigidBodyHandle } from '../physics/PhysicsWorld';
import { EventBus } from '../engine/EventBus';
import { SceneManager } from '../engine/SceneManager';
import { BodyFactory } from '../physics/BodyFactory';
import { AssetLoader } from '../engine/AssetLoader';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

// =================================================================
// TIPOS COMPARTIDOS (para compatibilidad con EnemyPool)
// =================================================================

/**
 * Tipos de enemigos disponibles
 */
export enum EnemyType {
  SkeletonMinion = 'skeleton_minion',
  SkeletonWarrior = 'skeleton_warrior',
  SkeletonRogue = 'skeleton_rogue',
  SkeletonMage = 'skeleton_mage',
  Basic = 'basic',
  Fast = 'fast',
  Tank = 'tank',
  Ranged = 'ranged',
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
 * Opciones para spawnear un enemigo
 */
export interface SpawnOptions {
  position: THREE.Vector3;
  rotation?: number;
  scale?: number;
}

/**
 * Estados específicos de enemigos
 */
export enum EnemyState {
  Spawning = 'spawning',
  Active = 'active',
  Dying = 'dying',
  Dead = 'dead',
}

// =================================================================
// STATS BASE
// =================================================================

/**
 * Estadísticas base para un esqueleto minion
 */
export const SKELETON_MINION_STATS: EnemyStats = {
  hp: 50,
  maxHp: 50,
  speed: 2.5,
  damage: 10,
  attackSpeed: 1.0,
  range: 1.5,
  armor: 5,
  knockbackResistance: 0.3,
  reward: 10,
};

// =================================================================
// CLASE PRINCIPAL
// =================================================================

/**
 * Enemigo con modelo 3D de esqueleto, animaciones, hitboxes funcionales
 * y sistema de ciclo de vida (spawn, pool, muerte).
 * 
 * Originalmente TestEnemy, ahora es la clase Enemy definitiva que
 * reemplaza tanto al TestEnemy original (cubos) como al SkeletonEnemy.
 */
export abstract class Enemy extends Character {
  // ========== CARGA DE MODELO ESTÁTICA (compartida entre instancias) ==========
  private static assetLoader: AssetLoader = new AssetLoader();
  /** Escena original del GLTF (se clona con SkeletonUtils.clone() para cada instancia) */
  private static modelScene: THREE.Group | null = null;
  private static isLoading: boolean = false;
  private static loadPromise: Promise<THREE.Group> | null = null;

  /**
   * Getter estático para que subclases (como EnemyBasic) accedan al modelo compartido.
   * Retorna la escena original del GLTF para clonar con SkeletonUtils.clone().
   */
  protected static getSharedModelScene(): THREE.Group | null {
    return Enemy.modelScene;
  }

  /**
   * Getter estático para acceder a la promesa de carga del modelo compartido.
   */
  protected static getSharedLoadPromise(): Promise<THREE.Group> | null {
    return Enemy.loadPromise;
  }

  /**
   * Inicia la carga del modelo compartido del esqueleto (solo la parte estática,
   * sin clonar para ninguna instancia). Útil para precargar el modelo antes de
   * crear instancias de subclases como EnemyBasic.
   *
   * Es seguro llamarlo múltiples veces — si ya está cargado o cargando, no hace nada.
   * @returns Promesa que resuelve cuando el modelo compartido está disponible
   */
  static async ensureModelLoaded(): Promise<void> {
    if (Enemy.modelScene) return;
    if (Enemy.loadPromise) {
      await Enemy.loadPromise;
      return;
    }

    // Iniciar la misma carga que loadModel() pero sin clonar para ninguna instancia
    Enemy.isLoading = true;
    Enemy.loadPromise = new Promise(async (resolve, reject) => {
      try {
        const assets = await Promise.all([
          Enemy.assetLoader.load('/models/enemies/Skeleton_Minion.glb'),
          Enemy.assetLoader.load('/models/Rig_Medium_General.glb'),
          Enemy.assetLoader.load('/models/Rig_Medium_MovementBasic.glb'),
          Enemy.assetLoader.load('/models/Rig_Medium_CombatMelee.glb')
        ]);

        const skeletonGltf = assets[0] as GLTF;
        const generalGltf = assets[1] as GLTF;
        const movementGltf = assets[2] as GLTF;
        const combatGltf = assets[3] as GLTF;

        const model = skeletonGltf.scene;

        // Combinar animaciones
        Enemy.modelAnimations = [
          ...(generalGltf.animations || []),
          ...(movementGltf.animations || []),
          ...(combatGltf.animations || [])
        ];

        if (Enemy.modelAnimations.length === 0) {
          console.error('⚠️ LOS RIGS NO TIENEN ANIMACIONES. Revisa los archivos Rig.');
        } else {
          console.log(`[Enemy] Cargadas ${Enemy.modelAnimations.length} animaciones desde los Rigs:`, Enemy.modelAnimations.map(a => a.name));
        }

        model.scale.set(1.0, 1.0, 1.0);
        model.rotation.y = Math.PI;

        model.traverse(child => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        Enemy.modelScene = model;
        Enemy.isLoading = false;
        resolve(model);
      } catch (error) {
        Enemy.isLoading = false;
        Enemy.loadPromise = null;
        console.error('[Enemy] Error cargando assets:', error);
        reject(error);
      }
    });

    await Enemy.loadPromise;
  }

  // ========== PROPIEDADES DE INSTANCIA ==========
  /** Modelo visual (Group contenedor) - siguiendo Container+SkeletonUtils pattern */
  protected model: THREE.Group | null = null;
  /** Escena interna clonada (contiene SkinnedMesh + huesos). Root del AnimationMixer. */
  protected innerMesh: THREE.Object3D | null = null;
  /** Referencia al SceneManager */
  protected sceneManager: SceneManager;
  /** Color base del enemigo */
  private color: number;
  /** Tamaño base del enemigo */
  private size: number;

  /** Posición objetivo guardada para cuando el modelo termine de cargar */
  protected targetPosition: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  /** Rotación objetivo guardada para cuando el modelo termine de cargar */
  protected targetRotation: number = 0;

  // ========== HIT FLASH ==========
  protected flashTimeoutId: ReturnType<typeof setTimeout> | null = null;
  protected originalModelColor: Map<THREE.Mesh, THREE.Color> = new Map();

  // ========== MUERTE ==========
  protected isDying: boolean = false;
  protected deathAnimationStart: number = 0;
  protected readonly DEATH_ANIMATION_DURATION = 600;
  protected deathParticles: THREE.Mesh[] = [];

  // ========== HP BAR ==========
  protected hpBar: THREE.Sprite | null = null;
  protected hpBarVisible: boolean = false;
  protected hpBarHideTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // ========== ANIMACIONES ==========
  protected mixer: THREE.AnimationMixer | null = null;
  protected animations: THREE.AnimationAction[] = [];
  protected currentAnimation: THREE.AnimationAction | null = null;

  // ========== POOL / CICLO DE VIDA ==========
  /** Tipo de enemigo */
  public readonly type: EnemyType;
  /** Recompensa al morir */
  protected reward: number;
  /** Estado del enemigo (spawning, active, dying, dead) */
  protected enemyState: EnemyState = EnemyState.Spawning;
  /** Tiempo de inicio del spawn */
  protected spawnStartTime: number = 0;
  /** Duración del spawn en ms */
  protected readonly SPAWN_DURATION = 500;
  /** Indica si está liberado al pool */
  protected isPooled: boolean = false;

  /** Promesa que resuelve cuando el modelo 3D ha terminado de cargar */
  public readyPromise: Promise<void>;
  /** Resolve de readyPromise, se llama en setupModel() */
  private resolveReady: (() => void) | null = null;

  /** Animaciones extraídas del GLTF original (compartidas estáticamente) */
  private static modelAnimations: THREE.AnimationClip[] = [];

  /** Stats base del enemigo de prueba (legacy) */
  static readonly BASE_STATS: CharacterStats = {
    hp: 40,
    maxHp: 40,
    speed: 0,
    damage: 0,
    attackSpeed: 0,
    range: 0,
    armor: 5,
  };

  /**
   * Crea un nuevo enemigo
   */
  constructor(
    id: string,
    eventBus: EventBus,
    sceneManager: SceneManager,
    physicsWorld?: PhysicsWorld,
    physicsBody?: RigidBodyHandle,
    color: number = 0xff0000,
    size: number = 1.0,
    knockbackResistance: number = 0.0,
    type: EnemyType = EnemyType.SkeletonMinion,
    stats?: EnemyStats,
    skipModelLoad: boolean = false
  ) {
    // Usar stats proporcionadas o BASE_STATS
    const effectiveStats: CharacterStats = stats || Enemy.BASE_STATS;
    super(id, effectiveStats, eventBus, physicsWorld, physicsBody);

    this.sceneManager = sceneManager;
    this.color = color;
    this.size = size;
    this.type = type;
    this.reward = stats?.reward ?? 10;

    // Establecer resistencia al knockback
    this.setKnockbackResistance(knockbackResistance);

    // Iniciar estado de spawn
    this.enemyState = EnemyState.Spawning;
    this.spawnStartTime = Date.now();

    // Crear promesa que resuelve cuando el modelo termine de cargar
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });

    // Cargar modelo asíncronamente (subclases pueden saltarse esto)
    if (!skipModelLoad) {
      this.loadModel();
    }
  }

  // =================================================================
  // CARGA DE MODELO (estática compartida)
  // =================================================================

  /**
   * Carga el modelo 3D del esqueleto (carga compartida entre todas las instancias)
   */
  private async loadModel(): Promise<void> {
    // Si el modelo ya está cargado, clonarlo con SkeletonUtils.clone() directamente
    // (SkeletonUtils.clone() retargetea los huesos, AssetLoader.clone() además clona geometrías
    //  lo que puede romper el retargeting de skin indices)
    if (Enemy.modelScene) {
      const cloned = SkeletonUtils.clone(Enemy.modelScene) as THREE.Group;
      this.setupModel(cloned);
      return;
    }

    // Si ya está cargando, esperar a que termine
    if (Enemy.loadPromise) {
      const scene = await Enemy.loadPromise;
      const cloned = SkeletonUtils.clone(scene) as THREE.Group;
      this.setupModel(cloned);
      return;
    }

    // Iniciar carga
    Enemy.isLoading = true;
    Enemy.loadPromise = new Promise(async (resolve, reject) => {
      try {
        // 1. Cargar modelo visual + Rigs de animación simultáneamente
        const assets = await Promise.all([
          Enemy.assetLoader.load('/models/enemies/Skeleton_Minion.glb'),
          Enemy.assetLoader.load('/models/Rig_Medium_General.glb'),
          Enemy.assetLoader.load('/models/Rig_Medium_MovementBasic.glb'),
          Enemy.assetLoader.load('/models/Rig_Medium_CombatMelee.glb')
        ]);

        const skeletonGltf = assets[0] as GLTF;
        const generalGltf = assets[1] as GLTF;
        const movementGltf = assets[2] as GLTF;
        const combatGltf = assets[3] as GLTF;

        const model = skeletonGltf.scene;

        // 2. Combinar animaciones de todos los Rigs (el esqueleto no trae animaciones propias)
        Enemy.modelAnimations = [
          ...(generalGltf.animations || []),
          ...(movementGltf.animations || []),
          ...(combatGltf.animations || [])
        ];

        if (Enemy.modelAnimations.length === 0) {
          console.error('⚠️ LOS RIGS NO TIENEN ANIMACIONES. Revisa los archivos Rig.');
        } else {
          console.log(`[Enemy] Cargadas ${Enemy.modelAnimations.length} animaciones desde los Rigs:`, Enemy.modelAnimations.map(a => a.name));
        }

        // 3. Ajustar escala y orientación UNA SOLA VEZ en la escena original
        model.scale.set(1.0, 1.0, 1.0);
        model.rotation.y = Math.PI;

        // 4. Configurar sombras en el modelo original (el clon heredará estas propiedades)
        model.traverse(child => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        // 5. Guardar la escena (Group) para clonado posterior con SkeletonUtils.clone()
        Enemy.modelScene = model;
        Enemy.isLoading = false;
        resolve(model);

        // 6. Clonar para esta instancia usando SkeletonUtils.clone()
        const cloned = SkeletonUtils.clone(model) as THREE.Group;
        this.setupModel(cloned);
      } catch (error) {
        Enemy.isLoading = false;
        Enemy.loadPromise = null;
        console.error('[Enemy] Error cargando assets:', error);
        reject(error);
      }
    });
  }

  /**
   * Configura el modelo clonado para esta instancia
   *
   * Patrón Container+SkeletonUtils correcto:
   * 1. Crear contenedor THREE.Group vacío (this.model)
   * 2. Meter la escena clonada COMPLETA (con huesos + SkinnedMesh) dentro del contenedor
   * 3. Crear AnimationMixer sobre la escena interna (this.innerMesh = clonedScene)
   *
   * NO extraer el SkinnedMesh solo - los huesos (Bone) son hermanos del SkinnedMesh
   * en la jerarquía GLTF y deben mantenerse intactos.
   */
  protected setupModel(clonedScene: THREE.Group): void {
    // 1. Crear contenedor limpio
    this.model = new THREE.Group();

    // 2. Meter la escena clonada COMPLETA dentro del contenedor
    //    (conserva SkinnedMesh + huesos + armature intactos)
    this.innerMesh = clonedScene;
    this.model.add(clonedScene);

    // 3. Configurar Frustum Culling + sombras + clonar materiales
    clonedScene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.frustumCulled = false;
        child.castShadow = true;
        child.receiveShadow = true;
        // Clonar materiales para que el Hit Flash de un enemigo no afecte a los demás
        const mat = child.material;
        if (mat) {
          if (Array.isArray(mat)) {
            child.material = mat.map((m: THREE.Material) => m.clone());
          } else {
            child.material = mat.clone();
          }
        }
      }
    });

    // 4. Aplicar posición y rotación al CONTENEDOR (no a la escena interna)
    this.model.position.copy(this.targetPosition);
    this.model.rotation.y = this.targetRotation;

    // 5. Escala protegida en el contenedor
    const finalSize = this.size || 1;
    this.model.scale.set(1.0 * finalSize, 1.0 * finalSize, 1.0 * finalSize);

    // 6. Visibilidad del contenedor según el pool
    this.model.visible = !this.isPooled;

    // 7. Configurar animaciones - mixer sobre la escena interna (clonedScene)
    //    El mixer necesita como root el mismo nodo que contiene los huesos
    //    para que clipAction() pueda encontrarlos por nombre.
    if (Enemy.modelAnimations && Enemy.modelAnimations.length > 0) {
      this.mixer = new THREE.AnimationMixer(clonedScene);
      this.animations = [];

      Enemy.modelAnimations.forEach(clip => {
        const action = this.mixer!.clipAction(clip);
        this.animations.push(action);
      });

      // DEBUG: Loggear detalles de cada clip de animación
      Enemy.modelAnimations.forEach((anim, i) => {
        console.log(`[Enemy ${this.id}] Anim[${i}]: name="${anim.name}", duration=${anim.duration}s, tracks=${anim.tracks.length}, blendMode=${anim.blendMode}`);
        anim.tracks.forEach((track, j) => {
          const t = track as any;
          console.log(`  track[${j}]: path="${t.path}", type=${track.constructor.name}, times=${track.times.length}, values=${track.values.length}`);
        });
      });

      // Buscar animación idle por nombre (case-insensitive)
      const idleClip = Enemy.modelAnimations.find(a =>
        a.name.toLowerCase().includes('idle')
      );
      if (idleClip) {
        const idleAction = this.mixer.clipAction(idleClip);
        idleAction.reset();
        idleAction.setLoop(THREE.LoopRepeat, Infinity);
        idleAction.clampWhenFinished = false;
        idleAction.play();
        this.currentAnimation = idleAction;
        console.log(`[Enemy ${this.id}] Reproduciendo idle: "${idleClip.name}"`);
      } else {
        console.warn(`[Enemy ${this.id}] No se encontró animación idle. Nombres:`, Enemy.modelAnimations.map(a => a.name));
        if (this.animations.length > 0) {
          const firstAction = this.animations[0];
          firstAction.reset().play();
          this.currentAnimation = firstAction;
          console.log(`[Enemy ${this.id}] Fallback: reproduciendo "${firstAction.getClip().name}"`);
        }
      }
    }

    // 8. Agregar el contenedor a la escena
    this.sceneManager.add(this.model);

    // 9. Crear cuerpo físico si no existe
    if (!this.physicsBody && this.physicsWorld) {
      this.createPhysicsBody();
      if (this.isPooled && this.physicsBody) {
        const body = this.physicsWorld.getBody(this.physicsBody);
        if (body) body.setEnabled(false);
      }
    }

    // 10. Resolver la promesa readyPromise
    this.resolveReady?.();

    console.log(`[Enemy ${this.id}] Modelo configurado en (${this.targetPosition.x}, ${this.targetPosition.y}, ${this.targetPosition.z})`);
  }

  // =================================================================
  // FÍSICA
  // =================================================================

  /**
   * Crea un cuerpo físico para el enemigo
   */
  protected createPhysicsBody(): void {
    if (!this.physicsWorld || !this.model) return;

    try {
      const bodyHandle = BodyFactory.createEnemyBody(
        this.physicsWorld,
        new THREE.Vector3(this.model.position.x, this.model.position.y, this.model.position.z),
        'medium',
        this.id,
        this
      );

      this.physicsBody = bodyHandle;
      console.log(`[Enemy ${this.id}] Cuerpo físico creado`);
    } catch (error) {
      console.error(`[Enemy ${this.id}] Error creando cuerpo físico:`, error);
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

  // =================================================================
  // ANIMACIONES
  // =================================================================

  /**
   * Reproduce una animación por nombre
   */
  /**
   * Reproduce una animación por nombre.
   * @param name Nombre o subcadena del clip de animación
   * @param loop Si es true (default), la animación se repite en loop infinito.
   *             Si es false, se reproduce una sola vez (LoopOnce).
   */
  protected playAnimation(name: string, loop: boolean = true): void {
    if (!this.mixer || !Enemy.modelAnimations) return;

    // Buscar el clip directamente en modelAnimations
    const animClip = Enemy.modelAnimations.find(a =>
      a.name.toLowerCase().includes(name.toLowerCase())
    );

    if (animClip) {
      const action = this.mixer.clipAction(animClip);

      // Si ya está reproduciendo esta acción exacta, no reiniciar
      if (this.currentAnimation === action) return;

      if (this.currentAnimation) {
        this.currentAnimation.fadeOut(0.2);
      }

      action.reset();
      action.setEffectiveTimeScale(1);
      action.setEffectiveWeight(1);

      if (loop) {
        action.setLoop(THREE.LoopRepeat, Infinity);
      } else {
        action.setLoop(THREE.LoopOnce, 1);
        // Para animaciones one-shot, no mantener la última pose
        action.clampWhenFinished = true;
      }

      action.fadeIn(0.2).play();

      this.currentAnimation = action;
    } else {
      console.warn(`[Enemy] No se encontró animación para: ${name}`);
    }
  }

  // =================================================================
  // IA (abstracta — cada subclase debe implementar su propio comportamiento)
  // =================================================================

  /**
   * IA del enemigo. Cada subclase debe implementar su propio comportamiento.
   * @param dt - Delta time en segundos
   * @param players - Array de jugadores (deben tener getPosition())
   * @param world - Mundo de física (opcional)
   * @param activeEnemies - Array de enemigos activos para steering behaviors (separación, etc.)
   */
  abstract updateAI(dt: number, players: any[], world?: any, activeEnemies?: any[]): void;

  // =================================================================
  // UPDATE
  // =================================================================

  /**
   * Actualiza el enemigo cada frame
   */
  update(dt: number): void {
    // Actualizar animaciones — dt ya está en segundos (ej: 0.016)
    if (this.mixer) {
      this.mixer.update(dt);
    }

    // Actualizar partículas de impacto (se autodestruyen solas)
    if (this.hitParticles.length > 0) {
      this.updateHitParticles();
    }

    // Manejar lógica de spawn
    if (this.enemyState === EnemyState.Spawning) {
      this.updateSpawnAnimation();
    }

    // Actualizar animación de muerte
    if (this.isDying) {
      this.updateDeathAnimation();
    }

    // Actualizar barra de HP
    if (this.hpBarVisible && this.hpBar) {
      this.updateHpBar();
    }

    // Sincronizar modelo con física
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
      // El modelo base ya está escalado a 1.0 en loadModel(),
      // así que spawn anima desde 0 hasta 1.0 * size
      const finalSize = this.size || 1; // Protege contra undefined
      const scale = progress * 1.0 * finalSize;
      // Evitar el 0 matemático para que los huesos no colapsen
      const safeScale = Math.max(scale, 0.0001);
      this.model.scale.set(safeScale, safeScale, safeScale);
    }

    if (progress >= 1) {
      this.enemyState = EnemyState.Active;
      console.log(`[Enemy ${this.id}] Spawn completado`);
    }
  }

  // =================================================================
  // TAKE DAMAGE
  // =================================================================

  /**
   * Aplica daño al enemigo con feedback visual
   */
  takeDamage(amount: number): void {
    // Solo puede recibir daño si está activo
    if (this.enemyState !== EnemyState.Active) return;

    // Aplicar daño usando la lógica del padre
    super.takeDamage(amount);

    // Efecto visual de hit flash
    this.startHitFlash();

    // Partículas de impacto (donde sea que pegue el proyectil)
    if (this.model) {
      this.spawnHitParticles(this.model.position);
    }

    // Mostrar barra de HP
    this.showHpBar();

    // Emitir evento de daño recibido
    const position = this.model ? this.model.position : new THREE.Vector3(0, 0, 0);
    this.eventBus.emit('enemy:damage', {
      enemyId: this.id,
      damage: amount,
      attackerId: 'player',
      position: { x: position.x, y: position.y, z: position.z } as THREE.Vector3,
    });

    // Si el enemigo muere, iniciar muerte
    if (!this.isAlive()) {
      this.eventBus.emit('enemy:died', {
        enemyId: this.id,
        position: { x: position.x, y: position.y, z: position.z } as THREE.Vector3,
        reward: this.reward,
      });

      this.die();
    }
  }

  // =================================================================
  // PARTÍCULAS DE IMPACTO (proyectil)
  // =================================================================

  private hitParticles: THREE.Mesh[] = [];

  /**
   * Crea pequeñas partículas en el punto de impacto (proyectil ADC, melee, etc.)
   * Se autodestruyen después de ~300ms
   */
  protected spawnHitParticles(position: THREE.Vector3): void {
    if (!this.sceneManager) return;

    const count = 5;
    const colors = [0xffff44, 0xffaa00, 0xffffff, 0xff6600, 0xffcc00];

    for (let i = 0; i < count; i++) {
      const size = 0.12 + Math.random() * 0.15;
      const geometry = new THREE.BoxGeometry(size, size, size);
      const material = new THREE.MeshBasicMaterial({
        color: colors[i % colors.length],
        transparent: true,
        opacity: 1,
      });
      const particle = new THREE.Mesh(geometry, material);

      particle.position.set(
        position.x + (Math.random() - 0.5) * 0.6,
        position.y + 0.5 + (Math.random() - 0.5) * 0.6,
        position.z + (Math.random() - 0.5) * 0.6
      );

      particle.userData = {
        velocityY: 2.0 + Math.random() * 2.5,
        velocityX: (Math.random() - 0.5) * 2.0,
        velocityZ: (Math.random() - 0.5) * 2.0,
        birth: Date.now(),
        lifespan: 400,
      };

      this.sceneManager.add(particle);
      this.hitParticles.push(particle);
    }
  }

  /**
   * Actualiza las partículas de impacto (animación + cleanup automático)
   */
  private updateHitParticles(): void {
    const now = Date.now();
    for (let i = this.hitParticles.length - 1; i >= 0; i--) {
      const particle = this.hitParticles[i];
      const data = particle.userData;
      const age = now - data.birth;
      const progress = age / data.lifespan;

      if (progress >= 1) {
        // Eliminar partícula expirada
        this.sceneManager.remove(particle);
        particle.geometry.dispose();
        (particle.material as THREE.Material).dispose();
        this.hitParticles.splice(i, 1);
        continue;
      }

      // Mover hacia arriba con velocidad
      particle.position.y += data.velocityY * 0.016;
      particle.position.x += data.velocityX * 0.016;
      particle.position.z += data.velocityZ * 0.016;

      // Desvanecer
      const material = particle.material as THREE.MeshBasicMaterial;
      material.opacity = 1 - progress;

      // Rotar
      particle.rotation.x += 0.2;
      particle.rotation.y += 0.3;
    }
  }

  /**
   * Limpia todas las partículas de impacto (al liberar al pool)
   */
  protected cleanupHitParticles(): void {
    this.hitParticles.forEach(particle => {
      this.sceneManager.remove(particle);
      particle.geometry.dispose();
      (particle.material as THREE.Material).dispose();
    });
    this.hitParticles = [];
  }

  // =================================================================
  // MUERTE
  // =================================================================

  /**
   * Mata al enemigo e inicia la animación de muerte
   */
  die(): void {
    if (this.enemyState === EnemyState.Dying || this.enemyState === EnemyState.Dead) return;

    this.enemyState = EnemyState.Dying;
    this.state = CharacterState.Dead;

    console.log(`[Enemy ${this.id}] Murió, recompensa: ${this.reward}`);

    // Crear partículas de muerte
    this.createDeathParticles();

    // Limpiar barra de HP
    this.cleanupHpBar();

    // Iniciar animación de muerte
    this.startDeathAnimation();
  }

  /**
   * Inicia la animación de muerte
   */
  private startDeathAnimation(): void {
    if (this.isDying) return;

    this.isDying = true;
    this.deathAnimationStart = Date.now();

    // Reproducir animación de muerte si existe
    this.playAnimation('Death');

    console.log(`[Enemy ${this.id}] Iniciando animación de muerte`);
  }

  /**
   * Actualiza la animación de muerte (partículas + cleanup)
   */
  protected updateDeathAnimation(): void {
    if (this.deathParticles.length === 0) return;

    const elapsed = Date.now() - this.deathAnimationStart;
    const progress = Math.min(elapsed / this.DEATH_ANIMATION_DURATION, 1);

    // Escalar modelo a cero (desde 1.0*size hasta 0)
    if (this.model) {
      const finalSize = this.size || 1; // Protege contra undefined
      const scale = (1 - progress) * 1.0 * finalSize;
      // Evitar el 0 matemático para que los huesos no colapsen
      const safeScale = Math.max(scale, 0.0001);
      this.model.scale.set(safeScale, safeScale, safeScale);
    }

    // Animar partículas
    this.deathParticles.forEach(particle => {
      particle.position.y += particle.userData.velocityY * 0.016;
      particle.position.x += particle.userData.velocityX * 0.016;
      particle.position.z += particle.userData.velocityZ * 0.016;

      const material = particle.material as THREE.MeshBasicMaterial;
      material.opacity = Math.max(0, 1 - progress);

      particle.rotation.x += 0.1;
      particle.rotation.y += 0.15;
    });

    // Cuando termina la animación, limpiar y liberar al pool
    if (progress >= 1) {
      this.cleanupDeathParticles();
      this.release();
    }
  }

  // =================================================================
  // PARTÍCULAS DE MUERTE
  // =================================================================

  /**
   * Crea partículas para el efecto de muerte
   */
  protected createDeathParticles(): void {
    if (!this.model || !this.sceneManager) return;

    const position = this.model.position;
    const particleCount = 5;
    const colors = [0xff4444, 0xff8844, 0xffcc44, 0xff6644, 0xffaa44];

    for (let i = 0; i < particleCount; i++) {
      const size = 0.1 + Math.random() * 0.15;
      const geometry = new THREE.BoxGeometry(size, size, size);
      const material = new THREE.MeshBasicMaterial({
        color: colors[i % colors.length],
        transparent: true,
        opacity: 1,
      });
      const particle = new THREE.Mesh(geometry, material);

      particle.position.set(
        position.x + (Math.random() - 0.5) * 0.5,
        position.y + Math.random() * 0.3,
        position.z + (Math.random() - 0.5) * 0.5
      );

      particle.userData = {
        velocityY: 1.5 + Math.random() * 2,
        velocityX: (Math.random() - 0.5) * 1.5,
        velocityZ: (Math.random() - 0.5) * 1.5,
      };

      this.sceneManager.add(particle);
      this.deathParticles.push(particle);
    }
  }

  /**
   * Limpia las partículas de muerte
   */
  protected cleanupDeathParticles(): void {
    this.deathParticles.forEach(particle => {
      this.sceneManager.remove(particle);
      particle.geometry.dispose();
      (particle.material as THREE.Material).dispose();
    });
    this.deathParticles = [];
    this.isDying = false;
  }

  // =================================================================
  // HIT FLASH
  // =================================================================

  /**
   * Inicia el efecto visual de hit flash (blanco por 100ms)
   */
  protected startHitFlash(): void {
    if (!this.model) return;

    if (this.flashTimeoutId) {
      clearTimeout(this.flashTimeoutId);
    }

    this.storeOriginalColor();
    this.applyColorToMeshes(new THREE.Color(0xffffff));

    this.flashTimeoutId = setTimeout(() => {
      this.restoreOriginalColor();
      this.flashTimeoutId = null;
    }, 100);
  }

  /**
   * Almacena los colores originales de todos los meshes del modelo
   */
  protected storeOriginalColor(): void {
    if (!this.model || this.originalModelColor.size > 0) return;

    this.model.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((mat) => {
          if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshBasicMaterial) {
            if (mat.color) {
              this.originalModelColor.set(child, mat.color.clone());
            }
          }
        });
      }
    });
  }

  /**
   * Aplica un color a todos los meshes del modelo
   */
  protected applyColorToMeshes(color: THREE.Color): void {
    if (!this.model) return;

    this.model.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((mat) => {
          if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshBasicMaterial) {
            mat.color.copy(color);
            mat.needsUpdate = true;
          }
        });
      }
    });
  }

  /**
   * Restaura los colores originales del modelo
   */
  protected restoreOriginalColor(): void {
    if (this.originalModelColor.size === 0) return;

    this.originalModelColor.forEach((originalColor, mesh) => {
      if (mesh.material) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((mat) => {
          if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshBasicMaterial) {
            mat.color.copy(originalColor);
            mat.needsUpdate = true;
          }
        });
      }
    });

    this.originalModelColor.clear();
  }

  // =================================================================
  // HP BAR
  // =================================================================

  /**
   * Crea la barra de HP flotante (sprite con canvas)
   */
  protected createHpBar(): void {
    if (this.hpBar || !this.sceneManager) return;

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 16;
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(1.2, 0.15, 1);
    sprite.visible = false;
    sprite.renderOrder = 999;

    this.sceneManager.add(sprite);
    this.hpBar = sprite;
  }

  /**
   * Actualiza la barra de HP con el porcentaje actual
   */
  protected updateHpBar(): void {
    if (!this.hpBar || !this.model) return;

    const spriteMaterial = this.hpBar.material as THREE.SpriteMaterial;
    const texture = spriteMaterial.map as THREE.CanvasTexture;
    const canvas = texture.image as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const currentHp = this.statsSystem.getStat('hp');
    const maxHp = this.statsSystem.getStat('maxHp');
    const ratio = Math.max(0, currentHp / maxHp);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const hue = ratio * 120;
    ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
    ctx.fillRect(1, 1, (canvas.width - 2) * ratio, canvas.height - 2);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);

    texture.needsUpdate = true;

    this.hpBar.position.copy(this.model.position);
    this.hpBar.position.y += 2;
  }

  /**
   * Muestra la barra de HP por 3 segundos
   */
  private showHpBar(): void {
    if (!this.hpBar) {
      this.createHpBar();
    }

    if (!this.hpBar) return;

    this.hpBar.visible = true;
    this.hpBarVisible = true;

    if (this.hpBarHideTimeoutId) {
      clearTimeout(this.hpBarHideTimeoutId);
    }

    this.hpBarHideTimeoutId = setTimeout(() => {
      if (this.hpBar) {
        this.hpBar.visible = false;
      }
      this.hpBarVisible = false;
      this.hpBarHideTimeoutId = null;
    }, 3000);
  }

  /**
   * Limpia la barra de HP
   */
  protected cleanupHpBar(): void {
    if (this.hpBarHideTimeoutId) {
      clearTimeout(this.hpBarHideTimeoutId);
      this.hpBarHideTimeoutId = null;
    }
    if (this.hpBar) {
      this.hpBar.visible = false;
    }
    this.hpBarVisible = false;
  }

  // =================================================================
  // POSICIÓN
  // =================================================================

  /**
   * Establece la posición del enemigo
   */
  setPosition(x: number, y: number, z: number): void {
    // Guardar siempre la posición objetivo
    this.targetPosition.set(x, y, z);

    if (this.model) {
      this.model.position.set(x, y, z);
    }

    if (this.physicsBody && this.physicsWorld) {
      const body = this.physicsWorld.getBody(this.physicsBody);
      if (body) {
        body.setTranslation({ x, y, z }, true);
      }
    }
  }

  /**
   * Obtiene la posición actual del enemigo
   */
  getPosition(): THREE.Vector3 | null {
    if (!this.model) return null;
    return this.model.position.clone();
  }

  // =================================================================
  // POOL / CICLO DE VIDA
  // =================================================================

  /**
   * Spawnea el enemigo en una posición específica
   */
  spawn(options: SpawnOptions): void {
    this.enemyState = EnemyState.Spawning;
    this.spawnStartTime = Date.now();
    this.isPooled = false;
    this.isDying = false;

    // Guardar los objetivos para cuando termine de cargar el modelo
    this.targetPosition.copy(options.position);
    if (options.rotation !== undefined) this.targetRotation = options.rotation;

    // Resetear hit flash
    this.restoreOriginalColor();

    // Crear barra de HP si no existe
    if (!this.hpBar) {
      this.createHpBar();
    }

    // Si el modelo ya cargó, aplicar posición directamente
    if (this.model) {
      this.model.position.copy(this.targetPosition);
      this.model.rotation.y = this.targetRotation;
      // Forzar visibilidad y escala inicial segura (evita matrices corruptas)
      this.model.visible = true;
      this.model.scale.set(0.0001, 0.0001, 0.0001);
    }

    // Recrear cuerpo físico si fue destruido en release()
    if (!this.physicsBody && this.physicsWorld && this.model) {
      this.createPhysicsBody();
    }

    // Establecer posición física
    if (this.physicsBody && this.physicsWorld) {
      const body = this.physicsWorld.getBody(this.physicsBody);
      if (body) {
        body.setTranslation(this.targetPosition, true);
        body.setEnabled(true);
      }
    }

    console.log(`[Enemy ${this.id}] Spawneado en ${options.position.x}, ${options.position.y}, ${options.position.z}`);
  }

  /**
   * Libera recursos del enemigo (para ser reutilizado por el pool)
   */
  release(): void {
    if (this.isPooled) return;

    // Limpiar hit flash
    if (this.flashTimeoutId) {
      clearTimeout(this.flashTimeoutId);
      this.flashTimeoutId = null;
    }
    this.restoreOriginalColor();

    // Limpiar barra de HP
    this.cleanupHpBar();

    // Limpiar partículas de muerte
    this.cleanupDeathParticles();

    // Limpiar partículas de impacto
    if (this.hitParticles.length > 0) {
      this.cleanupHitParticles();
    }

    // Ocultar modelo
    if (this.model) {
      this.model.visible = false;
    }

    // Destruir cuerpo físico (no acumular bodies desactivados en el mundo Rapier)
    if (this.physicsBody && this.physicsWorld) {
      this.physicsWorld.removeBody(this.physicsBody);
      this.physicsBody = undefined;
    }

    this.enemyState = EnemyState.Dead;
    this.isPooled = true;
    this.isDying = false;
    console.log(`[Enemy ${this.id}] Liberado al pool`);
  }

  /**
   * Prepara el enemigo para reutilización (reset de estado)
   */
  reset(): void {
    const maxHp = this.statsSystem.getStat('maxHp');
    this.statsSystem.setBaseStat('hp', maxHp);

    this.enemyState = EnemyState.Spawning;
    this.spawnStartTime = Date.now();
    this.state = CharacterState.Idle;
    this.isPooled = false;
    this.isDying = false;

    // Resetear hit flash
    if (this.flashTimeoutId) {
      clearTimeout(this.flashTimeoutId);
      this.flashTimeoutId = null;
    }
    this.restoreOriginalColor();

    // Limpiar partículas de muerte
    this.cleanupDeathParticles();

    // Crear barra de HP si no existe
    if (!this.hpBar) {
      this.createHpBar();
    }

    // Mostrar modelo (la updateSpawnAnimation lo escalará hasta 0.01*size)
    if (this.model) {
      this.model.visible = true;
      // Usar 0.0001 en vez de 0 puro para no romper las matrices de los huesos en animaciones
      this.model.scale.set(0.0001, 0.0001, 0.0001);
    }

    // Activar cuerpo físico
    if (this.physicsBody && this.physicsWorld) {
      const body = this.physicsWorld.getBody(this.physicsBody);
      if (body) {
        body.setEnabled(true);
      }
    }
  }

  /**
   * Verifica si el enemigo está vivo
   */
  isAlive(): boolean {
    return this.enemyState === EnemyState.Active || this.enemyState === EnemyState.Spawning;
  }

  /**
   * Verifica si el enemigo está listo para ser reutilizado por el pool
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

  // =================================================================
  // DISPOSE
  // =================================================================

  /**
   * Libera todos los recursos del enemigo (disposición completa)
   */
  dispose(): void {
    // Cancelar timeout de flash
    if (this.flashTimeoutId) {
      clearTimeout(this.flashTimeoutId);
      this.flashTimeoutId = null;
    }
    this.originalModelColor.clear();

    // Limpiar barra de HP
    this.cleanupHpBar();

    // Limpiar partículas de muerte
    this.cleanupDeathParticles();

    // Detener animaciones
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    this.animations = [];
    this.currentAnimation = null;

    // Remover modelo de la escena
    if (this.model && this.sceneManager) {
      this.sceneManager.remove(this.model);
      this.model = null;
    }

    // Remover cuerpo físico
    if (this.physicsBody && this.physicsWorld && !this.isPooled) {
      this.physicsWorld.removeBody(this.physicsBody);
      this.physicsBody = undefined;
    }

    console.log(`[Enemy ${this.id}] Recursos liberados completamente`);
  }

}
