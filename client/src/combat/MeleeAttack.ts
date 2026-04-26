import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { EventBus } from '../engine/EventBus';
import type { Character } from '../characters/Character';
import { Groups } from '../physics/CollisionGroups';
import { DamagePipeline } from './DamagePipeline';
import { KnockbackSystem, KnockbackPresets } from './Knockback';

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
  /** Pipeline centralizado de daño */
  private damagePipeline: DamagePipeline;
  /** Sistema de knockback */
  private knockbackSystem: KnockbackSystem;

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
    
    // Pipeline centralizado de daño
    this.damagePipeline = new DamagePipeline(eventBus);
    
    // Sistema de knockback
    this.knockbackSystem = new KnockbackSystem();
    
    // Configurar debug renderer si estamos en modo desarrollo
    this.setupDebugRenderer();
  }

  /**
   * Establece la referencia al PhysicsWorld (necesario si no se pasó en el constructor).
   */
  setPhysicsWorld(world: PhysicsWorld): void {
    this.physicsWorld = world;
    this.knockbackSystem.setPhysicsWorld(world);
  }

  /**
   * Establece un pipeline de daño compartido (en lugar de crear uno interno).
   * Útil para compartir el mismo DamageNumberSystem entre múltiples sistemas.
   */
  setDamagePipeline(pipeline: DamagePipeline): void {
    this.damagePipeline = pipeline;
  }

  /**
   * Intenta ejecutar un ataque melee si no está en cooldown.
   * @returns true si el ataque se ejecutó, false si está en cooldown
   */
  tryAttack(): boolean {
    console.log(`[MeleeAttack] tryAttack() llamado, cooldownTimer=${this.cooldownTimer}, isAttacking=${this.isAttacking}`);
    if (this.cooldownTimer > 0 || this.isAttacking) {
      console.log(`[MeleeAttack] tryAttack() bloqueado por cooldown o ataque en progreso`);
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
    console.log('[MeleeAttack] executeAttack() llamado');
    if (!this.physicsWorld) {
      console.warn('[MeleeAttack] PhysicsWorld no disponible, no se puede ejecutar ataque');
      return;
    }
    console.log('[MeleeAttack] PhysicsWorld disponible');

    this.isAttacking = true;
    this.damagedEnemies.clear();

    // Obtener posición del personaje
    const position = this.getCharacterPosition();
    if (!position) {
      console.warn('[MeleeAttack DEBUG] Posición del personaje no disponible');
      this.isAttacking = false;
      return;
    }

    // Obtener dirección de ataque (siempre hacia adelante del personaje)
    const meleeChar = this.character as any;
    let forwardDirection: THREE.Vector3;
    
    // Opción 1: Usar dirección de movimiento si está disponible y no es cero
    if (meleeChar.moveDirection && meleeChar.moveDirection.lengthSq() > 0.01) {
      forwardDirection = meleeChar.moveDirection.clone();
      forwardDirection.y = 0;
      if (forwardDirection.lengthSq() > 0.01) {
        forwardDirection.normalize();
        console.log(`[MeleeAttack] Usando moveDirection: (${forwardDirection.x.toFixed(2)}, ${forwardDirection.y.toFixed(2)}, ${forwardDirection.z.toFixed(2)})`);
      } else {
        forwardDirection = this.calculateForwardFromModel(meleeChar);
      }
    } else {
      // Opción 2: Calcular desde el modelo
      forwardDirection = this.calculateForwardFromModel(meleeChar);
    }

    // DEBUG: Log de posición y dirección
    console.log(`[MeleeAttack] Posición: (${position.x.toFixed(1)}, ${position.z.toFixed(1)}), Dirección: (${forwardDirection.x.toFixed(2)}, ${forwardDirection.z.toFixed(2)})`);

    // Calcular posición frontal para el shape (usando el rango completo)
    const attackDistance = this.options.range * 0.7; // 70% del rango para centrar mejor
    const forwardOffset = forwardDirection.clone().multiplyScalar(attackDistance);
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

    // Calcular rotación hacia la dirección del personaje (quaternion completo)
    // Inicializar con rotación simplificada (será sobrescrita si hay quaternion mundial)
    let rotation = { x: 0, y: 0, z: 0, w: 1 };
    const angle = Math.atan2(forwardDirection.x, forwardDirection.z);
    rotation = { x: 0, y: angle, z: 0, w: 1 }; // Quaternion simplificado (fallback)

    // Realizar overlap query
    const world = this.physicsWorld.getWorld();
    
    // Usar intersectionsWithShape (API de Rapier) - recolectar resultados en un array
    const posObj = { x: shapePosition.x, y: shapePosition.y, z: shapePosition.z };
    const intersections: RAPIER.Collider[] = [];
    
    // Obtener quaternion mundial del modelo para rotación precisa
    const model = (this.character as any).model;
    let worldQuaternion: THREE.Quaternion | null = null;
    if (model && model.getWorldQuaternion) {
      worldQuaternion = new THREE.Quaternion();
      model.getWorldQuaternion(worldQuaternion);
      // Convertir a formato Rapier
      rotation = { x: worldQuaternion.x, y: worldQuaternion.y, z: worldQuaternion.z, w: worldQuaternion.w };
      console.log(`[MeleeAttack] Rotación mundial del modelo: (${worldQuaternion.x.toFixed(2)}, ${worldQuaternion.y.toFixed(2)}, ${worldQuaternion.z.toFixed(2)}, ${worldQuaternion.w.toFixed(2)})`);
    }
    
    console.log(`[MeleeAttack] Realizando intersectionsWithShape en posición: (${posObj.x.toFixed(2)}, ${posObj.y.toFixed(2)}, ${posObj.z.toFixed(2)}) con rotación:`, rotation);
    
    world.intersectionsWithShape(
      posObj,
      rotation,
      shape,
      (collider: RAPIER.Collider) => {
        // --- VERIFICACIÓN CLAVE ---
        console.log("¡Golpeé un collider!", collider);
        console.log("UserData del collider:", collider.parent()?.userData);
        // -------------------------
        
        // Filtrar por grupo ENEMY
        const groups = collider.collisionGroups();
        const membership = (groups >> 16) & 0xffff; // Extraer bits de membership
        if ((membership & Groups.ENEMY) !== 0) {
          intersections.push(collider);
          console.log("Collider pertenece a grupo ENEMY");
        } else {
          console.log("Collider NO pertenece a grupo ENEMY, membership:", membership);
        }
        return true; // Continuar buscando
      }
    );

    // Procesar intersecciones y aplicar filtro de arco
    const enemiesInArc = this.filterEnemiesByArc(position, forwardDirection, intersections);
    
    // Log resumido
    console.log(`[MeleeAttack] Intersecciones: ${intersections.length}, Enemigos en arco: ${enemiesInArc.length}`);

    // Aplicar daño a cada enemigo en el arco
    enemiesInArc.forEach(enemy => {
      this.applyDamageToEnemy(enemy);
    });

    // Configurar cooldown basado en attackSpeed del personaje
    const attackSpeed = this.character.getEffectiveStat('attackSpeed');
    this.cooldownTimer = attackSpeed > 0 ? 1 / attackSpeed : 1.0;

    // Actualizar debug mesh si está activo
    this.updateDebugMesh(shapePosition, forwardDirection);

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
   * Calcula la dirección forward (hacia adelante) del modelo del personaje.
   * Usa getWorldDirection para obtener la dirección absoluta en el mundo 3D,
   * ignorando jerarquías de grupos.
   * NOTA: getWorldDirection devuelve la dirección hacia la que apunta el modelo
   * en espacio mundial (hacia Z positivo local). Si el modelo mira hacia Z negativo,
   * necesitamos invertir el vector. Probamos ambas opciones y elegimos la que
   * coincida con la dirección de movimiento si está disponible.
   */
  private calculateForwardFromModel(character: any): THREE.Vector3 {
    const model = character.model;
    if (!model || !model.getWorldDirection) {
      console.log(`[MeleeAttack] No hay modelo o getWorldDirection, usando dirección por defecto (0,0,-1)`);
      return new THREE.Vector3(0, 0, -1);
    }

    // Obtener dirección mundial (hacia Z positivo por defecto en Three.js)
    const worldDirection = new THREE.Vector3();
    model.getWorldDirection(worldDirection);
    
    // DEBUG: Mostrar dirección sin invertir
    console.log(`[MeleeAttack] Dirección mundial sin invertir: (${worldDirection.x.toFixed(2)}, ${worldDirection.y.toFixed(2)}, ${worldDirection.z.toFixed(2)})`);
    
    // Determinar si debemos invertir basado en la dirección de movimiento actual
    // Si el personaje tiene moveDirection, comparamos el dot product
    const moveDirection = character.moveDirection;
    let shouldNegate = false;
    if (moveDirection && moveDirection.lengthSq() > 0.01) {
      const moveDir = moveDirection.clone().normalize();
      const dotWithWorld = moveDir.dot(worldDirection);
      const dotWithNegated = moveDir.dot(worldDirection.clone().negate());
      // Elegir la que tenga mayor producto punto (más alineada)
      shouldNegate = dotWithNegated > dotWithWorld;
      console.log(`[MeleeAttack] Dot con world: ${dotWithWorld.toFixed(2)}, con negated: ${dotWithNegated.toFixed(2)}, invertir? ${shouldNegate}`);
    } else {
      // Por defecto, NO invertir (asumimos que getWorldDirection ya apunta hacia adelante)
      // Si la hitbox aparece detrás, cambiar a shouldNegate = true
      shouldNegate = false;
      console.log(`[MeleeAttack] Sin moveDirection, asumiendo NO invertir (modelo mira hacia Z positivo)`);
    }
    
    if (shouldNegate) {
      worldDirection.negate();
      console.log(`[MeleeAttack] Dirección invertida (hacia Z negativo): (${worldDirection.x.toFixed(2)}, ${worldDirection.y.toFixed(2)}, ${worldDirection.z.toFixed(2)})`);
    }
    
    // Mantener en plano horizontal
    worldDirection.y = 0;
    if (worldDirection.lengthSq() > 0.01) {
      worldDirection.normalize();
    } else {
      // Fallback si la dirección es casi cero
      worldDirection.set(0, 0, -1);
    }

    console.log(`[MeleeAttack] Dirección final: (${worldDirection.x.toFixed(2)}, ${worldDirection.y.toFixed(2)}, ${worldDirection.z.toFixed(2)})`);
    
    return worldDirection;
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
   * Aplica daño a un enemigo usando el DamagePipeline centralizado.
   */
  private applyDamageToEnemy(enemyCollider: RAPIER.Collider): void {
    // Obtener referencia al cuerpo y userData
    const enemyBody = enemyCollider.parent();
    if (!enemyBody) return;
    
    const userData = enemyBody.userData as any;
    if (!userData) return;
    
    // Verificar si ya fue dañado en este ataque (usando ID)
    const enemyId = userData.id;
    if (enemyId && this.damagedEnemies.has(enemyId)) {
      return; // Ya dañado en este ataque
    }

    const baseDamage = this.getAttackDamage();
    const enemyEntity = userData.entity;
    
    if (!enemyEntity || typeof enemyEntity.takeDamage !== 'function') {
      // Fallback: emitir evento de daño (para compatibilidad)
      this.emitDamageEvent(enemyId, baseDamage);
      if (enemyId) {
        this.damagedEnemies.add(enemyId);
      }
      return;
    }

    // Obtener posición del enemigo (aproximada desde el collider)
    const enemyPos = enemyBody.translation();
    const position = new THREE.Vector3(enemyPos.x, enemyPos.y, enemyPos.z);

    // Aplicar daño a través del pipeline
    const result = this.damagePipeline.applyDamage(
      this.character, // attacker (instancia de Character para nextAttackIsCrit)
      enemyEntity, // target (debe tener takeDamage e id)
      baseDamage,
      {
        position,
        source: 'melee',
        attackerId: this.playerId,
        canCrit: true,
        critChance: 0.1, // 10% base
        critMultiplier: 1.5,
      }
    );

    console.log(`[MeleeAttack] ${this.playerId} - Daño a enemigo ${enemyId || 'sin ID'}: ${result.finalDamage.toFixed(1)} ${result.isCrit ? 'CRIT!' : ''}`);

    // Aplicar knockback si el sistema está configurado
    if (this.knockbackSystem && this.physicsWorld) {
      const attackerPos = this.getCharacterPosition();
      if (attackerPos) {
        // Obtener resistencia al knockback del enemigo (por defecto 0)
        const knockbackResistance = (enemyEntity as any).knockbackResistance ?? 0;
        // Configuración de knockback (usar preset MEDIUM)
        // baseStrength: unidades/segundo de velocidad de knockback
        const knockbackConfig = {
          baseStrength: 2.5,
          duration: 0.25,
          scaleWithDamage: true,
          damageScaleFactor: 0.015
        };
        // Aplicar knockback
        this.knockbackSystem.applyKnockback(
          enemyEntity,
          attackerPos,
          knockbackConfig,
          result.finalDamage,
          knockbackResistance
        );
        console.log(`[MeleeAttack] Knockback aplicado a ${enemyId} (resistencia: ${knockbackResistance})`);
      }
    }

    if (enemyId) {
      this.damagedEnemies.add(enemyId);
    }
  }

  private emitDamageEvent(enemyId: string | undefined, damage: number): void {
    if (!enemyId) return;
    
    (this.eventBus as any).emit('enemy:damage', {
      enemyId,
      damage,
      source: 'melee',
      playerId: this.playerId
    });
    
    console.log(`[MeleeAttack] ${this.playerId} - Evento de daño a enemigo ${enemyId}: ${damage}`);
  }

  /**
   * Calcula el daño del ataque considerando stats del personaje y la pasiva de furia.
   */
  private getAttackDamage(): number {
    const baseDamage = this.character.getEffectiveStat('damage');
    let damage = baseDamage * (this.options.baseDamage / 10); // Escalar según daño base configurado
    
    // Aplicar multiplicador de furia si está disponible
    const meleeChar = this.character as any;
    if (meleeChar.furyPassive && typeof meleeChar.furyPassive.applyFuryToAttack === 'function') {
      const furyMultiplier = meleeChar.furyPassive.applyFuryToAttack();
      if (furyMultiplier > 1) {
        console.log(`[MeleeAttack] Aplicando multiplicador de furia: ×${furyMultiplier}`);
        damage *= furyMultiplier;
      }
    }
    
    return damage;
  }

  /**
   * Obtiene la posición del personaje en espacio mundial.
   * Usa getWorldPosition para obtener la posición absoluta en el mundo 3D,
   * ignorando jerarquías de grupos.
   */
  private getCharacterPosition(): THREE.Vector3 | null {
    const model = (this.character as any).model;
    if (model && model.getWorldPosition) {
      const worldPosition = new THREE.Vector3();
      model.getWorldPosition(worldPosition);
      console.log(`[MeleeAttack] Posición mundial del modelo: (${worldPosition.x.toFixed(2)}, ${worldPosition.y.toFixed(2)}, ${worldPosition.z.toFixed(2)})`);
      return worldPosition;
    }
    
    // Fallback: usar posición del cuerpo físico
    const physicsBody = this.character.getPhysicsBody();
    if (physicsBody && this.physicsWorld) {
      const body = this.physicsWorld.getBody(physicsBody);
      if (body) {
        const pos = body.translation();
        console.log(`[MeleeAttack] Posición física: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})`);
        return new THREE.Vector3(pos.x, pos.y, pos.z);
      }
    }
    
    console.warn('[MeleeAttack] No se pudo obtener posición del personaje');
    return null;
  }

  /**
   * Obtiene la dirección hacia la que mira el personaje.
   * Prioriza moveDirection si está disponible, luego usa la rotación del modelo.
   * Usa la misma lógica robusta que calculateForwardFromModel().
   */
  private getCharacterFacingDirection(): THREE.Vector3 | null {
    const meleeChar = this.character as any;
    
    // Opción 1: Usar moveDirection si está disponible y no es cero
    if (meleeChar.moveDirection && meleeChar.moveDirection.lengthSq() > 0.01) {
      const moveDir = meleeChar.moveDirection.clone();
      moveDir.y = 0; // Mantener en plano horizontal
      if (moveDir.lengthSq() > 0.01) {
        console.log(`[MeleeAttack] Usando moveDirection: (${moveDir.x.toFixed(2)}, ${moveDir.y.toFixed(2)}, ${moveDir.z.toFixed(2)})`);
        return moveDir.normalize();
      }
    }
    
    // Opción 2: Calcular desde el modelo usando la lógica robusta
    const forwardDirection = this.calculateForwardFromModel(meleeChar);
    console.log(`[MeleeAttack] Dirección desde modelo: (${forwardDirection.x.toFixed(2)}, ${forwardDirection.y.toFixed(2)}, ${forwardDirection.z.toFixed(2)})`);
    return forwardDirection;
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
    
    // Actualizar estados de knockback (debe llamarse cada frame)
    if (this.knockbackSystem) {
      this.knockbackSystem.update(dt);
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
   * Usa la posición y dirección mundial para alinear correctamente con el personaje.
   */
  private updateDebugMesh(position?: THREE.Vector3, direction?: THREE.Vector3): void {
    if (!this.debugMesh || !this.debugMaterial) return;
    
    if (position && direction) {
      // Copiar posición mundial
      this.debugMesh.position.copy(position);
      
      // Ajustar posición hacia adelante (centro del shape)
      const forwardOffset = direction.clone().multiplyScalar(this.options.range / 2);
      this.debugMesh.position.add(forwardOffset);
      this.debugMesh.position.y += this.options.height / 2;
      
      // Obtener quaternion mundial del modelo para rotación precisa
      const model = (this.character as any).model;
      if (model && model.getWorldQuaternion) {
        const worldQuaternion = new THREE.Quaternion();
        model.getWorldQuaternion(worldQuaternion);
        this.debugMesh.quaternion.copy(worldQuaternion);
        console.log(`[MeleeAttack] Debug mesh rotado con quaternion mundial`);
      } else {
        // Fallback: rotar hacia la dirección (solo eje Y)
        const angle = Math.atan2(direction.x, direction.z);
        this.debugMesh.rotation.set(0, angle, 0);
      }
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