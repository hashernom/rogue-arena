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
 *
 * Estrategia de detección de impacto:
 * 1. El proyectil se mueve como cuerpo dinámico con CCD (para colisionar con cuerpos cinemáticos).
 * 2. En cada frame, se usa `intersectionsWithShape` (overlap query) con una esfera en la
 *    posición actual del proyectil para detectar solapamiento con colliders objetivo.
 * 3. Como fallback, se usa un raycast desde la posición anterior a la actual para cubrir
 *    el arco de movimiento entre frames (anti-tunneling).
 * 4. Como fallback adicional, se hace un distance check directo contra targets registrados
 *    (no depende de Rapier queries ni alturas de colliders).
 */
export class Projectile {
  private mesh: THREE.Mesh;
  private bodyHandle: RigidBodyHandle | null = null;
  private config: ProjectileConfig | null = null;
  private active: boolean = false;
  private distanceTraveled: number = 0;
  private hasPierced: boolean = false;
  private startPosition: THREE.Vector3 = new THREE.Vector3();

  /** Posición en el frame anterior (para raycast entre frames) */
  private previousPosition: THREE.Vector3 | null = null;

  /** Pipeline centralizado de daño (opcional) */
  private damagePipeline: DamagePipeline | null = null;

  /** Targets a los que puede dañar este proyectil (para distance check directo) */
  private targets: { entity: any; getPosition: () => THREE.Vector3 | null }[] = [];

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
    this.previousPosition = position.clone();
    this.distanceTraveled = 0;
    this.hasPierced = false;
    this.active = true;

    // Crear cuerpo físico (dinámico con CCD para colisionar con cuerpos cinemáticos)
    this.createPhysicsBody(position, config);

    // Configurar mesh visual
    this.mesh.position.copy(position);
    this.mesh.visible = true;

    console.log(`[Projectile] Activado por ${config.ownerId} con daño ${config.damage}`);
  }

  /**
   * Crea el cuerpo físico Rapier para el proyectil.
   * Usa cuerpo dinámico (no cinemático) para que los eventos de colisión
   * funcionen correctamente con cuerpos cinemáticos (players).
   */
  private createPhysicsBody(position: THREE.Vector3, config: ProjectileConfig): void {
    const radius = config.radius ?? 0.1;
    const group = config.collisionGroup ?? Groups.PROJECTILE;
    const mask = config.collisionMask ?? Masks.PROJECTILE;

    // Collider esférico
    const colliderDesc = RAPIER.ColliderDesc.ball(radius)
      .setTranslation(position.x, position.y, position.z)
      .setCollisionGroups((group << 16) | mask)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

    // Cuerpo dinámico (NO kinematic) para colisionar con cuerpos cinemáticos
    this.bodyHandle = this.physicsWorld.createBody({
      type: 'dynamic',
      position,
      collider: colliderDesc,
      ccdEnabled: true, // Continuous Collision Detection para alta velocidad
      gravityScale: 0,  // Sin gravedad (top-down)
      linearDamping: 0, // Sin damping para que mantenga velocidad constante
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
   * Establece los targets contra los que hacer distance check directo.
   * Útil para proyectiles enemigos que necesitan detectar players
   * independientemente de la altura de sus colliders de física.
   */
  setTargets(targets: { entity: any; getPosition: () => THREE.Vector3 | null }[]): void {
    this.targets = targets;
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

    const body = this.physicsWorld.getBody(this.bodyHandle);
    if (!body) return;

    const currentPos = body.translation();

    // Actualizar distancia recorrida
    this.distanceTraveled = this.startPosition.distanceTo(
      new THREE.Vector3(currentPos.x, currentPos.y, currentPos.z)
    );

    // 1. Detectar colisiones vía Rapier: overlap query + raycast entre frames
    this.checkCollisions(body, currentPos);

    // 2. Distance check directo contra targets (fallback robusto)
    //    No depende de alturas de colliders ni del orden de stepAll()
    this.checkTargetDistance(currentPos);

    // Guardar posición actual para el próximo frame
    this.previousPosition = new THREE.Vector3(currentPos.x, currentPos.y, currentPos.z);

    // Verificar si superó el rango máximo
    if (this.distanceTraveled > this.config.range) {
      console.log(`[Projectile] Destruido por superar rango (${this.distanceTraveled.toFixed(1)} > ${this.config.range})`);
      this.markForRelease();
    }
  }

  /**
   * Detecta colisiones usando overlap query (intersectionsWithShape) y raycast entre frames.
   *
   * El overlap query detecta si la esfera del proyectil se solapa con algún collider
   * en su posición actual. Usa un radio generoso (0.5) para cubrir el rango vertical
   * de los capsules de los personajes.
   *
   * El raycast entre frames cubre el arco de movimiento para evitar tunneling.
   */
  private checkCollisions(body: RAPIER.RigidBody, currentPos: RAPIER.Vector): void {
    if (!this.config) return;

    const world = this.physicsWorld.getWorld();
    if (!world) return;

    // Determinar qué grupo buscar según el collision group del proyectil
    const group = this.config.collisionGroup ?? Groups.PROJECTILE;
    const targetGroup = group === Groups.ENEMY_PROJECTILE ? Groups.PLAYER : Groups.ENEMY;

    // Radio generoso para la overlap query (0.5 cubre bien el rango vertical
    // de los capsules: halfHeight=0.5, radius=0.3)
    const queryRadius = 0.5;

    // --- 1. Overlap query: esfera grande en la posición actual ---
    // Usamos un radio generoso para asegurar que la esfera cubra el rango
    // vertical de los capsules de los personajes, incluso si el projectile
    // viaja a una altura ligeramente diferente.
    const sphereShape = new RAPIER.Ball(queryRadius);
    const identity = { x: 0, y: 0, z: 0, w: 1 };

    world.intersectionsWithShape(
      { x: currentPos.x, y: currentPos.y, z: currentPos.z },
      identity,
      sphereShape,
      (collider: RAPIER.Collider) => {
        // Filtrar por el grupo objetivo
        const groups = collider.collisionGroups();
        const membership = (groups >> 16) & 0xffff;
        if ((membership & targetGroup) === 0) {
          return true; // No es el objetivo, continuar
        }

        const parentBody = collider.parent();
        if (!parentBody) return true;

        const userData = parentBody.userData as { entity?: any; type?: string } | undefined;

        if (userData) {
          console.log(`[Projectile] Hit detectado (overlap): type=${userData.type}, entity=${!!userData.entity}`);
          this.handleCollision(userData);
        } else {
          console.log(`[Projectile] Collider sin userData (overlap), groups=${groups.toString(16)}`);
        }

        return true; // Continuar buscando
      },
      undefined, // filterFlags
      undefined, // filterGroups
      undefined, // filterExcludeCollider
      undefined, // filterExcludeRigidBody
      undefined  // filterPredicate
    );

    // --- 2. Raycast entre frames (anti-tunneling) ---
    // Si el proyectil se mueve muy rápido, el overlap query podría no detectar
    // colliders pequeños entre frames. El raycast desde la posición anterior
    // cubre todo el arco de movimiento.
    if (this.previousPosition) {
      const prev = this.previousPosition;
      const dx = currentPos.x - prev.x;
      const dy = currentPos.y - prev.y;
      const dz = currentPos.z - prev.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist > 0.001) {
        const rayDir = { x: dx / dist, y: dy / dist, z: dz / dist };
        const scanDistance = dist + queryRadius + 0.3;

        const ray = new RAPIER.Ray(
          { x: prev.x, y: prev.y, z: prev.z },
          rayDir
        );

        world.intersectionsWithRay(
          ray, scanDistance, true,
          (intersection: RAPIER.RayColliderIntersection) => {
            const collider = intersection.collider;

            // Filtrar por el grupo objetivo
            const groups = collider.collisionGroups();
            const membership = (groups >> 16) & 0xffff;
            if ((membership & targetGroup) === 0) {
              return true; // No es el objetivo, continuar
            }

            const parentBody = collider.parent();
            if (!parentBody) return true;

            const userData = parentBody.userData as { entity?: any; type?: string } | undefined;

            if (userData) {
              console.log(`[Projectile] Hit detectado (raycast): type=${userData.type}`);
              this.handleCollision(userData);
            }

            return true;
          }
        );
      }
    }
  }

  /**
   * Distance check directo contra targets registrados.
   * No depende de Rapier queries, alturas de colliders ni orden de stepAll().
   * Detecta si el proyectil está cerca de algún target por distancia euclidiana.
   */
  private checkTargetDistance(currentPos: RAPIER.Vector): void {
    if (!this.config || !this.active) return;

    const hitRadius = 0.6; // Radio de impacto generoso
    const currentVec = new THREE.Vector3(currentPos.x, currentPos.y, currentPos.z);

    for (const target of this.targets) {
      const targetPos = target.getPosition();
      if (!targetPos) continue;

      const dist = currentVec.distanceTo(targetPos);
      if (dist < hitRadius) {
        console.log(`[Projectile] Hit detectado (distance check): dist=${dist.toFixed(2)}, target=player`);
        this.handleCollision({ type: 'player', entity: target.entity });
        break;
      }
    }
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
    this.previousPosition = null;
    this.targets = [];

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
