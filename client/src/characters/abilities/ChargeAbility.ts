import * as THREE from 'three';
import { EventBus } from '../../engine/EventBus';
import { Character } from '../Character';
import { Enemy } from '../../enemies/Enemy';
import { SceneManager } from '../../engine/SceneManager';

/**
 * Habilidad de carga (Q) para el personaje melee.
 * El personaje se lanza hacia adelante dañando enemigos en su trayectoria.
 * Incluye sistema de partículas rojas agresivas.
 */
export class ChargeAbility {
  private eventBus: EventBus;
  private character: Character;
  private playerId: string;
  private getActiveEnemies: () => Enemy[];
  private sceneManager: SceneManager | null = null;

  // Estado del dash
  private isDashing: boolean = false;
  private dashTimer: number = 0;
  private dashDuration: number = 0.25; // segundos (nerf: menos recorrido)
  private dashSpeedMultiplier: number = 4;

  // Cooldown
  private cooldownTimer: number = 0;
  private cooldownDuration: number = 6; // segundos
  private isOnCooldown: boolean = false;

  // Dirección del dash (se guarda al inicio)
  private dashDirection: THREE.Vector3 = new THREE.Vector3();

  // Posición inicial del dash (para detección por barrido)
  private dashStartPosition: THREE.Vector3 = new THREE.Vector3();

  // Enemigos ya dañados durante este dash (para evitar daño múltiple)
  private damagedEnemies: Set<string> = new Set();

  // Radio de detección de impacto durante el dash (distancia a la línea de trayectoria)
  // Reducido de 4.0 a 2.0 para que solo afecte enemigos realmente cerca de la línea del dash
  private hitRadius: number = 2.0;

  // --- Sistema de partículas rojas (más agresivo) ---
  private particleMesh: THREE.Points | null = null;
  private particlePositions: Float32Array | null = null;
  private particleVelocities: Float32Array | null = null;
  private particleLifetimes: Float32Array | null = null;
  private particleCount: number = 120; // duplicado de 60 a 120 para mucha más densidad
  private particleTimer: number = 0;
  private particleSpawnInterval: number = 0.006; // cada 6ms (antes 15ms) - estela mucho más densa

  /** Referencia vinculada del handler para poder remover el listener correctamente. */
  private _boundHandleAbilityActivation: (data: any) => void;

  constructor(
    eventBus: EventBus,
    character: Character,
    playerId: string,
    getActiveEnemies: () => Enemy[],
    sceneManager?: SceneManager
  ) {
    this.eventBus = eventBus;
    this.character = character;
    this.playerId = playerId;
    this.getActiveEnemies = getActiveEnemies;
    if (sceneManager) {
      this.sceneManager = sceneManager;
    }

    this._boundHandleAbilityActivation = this.handleAbilityActivation.bind(this);
    this.setupEventListeners();
  }

  /**
   * Configura los listeners de eventos para esta habilidad.
   */
  private setupEventListeners(): void {
    // Escuchar eventos de tecla Q (o botón de habilidad)
    // Esto se manejará desde el InputManager, pero por ahora usamos un evento personalizado
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.eventBus as any).on('player:abilityQ', this._boundHandleAbilityActivation);
  }

  /**
   * Maneja la activación de la habilidad (cuando el jugador presiona Q).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleAbilityActivation(data: any): void {
    // Verificar que sea el jugador correcto
    if (data.playerId !== this.playerId) return;

    // Verificar cooldown
    if (this.isOnCooldown) return;

    // Evitar activación múltiple
    if (this.isDashing) return;

    // Verificar que el personaje esté vivo
    if (this.character.getCurrentHp() <= 0) return;

    console.log(`[ChargeAbility] ${this.playerId} - Activando dash!`);
    this.activateDash();
  }

  /**
   * Activa el dash: guarda dirección y estado inicial.
   */
  private activateDash(): void {
    console.log(`[ChargeAbility] ${this.playerId} - activateDash()`);

    // Obtener la dirección del personaje
    const charPos = this.getCharacterPositionVec();
    this.dashStartPosition.copy(charPos);

    // Obtener dirección hacia adelante del personaje (desde el modelo)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const characterAny = this.character as any;

    let forwardDir = new THREE.Vector3(0, 0, 1);

    if (characterAny.model) {
      // Intentar obtener la dirección del modelo
      const modelDir = new THREE.Vector3();
      characterAny.model.getWorldDirection(modelDir);
      if (modelDir.lengthSq() > 0.01) {
        forwardDir.copy(modelDir);
        // Aplanar la dirección (ignorar componente Y)
        forwardDir.y = 0;
        if (forwardDir.lengthSq() > 0.01) {
          forwardDir.normalize();
        } else {
          forwardDir.set(0, 0, 1);
        }
      }
    }

    this.dashDirection.copy(forwardDir);

    this.isDashing = true;
    this.dashTimer = 0;
    this.isOnCooldown = true;
    this.cooldownTimer = 0;
    this.damagedEnemies.clear();

    // Efecto visual
    this.activateVisualEffect();

    console.log(`[ChargeAbility] ${this.playerId} - Dash iniciado, dirección:`, this.dashDirection);
  }

  /**
   * Aplica la velocidad del dash al personaje cada frame.
   */
  private applyDashVelocity(): void {
    if (!this.isDashing) return;

    const speed = this.character.getEffectiveStat('speed') * this.dashSpeedMultiplier;
    const step = speed * 0.016; // Asumiendo 60 FPS

    // Aplicar movimiento directamente a la posición del modelo
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const characterAny = this.character as any;

    if (characterAny.model) {
      characterAny.model.position.x += this.dashDirection.x * step;
      characterAny.model.position.z += this.dashDirection.z * step;
    }
  }

  /**
   * Obtiene la posición actual del personaje para detección de enemigos.
   */
  private getCharacterPosition(): number[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const characterAny = this.character as any;
    if (characterAny.model) {
      return [characterAny.model.position.x, characterAny.model.position.y, characterAny.model.position.z];
    }
    return [0, 0, 0];
  }

  /**
   * Obtiene el ratio de cooldown (0-1) para el HUD.
   */
  getCooldownRatio(): number {
    if (!this.isOnCooldown) return 1;
    return 1 - (this.cooldownTimer / this.cooldownDuration);
  }

  /**
   * Verifica si la habilidad está lista para usarse.
   */
  isReady(): boolean {
    return !this.isOnCooldown && !this.isDashing;
  }

  /**
   * Actualiza el estado del dash cada frame.
   */
  public update(dt: number): void {
    // Actualizar cooldown
    if (this.isOnCooldown) {
      this.cooldownTimer += dt;
      if (this.cooldownTimer >= this.cooldownDuration) {
        this.isOnCooldown = false;
        this.cooldownTimer = 0;
        console.log(`[ChargeAbility] ${this.playerId} - Cooldown terminado`);
      }
    }

    // Actualizar dash
    if (this.isDashing) {
      this.dashTimer += dt;
      this.applyDashVelocity();

      // Detectar enemigos cercanos durante el dash
      this.detectNearbyEnemies();

      if (this.dashTimer >= this.dashDuration) {
        this.endDash();
      }
    }

    // Actualizar partículas
    this.updateParticles(dt);
  }

  /**
   * Detecta enemigos cercanos durante el dash y les aplica daño.
   */
  private detectNearbyEnemies(): void {
    const enemies = this.getActiveEnemies();
    if (!enemies || enemies.length === 0) return;

    const charPosVec = this.getCharacterPositionVec();

    for (const enemy of enemies) {
      if (this.damagedEnemies.has(enemy.id)) continue;

      const enemyPos = enemy.getPosition();
      if (!enemyPos) continue;

      // Calcular distancia del enemigo a la línea del dash
      const toEnemy = new THREE.Vector3().copy(enemyPos).sub(this.dashStartPosition);
      const dashDir = new THREE.Vector3().copy(this.dashDirection);

      // Proyección del enemigo sobre la línea del dash
      const projection = toEnemy.dot(dashDir);

      // Ignorar enemigos detrás del punto de inicio
      if (projection < 0) continue;

      // Punto más cercano en la línea del dash
      const closestPoint = new THREE.Vector3().copy(this.dashStartPosition).add(
        dashDir.multiplyScalar(projection)
      );

      // Distancia perpendicular desde el enemigo hasta la línea del dash
      const perpendicularDist = enemyPos.distanceTo(closestPoint);

      // También verificar que esté dentro del rango del dash
      const dashProgress = this.dashTimer / this.dashDuration;
      const currentDashPos = new THREE.Vector3().copy(this.dashStartPosition).add(
        new THREE.Vector3().copy(this.dashDirection).multiplyScalar(
          this.character.getEffectiveStat('speed') * this.dashSpeedMultiplier * this.dashTimer
        )
      );

      // Distancia directa desde la posición actual del dash
      const directDist = enemyPos.distanceTo(currentDashPos);

      if (perpendicularDist <= this.hitRadius || directDist <= this.hitRadius * 1.5) {
        // Aplicar daño
        this.applyDamageToEnemy(enemy);
      }
    }
  }

  /**
   * Obtiene la posición actual del personaje como Vector3.
   */
  private getCharacterPositionVec(): THREE.Vector3 {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const characterAny = this.character as any;
    if (characterAny.getPosition) {
      const pos = characterAny.getPosition();
      if (pos) return pos;
    }
    if (characterAny.model) {
      return characterAny.model.position;
    }
    return new THREE.Vector3(0, 0, 0);
  }

  /**
   * Aplica daño a un enemigo y emite eventos.
   */
  private applyDamageToEnemy(
    enemy: Enemy
  ): void {
    const damage = this.character.getEffectiveStat('damage') * 1.5; // 150% del daño base

    // Usar el pipeline de daño si está disponible (ataque cuerpo a cuerpo)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const characterAny = this.character as any;
    if (characterAny.damagePipeline) {
      characterAny.damagePipeline.processDamage(
        enemy,
        damage,
        this.playerId
      );
    } else {
      enemy.takeDamage(damage, this.playerId);
    }

    this.damagedEnemies.add(enemy.id);

    // Efecto visual: pequeño empuje hacia atrás
    const enemyPos = enemy.getPosition();
    if (enemyPos) {
      const knockbackDir = new THREE.Vector3()
        .copy(enemyPos)
        .sub(this.getCharacterPositionVec())
        .normalize()
        .multiplyScalar(3);
      enemy.applyKnockback(knockbackDir, 0.2);
    }

    // Emitir evento de daño
    (this.eventBus as any).emit('player:damageDealt' as any, {
      playerId: this.playerId,
      enemyId: enemy.id,
      damage,
    });

    // Notificar al sistema de audio
    (this.eventBus as any).emit('enemy:damaged' as any, {
      enemyId: enemy.id,
      damage,
    });

    setTimeout(() => {
      console.log(`[ChargeAbility] ${this.playerId} - Daño aplicado a ${enemy.id}: ${damage}`);
    }, 0);
  }

  /**
   * Termina el dash y limpia el estado.
   */
  private endDash(): void {
    this.isDashing = false;
    this.dashTimer = 0;
    this.damagedEnemies.clear();

    this.deactivateVisualEffect();

    console.log(`[ChargeAbility] ${this.playerId} - Dash finalizado`);
  }

  /**
   * Crea el sistema de partículas rojas para el dash.
   */
  private createParticleSystem(): void {
    if (this.particleMesh) return;
    if (!this.sceneManager) return;

    const count = this.particleCount;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const lifetimes = new Float32Array(count);

    // Inicializar todas las partículas en origen con lifetime 0 (inactivas)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;
      velocities[i * 3] = 0;
      velocities[i * 3 + 1] = 0;
      velocities[i * 3 + 2] = 0;
      lifetimes[i] = 0;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Material rojo intenso con brillo
    const material = new THREE.PointsMaterial({
      color: 0xff3300,
      size: 1.2, // aumentado de 0.6 a 1.2 para partículas más grandes
      transparent: true,
      opacity: 1.0, // aumentado de 0.9 a 1.0
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.particleMesh = new THREE.Points(geometry, material);
    this.particlePositions = positions;
    this.particleVelocities = velocities;
    this.particleLifetimes = lifetimes;
    this.particleTimer = 0;

    // Agregar a la escena
    this.sceneManager.add(this.particleMesh);
  }

  /**
   * Activa el efecto visual del dash: partículas rojas.
   */
  private activateVisualEffect(): void {
    console.log(`[ChargeAbility] ${this.playerId} - Efecto visual activado (partículas rojas)`);

    // Crear el sistema de partículas si no existe
    this.createParticleSystem();

    if (!this.particleMesh) return;

    this.particleMesh.visible = true;
    this.particleTimer = 0;

    // Spawn inicial de partículas alrededor del personaje
    this.spawnParticlesBurst();
  }

  /**
   * Spawnea una ráfaga inicial de partículas.
   */
  private spawnParticlesBurst(): void {
    if (!this.particlePositions || !this.particleLifetimes || !this.particleVelocities) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const characterAny = this.character as any;
    let charPos: THREE.Vector3;
    if (characterAny.model) {
      charPos = characterAny.model.position;
    } else {
      charPos = new THREE.Vector3(0, 0, 0);
    }

    const count = Math.min(80, this.particleCount); // burst con 80 partículas

    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * this.particleCount);
      const i3 = idx * 3;

      // Posición alrededor del personaje con radio de explosión 3.0
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const radius = Math.random() * 3.0;

      this.particlePositions[i3] = charPos.x + radius * Math.sin(phi) * Math.cos(theta);
      this.particlePositions[i3 + 1] = charPos.y + Math.random() * 4.0; // altura hasta 4.0
      this.particlePositions[i3 + 2] = charPos.z + radius * Math.sin(phi) * Math.sin(theta);

      // Velocidad: explosión hacia afuera
      const speed = 5 + Math.random() * 13;
      this.particleVelocities[i3] = (this.particlePositions[i3] - charPos.x) * speed;
      this.particleVelocities[i3 + 1] = (Math.random() - 0.5) * 8 + 3; // sesgo ascendente
      this.particleVelocities[i3 + 2] = (this.particlePositions[i3 + 2] - charPos.z) * speed;

      // Vida útil: 0.5 a 1.5 segundos
      this.particleLifetimes[idx] = 0.5 + Math.random() * 1.0;
    }

    // Actualizar buffer de geometría
    const positionAttr = this.particleMesh!.geometry.attributes.position;
    positionAttr.needsUpdate = true;
  }

  /**
   * Spawnea una partícula de estela durante el dash.
   */
  private spawnTrailParticle(): void {
    if (!this.particlePositions || !this.particleLifetimes || !this.particleVelocities) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const characterAny = this.character as any;
    let charPos: THREE.Vector3;
    if (characterAny.model) {
      charPos = characterAny.model.position;
    } else {
      charPos = new THREE.Vector3(0, 0, 0);
    }

    // Buscar una partícula inactiva (lifetime <= 0) o reutilizar una al azar
    let idx = -1;
    for (let i = 0; i < this.particleCount; i++) {
      if (this.particleLifetimes[i] <= 0) {
        idx = i;
        break;
      }
    }
    if (idx === -1) {
      // Si todas están activas, reutilizar la más vieja (aleatoria)
      idx = Math.floor(Math.random() * this.particleCount);
    }

    const i3 = idx * 3;

    // Dispersión horizontal ±5, altura variable 0-4
    const spread = 5.0;

    this.particlePositions[i3] = charPos.x + (Math.random() - 0.5) * spread;
    this.particlePositions[i3 + 1] = charPos.y + Math.random() * 4.0;
    this.particlePositions[i3 + 2] = charPos.z + (Math.random() - 0.5) * spread;

    // Velocidad: hacia arriba y ligeramente aleatoria
    this.particleVelocities[i3] = (Math.random() - 0.5) * 3;
    this.particleVelocities[i3 + 1] = 2 + Math.random() * 5;
    this.particleVelocities[i3 + 2] = (Math.random() - 0.5) * 3;

    // Vida útil
    this.particleLifetimes[idx] = 0.5 + Math.random() * 1.0;
  }

  /**
   * Actualiza la simulación de partículas.
   */
  private updateParticles(dt: number): void {
    if (!this.particleMesh || !this.isDashing) {
      // Si no hay dash, ocultar partículas gradualmente
      if (this.particleMesh && !this.isDashing) {
        // Dejar que las partículas activas terminen su ciclo
      }
      return;
    }

    // Spawnear nuevas partículas de estela
    this.particleTimer += dt;
    while (this.particleTimer >= this.particleSpawnInterval) {
      this.particleTimer -= this.particleSpawnInterval;
      this.spawnTrailParticle();
    }

    // Actualizar partículas existentes
    const pos = this.particlePositions!;
    const vel = this.particleVelocities!;
    const life = this.particleLifetimes!;

    let anyAlive = false;
    for (let i = 0; i < this.particleCount; i++) {
      if (life[i] <= 0) continue;

      const i3 = i * 3;

      // Reducir vida
      life[i] -= dt;

      if (life[i] <= 0) {
        life[i] = 0;
        // Mover partícula fuera de la escena (inactiva)
        pos[i3] = 0;
        pos[i3 + 1] = -100;
        pos[i3 + 2] = 0;
        continue;
      }

      anyAlive = true;

      // Aplicar velocidad con fricción
      vel[i3] *= 0.97;
      vel[i3 + 1] *= 0.97;
      vel[i3 + 2] *= 0.97;

      // Gravedad suave
      vel[i3 + 1] -= 2 * dt;

      // Actualizar posición
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
    }

    // Marcar buffer para actualización
    if (anyAlive) {
      const positionAttr = this.particleMesh.geometry.attributes.position;
      if (positionAttr) {
        positionAttr.needsUpdate = true;
      }
    }
  }

  /**
   * Desactiva el efecto visual.
   */
  private deactivateVisualEffect(): void {
    if (this.particleMesh) {
      this.particleMesh.visible = false;
    }
  }

  /**
   * Activa la habilidad desde el exterior (por ejemplo, desde el personaje).
   */
  public activate(): void {
    if (this.isOnCooldown) return;
    if (this.isDashing) return;
    if (this.character.getCurrentHp() <= 0) return;
    this.activateDash();
  }

  /**
   * Verifica si el personaje está en dash.
   */
  public isDashingActive(): boolean {
    return this.isDashing;
  }

  /**
   * Establece el SceneManager para el sistema de partículas.
   */
  public setSceneManager(sm: SceneManager): void {
    this.sceneManager = sm;
  }

  /**
   * Limpia recursos (para cuando el personaje muere o se destruye).
   */
  public dispose(): void {
    // Limpiar listeners usando la referencia almacenada
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.eventBus as any).off('player:abilityQ', this._boundHandleAbilityActivation);

    if (this.isDashing) {
      this.endDash();
    }

    // Limpiar sistema de partículas (geometry + material)
    if (this.particleMesh) {
      this.particleMesh.geometry.dispose();
      (this.particleMesh.material as THREE.Material).dispose();
      if (this.sceneManager) {
        this.sceneManager.remove(this.particleMesh);
      }
      this.particleMesh = null;
      this.particlePositions = null;
      this.particleVelocities = null;
      this.particleLifetimes = null;
    }
  }
}
