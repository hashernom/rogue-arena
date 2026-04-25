import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Enemy, type EnemyStats, type SpawnOptions, EnemyState, EnemyType } from './Enemy';
import { CharacterState } from '../characters/Character';
import type { EventBus } from '../engine/EventBus';
import type { SceneManager } from '../engine/SceneManager';
import type { PhysicsWorld, RigidBodyHandle } from '../physics/PhysicsWorld';
import { BodyFactory } from '../physics/BodyFactory';

// =================================================================
// STATS BASE PARA EnemyFast
// =================================================================

/**
 * Estadísticas base para el enemigo veloz (flanqueador).
 * - hp: 20, baja vida -> frágil
 * - speed: 5.5, muy rápido
 * - damage: 5, daño bajo pero constante
 * - armor: 0, sin protección
 * - knockbackResistance: 0.2, leve resistencia
 * - reward: 2, recompensa baja
 */
export const ENEMY_FAST_STATS: EnemyStats = {
  hp: 20,
  maxHp: 20,
  speed: 5.5,
  damage: 5,
  attackSpeed: 1.0,
  range: 0.6,
  armor: 0,
  knockbackResistance: 0.2,
  reward: 2,
};

// =================================================================
// CLASE EnemyFast
// =================================================================

/**
 * Enemigo veloz que prioriza atacar al Tirador (ADC), flanqueando
 * en lugar de ir en línea recta.
 *
 * Características:
 * - Prioriza al ADC (AdcCharacter) sobre el Caballero (MeleeCharacter)
 * - Se aproxima con offset lateral de 1.5m (flanqueo)
 * - Recalcula el offset de flanqueo (left/right random) cada 2s
 * - Al morir el ADC, cambia de target al Caballero inmediatamente
 * - Usa el mismo modelo de esqueleto con tinte celeste muy leve
 * - Usa el pool lifecycle de Enemy (spawn, release, reset, dispose)
 */
export class EnemyFast extends Enemy {
  // ========== ATAQUE MELEE ==========
  /** Timestamp del último ataque (para control de cadencia) */
  private lastAttackTime: number = 0;
  /** Indica si el enemigo está en rango de ataque */
  private isInAttackRange: boolean = false;
  /** Tiempo mínimo (ms) que la animación de ataque debe verse antes de permitir Idle */
  private readonly ATTACK_ANIM_DURATION_MS: number = 600;

  // ========== FLANQUEO ==========
  /** Offset lateral actual para flanqueo (Vector3 para evitar crear objetos en updateAI) */
  private flankOffset: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  /** Timestamp del último recálculo del offset de flanqueo */
  private lastFlankRecalcTime: number = 0;
  /** Intervalo en ms entre recálculos de flanqueo */
  private readonly FLANK_RECALC_INTERVAL_MS: number = 2000;
  /** Distancia lateral del offset de flanqueo */
  private readonly FLANK_OFFSET_DISTANCE: number = 1.5;

  /**
   * Crea un nuevo EnemyFast
   */
  constructor(
    id: string,
    eventBus: EventBus,
    sceneManager: SceneManager,
    physicsWorld?: PhysicsWorld,
    physicsBody?: RigidBodyHandle,
    color: number = 0xbbddff,
    size: number = 1.0,
    knockbackResistance: number = 0.2,
    type: EnemyType = EnemyType.Fast,
    stats?: EnemyStats
  ) {
    // Usar ENEMY_FAST_STATS si no se proporcionan stats
    const effectiveStats = stats || ENEMY_FAST_STATS;

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
  // CARGA DE MODELO (esqueleto con tinte celeste)
  // =================================================================

  /**
   * Carga el modelo de esqueleto reutilizando la carga compartida de Enemy.
   * Si el modelo compartido aún no está disponible, se suscribe a la promesa.
   */
  private loadSkeletonModel(color: number): void {
    // Intentar obtener el modelo compartido de Enemy (getter estático)
    const sharedModel = Enemy.getSharedModelScene();

    if (sharedModel) {
      // El modelo ya está cargado — clonar inmediatamente (síncrono)
      this.cloneAndTintSkeleton(sharedModel, color);
      return;
    }

    // Si no está disponible, suscribirse a la promesa de carga
    const loadPromise = Enemy.getSharedLoadPromise();
    if (loadPromise) {
      loadPromise.then((scene: THREE.Group) => {
        this.cloneAndTintSkeleton(scene, color);
      }).catch(err => {
        console.error(`[EnemyFast ${this.id}] Error en carga compartida:`, err);
      });
      return;
    }

    // Si no hay promesa ni modelo, el modelo nunca se cargó
    console.warn(`[EnemyFast ${this.id}] Modelo compartido no disponible — los skeletons se crean antes`);
  }

  /**
   * Clona el modelo de esqueleto compartido y le aplica un tinte de color.
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
  private cloneAndTintSkeleton(sourceScene: THREE.Group, color: number): void {
    try {
      // Clonar con SkeletonUtils para preservar skinning
      const cloned = SkeletonUtils.clone(sourceScene) as THREE.Group;

      // Aplicar tinte de color a todas las mallas del modelo clonado
      cloned.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          if (mesh.material) {
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((mat) => {
              if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhongMaterial) {
                // Mezclar el color base con el tinte (multiplicativo)
                const tintColor = new THREE.Color(color);
                if (mat.color) {
                  mat.color.multiply(tintColor);
                }
                mat.needsUpdate = true;
              }
            });
          }
        }
      });

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

      console.log(`[EnemyFast ${this.id}] Modelo de esqueleto (tinte celeste) cargado y configurado en (${this.targetPosition.x}, ${this.targetPosition.y}, ${this.targetPosition.z})`);
    } catch (error) {
      console.error(`[EnemyFast ${this.id}] Error clonando modelo:`, error);
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
      console.log(`[EnemyFast ${this.id}] Cuerpo físico creado`);
    } catch (error) {
      console.error(`[EnemyFast ${this.id}] Error creando cuerpo físico:`, error);
    }
  }

  // =================================================================
  // IA: FLANQUEO CON PRIORIDAD ADC
  // =================================================================

  /**
   * Encuentra el target prioritario: ADC (AdcCharacter) si está vivo,
   * o Caballero (MeleeCharacter) si el ADC está muerto.
   *
   * Detecta al ADC verificando si tiene el método `shootProjectile`
   * (presente en AdcCharacter, ausente en MeleeCharacter).
   *
   * Zero-garbage: no crea objetos temporales en el game loop.
   */
  private getTargetPlayer(players: any[]): any | null {
    if (players.length === 0) return null;

    let adcTarget: any | null = null;
    let meleeTarget: any | null = null;

    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      // Ignorar jugadores sin getPosition, sin isAlive, o muertos
      if (!player || !player.getPosition || !player.isAlive) continue;
      if (!player.isAlive()) continue;

      // Detectar ADC por la presencia de shootProjectile
      if (typeof player.shootProjectile === 'function') {
        adcTarget = player;
      } else {
        meleeTarget = player;
      }
    }

    // Priorizar ADC; si no hay ADC vivo, ir al Caballero
    return adcTarget || meleeTarget;
  }

  /**
   * Recalcula el offset lateral de flanqueo (left o right random).
   * Se llama cada FLANK_RECALC_INTERVAL_MS (2s).
   */
  private recalculateFlankOffset(): void {
    // Elegir lado aleatorio: izquierdo (-1) o derecho (+1)
    const side = Math.random() < 0.5 ? -1 : 1;

    // El offset es perpendicular a la dirección de avance del enemigo
    // pero se calcula en coordenadas absolutas (se rotará en updateAI
    // según la dirección al target)
    this.flankOffset.set(
      side * this.FLANK_OFFSET_DISTANCE,
      0,
      0
    );

    this.lastFlankRecalcTime = Date.now();
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
      console.log(`[EnemyFast ${this.id}] Ataque cuerpo a cuerpo a ${target.id}: ${damage} daño`);
    }

    return true;
  }

  /**
   * Actualiza la IA del enemigo: flanqueo con prioridad ADC.
   * Zero-garbage: no instancia nuevos objetos en el game loop.
   */
  updateAI(dt: number, players: any[], world?: any, activeEnemies?: any[]): void {
    if (!this.model || players.length === 0) return;
    if (this.enemyState !== EnemyState.Active) return;
    if (!this.steeringEnabled) return;

    // 1. Encontrar el target prioritario (ADC > Caballero)
    const target = this.getTargetPlayer(players);
    if (!target || !target.getPosition) return;

    const targetPos = target.getPosition();
    if (!targetPos) return;

    const enemyPos = this.model.position;

    // 2. Calcular dirección y distancia hacia el target
    const dx = targetPos.x - enemyPos.x;
    const dz = targetPos.z - enemyPos.z;
    const distSq = dx * dx + dz * dz;

    // 3. Recalcular offset de flanqueo cada 2s
    const now = Date.now();
    if (now - this.lastFlankRecalcTime >= this.FLANK_RECALC_INTERVAL_MS) {
      this.recalculateFlankOffset();
    }

    // 4. Verificar si está en rango de ataque (0.6m)
    const attackRangeSq = 0.6 * 0.6;
    this.isInAttackRange = distSq <= attackRangeSq;

    if (this.isInAttackRange) {
      // 4a. Atacar cuerpo a cuerpo
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
      // 4b. Perseguir al target con flanqueo
      const dist = Math.sqrt(distSq);
      if (dist < 0.001) return;

      // Dirección normalizada hacia el target
      const dirX = dx / dist;
      const dirZ = dz / dist;

      // Calcular punto de flanqueo: desplazar el target perpendicularmente
      // a la dirección de aproximación
      // Perpendicular en 2D: (-dirZ, dirX) para izquierda, (dirZ, -dirX) para derecha
      const perpX = -dirZ;
      const perpZ = dirX;

      // Aplicar el offset lateral (flankOffset.x es -1.5 o +1.5)
      const flankTargetX = targetPos.x + perpX * this.flankOffset.x;
      const flankTargetZ = targetPos.z + perpZ * this.flankOffset.x;

      // Calcular dirección hacia el punto de flanqueo
      const fdx = flankTargetX - enemyPos.x;
      const fdz = flankTargetZ - enemyPos.z;
      const fDist = Math.sqrt(fdx * fdx + fdz * fdz);

      let moveDirX: number;
      let moveDirZ: number;

      if (fDist > 0.1) {
        // Moverse hacia el punto de flanqueo
        moveDirX = fdx / fDist;
        moveDirZ = fdz / fDist;
      } else {
        // Ya está en posición de flanqueo — moverse directamente al target
        moveDirX = dirX;
        moveDirZ = dirZ;
      }

      // ================================================================
      // SEPARACIÓN: evitar que los enemigos se amontonen
      // ================================================================
      const SEPARATION_DIST = 1.5;
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

      moveDirX += sepX;
      moveDirZ += sepZ;

      // Re-normalizar después de separación
      const finalDist = Math.sqrt(moveDirX * moveDirX + moveDirZ * moveDirZ);
      if (finalDist > 0.001) {
        moveDirX /= finalDist;
        moveDirZ /= finalDist;
      }

      // ================================================================
      // ROTACIÓN: el modelo base tiene rotation.y = Math.PI (aplicado en
      // ensureModelLoaded/loadModel), por lo que el forward efectivo es -Z.
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

    // Inicializar offset de flanqueo aleatorio al spawnear
    this.recalculateFlankOffset();

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
    console.log(`[EnemyFast ${this.id}] Liberado al pool`);
  }

  /**
   * Prepara el enemigo para reutilización
   */
  reset(): void {
    super.reset();

    // Resetear estado de ataque
    this.lastAttackTime = 0;
    this.isInAttackRange = false;

    // Resetear flanqueo (se recalculará en spawn)
    this.flankOffset.set(0, 0, 0);
    this.lastFlankRecalcTime = 0;

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
    console.log(`[EnemyFast ${this.id}] Recursos liberados completamente`);
  }
}
