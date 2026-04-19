import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { EventBus } from '../engine/EventBus';
import type { Character } from '../characters/Character';
import { Groups } from '../physics/CollisionGroups';

/**
 * Opciones para configurar un ataque melee.
 */
export interface MeleeAttackOptions {
  /** Rango máximo del ataque (en unidades del mundo) */
  range: number;
  /** Ancho del área de ataque (en unidades del mundo) */
  width: number;
  /** Altura del área de ataque (en unidades del mundo) */
  height: number;
  /** Ángulo del arco de ataque en grados (por defecto 120°) */
  arcAngle: number;
  /** Daño base del ataque (se multiplicará por el stat del personaje) */
  baseDamage: number;
}

/**
 * Sistema de detección de golpes melee usando overlap query de Rapier.
 * Realiza una consulta de intersección con una forma en un arco frente al personaje
 * sin crear un cuerpo físico permanente.
 */
export class MeleeAttack {
  private physicsWorld: PhysicsWorld | null = null;
  private eventBus: EventBus;
  private character: Character;
  private playerId: string;
  private options: MeleeAttackOptions;
  
  /** Tiempo restante de cooldown (segundos) */
  private cooldownTimer: number = 0;
  /** Indica si el ataque está en progreso (para evitar múltiples detecciones en el mismo frame) */
  private isAttacking: boolean = false;
  /** Enemigos ya dañados en el ataque actual (para evitar daño múltiple) */
  private damagedEnemies: Set<string> = new Set();
  
  /** Debug: mesh para visualizar el área de ataque (solo en modo DEV) */
  private debugMesh: THREE.Mesh | null = null;
  private debugMaterial: THREE.MeshBasicMaterial | null = null;

  constructor(
    eventBus: EventBus,
    character: Character,
    playerId: string,
    options?: Partial<MeleeAttackOptions>
  ) {
    this.eventBus = eventBus;
    this.character = character;
    this.playerId = playerId;
    
    // Opciones por defecto
    this.options = {
      range: 2.0,
      width: 1.5,
      height: 1.0,
      arcAngle: 120,
      baseDamage: 10,
      ...options
    };
    
    // Configurar debug renderer si estamos en modo desarrollo
    this.setupDebugRenderer();
  }

  /**
   * Establece la referencia al PhysicsWorld (necesario si no se pasó en el constructor).
   */
  setPhysicsWorld(world: PhysicsWorld): void {
    this.physicsWorld = world;
  }

  /**
   * Intenta ejecutar un ataque melee si no está en cooldown.
   * @returns true si el ataque se ejecutó, false si está en cooldown
   */
  tryAttack(): boolean {
    if (this.cooldownTimer > 0 || this.isAttacking) {
      return false;
    }

    // Notificar que se va a ejecutar un ataque (para animación)
    this.notifyAttackAnimation();
    
    this.executeAttack();
    return true;
  }

  /**
   * Notifica al sistema de animación que se va a ejecutar un ataque.
   */
  private notifyAttackAnimation(): void {
    // Emitir evento para AnimationController
    this.eventBus.emit('player:attack:start', {
      playerId: this.playerId
    });
    
    // NOTA: No llamamos a character.attack() aquí para evitar recursión infinita
    // El AnimationController escuchará el evento 'player:attack:start' y manejará la animación
  }

  /**
   * Ejecuta el ataque melee: realiza overlap query y aplica daño a enemigos en el arco.
   */
  private executeAttack(): void {
    if (!this.physicsWorld) {
      console.warn('[MeleeAttack] PhysicsWorld no disponible, no se puede ejecutar ataque');
      return;
    }

    this.isAttacking = true;
    this.damagedEnemies.clear();

    // Obtener posición y dirección del personaje
    const position = this.getCharacterPosition();
    const direction = this.getCharacterFacingDirection();
    
    if (!position || !direction) {
      this.isAttacking = false;
      return;
    }

    // Calcular posición frontal para el shape
    const forwardOffset = direction.clone().multiplyScalar(this.options.range / 2);
    const shapePosition = new THREE.Vector3(
      position.x + forwardOffset.x,
      position.y + this.options.height / 2, // Centrar en altura del personaje
      position.z + forwardOffset.z
    );

    // Crear shape de Rapier (Cuboid con half-extents)
    const halfExtents = new RAPIER.Vector3(
      this.options.width / 2,
      this.options.height / 2,
      this.options.range / 2
    );
    const shape = new RAPIER.Cuboid(halfExtents.x, halfExtents.y, halfExtents.z);

    // Calcular rotación hacia la dirección del personaje
    const angle = Math.atan2(direction.x, direction.z);
    const rotation = { x: 0, y: angle, z: 0, w: 1 }; // Quaternion simplificado

    // Realizar overlap query
    const world = this.physicsWorld.getWorld();
    
    // Usar intersectionsWithShape (API de Rapier) - recolectar resultados en un array
    // Nota: Necesitamos convertir la posición a un objeto con propiedades x, y, z
    const posObj = { x: shapePosition.x, y: shapePosition.y, z: shapePosition.z };
    const intersections: RAPIER.Collider[] = [];
    
    world.intersectionsWithShape(
      posObj,
      rotation,
      shape,
      (collider: RAPIER.Collider) => {
        // Filtrar por grupo ENEMY
        const groups = collider.collisionGroups();
        const membership = (groups >> 16) & 0xffff; // Extraer bits de membership
        if ((membership & Groups.ENEMY) !== 0) {
          intersections.push(collider);
        }
        return true; // Continuar buscando
      }
    );

    // Procesar intersecciones y aplicar filtro de arco
    const enemiesInArc = this.filterEnemiesByArc(position, direction, intersections);
    
    // Aplicar daño a cada enemigo en el arco
    enemiesInArc.forEach(enemy => {
      this.applyDamageToEnemy(enemy);
    });

    // Configurar cooldown basado en attackSpeed del personaje
    const attackSpeed = this.character.getEffectiveStat('attackSpeed');
    this.cooldownTimer = attackSpeed > 0 ? 1 / attackSpeed : 1.0;

    // Actualizar debug mesh si está activo
    this.updateDebugMesh(shapePosition, direction);

    // Emitir evento de ataque completado
    (this.eventBus as any).emit('player:attack', {
      playerId: this.playerId,
      damage: this.getAttackDamage(),
      enemiesHit: enemiesInArc.length,
      position: { x: position.x, y: position.y, z: position.z }
    });

    // Resetear estado de ataque después de un frame
    setTimeout(() => {
      this.isAttacking = false;
    }, 0);
  }

  /**
   * Filtra enemigos por arco de 120° frente al personaje.
   */
  private filterEnemiesByArc(
    playerPosition: THREE.Vector3,
    playerDirection: THREE.Vector3,
    intersections: RAPIER.Collider[]
  ): RAPIER.Collider[] {
    const halfArc = this.options.arcAngle / 2;
    const cosHalfArc = Math.cos(THREE.MathUtils.degToRad(halfArc));
    
    return intersections.filter(collider => {
      const colliderPos = collider.translation();
      const toEnemy = new THREE.Vector3(
        colliderPos.x - playerPosition.x,
        0, // Ignorar diferencia en Y para cálculo 2D
        colliderPos.z - playerPosition.z
      ).normalize();
      
      // Producto punto entre dirección del jugador y vector hacia enemigo
      const dot = playerDirection.dot(toEnemy);
      
      // El enemigo está dentro del arco si el coseno del ángulo es mayor que cos(halfArc)
      return dot >= cosHalfArc;
    });
  }

  /**
   * Aplica daño a un enemigo.
   */
  private applyDamageToEnemy(enemyCollider: RAPIER.Collider): void {
    // Obtener ID del enemigo (asumimos que está almacenado en userData)
    const enemyBody = enemyCollider.parent();
    if (!enemyBody) return;
    
    const enemyId = (enemyBody.userData as any)?.id;
    if (!enemyId || this.damagedEnemies.has(enemyId)) {
      return; // Ya dañado en este ataque
    }

    const damage = this.getAttackDamage();
    
    // Emitir evento de daño
    (this.eventBus as any).emit('enemy:damage', {
      enemyId,
      damage,
      source: 'melee',
      playerId: this.playerId
    });

    this.damagedEnemies.add(enemyId);
    
    console.log(`[MeleeAttack] ${this.playerId} - Daño a enemigo ${enemyId}: ${damage}`);
  }

  /**
   * Calcula el daño del ataque considerando stats del personaje.
   */
  private getAttackDamage(): number {
    const baseDamage = this.character.getEffectiveStat('damage');
    return baseDamage * (this.options.baseDamage / 10); // Escalar según daño base configurado
  }

  /**
   * Obtiene la posición del personaje.
   */
  private getCharacterPosition(): THREE.Vector3 | null {
    // Usar método getPhysicsBody() que es público
    const physicsBody = this.character.getPhysicsBody();
    if (physicsBody && this.physicsWorld) {
      const body = this.physicsWorld.getBody(physicsBody);
      if (body) {
        const pos = body.translation();
        return new THREE.Vector3(pos.x, pos.y, pos.z);
      }
    }
    
    // Fallback: usar posición del modelo
    const model = (this.character as any).model;
    if (model && model.position) {
      return model.position.clone();
    }
    
    return null;
  }

  /**
   * Obtiene la dirección hacia la que mira el personaje.
   */
  private getCharacterFacingDirection(): THREE.Vector3 | null {
    // Para personajes top-down, asumimos que miran en la dirección de movimiento
    // o en la dirección de su rotación actual
    const model = (this.character as any).model;
    if (model) {
      const direction = new THREE.Vector3(0, 0, 1);
      direction.applyQuaternion(model.quaternion);
      direction.y = 0; // Mantener en plano horizontal
      return direction.normalize();
    }
    
    // Fallback: dirección por defecto (hacia adelante en Z)
    return new THREE.Vector3(0, 0, 1);
  }

  /**
   * Actualiza el estado del ataque (debe llamarse cada frame).
   * @param dt Tiempo delta en segundos
   */
  update(dt: number): void {
    // Actualizar cooldown
    if (this.cooldownTimer > 0) {
      this.cooldownTimer = Math.max(0, this.cooldownTimer - dt);
    }
    
    // Actualizar debug mesh si está activo
    if (this.debugMesh && this.debugMesh.visible) {
      this.updateDebugMeshPosition();
    }
  }

  /**
   * Configura el renderizador de debug para visualizar el área de ataque.
   */
  private setupDebugRenderer(): void {
    // Solo en modo desarrollo
    if (import.meta.env.DEV) {
      const geometry = new THREE.BoxGeometry(
        this.options.width,
        this.options.height,
        this.options.range
      );
      
      this.debugMaterial = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.3,
        wireframe: true
      });
      
      this.debugMesh = new THREE.Mesh(geometry, this.debugMaterial);
      this.debugMesh.visible = false; // Oculto por defecto
      
      // Agregar a la escena (necesitamos acceso al sceneManager)
      const sceneManager = (this.character as any).sceneManager;
      if (sceneManager && sceneManager.scene) {
        sceneManager.scene.add(this.debugMesh);
      }
    }
  }

  /**
   * Actualiza la posición y rotación del debug mesh.
   */
  private updateDebugMesh(position?: THREE.Vector3, direction?: THREE.Vector3): void {
    if (!this.debugMesh || !this.debugMaterial) return;
    
    if (position && direction) {
      this.debugMesh.position.copy(position);
      
      // Ajustar posición hacia adelante (centro del shape)
      const forwardOffset = direction.clone().multiplyScalar(this.options.range / 2);
      this.debugMesh.position.add(forwardOffset);
      this.debugMesh.position.y += this.options.height / 2;
      
      // Rotar hacia la dirección
      const angle = Math.atan2(direction.x, direction.z);
      this.debugMesh.rotation.set(0, angle, 0);
    }
  }

  /**
   * Actualiza la posición del debug mesh basado en la posición actual del personaje.
   */
  private updateDebugMeshPosition(): void {
    const position = this.getCharacterPosition();
    const direction = this.getCharacterFacingDirection();
    
    if (position && direction) {
      this.updateDebugMesh(position, direction);
    }
  }

  /**
   * Activa/desactiva la visualización del debug mesh.
   */
  setDebugVisible(visible: boolean): void {
    if (this.debugMesh) {
      this.debugMesh.visible = visible;
    }
  }

  /**
   * Alterna la visualización del debug mesh.
   * @returns El nuevo estado de visibilidad
   */
  toggleDebugVisible(): boolean {
    if (this.debugMesh) {
      this.debugMesh.visible = !this.debugMesh.visible;
      return this.debugMesh.visible;
    }
    return false;
  }

  /**
   * Obtiene el estado actual de visibilidad del debug mesh.
   */
  getDebugVisible(): boolean {
    return this.debugMesh ? this.debugMesh.visible : false;
  }

  /**
   * Libera recursos.
   */
  dispose(): void {
    if (this.debugMesh) {
      this.debugMesh.geometry.dispose();
      if (this.debugMaterial) {
        this.debugMaterial.dispose();
      }
      
      const sceneManager = (this.character as any).sceneManager;
      if (sceneManager && sceneManager.scene) {
        sceneManager.scene.remove(this.debugMesh);
      }
    }
    
    this.damagedEnemies.clear();
  }
}