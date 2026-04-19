import { EventBus } from '../../engine/EventBus';
import { Character } from '../Character';
import * as THREE from 'three';

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
    
    // Activar salva
    this.activateSalvo();
  }

  /**
   * Activa la salva de proyectiles.
   */
  private activateSalvo(): void {
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
    
    // Disparar los proyectiles en secuencia rápida
    this.fireSalvoProjectiles();
  }

  /**
   * Obtiene la posición actual del personaje.
   */
  private getCharacterPosition(): number[] {
    const characterAny = this.character as any;
    if (characterAny.model) {
      return [
        characterAny.model.position.x,
        characterAny.model.position.y,
        characterAny.model.position.z
      ];
    }
    return [0, 0, 0];
  }

  /**
   * Dispara los proyectiles de la salva en abanico.
   */
  private fireSalvoProjectiles(): void {
    const characterAny = this.character as any;
    if (!characterAny.model) return;
    
    // Obtener dirección frontal del personaje
    const forwardDirection = new THREE.Vector3(0, 0, -1);
    forwardDirection.applyQuaternion(characterAny.model.quaternion);
    
    // Calcular ángulo entre proyectiles (en radianes)
    const totalAngleRad = THREE.MathUtils.degToRad(this.salvoAngle);
    const angleBetweenProjectiles = totalAngleRad / (this.salvoProjectiles - 1);
    const startAngle = -totalAngleRad / 2; // Empezar desde el extremo izquierdo
    
    // Crear y disparar cada proyectil
    for (let i = 0; i < this.salvoProjectiles; i++) {
      // Calcular ángulo para este proyectil
      const angle = startAngle + (i * angleBetweenProjectiles);
      
      // Crear dirección rotada
      const projectileDirection = forwardDirection.clone();
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
    
    // Crear geometría de proyectil (flecha)
    const geometry = new THREE.ConeGeometry(0.1, 0.5, 8);
    const material = new THREE.MeshStandardMaterial({ color: 0xffaa00 }); // Color naranja para diferenciar
    const projectile = new THREE.Mesh(geometry, material);
    projectile.castShadow = true;
    
    // Posición inicial: frente del personaje
    const startPosition = characterAny.model.position.clone();
    const offset = direction.clone().multiplyScalar(1.5);
    projectile.position.copy(startPosition).add(offset);
    
    // Orientar el proyectil en la dirección de disparo
    projectile.lookAt(projectile.position.clone().add(direction));
    projectile.rotateX(Math.PI / 2); // Ajustar orientación para cono
    
    // Añadir a la escena
    this.sceneManager.add(projectile);
    
    // Emitir evento de creación de proyectil
    (this.eventBus as any).emit('projectile:created', {
      playerId: this.playerId,
      projectileId: `salvo_${Date.now()}_${Math.random()}`,
      position: [projectile.position.x, projectile.position.y, projectile.position.z],
      direction: [direction.x, direction.y, direction.z],
      damage: this.character.getEffectiveStat('damage'),
      source: 'salvo'
    });
    
    // Animar el proyectil (movimiento lineal)
    this.animateProjectile(projectile, direction);
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
   */
  public activate(): void {
    this.handleAbilityActivation({ playerId: this.playerId });
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