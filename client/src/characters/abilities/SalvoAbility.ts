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
 * - Dispara 5 proyectiles en un abanico de 60° (15° entre cada proyectil)
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
  private salvoProjectiles: number = 5;
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

  // Lista de proyectiles activos para poder limpiarlos al forzar ronda (F2)
  private activeSalvoProjectiles: Set<THREE.Object3D> = new Set();

  /** Referencia vinculada del handler para poder remover el listener correctamente. */
  private _boundHandleAbilityActivation: (data: any) => void;

  constructor(eventBus: EventBus, character: Character, playerId: string, sceneManager: any) {
    this.eventBus = eventBus;
    this.character = character;
    this.playerId = playerId;
    this.sceneManager = sceneManager;

    this._boundHandleAbilityActivation = this.handleAbilityActivation.bind(this);
    this.setupEventListeners();
  }

  /**
   * Configura los listeners de eventos para esta habilidad.
   */
  private setupEventListeners(): void {
    // Escuchar eventos de tecla Q (o botón de habilidad)
    (this.eventBus as any).on('player:abilityQ', this._boundHandleAbilityActivation);
  }

  /**
   * Maneja la activación de la habilidad (cuando el jugador presiona Q).
   */
  private handleAbilityActivation(data: any): void {
    // Verificar que sea el jugador correcto
    if (data.playerId !== this.playerId) return;

    // Verificar cooldown
    if (this.isOnCooldown) {
      console.log(
        `[SalvoAbility] ${this.playerId} - Habilidad en cooldown (${this.cooldownTimer.toFixed(1)}s restantes)`
      );
      return;
    }

    // Activar salva con inputState (si está disponible)
    this.activateSalvo(data.inputState);
  }

  /**
   * Activa la salva de proyectiles.
   */
  private activateSalvo(inputState?: InputState, aimPosition?: THREE.Vector3): void {
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
      position: this.getCharacterPosition(),
    });

    // Feedback visual (placeholder)
    this.activateVisualEffect();

    // Disparar los proyectiles en secuencia rápida con inputState para mouse targeting
    this.fireSalvoProjectiles(inputState, aimPosition);
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

    console.log(
      `[SalvoAbility] Dirección mundial: (${worldDirection.x.toFixed(2)}, ${worldDirection.y.toFixed(2)}, ${worldDirection.z.toFixed(2)}), invertir? ${shouldNegate}, forward final: (${forward.x.toFixed(2)}, ${forward.y.toFixed(2)}, ${forward.z.toFixed(2)})`
    );
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
   * @param inputState Estado de input (mouseNDC para online)
   * @param aimPosition Posición objetivo para auto-aim (modo local)
   */
  private fireSalvoProjectiles(inputState?: InputState, aimPosition?: THREE.Vector3): void {
    const characterAny = this.character as any;
    if (!characterAny.model) return;

    // Obtener dirección base: mouse targeting si hay inputState, sino dirección forward del personaje
    let baseForward = this.getCharacterForwardDirection();

    // AUTO-AIM (modo local): calcular dirección hacia la posición objetivo
    if (aimPosition) {
      const charPos = this.getCharacterPosition();
      charPos.y = 1.2;
      const aimPos = aimPosition.clone();
      aimPos.y = 1.2;
      const toTarget = new THREE.Vector3().subVectors(aimPos, charPos);
      toTarget.y = 0;
      if (toTarget.lengthSq() > 0.01) {
        baseForward = toTarget.normalize();
      }
    }
    // Intentar usar mouse targeting si está disponible (modo online)
    else if (inputState?.mouseNDC && this.sceneManager) {
      const camera = this.sceneManager.getCamera();
      if (camera) {
        // Calcular dirección usando raycasting similar a AdcCharacter.calculateAimDirection
        const mouseDir = this.calculateAimDirection(camera, inputState.mouseNDC);
        if (mouseDir.lengthSq() > 0.01) {
          baseForward = mouseDir;
          console.log(
            `[SalvoAbility] Usando dirección de mouse: (${baseForward.x.toFixed(2)}, ${baseForward.y.toFixed(2)}, ${baseForward.z.toFixed(2)})`
          );
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
      const angle = startAngle + i * angleBetweenProjectiles;

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
   * Crea un proyectil individual con modelo 3D de flecha naranja brillante
   * y sistema de partículas de estela (trail).
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

    // 4. Crear proyectil con modelo 3D de flecha (naranja brillante)
    let projectile: THREE.Object3D;

    if (characterAny.arrowGltf && characterAny.assetLoader) {
      try {
        // Clonar el modelo GLTF de la flecha (igual que shootProjectile del ADC)
        projectile = characterAny.assetLoader.clone(characterAny.arrowGltf);
        projectile.scale.set(2.0, 2.0, 2.0);

        // Teñir la flecha de naranja brillante con glow
        projectile.traverse(child => {
          if (child instanceof THREE.Mesh && child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach(mat => {
              mat.color.setHex(0xff6600);
              mat.emissive = new THREE.Color(0xff4400);
              mat.emissiveIntensity = 0.8;
              mat.needsUpdate = true;
            });
          }
        });
      } catch (cloneError) {
        console.warn('[SalvoAbility] Error clonando flecha, usando fallback:', cloneError);
        projectile = this.createFallbackProjectile();
      }
    } else {
      // Fallback: cono naranja
      projectile = this.createFallbackProjectile();
    }

    // Posición inicial y orientación
    projectile.position.copy(spawnPos);
    const lookTarget = spawnPos.clone().add(forwardDir);
    projectile.lookAt(lookTarget);

    // 5. Crear sistema de partículas de estela (trail naranja)
    const trailCount = 12;
    const trailPositions = new Float32Array(trailCount * 3);
    for (let i = 0; i < trailCount; i++) {
      trailPositions[i * 3] = spawnPos.x;
      trailPositions[i * 3 + 1] = spawnPos.y;
      trailPositions[i * 3 + 2] = spawnPos.z;
    }
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    const trailMat = new THREE.PointsMaterial({
      color: 0xff6600,
      size: 0.2,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const trailParticles = new THREE.Points(trailGeo, trailMat);

    // Añadir a la escena
    this.sceneManager.add(projectile);
    this.sceneManager.add(trailParticles);

    // Almacenar referencia de partículas en userData para limpieza
    projectile.userData.trailParticles = trailParticles;

    // Track para cleanup al forzar ronda
    this.activeSalvoProjectiles.add(projectile);

    console.log(
      `[SalvoAbility] Proyectil salva creado en: (${spawnPos.x.toFixed(2)}, ${spawnPos.y.toFixed(2)}, ${spawnPos.z.toFixed(2)}) dirección: (${forwardDir.x.toFixed(2)}, ${forwardDir.y.toFixed(2)}, ${forwardDir.z.toFixed(2)})`
    );

    // Detectar colisiones con raycast (piercing SIEMPRE activo para la salva)
    this.detectHitsWithRay(spawnPos, forwardDir, this.character.getEffectiveStat('damage'));

    // Animar el proyectil (movimiento lineal visual + trail)
    this.animateProjectile(projectile, forwardDir);
  }

  /**
   * Crea un proyectil de fallback (cono naranja) cuando no hay modelo 3D de flecha.
   */
  private createFallbackProjectile(): THREE.Mesh {
    const geometry = new THREE.ConeGeometry(0.12, 0.5, 8);
    const material = new THREE.MeshStandardMaterial({
      color: 0xff6600,
      emissive: 0xff4400,
      emissiveIntensity: 0.6,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.rotateX(Math.PI / 2);
    return mesh;
  }

  /**
   * Anima el movimiento del proyectil.
   * Usa deltaTime real para ser independiente del framerate.
   * Actualiza las partículas de estela (trail) en cada frame.
   */
  private animateProjectile(projectile: THREE.Object3D, direction: THREE.Vector3): void {
    const speed = 50; // Velocidad aumentada para que el proyectil sea más rápido
    const maxDistance = 40; // Distancia máxima aumentada

    let distanceTraveled = 0;
    const startPosition = projectile.position.clone();
    let lastTime: number | null = null;

    // Referencia a las partículas de estela
    const trailParticles = projectile.userData.trailParticles as THREE.Points | undefined;

    // Función de animación por frame
    const animate = (timestamp: number) => {
      if (!projectile.parent) return; // Si el proyectil fue removido

      // Calcular deltaTime en segundos
      if (lastTime === null) lastTime = timestamp;
      const deltaTime = (timestamp - lastTime) / 1000;
      lastTime = timestamp;

      // Mover proyectil con deltaTime real
      const moveDistance = speed * deltaTime;
      projectile.position.add(direction.clone().multiplyScalar(moveDistance));
      distanceTraveled = startPosition.distanceTo(projectile.position);

      // Actualizar partículas de estela (trail)
      if (trailParticles) {
        const positions = trailParticles.geometry.attributes.position.array as Float32Array;
        // Desplazar todas las posiciones hacia atrás (efecto estela)
        const len = positions.length;
        for (let i = len - 1; i >= 3; i--) {
          positions[i] = positions[i - 3];
        }
        // Primera posición = posición actual del proyectil
        positions[0] = projectile.position.x;
        positions[1] = projectile.position.y;
        positions[2] = projectile.position.z;
        trailParticles.geometry.attributes.position.needsUpdate = true;

        // Reducir opacidad gradualmente con la distancia
        const opacity = Math.max(0, 1 - distanceTraveled / maxDistance);
        (trailParticles.material as THREE.PointsMaterial).opacity = opacity * 0.7;
      }

      // Verificar si ha alcanzado la distancia máxima
      if (distanceTraveled >= maxDistance) {
        this.removeProjectile(projectile);
        return;
      }

      // Continuar animación
      requestAnimationFrame(animate);
    };

    // Iniciar animación
    requestAnimationFrame(animate);
  }

  /**
   * Detecta colisiones con un rayo (disparo instantáneo) y aplica daño.
   * Soporta piercing: si canPierce es true, el rayo continúa atravesando enemigos.
   */
  private detectHitsWithRay(origin: THREE.Vector3, direction: THREE.Vector3, damage: number): void {
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

    console.log(
      `[SalvoAbility] Lanzando raycast desde (${origin.x.toFixed(2)}, ${origin.y.toFixed(2)}, ${origin.z.toFixed(2)}) dirección (${direction.x.toFixed(2)}, ${direction.y.toFixed(2)}, ${direction.z.toFixed(2)})`
    );

    // Salva: TODOS los proyectiles tienen piercing siempre (perforan enemigos)
    const canPierce = true;

    // 1. Recolectar todos los impactos del rayo
    const hits: { id: number; entity: any; toi: number }[] = [];
    // Distancia al muro más cercano (-1 = no hay muro en el camino)
    let wallHitToi = -1;

    world.intersectionsWithRay(
      ray,
      maxRange,
      solid,
      (intersection: RAPIER.RayColliderIntersection) => {
        const collider = intersection.collider;

        // Extraer grupos de colisión
        const groups = collider.collisionGroups();
        const membership = (groups >> 16) & 0xffff; // Extraer bits de membership

        // Si es un muro, registrar la distancia de impacto
        if ((membership & Groups.WALL) !== 0) {
          const intersectionAny = intersection as any;
          const toi =
            intersectionAny.toi ??
            intersectionAny.timeOfImpact ??
            intersectionAny.distance ??
            intersectionAny.t ??
            0;
          // Solo registrar si es el muro más cercano hasta ahora
          if (wallHitToi < 0 || toi < wallHitToi) {
            wallHitToi = toi;
          }
          return true; // Continuar buscando (puede haber enemigos antes del muro)
        }

        // Filtrar por grupo ENEMY
        if ((membership & Groups.ENEMY) === 0) {
          return true; // No es relevante, continuar
        }

        const userData = collider.parent()?.userData as { entity?: any; id?: number } | undefined;

        if (userData?.entity && typeof userData.entity.takeDamage === 'function') {
          const enemyId = userData.id;
          if (enemyId !== undefined) {
            // Extraer distancia (time of impact) del objeto intersection
            // Rapier puede usar 'toi', 'timeOfImpact', 'distance' o 't'
            const intersectionAny = intersection as any;
            const toi =
              intersectionAny.toi ??
              intersectionAny.timeOfImpact ??
              intersectionAny.distance ??
              intersectionAny.t ??
              0;
            console.log(
              '[SalvoAbility] Intersection props:',
              Object.keys(intersectionAny),
              'toi:',
              toi
            );

            hits.push({
              id: enemyId,
              entity: userData.entity,
              toi,
            });
          }
        }

        // Retornar TRUE obligatoriamente para que Rapier siga buscando más objetivos en la línea
        return true;
      }
    );

    console.log(
      `[SalvoAbility] Piercing activo para este disparo: ${canPierce}, hits recolectados: ${hits.length}, wallHitToi: ${wallHitToi}`
    );
    if (hits.length > 0) {
      console.log(`[SalvoAbility] Distancias: ${hits.map(h => h.toi.toFixed(2)).join(', ')}`);
    }

    // 2. ORDENAR MATEMÁTICAMENTE: Del más cercano (menor toi) al más lejano (mayor toi)
    hits.sort((a, b) => a.toi - b.toi);

    // 3. Verificar si el muro está ANTES que cualquier enemigo
    // Si el muro está más cerca que el primer enemigo, el proyectil impacta el muro y no pasa
    if (wallHitToi >= 0 && (hits.length === 0 || wallHitToi < hits[0].toi)) {
      console.log(`[SalvoAbility] Proyectil impactó muro a distancia ${wallHitToi.toFixed(2)}, destruido`);
      return; // El proyectil se destruye contra el muro
    }

    // 4. APLICAR DAÑO Y LÓGICA DE PIERCING
    const enemiesHit = new Set<number>();
    for (const hit of hits) {
      if (!enemiesHit.has(hit.id)) {
        // Verificar si hay un muro entre el origen y este enemigo
        if (wallHitToi >= 0 && wallHitToi < hit.toi) {
          console.log(`[SalvoAbility] Muro bloquea el impacto al enemigo ID: ${hit.id} (muro: ${wallHitToi.toFixed(2)} < enemigo: ${hit.toi.toFixed(2)})`);
          break; // El muro bloquea el proyectil antes de llegar a este enemigo
        }

        // Pasamos this.playerId como attackerId para tracking de kills
        hit.entity.takeDamage(damage, this.playerId);
        enemiesHit.add(hit.id);

        // Acumular daño infligido para estadísticas de fin de partida
        this.character.damageDealt += damage;

        console.log(
          `🎯 Impacto ordenado en enemigo ID: ${hit.id} a distancia: ${(hit.toi ?? 0).toFixed(2)}`
        );

        // Si NO hay piercing, la bala se destruye al golpear al PRIMER enemigo (el más cercano)
        if (!canPierce) {
          break;
        }
        // Si SÍ hay piercing, el 'break' se ignora y el ciclo continúa golpeando al 2do, 3ro, etc.
      }
    }
  }

  /**
   * Verifica si la pasiva de piercing está activa para este jugador.
   * Consulta el estado de PiercePassive y consume el efecto si está activo.
   */
  private checkPiercePassive(): boolean {
    const characterAny = this.character as any;
    if (!characterAny.piercePassive) {
      return false;
    }
    // consumePierce() devuelve true si el próximo proyectil tiene piercing y lo consume
    const hasPierce = characterAny.piercePassive.consumePierce();
    if (hasPierce) {
      console.log(`[SalvoAbility] Proyectil con piercing activado!`);
    }
    return hasPierce;
  }

  /**
   * Remueve un proyectil de la escena.
   * Maneja tanto THREE.Mesh como THREE.Group (modelo 3D flecha).
   * También limpia las partículas de estela asociadas.
   */
  private removeProjectile(projectile: THREE.Object3D): void {
    // Quitar del tracking set
    this.activeSalvoProjectiles.delete(projectile);

    // Limpiar partículas de estela (trail)
    const trailParticles = projectile.userData.trailParticles as THREE.Points | undefined;
    if (trailParticles) {
      if (trailParticles.parent) {
        this.sceneManager.remove(trailParticles);
      }
      try { trailParticles.geometry.dispose(); } catch { /* ignore */ }
      try { (trailParticles.material as THREE.Material).dispose(); } catch { /* ignore */ }
    }

    if (projectile.parent) {
      this.sceneManager.remove(projectile);

      // Si es un Group (modelo 3D flecha), recorrer hijos para disposear recursos
      if (projectile instanceof THREE.Group) {
        projectile.traverse(child => {
          if (child instanceof THREE.Mesh) {
            try { child.geometry.dispose(); } catch { /* ignore */ }
            if (child.material) {
              const materials = Array.isArray(child.material) ? child.material : [child.material];
              materials.forEach((m: THREE.Material) => {
                try { m.dispose(); } catch { /* ignore */ }
              });
            }
          }
        });
      } else if (projectile instanceof THREE.Mesh) {
        // Mesh simple (fallback): disposear directamente
        try { projectile.geometry.dispose(); } catch { /* ignore */ }
        try { (projectile.material as THREE.Material).dispose(); } catch { /* ignore */ }
      }
    }
  }

  /**
   * Retorna la proporción de cooldown completado (0 = listo, 1 = cooldown completo).
   */
  getCooldownRatio(): number {
    if (!this.isOnCooldown) return 0;
    return Math.min(1, Math.max(0, this.cooldownTimer / this.cooldownDuration));
  }

  /**
   * Indica si la habilidad está lista para usarse.
   */
  isReady(): boolean {
    return !this.isOnCooldown && !this.isSalvoActive;
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
      playerId: this.playerId,
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
   * Método para activar la habilidad manualmente (desde el InputManager o AdcCharacter).
   * @param inputState Estado de entrada opcional (mouseNDC para online)
   * @param aimPosition Posición objetivo para auto-aim (modo local, opcional)
   */
  public activate(inputState?: InputState, aimPosition?: THREE.Vector3): void {
    if (this.isOnCooldown) {
      console.log(
        `[SalvoAbility] ${this.playerId} - Habilidad en cooldown (${this.cooldownTimer.toFixed(1)}s restantes)`
      );
      return;
    }
    this.activateSalvo(inputState, aimPosition);
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
   * Limpia todos los proyectiles activos de la salva.
   * Debe llamarse al forzar ronda (F2) o al destruir el personaje.
   * Maneja tanto Mesh como Group, y limpia las partículas de estela.
   */
  public clearAllProjectiles(): void {
    for (const projectile of this.activeSalvoProjectiles) {
      // Limpiar partículas de estela (trail)
      const trailParticles = projectile.userData.trailParticles as THREE.Points | undefined;
      if (trailParticles) {
        if (trailParticles.parent) {
          this.sceneManager.remove(trailParticles);
        }
        try { trailParticles.geometry.dispose(); } catch { /* ignore */ }
        try { (trailParticles.material as THREE.Material).dispose(); } catch { /* ignore */ }
      }

      if (projectile.parent) {
        this.sceneManager.remove(projectile);
      }

      // Disposear recursos según el tipo (Group o Mesh)
      if (projectile instanceof THREE.Group) {
        projectile.traverse(child => {
          if (child instanceof THREE.Mesh) {
            try { child.geometry.dispose(); } catch { /* ignore */ }
            if (child.material) {
              const materials = Array.isArray(child.material) ? child.material : [child.material];
              materials.forEach((m: THREE.Material) => {
                try { m.dispose(); } catch { /* ignore */ }
              });
            }
          }
        });
      } else if (projectile instanceof THREE.Mesh) {
        try { projectile.geometry.dispose(); } catch { /* ignore */ }
        try { (projectile.material as THREE.Material).dispose(); } catch { /* ignore */ }
      }
    }
    this.activeSalvoProjectiles.clear();
  }

  /**
   * Limpia recursos (para cuando el personaje muere o se destruye).
   */
  public dispose(): void {
    // Limpiar listeners usando la referencia almacenada
    (this.eventBus as any).off('player:abilityQ', this._boundHandleAbilityActivation);

    // Limpiar todos los proyectiles pendientes (incluye trail particles)
    this.clearAllProjectiles();
  }
}
