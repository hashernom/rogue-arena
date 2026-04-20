import { EventBus } from '../../engine/EventBus';
import { Character } from '../Character';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Groups } from '../../physics/CollisionGroups';
import { InputState } from '../../engine/InputManager';

/**
 * Habilidad activa "Salva" para el Tirador (AdcCharacter).
 * 
 * Mecánica:
 * - Dispara 3 proyectiles en un abanico de 60° (20° entre cada proyectil)
 * - Cada proyectil hace daño normal
 * - Cooldown: 4 segundos con indicador visual en HUD
 * - Feedback visual: efecto de partículas/aura durante la salva
 */
export class SalvoAbility {
  private eventBus: EventBus;
  private character: Character;
  private playerId: string;
  
  // Estado de la salva
  private isSalvoActive: boolean = false;
  private salvoProjectiles: number = 3;
  private salvoAngle: number = 60; // grados totales del abanico
  private projectilesFired: number = 0;
  
  // Cooldown
  private cooldownTimer: number = 0;
  private cooldownDuration: number = 4; // segundos
  private isOnCooldown: boolean = false;
  
  // Para feedback visual (placeholder)
  private visualEffectActive: boolean = false;
  
  // Referencia a la escena (necesaria para añadir proyectiles)
  private sceneManager: any;

  constructor(eventBus: EventBus, character: Character, playerId: string, sceneManager: any) {
    this.eventBus = eventBus;
    this.character = character;
    this.playerId = playerId;
    this.sceneManager = sceneManager;
    
    this.setupEventListeners();
  }

  /**
   * Configura los listeners de eventos para esta habilidad.
   */
  private setupEventListeners(): void {
    // Escuchar eventos de tecla Q (o botón de habilidad)
    (this.eventBus as any).on('player:abilityQ', this.handleAbilityActivation.bind(this));
  }

  /**
   * Maneja la activación de la habilidad (cuando el jugador presiona Q).
   */
  private handleAbilityActivation(data: any): void {
    // Verificar que sea el jugador correcto
    if (data.playerId !== this.playerId) return;
    
    // Verificar cooldown
    if (this.isOnCooldown) {
      console.log(`[SalvoAbility] ${this.playerId} - Habilidad en cooldown (${this.cooldownTimer.toFixed(1)}s restantes)`);
      return;
    }
    
    // Activar salva con inputState (si está disponible)
    this.activateSalvo(data.inputState);
  }

  /**
   * Activa la salva de proyectiles.
   */
  private activateSalvo(inputState?: InputState): void {
    if (this.isSalvoActive) return;
    
    console.log(`[SalvoAbility] ${this.playerId} - ¡Salva activada!`);
    
    // Iniciar estado de salva
    this.isSalvoActive = true;
    this.projectilesFired = 0;
    
    // Iniciar cooldown
    this.isOnCooldown = true;
    this.cooldownTimer = this.cooldownDuration;
    
    // Emitir evento para feedback visual
    (this.eventBus as any).emit('ability:salvo:activated', {
      playerId: this.playerId,
      position: this.getCharacterPosition()
    });
    
    // Feedback visual (placeholder)
    this.activateVisualEffect();
    
    // Disparar los proyectiles en secuencia rápida con inputState para mouse targeting
    this.fireSalvoProjectiles(inputState);
  }

  /**
   * Obtiene la posición actual del personaje en espacio mundial.
   */
  private getCharacterPosition(): THREE.Vector3 {
    const characterAny = this.character as any;
    if (characterAny.model) {
      const worldPosition = new THREE.Vector3();
      characterAny.model.getWorldPosition(worldPosition);
      return worldPosition;
    }
    return new THREE.Vector3(0, 0, 0);
  }

  /**
   * Obtiene la dirección frontal del personaje en espacio mundial.
   * Incluye lógica para determinar si se debe negar basado en la dirección de movimiento.
   */
  private getCharacterForwardDirection(): THREE.Vector3 {
    const characterAny = this.character as any;
    if (!characterAny.model) return new THREE.Vector3(0, 0, -1);

    // Obtener dirección mundial (hacia Z positivo por defecto en Three.js)
    const worldDirection = new THREE.Vector3();
    characterAny.model.getWorldDirection(worldDirection);

    // Determinar si debemos invertir basado en la dirección de movimiento actual
    const moveDirection = characterAny.moveDirection;
    let shouldNegate = false;
    if (moveDirection && moveDirection.lengthSq() > 0.01) {
      const moveDir = moveDirection.clone().normalize();
      const dotWithWorld = moveDir.dot(worldDirection);
      const dotWithNegated = moveDir.dot(worldDirection.clone().negate());
      shouldNegate = dotWithNegated > dotWithWorld;
    } else {
      // Si no hay movimiento, asumir que el modelo mira hacia Z negativo (como en AdcCharacter)
      shouldNegate = true;
    }

    const forward = worldDirection.clone();
    if (shouldNegate) forward.negate();
    
    console.log(`[SalvoAbility] Dirección mundial: (${worldDirection.x.toFixed(2)}, ${worldDirection.y.toFixed(2)}, ${worldDirection.z.toFixed(2)}), invertir? ${shouldNegate}, forward final: (${forward.x.toFixed(2)}, ${forward.y.toFixed(2)}, ${forward.z.toFixed(2)})`);
    return forward;
  }

  /**
   * Calcula la dirección de disparo basada en la posición del mouse usando raycasting.
   * Intersecta un rayo desde la cámara a través de las coordenadas NDC del mouse con un plano en Y=1.2 (altura del pecho).
   * @param camera Cámara desde la cual se lanza el rayo
   * @param mouseNDC Coordenadas normalizadas del mouse en rango [-1, 1]
   * @returns Dirección normalizada hacia el punto de intersección, o fallback a dirección forward del modelo
   */
  private calculateAimDirection(camera: THREE.Camera, mouseNDC: THREE.Vector2): THREE.Vector3 {
    // 🔥 FORZAR LA ACTUALIZACIÓN DE LA CÁMARA 🔥
    camera.updateMatrixWorld();

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouseNDC, camera);

    // 🔥 CAMBIO CLAVE: Intersectamos el SUELO real (Y = 0) 🔥
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const targetPos = new THREE.Vector3();

    if (raycaster.ray.intersectPlane(groundPlane, targetPos)) {
      // Una vez tenemos el punto en el suelo, lo subimos a la altura del pecho
      targetPos.y = 1.2;

      const spawnPos = this.getCharacterPosition();
      spawnPos.y = 1.2;

      const direction = new THREE.Vector3().subVectors(targetPos, spawnPos);
      direction.y = 0; // Forzar horizontalidad
      
      if (direction.lengthSq() > 0.0001) {
        return direction.normalize();
      }
    }

    // 🔥 2. LA SOLUCIÓN AL CORTE (Mouse apuntando al horizonte/cielo) 🔥
    // Si el rayo no choca con el suelo, usamos la dirección de la cámara proyectada en 2D
    const horizonDir = raycaster.ray.direction.clone();
    horizonDir.y = 0;
    
    if (horizonDir.lengthSq() > 0.0001) {
      return horizonDir.normalize();
    }

    // 3. Fallback absoluto (casi imposible que se ejecute ahora)
    return this.getCharacterForwardDirection();
  }

  /**
   * Dispara los proyectiles de la salva en abanico.
   */
  private fireSalvoProjectiles(inputState?: InputState): void {
    const characterAny = this.character as any;
    if (!characterAny.model) return;
    
    // Obtener dirección base: mouse targeting si hay inputState, sino dirección forward del personaje
    let baseForward = this.getCharacterForwardDirection();
    
    // Intentar usar mouse targeting si está disponible
    if (inputState?.mouseNDC && this.sceneManager) {
      const camera = this.sceneManager.getCamera();
      if (camera) {
        // Calcular dirección usando raycasting similar a AdcCharacter.calculateAimDirection
        const mouseDir = this.calculateAimDirection(camera, inputState.mouseNDC);
        if (mouseDir.lengthSq() > 0.01) {
          baseForward = mouseDir;
          console.log(`[SalvoAbility] Usando dirección de mouse: (${baseForward.x.toFixed(2)}, ${baseForward.y.toFixed(2)}, ${baseForward.z.toFixed(2)})`);
        }
      }
    }
    
    // Calcular ángulo entre proyectiles (en radianes)
    const totalAngleRad = THREE.MathUtils.degToRad(this.salvoAngle);
    const angleBetweenProjectiles = totalAngleRad / (this.salvoProjectiles - 1);
    const startAngle = -totalAngleRad / 2; // Empezar desde el extremo izquierdo
    
    // Crear y disparar cada proyectil
    for (let i = 0; i < this.salvoProjectiles; i++) {
      // Calcular ángulo para este proyectil
      const angle = startAngle + (i * angleBetweenProjectiles);
      
      // Crear dirección rotada (rotar alrededor del eje Y mundial)
      const projectileDirection = baseForward.clone();
      const rotationAxis = new THREE.Vector3(0, 1, 0); // Rotar alrededor del eje Y
      projectileDirection.applyAxisAngle(rotationAxis, angle);
      
      // Disparar proyectil con un pequeño retraso para efecto visual
      setTimeout(() => {
        this.createProjectile(projectileDirection);
        this.projectilesFired++;
        
        // Verificar si todos los proyectiles han sido disparados
        if (this.projectilesFired >= this.salvoProjectiles) {
          this.endSalvo();
        }
      }, i * 100); // 100ms entre cada proyectil
    }
  }

  /**
   * Crea un proyectil individual.
   */
  private createProjectile(direction: THREE.Vector3): void {
    const characterAny = this.character as any;
    if (!characterAny.model || !this.sceneManager) return;
    
    // 1. Posición real en el mundo
    const spawnPos = new THREE.Vector3();
    characterAny.model.getWorldPosition(spawnPos);
    spawnPos.y += 1.2; // Subir el origen a la altura del pecho/arma
    
    // 2. Dirección real en el mundo (ya viene corregida desde getCharacterForwardDirection)
    const forwardDir = direction.clone().normalize();
    
    // 3. Offset: Adelantar el proyectil un poco para que no choque con el propio ADC al nacer
    const spawnOffset = 1.0;
    spawnPos.add(forwardDir.clone().multiplyScalar(spawnOffset));
    
    console.log(`[SalvoAbility] Creando proyectil en posición mundial: (${spawnPos.x.toFixed(2)}, ${spawnPos.y.toFixed(2)}, ${spawnPos.z.toFixed(2)}) con dirección: (${forwardDir.x.toFixed(2)}, ${forwardDir.y.toFixed(2)}, ${forwardDir.z.toFixed(2)})`);
    
    // Crear geometría de proyectil (flecha)
    const geometry = new THREE.ConeGeometry(0.1, 0.5, 8);
    const material = new THREE.MeshStandardMaterial({ color: 0xffaa00 }); // Color naranja para diferenciar
    const projectile = new THREE.Mesh(geometry, material);
    projectile.castShadow = true;
    
    // Posición inicial
    projectile.position.copy(spawnPos);
    
    // Orientar el proyectil en la dirección de disparo
    projectile.lookAt(projectile.position.clone().add(forwardDir));
    projectile.rotateX(Math.PI / 2); // Ajustar orientación para cono
    
    // Añadir a la escena
    this.sceneManager.add(projectile);
    
    // Emitir evento de creación de proyectil
    (this.eventBus as any).emit('projectile:created', {
      playerId: this.playerId,
      projectileId: `salvo_${Date.now()}_${Math.random()}`,
      position: [projectile.position.x, projectile.position.y, projectile.position.z],
      direction: [forwardDir.x, forwardDir.y, forwardDir.z],
      damage: this.character.getEffectiveStat('damage'),
      source: 'salvo'
    });
    
    // Detectar colisiones con raycast (disparo instantáneo)
    this.detectHitsWithRay(spawnPos, forwardDir, this.character.getEffectiveStat('damage'));
    
    // Animar el proyectil (movimiento lineal visual)
    this.animateProjectile(projectile, forwardDir);
  }

  /**
   * Anima el movimiento del proyectil.
   */
  private animateProjectile(projectile: THREE.Mesh, direction: THREE.Vector3): void {
    const speed = 15; // Velocidad del proyectil
    const maxDistance = 20; // Distancia máxima antes de desaparecer
    
    let distanceTraveled = 0;
    const startPosition = projectile.position.clone();
    
    // Función de animación por frame
    const animate = () => {
      if (!projectile.parent) return; // Si el proyectil fue removido
      
      // Mover proyectil
      const moveDistance = speed * 0.016; // Asumiendo 60 FPS
      projectile.position.add(direction.clone().multiplyScalar(moveDistance));
      distanceTraveled = startPosition.distanceTo(projectile.position);
      
      // Verificar si ha alcanzado la distancia máxima
      if (distanceTraveled >= maxDistance) {
        this.removeProjectile(projectile);
        return;
      }
      
      // Continuar animación
      requestAnimationFrame(animate);
    };
    
    // Iniciar animación
    animate();
  }

  /**
   * Detecta colisiones con un rayo (disparo instantáneo) y aplica daño.
   * Soporta piercing: si canPierce es true, el rayo continúa atravesando enemigos.
   */
  private detectHitsWithRay(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    damage: number
  ): void {
    const characterAny = this.character as any;
    if (!characterAny.physicsWorld) {
      console.warn('[SalvoAbility] No hay physicsWorld disponible para detectar colisiones');
      return;
    }

    const world = characterAny.physicsWorld.world;
    if (!world) return;

    const rayDir = { x: direction.x, y: direction.y, z: direction.z };
    const rayOrigin = { x: origin.x, y: origin.y, z: origin.z };
    const ray = new RAPIER.Ray(rayOrigin, rayDir);

    const maxRange = 25.0; // Alcance del ADC
    const solid = false; // Permite detectar el interior de las hitboxes

    console.log(`[SalvoAbility] Lanzando raycast desde (${origin.x.toFixed(2)}, ${origin.y.toFixed(2)}, ${origin.z.toFixed(2)}) dirección (${direction.x.toFixed(2)}, ${direction.y.toFixed(2)}, ${direction.z.toFixed(2)})`);

    // Determinar si este proyectil tiene piercing (consultar pasiva)
    const canPierce = this.checkPiercePassive();

    world.intersectionsWithRay(
      ray, maxRange, solid,
      (handle: number) => {
        const collider = world.getCollider(handle);
        const userData = collider.parent()?.userData;
        
        // Verificación de daño idéntica a la del Melee
        if (userData && userData.entity && typeof userData.entity.takeDamage === 'function') {
          userData.entity.takeDamage(damage);
          console.log(`🎯 Proyectil conectó con el enemigo! Daño: ${damage}`);
        }
        
        // 🔥 EL SECRETO DEL PIERCING 🔥
        // Si el ADC tiene la habilidad PiercePassive activa, retornamos TRUE.
        // true = Atraviesa al enemigo y sigue escaneando la trayectoria.
        // false = La bala se destruye/detiene en este enemigo.
        return canPierce;
      },
      null, null, null, Groups.ENEMY // Usar el grupo de colisión correcto
    );
  }

  /**
   * Verifica si la pasiva de piercing está activa para este jugador.
   * Esto es un placeholder; en una implementación real se consultaría el estado de PiercePassive.
   */
  private checkPiercePassive(): boolean {
    // Por ahora, siempre false. Deberíamos integrar con PiercePassive.
    return false;
  }

  /**
   * Remueve un proyectil de la escena.
   */
  private removeProjectile(projectile: THREE.Mesh): void {
    if (projectile.parent) {
      this.sceneManager.remove(projectile);
      projectile.geometry.dispose();
      (projectile.material as THREE.Material).dispose();
    }
  }

  /**
   * Actualiza el estado del cooldown.
   * Debe llamarse en cada frame desde el game loop.
   */
  public update(dt: number): void {
    // Actualizar cooldown
    if (this.isOnCooldown) {
      this.cooldownTimer -= dt;
      if (this.cooldownTimer <= 0) {
        this.isOnCooldown = false;
        this.cooldownTimer = 0;
        console.log(`[SalvoAbility] ${this.playerId} - Habilidad lista`);
      }
    }
  }

  /**
   * Finaliza la salva.
   */
  private endSalvo(): void {
    console.log(`[SalvoAbility] ${this.playerId} - Salva finalizada`);
    
    this.isSalvoActive = false;
    this.projectilesFired = 0;
    
    // Desactivar efecto visual
    this.deactivateVisualEffect();
    
    // Emitir evento de finalización
    (this.eventBus as any).emit('ability:salvo:ended', {
      playerId: this.playerId
    });
  }

  /**
   * Activa el efecto visual de la salva (placeholder).
   */
  private activateVisualEffect(): void {
    this.visualEffectActive = true;
    console.log(`[SalvoAbility] ${this.playerId} - Efecto visual activado (aura/partículas)`);
    
    // En una implementación real, aquí se crearían partículas o se modificarían materiales
  }

  /**
   * Desactiva el efecto visual de la salva (placeholder).
   */
  private deactivateVisualEffect(): void {
    this.visualEffectActive = false;
    console.log(`[SalvoAbility] ${this.playerId} - Efecto visual desactivado`);
  }

  /**
   * Método para activar la habilidad manualmente (desde el InputManager).
   * @param inputState Estado de entrada opcional que contiene coordenadas del mouse
   */
  public activate(inputState?: InputState): void {
    this.handleAbilityActivation({ playerId: this.playerId, inputState });
  }

  /**
   * Verifica si la habilidad está en cooldown.
   */
  public isAbilityReady(): boolean {
    return !this.isOnCooldown;
  }

  /**
   * Obtiene el tiempo restante de cooldown.
   */
  public getCooldownRemaining(): number {
    return this.cooldownTimer;
  }

  /**
   * Obtiene el porcentaje de cooldown (0-1).
   */
  public getCooldownPercent(): number {
    return this.cooldownTimer / this.cooldownDuration;
  }

  /**
   * Verifica si la salva está activa.
   */
  public isSalvoActiveState(): boolean {
    return this.isSalvoActive;
  }

  /**
   * Limpia recursos (para cuando el personaje muere o se destruye).
   */
  public dispose(): void {
    // Limpiar listeners
    (this.eventBus as any).off('player:abilityQ', this.handleAbilityActivation.bind(this));
    
    // Limpiar cualquier proyectil pendiente
    // (En una implementación real, se deberían limpiar todos los proyectiles activos)
  }
}