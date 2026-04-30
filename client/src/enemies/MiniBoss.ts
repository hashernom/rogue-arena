import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Enemy, type EnemyStats, type SpawnOptions, EnemyState, EnemyType } from './Enemy';
import { CharacterState } from '../characters/Character';
import type { EventBus } from '../engine/EventBus';
import type { SceneManager } from '../engine/SceneManager';
import type { PhysicsWorld, RigidBodyHandle } from '../physics/PhysicsWorld';
import { BodyFactory } from '../physics/BodyFactory';
import { AssetLoader } from '../engine/AssetLoader';
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
// STATS BASE PARA MiniBoss
// =================================================================

/**
 * Estadísticas base para el MiniBoss.
 * - hp: 1000 = Tank.hp * 5 (200 * 5)
 * - speed: 1.5 = Tank.speed
 * - damage: 30 = Tank.damage * 2 (15 * 2)
 * - armor: 5, knockbackResistance: 1.0 (inmune a knockback normal)
 * - reward: 16 = Tank.reward * 2 (8 * 2)
 */
export const MINIBOSS_STATS: EnemyStats = {
  hp: 1000,
  maxHp: 1000,
  speed: 1.5,
  damage: 30,
  attackSpeed: 0.8,
  range: 0.8,
  armor: 5,
  knockbackResistance: 1.0,
  reward: 16,
};

// =================================================================
// CARGA ESTÁTICA DEL MODELO WARRIOR
// =================================================================

/** AssetLoader dedicado para el modelo Warrior del MiniBoss */
const miniBossAssetLoader = new AssetLoader();
/** Escena original del GLTF Warrior (se clona con SkeletonUtils.clone()) */
let miniBossWarriorScene: THREE.Group | null = null;
/** Promesa de carga del modelo Warrior */
let miniBossLoadPromise: Promise<THREE.Group> | null = null;

/**
 * Carga el modelo Skeleton_Warrior.glb de forma estática.
 * Es seguro llamarlo múltiples veces — si ya está cargado o cargando, no hace nada.
 */
export async function ensureMiniBossModelLoaded(): Promise<void> {
  if (miniBossWarriorScene) return;
  if (miniBossLoadPromise) return;

  miniBossLoadPromise = new Promise(async (resolve, reject) => {
    try {
      const gltf = await miniBossAssetLoader.load('/models/enemies/Skeleton_Warrior.glb');
      const model = gltf.scene;

      // Aplicar rotación base para que el forward sea -Z
      model.rotation.y = Math.PI;

      // Configurar sombras
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      miniBossWarriorScene = model;
      console.log('[MiniBoss] Modelo Warrior cargado exitosamente');
      resolve(model);
    } catch (error) {
      console.error('[MiniBoss] Error cargando modelo Warrior:', error);
      reject(error);
    }
  });

  await miniBossLoadPromise;
}

// =================================================================
// ENUM DE ESTADOS DE CARGA
// =================================================================

/**
 * Estados de la mecánica de carga del MiniBoss.
 */
enum ChargeState {
  /** Esperando que termine el cooldown de 8s */
  Cooldown = 'cooldown',
  /** Mostrando indicador en el suelo (1.5s de telegraphing) */
  Telegraphing = 'telegraphing',
  /** Dash activo hacia el jugador objetivo */
  Charging = 'charging',
}

// =================================================================
// CLASE PRINCIPAL MiniBoss
// =================================================================

export class MiniBoss extends Enemy {
  // ========== MECÁNICA DE CARGA ==========
  /** Estado actual de la carga */
  private chargeState: ChargeState = ChargeState.Cooldown;
  /** Timer de cooldown entre cargas (8s) */
  private chargeCooldownTimer: number = 8;
  /** Timer de telegraphing (1.5s) */
  private telegraphTimer: number = 0;
  /** Duración del telegraphing en segundos */
  private readonly TELEGRAPH_DURATION: number = 1.5;
  /** Distancia del dash en metros */
  private readonly CHARGE_DISTANCE: number = 8;
  /** Velocidad del dash (m/s) — recorre 8m en ~0.32s */
  private readonly CHARGE_SPEED: number = 25;
  /** Dirección del dash */
  private chargeDirection: THREE.Vector3 = new THREE.Vector3();
  /** Posición de inicio del dash */
  private chargeStartPos: THREE.Vector3 = new THREE.Vector3();
  /** Posición objetivo del dash */
  private chargeTargetPos: THREE.Vector3 = new THREE.Vector3();
  /** Distancia recorrida durante el dash */
  private chargeDistanceTraveled: number = 0;
  /** Jugador objetivo de la carga */
  private chargeTarget: any | null = null;

  // ========== INDICADOR DE TELEGRAPHING ==========
  /** Anillo visual en el suelo durante el telegraphing */
  private telegraphIndicator: THREE.Mesh | null = null;
  /** Timer de pulso para animar el indicador */
  private telegraphPulseTimer: number = 0;

  // ========== BOSS HP BAR (DOM) ==========
  /** Elemento DOM de la barra de HP del boss */
  private static bossHpBarElement: HTMLDivElement | null = null;
  /** Elemento DOM del fill de la barra */
  private static bossHpBarFill: HTMLDivElement | null = null;
  /** Elemento DOM del texto del nombre */
  private static bossHpBarName: HTMLDivElement | null = null;
  /** Referencia al MiniBoss vivo actual para la HP bar */
  private static currentBossInstance: MiniBoss | null = null;

  // ========== ITEM DROP ==========
  /** Mesh del ítem dropeado en el suelo */
  private droppedItem: THREE.Mesh | null = null;
  /** Radio de recolección del ítem */
  private readonly ITEM_PICKUP_RADIUS: number = 1.5;
  /** Indica si el ítem ya fue recogido */
  private itemCollected: boolean = false;
  /** Lista de jugadores vivos (referencia para check de recolección) */
  private playersRef: any[] = [];

  // ========== TIMESTAMP DE ATAQUE ==========
  private lastAttackTime: number = 0;
  private isInAttackRange: boolean = false;
  private readonly ATTACK_ANIM_DURATION_MS: number = 600;

  /**
   * Crea un nuevo MiniBoss.
   */
  constructor(
    id: string,
    eventBus: EventBus,
    sceneManager: SceneManager,
    physicsWorld?: PhysicsWorld,
    physicsBody?: RigidBodyHandle,
    color: number = 0x880000, // Rojo oscuro para distinguirlo
    size: number = 1.8,       // Más grande que Tank (1.5)
    knockbackResistance: number = 1.0,
    type: EnemyType = EnemyType.MiniBoss,
    stats?: EnemyStats
  ) {
    const effectiveStats = stats || MINIBOSS_STATS;

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
      true // skipModelLoad — nosotros cargamos el Warrior
    );

    // Cargar el modelo de Warrior inmediatamente
    this.loadWarriorModel();
  }

  // =================================================================
  // CARGA DE MODELO (Skeleton_Warrior.glb)
  // =================================================================

  /**
   * Carga el modelo Skeleton_Warrior reutilizando la carga estática.
   */
  private loadWarriorModel(): void {
    if (miniBossWarriorScene) {
      this.cloneWarriorSkeleton(miniBossWarriorScene);
      return;
    }

    if (miniBossLoadPromise) {
      miniBossLoadPromise.then((scene: THREE.Group) => {
        this.cloneWarriorSkeleton(scene);
      }).catch(err => {
        console.error(`[MiniBoss ${this.id}] Error en carga del Warrior:`, err);
      });
      return;
    }

    console.warn(`[MiniBoss ${this.id}] Modelo Warrior no precargado — cargando ahora`);
    ensureMiniBossModelLoaded().then(() => {
      if (miniBossWarriorScene) {
        this.cloneWarriorSkeleton(miniBossWarriorScene);
      }
    }).catch(err => {
      console.error(`[MiniBoss ${this.id}] Error cargando modelo Warrior:`, err);
    });
  }

  /**
   * Clona el modelo Warrior compartido y lo configura para esta instancia.
   */
  private cloneWarriorSkeleton(sourceScene: THREE.Group): void {
    try {
      const cloned = SkeletonUtils.clone(sourceScene) as THREE.Group;

      // Tinte rojo oscuro para distinguir al boss
      cloned.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          if (mesh.material) {
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((mat) => {
              if ((mat as THREE.MeshStandardMaterial).color) {
                const m = mat as THREE.MeshStandardMaterial;
                m.color.setHex(0x880000);
                m.emissive = new THREE.Color(0x330000);
                m.emissiveIntensity = 0.3;
              }
            });
          }
        }
      });

      this.setupModel(cloned);

      this.model!.position.copy(this.targetPosition);

      if (this.enemyState === EnemyState.Spawning) {
        this.model!.scale.set(0.0001, 0.0001, 0.0001);
      }

      this.storeOriginalColor();

      if (!this.physicsBody && this.physicsWorld) {
        this.createPhysicsBody();
      }

      console.log(`[MiniBoss ${this.id}] Modelo Warrior cargado y configurado`);
    } catch (error) {
      console.error(`[MiniBoss ${this.id}] Error clonando modelo Warrior:`, error);
    }
  }

  // =================================================================
  // FÍSICA (override: usa 'large' — hitbox más grande)
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
        'large',
        this.id,
        this
      );

      this.physicsBody = bodyHandle;
      console.log(`[MiniBoss ${this.id}] Cuerpo físico creado (large)`);
    } catch (error) {
      console.error(`[MiniBoss ${this.id}] Error creando cuerpo físico:`, error);
    }
  }

  // =================================================================
  // IA: BÚSQUEDA DEL JUGADOR CON MÁS HP
  // =================================================================

  /**
   * Encuentra al jugador vivo con más HP.
   * El mini-boss prioriza al que tiene más vida para maximizar el impacto de la carga.
   */
  private getPlayerWithMostHP(players: any[]): any | null {
    if (players.length === 0) return null;

    let target: any | null = null;
    let highestHp = -1;

    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      if (!player || !player.getPosition || !player.isAlive) continue;
      if (!player.isAlive()) continue;

      const hp = player.getEffectiveStat ? player.getEffectiveStat('hp') : 0;
      if (hp > highestHp) {
        highestHp = hp;
        target = player;
      }
    }

    return target;
  }

  /**
   * Encuentra al jugador vivo más cercano (para movimiento normal).
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

  // =================================================================
  // MECÁNICA DE CARGA
  // =================================================================

  /**
   * Inicia la fase de telegraphing: muestra un indicador en el suelo
   * durante 1.5s antes de ejecutar el dash.
   */
  private startTelegraph(target: any): void {
    this.chargeState = ChargeState.Telegraphing;
    this.telegraphTimer = this.TELEGRAPH_DURATION;
    this.telegraphPulseTimer = 0;
    this.chargeTarget = target;

    // Calcular dirección hacia el target
    const enemyPos = this.model!.position;
    const targetPos = target.getPosition();
    if (!targetPos) {
      this.chargeState = ChargeState.Cooldown;
      this.chargeCooldownTimer = 8;
      return;
    }

    const dx = targetPos.x - enemyPos.x;
    const dz = targetPos.z - enemyPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.001) {
      this.chargeState = ChargeState.Cooldown;
      this.chargeCooldownTimer = 8;
      return;
    }

    // Dirección normalizada
    this.chargeDirection.set(dx / dist, 0, dz / dist);

    // Posición objetivo: 8m en la dirección del target (o hasta el target si está más cerca)
    const chargeDist = Math.min(this.CHARGE_DISTANCE, dist);
    this.chargeTargetPos.set(
      enemyPos.x + this.chargeDirection.x * chargeDist,
      enemyPos.y,
      enemyPos.z + this.chargeDirection.z * chargeDist
    );

    // Crear indicador visual en el suelo
    this.createTelegraphIndicator();

    // Detener movimiento durante telegraphing
    if (this.physicsBody && this.physicsWorld) {
      const body = this.physicsWorld.getBody(this.physicsBody);
      if (body) {
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }

    console.log(`[MiniBoss ${this.id}] Telegraphing carga hacia ${target.id}`);
  }

  /**
   * Crea el indicador visual de telegraphing en el suelo.
   * Es un anillo rojo que pulsa durante 1.5s.
   */
  private createTelegraphIndicator(): void {
    if (!this.model) return;

    const scene = this.sceneManager.getScene();

    // Anillo de advertencia
    const ringGeometry = new THREE.RingGeometry(0.5, 1.0, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xff2200,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });
    this.telegraphIndicator = new THREE.Mesh(ringGeometry, ringMaterial);
    this.telegraphIndicator.rotation.x = -Math.PI / 2;

    // Posicionar en el suelo, en la posición objetivo de la carga
    this.telegraphIndicator.position.set(
      this.chargeTargetPos.x,
      -1.9, // Justo sobre el suelo
      this.chargeTargetPos.z
    );

    scene.add(this.telegraphIndicator);
  }

  /**
   * Actualiza el indicador de telegraphing (animación de pulso).
   */
  private updateTelegraphIndicator(dt: number): void {
    if (!this.telegraphIndicator) return;

    this.telegraphPulseTimer += dt;

    // Pulso: opacidad oscila entre 0.3 y 1.0
    const pulse = Math.sin(this.telegraphPulseTimer * 8) * 0.35 + 0.65;
    const mat = this.telegraphIndicator.material as THREE.MeshBasicMaterial;
    mat.opacity = pulse;

    // Escalar el anillo: crece de 1.0 a 1.5 durante el telegraphing
    const progress = 1 - (this.telegraphTimer / this.TELEGRAPH_DURATION);
    const scale = 1.0 + progress * 0.5;
    this.telegraphIndicator.scale.set(scale, scale, scale);
  }

  /**
   * Limpia el indicador de telegraphing.
   */
  private cleanupTelegraphIndicator(): void {
    if (this.telegraphIndicator) {
      const scene = this.sceneManager.getScene();
      scene.remove(this.telegraphIndicator);
      this.telegraphIndicator.geometry.dispose();
      (this.telegraphIndicator.material as THREE.Material).dispose();
      this.telegraphIndicator = null;
    }
  }

  /**
   * Ejecuta el dash: mueve al mini-boss rápidamente hacia la posición objetivo.
   */
  private executeCharge(): void {
    this.chargeState = ChargeState.Charging;
    this.chargeStartPos.copy(this.model!.position);
    this.chargeDistanceTraveled = 0;

    // Rotar el modelo hacia la dirección de la carga
    const targetAngle = Math.atan2(this.chargeDirection.x, this.chargeDirection.z) + Math.PI;
    this.model!.rotation.y = targetAngle;

    // Reproducir animación de ataque durante la carga
    this.playAnimation('Attack', false);

    console.log(`[MiniBoss ${this.id}] Ejecutando carga!`);
  }

  /**
   * Actualiza el dash cada frame.
   * Mueve el cuerpo físico a alta velocidad y detecta colisiones con jugadores.
   */
  private updateCharge(dt: number): void {
    if (!this.model || !this.physicsBody || !this.physicsWorld) {
      this.endCharge();
      return;
    }

    const body = this.physicsWorld.getBody(this.physicsBody);
    if (!body) {
      this.endCharge();
      return;
    }

    // Mover a velocidad constante en la dirección de la carga
    const velocity = this.chargeDirection.clone().multiplyScalar(this.CHARGE_SPEED);
    body.setLinvel({ x: velocity.x, y: 0, z: velocity.z }, true);

    // Calcular distancia recorrida
    const currentPos = body.translation();
    const dx = currentPos.x - this.chargeStartPos.x;
    const dz = currentPos.z - this.chargeStartPos.z;
    this.chargeDistanceTraveled = Math.sqrt(dx * dx + dz * dz);

    // Verificar colisión con jugadores
    this.checkChargeCollision();

    // Verificar si llegó al destino o se pasó
    if (this.chargeDistanceTraveled >= this.CHARGE_DISTANCE) {
      this.endCharge();
      return;
    }

    // Verificar si chocó contra una pared (arena bounds ~ ±15)
    if (Math.abs(currentPos.x) > 14 || Math.abs(currentPos.z) > 14) {
      this.endCharge();
      return;
    }
  }

  /**
   * Verifica si la carga impactó a algún jugador.
   * Aplica daño ×3 y knockback masivo.
   */
  private checkChargeCollision(): void {
    if (!this.model || !this.chargeTarget) return;

    const enemyPos = this.model.position;
    const targetPos = this.chargeTarget.getPosition();
    if (!targetPos) return;

    // Radio de impacto de la carga (2m — generoso para que sea fácil de golpear)
    const impactRadiusSq = 2.0 * 2.0;
    const dx = targetPos.x - enemyPos.x;
    const dz = targetPos.z - enemyPos.z;
    const distSq = dx * dx + dz * dz;

    if (distSq <= impactRadiusSq) {
      // Aplicar daño ×3
      const baseDamage = this.getEffectiveStat('damage');
      const chargeDamage = Math.round(baseDamage * 3);

      if (this.chargeTarget.takeDamage) {
        this.chargeTarget.takeDamage(chargeDamage);
        console.log(`[MiniBoss ${this.id}] Impacto de carga! ${chargeDamage} daño a ${this.chargeTarget.id}`);
      }

      // Aplicar knockback masivo
      const knockbackDir = this.chargeDirection.clone().normalize();
      const knockbackForce = knockbackDir.multiplyScalar(30); // Fuerza masiva
      if (this.chargeTarget.applyKnockback) {
        this.chargeTarget.applyKnockback(knockbackForce, 0.5);
      }

      // Emitir evento de impacto visual
      this.eventBus.emit('enemy:damage', {
        enemyId: this.id,
        damage: chargeDamage,
        attackerId: this.id,
        position: { x: enemyPos.x, y: enemyPos.y, z: enemyPos.z },
        isCritical: true,
      });

      // Terminar la carga después del impacto
      this.endCharge();
    }
  }

  /**
   * Finaliza la carga y vuelve al estado de cooldown.
   */
  private endCharge(): void {
    this.chargeState = ChargeState.Cooldown;
    this.chargeCooldownTimer = 8; // 8s de cooldown
    this.chargeTarget = null;
    this.chargeDistanceTraveled = 0;

    // Limpiar indicador visual
    this.cleanupTelegraphIndicator();

    // Detener velocidad
    if (this.physicsBody && this.physicsWorld) {
      const body = this.physicsWorld.getBody(this.physicsBody);
      if (body) {
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
  }

  // =================================================================
  // BOSS HP BAR (DOM estático)
  // =================================================================

  /**
   * Crea el elemento DOM de la barra de HP del boss si no existe.
   * Se muestra en el centro superior de la pantalla.
   */
  private static ensureBossHpBarElement(): void {
    if (MiniBoss.bossHpBarElement) return;

    // Contenedor principal
    const container = document.createElement('div');
    container.id = 'boss-hp-bar';
    container.style.position = 'fixed';
    container.style.top = '60px';
    container.style.left = '50%';
    container.style.transform = 'translateX(-50%)';
    container.style.width = '400px';
    container.style.zIndex = '999';
    container.style.display = 'none';
    container.style.textAlign = 'center';

    // Nombre del boss
    const nameEl = document.createElement('div');
    nameEl.id = 'boss-hp-bar-name';
    nameEl.style.color = '#ff4444';
    nameEl.style.fontFamily = 'monospace';
    nameEl.style.fontSize = '20px';
    nameEl.style.fontWeight = 'bold';
    nameEl.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
    nameEl.style.marginBottom = '4px';
    nameEl.textContent = '⚔️ MINI BOSS ⚔️';
    container.appendChild(nameEl);

    // Barra de HP
    const barOuter = document.createElement('div');
    barOuter.style.width = '100%';
    barOuter.style.height = '24px';
    barOuter.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    barOuter.style.borderRadius = '12px';
    barOuter.style.border = '2px solid #ff4444';
    barOuter.style.overflow = 'hidden';
    barOuter.style.boxShadow = '0 0 15px rgba(255, 68, 68, 0.5)';

    const barFill = document.createElement('div');
    barFill.id = 'boss-hp-bar-fill';
    barFill.style.width = '100%';
    barFill.style.height = '100%';
    barFill.style.backgroundColor = '#ff2222';
    barFill.style.borderRadius = '10px';
    barFill.style.transition = 'width 0.3s ease';
    barOuter.appendChild(barFill);

    container.appendChild(barOuter);

    // Texto de HP (valor numérico)
    const hpText = document.createElement('div');
    hpText.id = 'boss-hp-bar-text';
    hpText.style.color = '#ffffff';
    hpText.style.fontFamily = 'monospace';
    hpText.style.fontSize = '14px';
    hpText.style.marginTop = '4px';
    hpText.style.textShadow = '1px 1px 2px rgba(0,0,0,0.8)';
    container.appendChild(hpText);

    document.body.appendChild(container);

    MiniBoss.bossHpBarElement = container;
    MiniBoss.bossHpBarFill = barFill;
    MiniBoss.bossHpBarName = nameEl;
  }

  /**
   * Muestra la barra de HP del boss en el centro de la pantalla.
   */
  private showBossHpBar(): void {
    MiniBoss.ensureBossHpBarElement();
    if (MiniBoss.bossHpBarElement) {
      MiniBoss.bossHpBarElement.style.display = 'block';
      MiniBoss.currentBossInstance = this;
    }
  }

  /**
   * Oculta la barra de HP del boss.
   */
  private hideBossHpBar(): void {
    if (MiniBoss.bossHpBarElement) {
      MiniBoss.bossHpBarElement.style.display = 'none';
      MiniBoss.currentBossInstance = null;
    }
  }

  /**
   * Actualiza la barra de HP del boss (llamado desde update).
   */
  private updateBossHpBar(): void {
    if (MiniBoss.currentBossInstance !== this) return;
    if (!MiniBoss.bossHpBarFill) return;

    const currentHp = this.getEffectiveStat('hp');
    const maxHp = this.getEffectiveStat('maxHp');
    const ratio = maxHp > 0 ? Math.max(0, currentHp / maxHp) : 0;

    MiniBoss.bossHpBarFill.style.width = `${ratio * 100}%`;

    // Cambiar color según HP restante
    if (ratio > 0.5) {
      MiniBoss.bossHpBarFill.style.backgroundColor = '#ff2222'; // Rojo
    } else if (ratio > 0.25) {
      MiniBoss.bossHpBarFill.style.backgroundColor = '#ff6600'; // Naranja
    } else {
      MiniBoss.bossHpBarFill.style.backgroundColor = '#ff0000'; // Rojo intenso
    }

    // Actualizar texto de HP
    const hpTextEl = document.getElementById('boss-hp-bar-text');
    if (hpTextEl) {
      hpTextEl.textContent = `${Math.ceil(currentHp)} / ${maxHp}`;
    }
  }

  // =================================================================
  // ITEM DROP SYSTEM
  // =================================================================

  /**
   * Crea un ítem visual en el suelo que los jugadores pueden recoger.
   * El ítem es una esfera brillante de color dorado.
   */
  private spawnItemDrop(): void {
    if (!this.model) return;

    const scene = this.sceneManager.getScene();

    // Crear una esfera dorada brillante como ítem
    const sphereGeo = new THREE.SphereGeometry(0.4, 16, 16);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      emissive: 0xffaa00,
      emissiveIntensity: 0.5,
      metalness: 0.8,
      roughness: 0.2,
    });
    this.droppedItem = new THREE.Mesh(sphereGeo, sphereMat);

    // Posicionar en el suelo donde murió el boss
    this.droppedItem.position.set(
      this.model.position.x,
      -1.6, // Justo sobre el suelo
      this.model.position.z
    );

    // Agregar un glow point light pequeño
    const glowLight = new THREE.PointLight(0xffd700, 0.5, 3);
    glowLight.position.copy(this.droppedItem.position);
    glowLight.position.y = -1.2;
    this.droppedItem.userData.glowLight = glowLight;

    scene.add(this.droppedItem);
    scene.add(glowLight);

    this.itemCollected = false;

    console.log(`[MiniBoss ${this.id}] Ítem dropeado en (${this.droppedItem.position.x.toFixed(1)}, ${this.droppedItem.position.z.toFixed(1)})`);
  }

  /**
   * Actualiza el item dropeado: animacion de flotacion y rotacion.
   * La recoleccion se hace mediante tecla [E] desde main.ts.
   */
  private updateItemDrop(dt: number, _players: any[]): void {
    if (!this.droppedItem || this.itemCollected) return;

    // Animacion de flotacion suave
    const floatOffset = Math.sin(Date.now() * 0.003) * 0.1;
    this.droppedItem.position.y = -1.6 + floatOffset;

    // Rotacion lenta
    this.droppedItem.rotation.y += dt * 1.5;
  }

  /**
   * Recolecta el item: otorga recompensa y efectos visuales.
   */
  private collectItem(player: any): void {
    if (this.itemCollected) return;
    this.itemCollected = true;

    console.log(`[MiniBoss ${this.id}] Item recogido por ${player.id}`);

    // Efecto visual de recoleccion (desaparecer con escala)
    if (this.droppedItem) {
      const scene = this.sceneManager.getScene();
      scene.remove(this.droppedItem);

      // Remover glow light
      if (this.droppedItem.userData.glowLight) {
        scene.remove(this.droppedItem.userData.glowLight);
      }

      this.droppedItem.geometry.dispose();
      (this.droppedItem.material as THREE.Material).dispose();
      this.droppedItem = null;
    }

    // Emitir evento de item recogido para que el MoneySystem otorgue bonus
    this.eventBus.emit('item:collected', {
      playerId: player.id,
      enemyId: this.id,
      reward: 10,
    });
  }

  // =================================================================
  // UPDATE AI (override principal)
  // =================================================================

  /**
   * Actualiza la IA del MiniBoss.
   * - Si está en cooldown de carga: persigue al jugador con más HP
   * - Cada 8s: inicia telegraphing (1.5s)
   * - Durante telegraphing: muestra indicador en el suelo, no se mueve
   * - Durante carga: dash rápido hacia el jugador objetivo
   * - Al impactar: daño ×3 + knockback masivo
   */
  updateAI(dt: number, players: any[], world?: any, activeEnemies?: any[]): void {
    if (!this.model || players.length === 0) return;
    if (this.enemyState !== EnemyState.Active) return;
    if (!this.steeringEnabled) return;

    // Guardar referencia a jugadores para item drop
    this.playersRef = players;

    // Actualizar barra de HP del boss
    this.updateBossHpBar();

    // Máquina de estados de la carga
    switch (this.chargeState) {
      case ChargeState.Cooldown: {
        this.chargeCooldownTimer -= dt;

        if (this.chargeCooldownTimer <= 0) {
          // Iniciar telegraphing hacia el jugador con más HP
          const target = this.getPlayerWithMostHP(players);
          if (target) {
            this.startTelegraph(target);
          } else {
            // Resetear cooldown si no hay target
            this.chargeCooldownTimer = 8;
          }
          return;
        }

        // Movimiento normal: perseguir al jugador con más HP
        this.updateNormalMovement(dt, players, activeEnemies);
        break;
      }

      case ChargeState.Telegraphing: {
        this.telegraphTimer -= dt;
        this.updateTelegraphIndicator(dt);

        // No moverse durante telegraphing
        if (this.physicsBody && this.physicsWorld) {
          const body = this.physicsWorld.getBody(this.physicsBody);
          if (body) {
            body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          }
        }

        if (this.telegraphTimer <= 0) {
          // Terminó telegraphing — ejecutar carga
          this.cleanupTelegraphIndicator();
          this.executeCharge();
        }
        break;
      }

      case ChargeState.Charging: {
        this.updateCharge(dt);
        break;
      }
    }

    // Actualizar item drop (recolección por proximidad)
    this.updateItemDrop(dt, players);
  }

  /**
   * Movimiento normal del MiniBoss (cuando no está cargando).
   * Persigue al jugador con más HP usando steering behaviors.
   */
  private updateNormalMovement(dt: number, players: any[], activeEnemies?: any[]): void {
    const target = this.getPlayerWithMostHP(players);
    if (!target || !target.getPosition) return;

    const targetPos = target.getPosition();
    if (!targetPos) return;

    const enemyPos = this.model!.position;

    const dx = targetPos.x - enemyPos.x;
    const dz = targetPos.z - enemyPos.z;
    const distSq = dx * dx + dz * dz;

    // Rango de ataque (1.1m — ajustado al nuevo radio de collider 0.65)
    const attackRangeSq = 1.1 * 1.1;
    this.isInAttackRange = distSq <= attackRangeSq;

    if (this.isInAttackRange) {
      // Atacar cuerpo a cuerpo
      this.tryMeleeAttack(target);

      // Detener movimiento mientras ataca
      if (this.physicsBody && this.physicsWorld) {
        const body = this.physicsWorld.getBody(this.physicsBody);
        if (body) {
          body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
      }

      const now = Date.now();
      const attackAnimFinished = (now - this.lastAttackTime) >= this.ATTACK_ANIM_DURATION_MS;
      if (attackAnimFinished) {
        this.playAnimation('Idle');
      }
    } else {
      // Perseguir al target usando steering behaviors
      const dist = Math.sqrt(distSq);
      if (dist < 0.001) return;

      // DirecciÃ³n normalizada hacia el target (para rotaciÃ³n)
      const dirX = dx / dist;
      const dirZ = dz / dist;

      // Preparar agente y vecinos para steering
      const agent: SteeringAgent = { position: enemyPos };
      const neighbors: SteeringAgent[] = [];
      if (activeEnemies) {
        for (let i = 0; i < activeEnemies.length; i++) {
          const other = activeEnemies[i];
          if (other === this || !other.model || !other.model.position) continue;
          neighbors.push({ position: other.model.position });
        }
      }

      // MiniBoss usa un radio de separaciÃ³n mayor por su tamaÃ±o
      const bossSeparationRadius = DEFAULT_SEPARATION_RADIUS * 2.0;

      // Calcular steering forces
      const seekForce = seek(agent, targetPos);
      const sepForce = separation(agent, neighbors, bossSeparationRadius, MAX_SEPARATION_NEIGHBORS);
      const avoidForce = avoidObstacles(agent, TilemapLoader.obstaclePositions, seekForce, DEFAULT_AVOID_LOOK_AHEAD, DEFAULT_AVOID_RADIUS);

      // Combinar con pesos
      const { direction, hasMovement } = combineForces([
        [seekForce, DEFAULT_MELEE_WEIGHTS.seek],
        [sepForce, DEFAULT_MELEE_WEIGHTS.separation * 2.0],
        [avoidForce, DEFAULT_AVOID_WEIGHT],
      ]);

      if (!hasMovement) return;

      // Aplicar aceleraciÃ³n suave
      const moveSpeed = this.getEffectiveStat('speed');
      applyAcceleration(this.currentSteeringVel, direction, moveSpeed, this.maxAcceleration, dt);

      // RotaciÃ³n: el modelo base tiene rotation.y = Math.PI, forward efectivo = -Z
      const targetAngle = Math.atan2(dirX, dirZ) + Math.PI;
      this.model!.rotation.y = THREE.MathUtils.lerp(
        this.model!.rotation.y,
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

      // AnimaciÃ³n de caminar
      this.playAnimation('Walk');
    }
  }

  /**
   * Intenta realizar un ataque cuerpo a cuerpo al target.
   * @param target - El jugador objetivo
   * @returns true si el ataque se ejecutÃ³
   */
  private tryMeleeAttack(target: any): boolean {
    const now = Date.now();
    const attackSpeed = this.getEffectiveStat('attackSpeed');
    const cooldownMs = attackSpeed > 0 ? 1000 / attackSpeed : 1000;

    if (now - this.lastAttackTime < cooldownMs) return false;

    this.lastAttackTime = now;

    // Reproducir animaciÃ³n de ataque (one-shot, sin loop)
    this.playAnimation('Attack', false);

    const damage = this.getEffectiveStat('damage');
    if (target && typeof target.takeDamage === 'function') {
      target.takeDamage(damage);
      console.log(`[MiniBoss ${this.id}] Ataque cuerpo a cuerpo a ${target.id}: ${damage} daÃ±o`);
    }

    return true;
  }

  // =================================================================
  // UPDATE (override)
  // =================================================================

  /**
   * Actualiza el MiniBoss cada frame.
   * Delega en super.update() para spawn animation, death animation,
   * HP bar, hit particles y sync de fÃ­sica.
   */
  update(dt: number): void {
    super.update(dt);
  }

  // =================================================================
  // MUERTE (override) - dropear item al morir
  // =================================================================

  /**
   * Override de die() para dropear el item antes de la animacion de muerte.
   */
  die(): void {
    // Dropear item antes de que el modelo desaparezca
    this.spawnItemDrop();
    super.die();
  }

  /**
   * Retorna la posicion del item dropeado (para la UI de recoleccion).
   */
  getDroppedItemPosition(): THREE.Vector3 | null {
    if (!this.droppedItem) return null;
    return this.droppedItem.position.clone();
  }

  /**
   * Indica si hay un item disponible para recoger.
   */
  hasDroppedItemAvailable(): boolean {
    return this.droppedItem !== null && !this.itemCollected;
  }

  /**
   * Intenta recoger el item si el jugador esta cerca.
   */
  tryCollectItem(player: any): boolean {
    if (!this.droppedItem || this.itemCollected) return false;
    if (!player || !player.getPosition) return false;

    const playerPos = player.getPosition();
    if (!playerPos) return false;

    const dx = playerPos.x - this.droppedItem.position.x;
    const dz = playerPos.z - this.droppedItem.position.z;
    const distSq = dx * dx + dz * dz;

    if (distSq <= this.ITEM_PICKUP_RADIUS * this.ITEM_PICKUP_RADIUS) {
      this.collectItem(player);
      return true;
    }
    return false;
  }

  // =================================================================
  // POOL LIFECYCLE (override)
  // =================================================================

  /**
   * Spawnea el MiniBoss en una posiciÃ³n especÃ­fica.
   * Muestra la barra de HP del boss en el HUD.
   */
  spawn(options: SpawnOptions): void {
    super.spawn(options);
    this.showBossHpBar();
    console.log(`[MiniBoss ${this.id}] Spawneado en (${options.position.x}, ${options.position.y}, ${options.position.z})`);
  }

  /**
   * Libera el MiniBoss de vuelta al pool.
   * Oculta la barra de HP del boss y limpia recursos.
   */
  release(): void {
    super.release();
    this.hideBossHpBar();
    this.cleanupTelegraphIndicator();
    this.cleanupDroppedItem();
    this.chargeState = ChargeState.Cooldown;
    this.chargeCooldownTimer = 8;
    this.lastAttackTime = 0;
    this.isInAttackRange = false;
  }

  /**
   * Resetea el MiniBoss para reutilizaciÃ³n.
   */
  reset(): void {
    super.reset();
    this.chargeState = ChargeState.Cooldown;
    this.chargeCooldownTimer = 8;
    this.lastAttackTime = 0;
    this.isInAttackRange = false;
    this.itemCollected = false;
  }

  /**
   * Limpia el Ã­tem dropeado del escenario.
   */
  private cleanupDroppedItem(): void {
    if (this.droppedItem) {
      if (this.droppedItem.parent) {
        this.droppedItem.parent.remove(this.droppedItem);
      }
      // Dispose de geometry y material
      this.droppedItem.traverse((child: any) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m: any) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      this.droppedItem = null;
    }
  }

  /**
   * DisposiciÃ³n completa de recursos del MiniBoss.
   */
  dispose(): void {
    this.cleanupDroppedItem();
    this.cleanupTelegraphIndicator();
    this.hideBossHpBar();
    super.dispose();
  }
}
