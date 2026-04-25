import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld, RigidBodyHandle } from '../physics/PhysicsWorld';
import { Groups, Masks } from '../physics/CollisionGroups';
import { EventBus } from '../engine/EventBus';
import { DamagePipeline } from './DamagePipeline';

export interface ProjectileConfig {
  /** Velocidad inicial (m/s) */
  velocity: THREE.Vector3;
  /** Daño base que inflige */
  damage: number;
  /** Si es true, atraviesa un enemigo antes de destruirse */
  pierce: boolean;
  /** ID del jugador o entidad que disparó el proyectil */
  ownerId: string;
  /** Rango máximo de viaje antes de autodestruirse */
  range: number;
  /** Radio de la esfera de colisión (metros) */
  radius?: number;
  /** Grupo de colisión (por defecto PROJECTILE). Usar ENEMY_PROJECTILE para proyectiles enemigos */
  collisionGroup?: number;
  /** Máscara de colisión (por defecto Masks.PROJECTILE) */
  collisionMask?: number;
}

/**
 * Proyectil reutilizable con cuerpo físico y mesh visual.
 * Se mueve cinemáticamente, detecta colisiones y aplica daño.
 */
export class Projectile {
  private mesh: THREE.Mesh;
  private bodyHandle: RigidBodyHandle | null = null;
  private config: ProjectileConfig | null = null;
  private active: boolean = false;
  private distanceTraveled: number = 0;
  private hasPierced: boolean = false;
  private startPosition: THREE.Vector3 = new THREE.Vector3();

  // Para detección de colisiones
  private lastCollisionCheck: number = 0;
  private readonly collisionCheckInterval: number = 0.1; // segundos

  /** Pipeline centralizado de daño (opcional) */
  private damagePipeline: DamagePipeline | null = null;

  constructor(
    private readonly physicsWorld: PhysicsWorld,
    private readonly scene: THREE.Scene,
    private readonly eventBus: EventBus
  ) {
    // Crear mesh visual (esfera pequeña)
    const geometry = new THREE.SphereGeometry(0.08, 8, 8);
    const material = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.visible = false;
    this.scene.add(this.mesh);
  }

  /**
   * Activa el proyectil con la configuración dada.
   * @param position Posición inicial
   * @param config Configuración del proyectil
   */
  activate(position: THREE.Vector3, config: ProjectileConfig): void {
    if (this.active) {
      console.warn('[Projectile] Intento de activar proyectil ya activo');
      return;
    }

    this.config = config;
    this.startPosition.copy(position);
    this.distanceTraveled = 0;
    this.hasPierced = false;
    this.active = true;

    // Crear cuerpo físico (kinemático con CCD activado)
    this.createPhysicsBody(position, config);

    // Configurar mesh visual
    this.mesh.position.copy(position);
    this.mesh.visible = true;

    console.log(`[Projectile] Activado por ${config.ownerId} con daño ${config.damage}`);
  }

  /**
   * Crea el cuerpo físico Rapier para el proyectil.
   */
  private createPhysicsBody(position: THREE.Vector3, config: ProjectileConfig): void {
    // Crear collider esférico
    const radius = config.radius ?? 0.1;
    const group = config.collisionGroup ?? Groups.PROJECTILE;
    const mask = config.collisionMask ?? Masks.PROJECTILE;
    const colliderDesc = RAPIER.ColliderDesc.ball(radius)
      .setTranslation(position.x, position.y, position.z)
      .setCollisionGroups((group << 16) | mask)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS); // Para detectar colisiones

    // Crear cuerpo kinemático (movido manualmente) con CCD habilitado
    this.bodyHandle = this.physicsWorld.createBody({
      type: 'kinematic',
      position,
      collider: colliderDesc,
      ccdEnabled: true, // Continuous Collision Detection para alta velocidad
      userData: {
        type: 'projectile',
        projectile: this,
        ownerId: config.ownerId,
        damage: config.damage,
        pierce: config.pierce,
      },
    });

    // Sincronizar mesh con cuerpo físico
    if (this.bodyHandle) {
      this.physicsWorld.syncToThree(this.mesh, this.bodyHandle);
    }

    // Aplicar velocidad inicial
    this.setVelocity(config.velocity);
  }

  /**
   * Establece el pipeline centralizado de daño.
   */
  setDamagePipeline(pipeline: DamagePipeline): void {
    this.damagePipeline = pipeline;
  }

  /**
   * Establece la velocidad del proyectil.
   */
  setVelocity(velocity: THREE.Vector3): void {
    if (!this.bodyHandle || !this.active) return;

    const body = this.physicsWorld.getBody(this.bodyHandle);
    if (!body) return;

    body.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
  }

  /**
   * Actualiza el estado del proyectil.
   * @param deltaTime Tiempo transcurrido desde el último frame (segundos)
   */
  update(deltaTime: number): void {
    if (!this.active || !this.bodyHandle || !this.config) return;

    // Actualizar distancia recorrida
    const body = this.physicsWorld.getBody(this.bodyHandle);
    if (body) {
      const currentPos = body.translation();
      this.distanceTraveled = this.startPosition.distanceTo(
        new THREE.Vector3(currentPos.x, currentPos.y, currentPos.z)
      );
    }

    // Verificar colisiones periódicamente
    this.lastCollisionCheck += deltaTime;
    if (this.lastCollisionCheck >= this.collisionCheckInterval) {
      this.checkCollisions();
      this.lastCollisionCheck = 0;
    }

    // Verificar si superó el rango máximo
    if (this.distanceTraveled > this.config.range) {
      console.log(`[Projectile] Destruido por superar rango (${this.distanceTraveled.toFixed(1)} > ${this.config.range})`);
      this.markForRelease();
    }
  }

  /**
   * Verifica colisiones usando raycast desde la posición actual del proyectil.
   * Filtra por el grupo de colisión del proyectil para detectar solo objetivos válidos.
   */
  private checkCollisions(): void {
    if (!this.bodyHandle || !this.config) return;

    const world = this.physicsWorld.getWorld();
    if (!world) return;

    // Obtener posición actual del proyectil
    const body = world.getRigidBody(this.bodyHandle);
    if (!body) return;

    const pos = body.translation();

    // Determinar qué grupo buscar según el collision group del proyectil
    const group = this.config.collisionGroup ?? Groups.PROJECTILE;
    const targetGroup = group === Groups.ENEMY_PROJECTILE ? Groups.PLAYER : Groups.ENEMY;

    // Usar la velocidad para determinar la dirección del raycast
    const vel = body.linvel();
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    if (speed < 0.01) return;

    const rayDir = { x: vel.x / speed, y: vel.y / speed, z: vel.z / speed };

    // --- Raycast hacia adelante ---
    // Escaneamos una distancia que cubra el movimiento desde el último check
    // (speed * collisionCheckInterval) más el radio del proyectil para detectar solapamiento
    const forwardScanDistance = speed * this.collisionCheckInterval + (this.config.radius ?? 0.1) + 0.5;
    const rayOrigin = { x: pos.x, y: pos.y, z: pos.z };
    const forwardRay = new RAPIER.Ray(rayOrigin, rayDir);

    world.intersectionsWithRay(
      forwardRay, forwardScanDistance, false,
      (intersection: RAPIER.RayColliderIntersection) => {
        const collider = intersection.collider;

        // Filtrar por el grupo objetivo
        const groups = collider.collisionGroups();
        const membership = (groups >> 16) & 0xffff;
        if ((membership & targetGroup) === 0) {
          return true; // No es el objetivo, continuar
        }

        const userData = collider.parent()?.userData as { entity?: any; type?: string } | undefined;

        if (userData) {
          // Llamar al manejador de colisión
          this.handleCollision(userData);
        }

        return true; // Continuar buscando
      }
    );

    // --- Raycast hacia atrás ---
    // Si el proyectil ya atravesó al objetivo entre frames, el raycast forward no lo detecta.
    // Escaneamos hacia atrás para cubrir esa posibilidad.
    const backDir = { x: -rayDir.x, y: -rayDir.y, z: -rayDir.z };
    const backRay = new RAPIER.Ray(rayOrigin, backDir);
    // Escaneamos una distancia menor hacia atrás (solo para detectar solapamiento)
    const backScanDistance = (this.config.radius ?? 0.1) + 0.5;

    world.intersectionsWithRay(
      backRay, backScanDistance, false,
      (intersection: RAPIER.RayColliderIntersection) => {
        const collider = intersection.collider;

        const groups = collider.collisionGroups();
        const membership = (groups >> 16) & 0xffff;
        if ((membership & targetGroup) === 0) {
          return true;
        }

        const userData = collider.parent()?.userData as { entity?: any; type?: string } | undefined;

        if (userData) {
          this.handleCollision(userData);
        }

        return true;
      }
    );
  }

  /**
   * Maneja una colisión con otra entidad.
   * @param otherUserData UserData del cuerpo con el que colisionó
   */
  handleCollision(otherUserData: any): void {
    if (!this.active || !this.config) return;

    const entityType = otherUserData?.type;
    console.log(`[Projectile] Colisión con ${entityType}`, otherUserData);

    if (entityType === 'enemy') {
      this.handleEnemyCollision(otherUserData);
    } else if (entityType === 'wall') {
      this.handleWallCollision();
    } else if (entityType === 'player') {
      this.handlePlayerCollision(otherUserData);
    } else if (otherUserData?.entity) {
      // Fallback: si tiene entity, intentar aplicar daño directamente
      const entity = otherUserData.entity;
      if (typeof entity.takeDamage === 'function') {
        this.applyDamageToEntity(entity);
      }
    }
  }

  /**
   * Maneja colisión con enemigo.
   */
  private handleEnemyCollision(enemyData: any): void {
    if (!this.config) return;

    // Obtener posición actual del proyectil
    const position = this.getPosition();

    // Usar el pipeline centralizado si está disponible
    if (this.damagePipeline && enemyData.entity) {
      this.damagePipeline.applyDamage(
        { id: this.config.ownerId },
        enemyData.entity,
        this.config.damage,
        {
          position,
          source: 'projectile',
          attackerId: this.config.ownerId,
          canCrit: true,
          critChance: 0.1,
          critMultiplier: 1.5,
        }
      );
    } else {
      // Fallback: emitir evento de daño directamente
      this.eventBus.emit('enemy:damage', {
        enemyId: enemyData.id,
        damage: this.config.damage,
        attackerId: this.config.ownerId,
        position: { x: position.x, y: position.y, z: position.z },
      });
    }

    console.log(`[Projectile] Aplicando daño ${this.config.damage} a enemigo ${enemyData.id}`);

    // Si no es perforante, marcar para liberación
    if (!this.config.pierce) {
      this.markForRelease();
    } else {
      // Si es perforante y ya atravesó un enemigo, liberar
      if (this.hasPierced) {
        this.markForRelease();
      } else {
        this.hasPierced = true;
        console.log(`[Projectile] Proyectil perforante atravesó primer enemigo`);
      }
    }
  }

  /**
   * Maneja colisión con muro.
   */
  private handleWallCollision(): void {
    console.log(`[Projectile] Colisión con muro, destruyendo`);
    this.markForRelease();
  }

  /**
   * Maneja colisión con jugador.
   */
  private handlePlayerCollision(playerData: any): void {
    if (!this.config) return;

    const entity = playerData.entity;
    if (!entity || typeof entity.takeDamage !== 'function') return;

    this.applyDamageToEntity(entity);
    this.markForRelease();
  }

  /**
   * Aplica daño a una entidad usando el pipeline o eventBus.
   */
  private applyDamageToEntity(entity: any): void {
    if (!this.config) return;

    const position = this.getPosition();

    if (this.damagePipeline) {
      this.damagePipeline.applyDamage(
        { id: this.config.ownerId },
        entity,
        this.config.damage,
        {
          position,
          source: 'projectile',
          attackerId: this.config.ownerId,
          canCrit: false,
          critChance: 0,
          critMultiplier: 1.0,
        }
      );
    } else {
      // Fallback: emitir evento de daño
      this.eventBus.emit('enemy:damage', {
        enemyId: this.config.ownerId,
        damage: this.config.damage,
        attackerId: this.config.ownerId,
        position: { x: position.x, y: position.y, z: position.z },
      });
    }

    console.log(`[Projectile] Aplicando daño ${this.config.damage} a entidad via applyDamageToEntity`);
  }

  /**
   * Marca el proyectil para ser liberado al pool.
   */
  markForRelease(): void {
    this.active = false;
  }

  /**
   * Determina si el proyectil debe ser liberado.
   */
  shouldBeReleased(): boolean {
    return !this.active;
  }

  /**
   * Resetea el proyectil a su estado inactivo.
   */
  reset(): void {
    this.active = false;
    this.config = null;
    this.distanceTraveled = 0;
    this.hasPierced = false;
    this.lastCollisionCheck = 0;

    // Ocultar mesh
    this.mesh.visible = false;

    // Eliminar cuerpo físico si existe
    if (this.bodyHandle) {
      this.physicsWorld.removeBody(this.bodyHandle);
      this.bodyHandle = null;
    }
  }

  /**
   * Obtiene si el proyectil está activo.
   */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Obtiene la posición actual del proyectil.
   */
  getPosition(): THREE.Vector3 {
    if (!this.bodyHandle) return this.mesh.position;

    const body = this.physicsWorld.getBody(this.bodyHandle);
    if (body) {
      const pos = body.translation();
      return new THREE.Vector3(pos.x, pos.y, pos.z);
    }

    return this.mesh.position;
  }

  /**
   * Destruye recursos (llamar cuando el pool se destruya).
   */
  dispose(): void {
    this.reset();
    this.scene.remove(this.mesh);
    (this.mesh.geometry as THREE.BufferGeometry).dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}