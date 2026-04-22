import * as THREE from 'three';
import { Enemy, EnemyType, type EnemyStats, type SpawnOptions } from './Enemy';
import type { PhysicsWorld, RigidBodyHandle } from '../physics/PhysicsWorld';
import { EventBus } from '../engine/EventBus';
import { SceneManager } from '../engine/SceneManager';
import { AssetLoader } from '../engine/AssetLoader';
import { BodyFactory } from '../physics/BodyFactory';

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

/**
 * Enemigo esqueleto minion con modelo 3D y animaciones básicas
 */
export class SkeletonEnemy extends Enemy {
  /** Cargador de assets para el modelo */
  private static assetLoader: AssetLoader = new AssetLoader();
  /** Modelo GLTF cargado (estático para todas las instancias) */
  private static modelGLTF: THREE.Group | null = null;
  /** Indica si el modelo está cargando */
  private static isLoading: boolean = false;
  /** Promesa de carga del modelo */
  private static loadPromise: Promise<THREE.Group> | null = null;

  /** Mixer de animaciones */
  private mixer: THREE.AnimationMixer | null = null;
  /** Acciones de animación */
  private animations: THREE.AnimationAction[] = [];
  /** Animación actual */
  private currentAnimation: THREE.AnimationAction | null = null;
  /** Timeout para la animación de muerte */
  private deathAnimationTimeout: number | null = null;

  /**
   * Crea un nuevo esqueleto minion
   */
  constructor(
    enemyId: string,
    stats: EnemyStats = SKELETON_MINION_STATS,
    eventBus: EventBus,
    sceneManager?: SceneManager,
    physicsWorld?: PhysicsWorld,
    physicsBody?: RigidBodyHandle
  ) {
    super(
      enemyId,
      EnemyType.SkeletonMinion,
      stats,
      eventBus,
      sceneManager,
      physicsWorld,
      physicsBody
    );

    // Cargar modelo asíncronamente
    this.loadModel();
  }

  /**
   * Carga el modelo 3D del esqueleto (carga compartida entre todas las instancias)
   */
  private async loadModel(): Promise<void> {
    // Si el modelo ya está cargado, clonarlo
    if (SkeletonEnemy.modelGLTF) {
      this.setupModel(SkeletonEnemy.modelGLTF.clone());
      return;
    }

    // Si ya está cargando, esperar a que termine
    if (SkeletonEnemy.loadPromise) {
      const model = await SkeletonEnemy.loadPromise;
      this.setupModel(model.clone());
      return;
    }

    // Iniciar carga
    SkeletonEnemy.isLoading = true;
    SkeletonEnemy.loadPromise = new Promise(async (resolve, reject) => {
      try {
        const gltf = await SkeletonEnemy.assetLoader.load('/models/enemies/Skeleton_Minion.glb');
        const model = gltf.scene;
        
        // Ajustar escala y orientación
        model.scale.set(0.01, 0.01, 0.01);
        model.rotation.y = Math.PI;
        
        // Configurar sombras
        model.traverse(child => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        SkeletonEnemy.modelGLTF = model;
        SkeletonEnemy.isLoading = false;
        resolve(model);
        
        // Clonar para esta instancia
        this.setupModel(model.clone());
      } catch (error) {
        SkeletonEnemy.isLoading = false;
        SkeletonEnemy.loadPromise = null;
        console.error('[SkeletonEnemy] Error cargando modelo:', error);
        reject(error);
      }
    });
  }

  /**
   * Configura el modelo clonado para esta instancia
   * @param model - Modelo 3D clonado
   */
  private setupModel(model: THREE.Group): void {
    this.model = model;

    // Configurar animaciones si existen
    if (model.animations && model.animations.length > 0) {
      this.mixer = new THREE.AnimationMixer(model);
      model.animations.forEach(anim => {
        const action = this.mixer!.clipAction(anim);
        this.animations.push(action);
      });

      // Reproducir animación idle por defecto
      this.playAnimation('Idle');
    }

    // Agregar a la escena
    if (this.sceneManager && this.model) {
      this.sceneManager.add(this.model);
    }

    // Crear cuerpo físico si no existe
    if (!this.physicsBody && this.physicsWorld) {
      this.createPhysicsBody();
    }

    console.log(`[SkeletonEnemy ${this.id}] Modelo configurado`);
  }

  /**
   * Crea un cuerpo físico para el esqueleto
   */
  private createPhysicsBody(): void {
    if (!this.physicsWorld || !this.model) return;

    try {
      const bodyHandle = BodyFactory.createEnemyBody(
        this.physicsWorld,
        this.model.position,
        'medium',
        this.id,
        this
      );

      this.physicsBody = bodyHandle;
      console.log(`[SkeletonEnemy ${this.id}] Cuerpo físico creado`);
    } catch (error) {
      console.error(`[SkeletonEnemy ${this.id}] Error creando cuerpo físico:`, error);
    }
  }

  /**
   * Reproduce una animación por nombre
   * @param name - Nombre de la animación (Idle, Walk, Attack, Death)
   */
  private playAnimation(name: string): void {
    if (!this.mixer || this.animations.length === 0) return;

    // Buscar animación que contenga el nombre (case-insensitive)
    const action = this.animations.find(a => 
      a.getClip().name.toLowerCase().includes(name.toLowerCase())
    );

    if (action) {
      if (this.currentAnimation) {
        this.currentAnimation.fadeOut(0.2);
      }
      action.reset().fadeIn(0.2).play();
      this.currentAnimation = action;
    }
  }

  /**
   * IA básica del esqueleto: perseguir al jugador más cercano
   * @param dt - Delta time en segundos
   * @param players - Lista de jugadores en el juego
   * @param world - Referencia al mundo del juego (opcional)
   */
  updateAI(dt: number, players: any[], world?: any): void {
    if (!this.model || players.length === 0) return;

    // Encontrar jugador más cercano
    const nearestPlayer = players[0]; // Por simplicidad, tomamos el primer jugador
    if (!nearestPlayer || !nearestPlayer.getPosition) return;

    const playerPos = nearestPlayer.getPosition();
    const enemyPos = this.model.position;

    if (!playerPos) return;

    // Calcular dirección hacia el jugador
    const direction = new THREE.Vector3()
      .subVectors(playerPos, enemyPos)
      .normalize();

    // Mover en dirección al jugador (solo en plano XZ)
    const moveSpeed = this.getEffectiveStat('speed') * dt;
    const moveVector = direction.multiplyScalar(moveSpeed);
    moveVector.y = 0;

    // Actualizar posición del modelo
    this.model.position.add(moveVector);

    // Rotar hacia el jugador
    if (direction.lengthSq() > 0.001) {
      const targetAngle = Math.atan2(direction.x, direction.z);
      this.model.rotation.y = THREE.MathUtils.lerp(this.model.rotation.y, targetAngle, 0.1);
    }

    // Sincronizar cuerpo físico si existe
    if (this.physicsBody && this.physicsWorld) {
      const body = this.physicsWorld.getBody(this.physicsBody);
      if (body) {
        body.setTranslation(this.model.position, true);
      }
    }

    // Cambiar animación según estado
    if (moveVector.lengthSq() > 0.001) {
      this.playAnimation('Walk');
    } else {
      this.playAnimation('Idle');
    }
  }

  /**
   * Inicia la animación de muerte del esqueleto
   */
  protected startDeathAnimation(): void {
    // Reproducir animación de muerte si existe
    this.playAnimation('Death');

    // Escalar a cero gradualmente (como fallback si no hay animación)
    if (this.model) {
      const targetScale = 0.001;
      const duration = 1000; // 1 segundo
      const startScale = this.model.scale.x;
      const startTime = Date.now();

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const scale = THREE.MathUtils.lerp(startScale, targetScale, progress);
        
        if (this.model) {
          this.model.scale.set(scale, scale, scale);
        }

        if (progress < 1) {
          this.deathAnimationTimeout = setTimeout(animate, 16) as unknown as number;
        } else {
          // Liberar al pool después de la animación
          this.release();
        }
      };

      animate();
    } else {
      // Si no hay modelo, liberar inmediatamente
      this.release();
    }
  }

  /**
   * Actualiza el esqueleto (llamado cada frame)
   * @param dt - Delta time en segundos
   */
  update(dt: number): void {
    // Actualizar animaciones
    if (this.mixer) {
      this.mixer.update(dt);
    }

    // Llamar a la lógica base
    super.update(dt);
  }

  /**
   * Libera recursos del esqueleto
   */
  dispose(): void {
    // Cancelar timeout de animación de muerte
    if (this.deathAnimationTimeout !== null) {
      clearTimeout(this.deathAnimationTimeout);
      this.deathAnimationTimeout = null;
    }

    // Detener animaciones
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }

    this.animations = [];
    this.currentAnimation = null;

    // Llamar a dispose base
    super.dispose();
  }
}