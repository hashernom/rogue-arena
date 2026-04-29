import { EventBus } from '../../engine/EventBus';
import { Character } from '../Character';
import { Enemy } from '../../enemies/Enemy';
import { SceneManager } from '../../engine/SceneManager';
import * as THREE from 'three';

/**
 * Habilidad activa "Carga" para el Caballero (MeleeCharacter).
 *
 * Mecánica:
 * - Dash: durante 0.3s la velocidad del personaje es ×4 en la dirección de movimiento actual
 * - Aplica daño a todos los enemigos tocados durante el dash (detección por proximidad)
 * - Aplica knockback fuerte a los enemigos impactados
 * - Cooldown: 6 segundos con indicador visual en HUD
 * - Feedback visual: efecto de partículas/aura durante el dash
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

  // --- Sistema de partículas rojas ---
  private particleMesh: THREE.Points | null = null;
  private particlePositions: Float32Array | null = null;
  private particleVelocities: Float32Array | null = null;
  private particleLifetimes: Float32Array | null = null;
  private particleCount: number = 60; // aumentado de 30 a 60 para más densidad
  private particleTimer: number = 0;
  private particleSpawnInterval: number = 0.015; // cada 15ms (más frecuente)

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

    this.setupEventListeners();
  }

  /**
   * Configura los listeners de eventos para esta habilidad.
   */
  private setupEventListeners(): void {
    // Escuchar eventos de tecla Q (o botón de habilidad)
    // Esto se manejará desde el InputManager, pero por ahora usamos un evento personalizado
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.eventBus as any).on('player:abilityQ', this.handleAbilityActivation.bind(this));
  }

  /**
   * Maneja la activación de la habilidad (cuando el jugador presiona Q).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleAbilityActivation(data: any): void {
    // Verificar que sea el jugador correcto
    if (data.playerId !== this.playerId) return;

    // Verificar cooldown
    if (this.isOnCooldown) {
      console.log(
        `[ChargeAbility] ${this.playerId} - Habilidad en cooldown (${this.cooldownTimer.toFixed(1)}s restantes)`
      );
      return;
    }

    // Activar dash
    this.activateDash();
  }

  /**
   * Activa el dash.
   */
  private activateDash(): void {
    if (this.isDashing) return;

    console.log(`[ChargeAbility] ${this.playerId} - ¡Carga activada!`);

    // Iniciar estado de dash
    this.isDashing = true;
    this.dashTimer = 0;
    this.damagedEnemies.clear();

    // Obtener dirección actual de movimiento del personaje
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const characterAny = this.character as any;
    if (characterAny.moveDirection && characterAny.moveDirection.lengthSq() > 0.001) {
      // Si el jugador se está moviendo, usar esa dirección
      this.dashDirection.copy(characterAny.moveDirection).normalize();
    } else if (
      characterAny.lastMoveDirection &&
      characterAny.lastMoveDirection.lengthSq() > 0.001
    ) {
      // Si está quieto, usar la última dirección de movimiento conocida
      this.dashDirection.copy(characterAny.lastMoveDirection).normalize();
    } else if (characterAny.model) {
      // Fallback: usar la rotación del modelo
      const forward = new THREE.Vector3(0, 0, -1);
      forward.applyQuaternion(characterAny.model.quaternion);
      forward.y = 0;
      forward.normalize();
      if (forward.lengthSq() > 0.001) {
        this.dashDirection.copy(forward);
      } else {
        this.dashDirection.set(0, 0, -1);
      }
    } else {
      // Fallback final: -Z (forward estándar THREE.js)
      this.dashDirection.set(0, 0, -1);
    }

    // Guardar posición inicial del dash para detección por barrido
    if (characterAny.physicsBody && characterAny.physicsWorld) {
      const body = characterAny.physicsWorld.getBody(characterAny.physicsBody);
      if (body) {
        const t = body.translation();
        this.dashStartPosition.set(t.x, t.y, t.z);
      }
    } else if (characterAny.model) {
      this.dashStartPosition.copy(characterAny.model.position);
    }

    // Aplicar velocidad de dash al cuerpo físico
    this.applyDashVelocity();

    // Iniciar cooldown
    this.isOnCooldown = true;
    this.cooldownTimer = this.cooldownDuration;

    // Emitir evento para feedback visual
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.eventBus as any).emit('ability:charge:activated', {
      playerId: this.playerId,
      position: this.getCharacterPosition(),
      direction: this.dashDirection.toArray(),
    });

    // Activar efecto visual de partículas rojas
    this.activateVisualEffect();
  }

  /**
   * Aplica la velocidad del dash al cuerpo físico del personaje.
   */
  private applyDashVelocity(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const characterAny = this.character as any;
    if (!characterAny.physicsBody || !characterAny.physicsWorld) return;

    const body = characterAny.physicsWorld.getBody(characterAny.physicsBody);
    if (!body) return;

    const baseSpeed = this.character.getEffectiveStat('speed');
    const dashSpeed = baseSpeed * this.dashSpeedMultiplier;

    // Aplicar velocidad directamente al cuerpo físico
    body.setLinvel(
      {
        x: this.dashDirection.x * dashSpeed,
        y: 0,
        z: this.dashDirection.z * dashSpeed,
      },
      true
    );
  }

  /**
   * Obtiene la posición actual del personaje desde el cuerpo físico.
   */
  private getCharacterPosition(): number[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const characterAny = this.character as any;
    if (characterAny.physicsBody && characterAny.physicsWorld) {
      const body = characterAny.physicsWorld.getBody(characterAny.physicsBody);
      if (body) {
        const pos = body.translation();
        return [pos.x, pos.y, pos.z];
      }
    }
    if (characterAny.model) {
      return [
        characterAny.model.position.x,
        characterAny.model.position.y,
        characterAny.model.position.z,
      ];
    }
    return [0, 0, 0];
  }

  /**
   * Retorna la proporción de cooldown restante (0 = lista, 1 = cooldown completo).
   */
  getCooldownRatio(): number {
    if (!this.isOnCooldown) return 0;
    return Math.min(1, Math.max(0, this.cooldownTimer / this.cooldownDuration));
  }

  /**
   * Indica si la habilidad está lista para usarse.
   */
  isReady(): boolean {
    return !this.isOnCooldown && !this.isDashing;
  }

  /**
   * Actualiza el estado del dash y cooldown.
   * Debe llamarse en cada frame desde el game loop.
   */
  public update(dt: number): void {
    // Actualizar cooldown
    if (this.isOnCooldown) {
      this.cooldownTimer -= dt;
      if (this.cooldownTimer <= 0) {
        this.isOnCooldown = false;
        this.cooldownTimer = 0;
        console.log(`[ChargeAbility] ${this.playerId} - Habilidad lista`);
      }
    }

    // Actualizar partículas (incluso fuera del dash para que se desvanezcan)
    this.updateParticles(dt);

    // Actualizar dash
    if (this.isDashing) {
      this.dashTimer += dt;

      console.log(
        `[ChargeAbility] Dash update: timer=${this.dashTimer.toFixed(3)}/${this.dashDuration}, ` +
          `enemiesHit=${this.damagedEnemies.size}`
      );

      // Detectar enemigos cercanos por proximidad
      this.detectNearbyEnemies();

      // Mantener velocidad de dash en cada frame (por si el personaje frena)
      this.applyDashVelocity();

      // Verificar si el dash ha terminado
      if (this.dashTimer >= this.dashDuration) {
        this.endDash();
      }
    }
  }

  /**
   * Detecta enemigos cercanos durante el dash usando distancia punto-a-línea (sweep).
   * En lugar de verificar solo la posición actual, verifica si el enemigo está cerca
   * de la trayectoria completa del dash (desde dashStartPosition en dirección dashDirection).
   * Esto asegura que enemigos en el camino sean impactados aunque el dash sea muy rápido.
   */
  private detectNearbyEnemies(): void {
    // Obtener todos los enemigos activos
    const enemies = this.getActiveEnemies();

    console.log(
      `[ChargeAbility] detectNearbyEnemies: ${enemies.length} enemigos activos, ` +
        `dashStart=(${this.dashStartPosition.x.toFixed(1)}, ${this.dashStartPosition.z.toFixed(1)}), ` +
        `dir=(${this.dashDirection.x.toFixed(2)}, ${this.dashDirection.z.toFixed(2)})`
    );

    // Punto inicial del barrido (dónde empezó el dash)
    const P0 = this.dashStartPosition;
    // Punto final estimado del barrido (trayectoria completa)
    const dashLength = 15; // unidades estimadas de recorrido
    const P1 = P0.clone().add(this.dashDirection.clone().multiplyScalar(dashLength));

    // Vector de la línea de barrido
    const lineVec = new THREE.Vector3().copy(P1).sub(P0);
    const lineLenSq = lineVec.lengthSq();

    for (const enemy of enemies) {
      if (!enemy.isAlive()) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const enemyId = (enemy as any).id;
      if (!enemyId) continue;

      // Evitar daño múltiple al mismo enemigo
      if (this.damagedEnemies.has(enemyId)) continue;

      // Obtener posición del enemigo
      const enemyPos = enemy.getPosition();
      if (!enemyPos) continue;

      // --- Calcular distancia del enemigo a la línea de trayectoria ---
      let distToLine: number;
      let closestPointOnLine: THREE.Vector3 | null = null;

      if (lineLenSq < 0.0001) {
        // Si la línea es un punto, usar distancia directa
        distToLine = P0.distanceTo(enemyPos);
        closestPointOnLine = P0.clone();
      } else {
        // Proyección del enemigo sobre la línea
        const t = new THREE.Vector3().copy(enemyPos).sub(P0).dot(lineVec) / lineLenSq;
        // Clampear t a [0, 1] para mantenernos dentro del segmento
        const clampedT = Math.max(0, Math.min(1, t));
        // Punto más cercano en el segmento
        closestPointOnLine = new THREE.Vector3()
          .copy(P0)
          .add(lineVec.clone().multiplyScalar(clampedT));
        // Distancia del enemigo al punto más cercano
        distToLine = enemyPos.distanceTo(closestPointOnLine);
      }

      // Verificar si está dentro del radio de impacto
      if (distToLine <= this.hitRadius) {
        console.log(
          `[ChargeAbility] ¡Impacto! ${enemyId} a ${distToLine.toFixed(2)}u ` +
            `(hitRadius=${this.hitRadius})`
        );
        this.applyDamageToEnemy(enemy, enemyPos, closestPointOnLine);
        this.damagedEnemies.add(enemyId);
      } else {
        console.log(
          `[ChargeAbility] Enemigo ${enemyId} fuera de rango: ${distToLine.toFixed(2)}u > ${this.hitRadius}`
        );
      }
    }
  }

  /**
   * Obtiene la posición actual del personaje como Vector3.
   */
  private getCharacterPositionVec(): THREE.Vector3 {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const characterAny = this.character as any;
    if (characterAny.physicsBody && characterAny.physicsWorld) {
      const body = characterAny.physicsWorld.getBody(characterAny.physicsBody);
      if (body) {
        const t = body.translation();
        return new THREE.Vector3(t.x, t.y, t.z);
      }
    }
    if (characterAny.model) {
      return characterAny.model.position.clone();
    }
    return new THREE.Vector3(0, 0, 0);
  }

  /**
   * Aplica daño y knockback lateral a un enemigo.
   * El knockback es perpendicular a la dirección del dash (empuja al enemigo hacia afuera).
   */
  private applyDamageToEnemy(
    enemy: Enemy,
    enemyPos: THREE.Vector3,
    closestPointOnLine: THREE.Vector3 | null
  ): void {
    const baseDamage = this.character.getEffectiveStat('damage');
    const chargeDamage = baseDamage * 2.0; // Daño bonus ×2 por carga

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enemyAny = enemy as any;
    const enemyId = enemyAny.id;

    console.log(`[ChargeAbility] ${this.playerId} - Daño a enemigo ${enemyId}: ${chargeDamage}`);

    // APLICAR DAÑO REAL: llamar a takeDamage() directamente en el enemigo
    // NOTA: El evento 'enemy:damage' es solo informativo (para UI/HUD),
    // NO es un mecanismo para aplicar daño. El daño real se aplica llamando
    // a enemy.takeDamage() directamente.
    // Pasamos this.playerId como attackerId para tracking de kills.
    enemy.takeDamage(chargeDamage, this.playerId);

    // Acumular daño infligido para estadísticas de fin de partida
    this.character.damageDealt += chargeDamage;

    // Emitir evento informativo de daño (para UI, HUD, etc.)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.eventBus as any).emit('enemy:damage', {
      enemyId,
      damage: chargeDamage,
      source: 'charge',
      playerId: this.playerId,
    });

    // Aplicar knockback LATERAL: el enemigo es empujado hacia afuera desde la línea del dash
    let knockbackDir: THREE.Vector3;

    if (closestPointOnLine) {
      // Dirección desde el punto más cercano en la línea hacia el enemigo (perpendicular al dash)
      knockbackDir = enemyPos.clone().sub(closestPointOnLine);
      if (knockbackDir.lengthSq() > 0.001) {
        knockbackDir.normalize();
      } else {
        // Si el enemigo está exactamente sobre la línea, usar perpendicular al dash
        knockbackDir = new THREE.Vector3(
          this.dashDirection.z,
          0,
          -this.dashDirection.x
        ).normalize();
      }
    } else {
      // Fallback: dirección perpendicular a la dirección del dash
      knockbackDir = new THREE.Vector3(this.dashDirection.z, 0, -this.dashDirection.x).normalize();
    }

    // Fuerza de knockback: 40 unidades/segundo para un impacto fuerte y visible
    const knockbackStrength = 40;
    const knockbackDuration = 0.6;
    const knockbackForce = knockbackDir.multiplyScalar(knockbackStrength);

    // Aplicar knockback usando el método del Character
    // NOTA: applyKnockback llama a disableSteering(), por lo que debemos
    // programar el re-activación del steering después de la duración
    enemy.applyKnockback(knockbackForce, knockbackDuration);

    // Programar re-activación del steering para que el enemigo no se congele
    setTimeout(() => {
      try {
        if (enemy.isAlive()) {
          enemy.enableSteering();
        }
      } catch {
        // Ignorar errores si el enemigo ya no existe
      }
    }, knockbackDuration * 1000);

    console.log(
      `[ChargeAbility] Knockback lateral aplicado a ${enemyId}: ` +
        `fuerza=(${knockbackForce.x.toFixed(1)}, ${knockbackForce.y.toFixed(1)}, ${knockbackForce.z.toFixed(1)})`
    );

    // Feedback visual de impacto
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.eventBus as any).emit('ability:charge:impact', {
      playerId: this.playerId,
      enemyId,
      damage: chargeDamage,
    });
  }

  /**
   * Finaliza el dash.
   */
  private endDash(): void {
    console.log(`[ChargeAbility] ${this.playerId} - Dash finalizado`);

    this.isDashing = false;
    this.dashTimer = 0;
    this.damagedEnemies.clear();

    // Desactivar efecto visual
    this.deactivateVisualEffect();

    // Emitir evento de finalización
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.eventBus as any).emit('ability:charge:ended', {
      playerId: this.playerId,
    });
  }

  /**
   * Establece el SceneManager para poder agregar/remover partículas de la escena.
   */
  public setSceneManager(sm: SceneManager): void {
    this.sceneManager = sm;
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

    // Material rojo con opacidad
    const material = new THREE.PointsMaterial({
      color: 0xff2200,
      size: 0.6, // aumentado de 0.4 a 0.6
      transparent: true,
      opacity: 0.9, // aumentado de 0.8 a 0.9
      blending: THREE.AdditiveBlending,
      depthWrite: false,
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

    const count = this.particleCount;
    for (let i = 0; i < count; i++) {
      // Posición aleatoria alrededor del personaje (radio 2.0, más dispersión)
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 2.0;
      const heightOffset = (Math.random() - 0.5) * 2.5;

      this.particlePositions[i * 3] = charPos.x + Math.cos(angle) * radius;
      this.particlePositions[i * 3 + 1] = charPos.y + 0.5 + heightOffset * 0.5;
      this.particlePositions[i * 3 + 2] = charPos.z + Math.sin(angle) * radius;

      // Velocidad: hacia atrás (opuesta al dash) con más fuerza
      const speed = 3 + Math.random() * 5;
      this.particleVelocities[i * 3] = -this.dashDirection.x * speed + (Math.random() - 0.5) * 3;
      this.particleVelocities[i * 3 + 1] = 1.5 + Math.random() * 3; // hacia arriba
      this.particleVelocities[i * 3 + 2] =
        -this.dashDirection.z * speed + (Math.random() - 0.5) * 3;

      // Lifetime más largo (0.4 - 1.0 segundos)
      this.particleLifetimes[i] = 0.4 + Math.random() * 0.6;
    }

    // Actualizar geometry
    if (this.particleMesh) {
      const posAttr = this.particleMesh.geometry.attributes.position;
      if (posAttr) {
        posAttr.needsUpdate = true;
      }
    }
  }

  /**
   * Spawnea una partícula individual durante el dash (efecto de estela).
   */
  private spawnTrailParticle(): void {
    if (!this.particlePositions || !this.particleLifetimes || !this.particleVelocities) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const characterAny = this.character as any;
    let charPos: THREE.Vector3;
    if (characterAny.model) {
      charPos = characterAny.model.position;
    } else {
      return;
    }

    // Encontrar una partícula inactiva (lifetime <= 0) para reutilizar
    let found = -1;
    for (let i = 0; i < this.particleCount; i++) {
      if (this.particleLifetimes[i] <= 0) {
        found = i;
        break;
      }
    }
    if (found < 0) return;

    const i = found;

    // Posición: detrás del personaje (opuesta a la dirección del dash)
    const offset = this.dashDirection
      .clone()
      .negate()
      .multiplyScalar(0.5 + Math.random() * 1.5);
    this.particlePositions[i * 3] = charPos.x + offset.x + (Math.random() - 0.5) * 0.8;
    this.particlePositions[i * 3 + 1] = charPos.y + 0.3 + Math.random() * 1.2;
    this.particlePositions[i * 3 + 2] = charPos.z + offset.z + (Math.random() - 0.5) * 0.8;

    // Velocidad: más dispersión
    this.particleVelocities[i * 3] = (Math.random() - 0.5) * 2.5;
    this.particleVelocities[i * 3 + 1] = 0.5 + Math.random() * 2.5;
    this.particleVelocities[i * 3 + 2] = (Math.random() - 0.5) * 2.5;

    // Lifetime más largo
    this.particleLifetimes[i] = 0.3 + Math.random() * 0.5;
  }

  /**
   * Actualiza las partículas cada frame.
   */
  private updateParticles(dt: number): void {
    if (
      !this.particleMesh ||
      !this.particlePositions ||
      !this.particleLifetimes ||
      !this.particleVelocities
    )
      return;
    if (!this.particleMesh.visible) return;

    // Spawnear nuevas partículas de estela periódicamente
    this.particleTimer += dt;
    if (this.particleTimer >= this.particleSpawnInterval) {
      this.particleTimer = 0;
      this.spawnTrailParticle();
    }

    // Actualizar cada partícula
    let allDead = true;
    for (let i = 0; i < this.particleCount; i++) {
      if (this.particleLifetimes[i] <= 0) continue;
      allDead = false;

      // Reducir lifetime
      this.particleLifetimes[i] -= dt;

      // Mover por velocidad
      this.particlePositions[i * 3] += this.particleVelocities[i * 3] * dt;
      this.particlePositions[i * 3 + 1] += this.particleVelocities[i * 3 + 1] * dt;
      this.particlePositions[i * 3 + 2] += this.particleVelocities[i * 3 + 2] * dt;

      // Desacelerar
      this.particleVelocities[i * 3] *= 0.98;
      this.particleVelocities[i * 3 + 1] *= 0.98;
      this.particleVelocities[i * 3 + 2] *= 0.98;

      // Si murió, ocultarla
      if (this.particleLifetimes[i] <= 0) {
        this.particlePositions[i * 3] = 0;
        this.particlePositions[i * 3 + 1] = 0;
        this.particlePositions[i * 3 + 2] = 0;
      }
    }

    // Actualizar geometry
    const posAttr = this.particleMesh.geometry.attributes.position;
    if (posAttr) {
      posAttr.needsUpdate = true;
    }

    // Ajustar opacidad del material basado en si hay partículas vivas
    if (allDead) {
      this.particleMesh.visible = false;
    }
  }

  /**
   * Desactiva el efecto visual del dash.
   */
  private deactivateVisualEffect(): void {
    console.log(`[ChargeAbility] ${this.playerId} - Efecto visual desactivado`);

    if (this.particleMesh) {
      this.particleMesh.visible = false;
    }
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
   * Verifica si el personaje está en dash.
   */
  public isDashingActive(): boolean {
    return this.isDashing;
  }

  /**
   * Limpia recursos (para cuando el personaje muere o se destruye).
   */
  public dispose(): void {
    // Limpiar listeners
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.eventBus as any).off('player:abilityQ', this.handleAbilityActivation.bind(this));

    if (this.isDashing) {
      this.endDash();
    }
  }
}
