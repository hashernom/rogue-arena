import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Character, type CharacterStats, CharacterState, ModifierType } from './Character';
import type { InputState } from '../engine/InputManager';
import type { PhysicsWorld, RigidBodyHandle } from '../physics/PhysicsWorld';
import { EventBus } from '../engine/EventBus';
import { AssetLoader } from '../engine/AssetLoader';
import { SceneManager } from '../engine/SceneManager';
import { BodyFactory } from '../physics/BodyFactory';
import { AnimationController } from './AnimationController';
import { PiercePassive } from './abilities/PiercePassive';
import { SalvoAbility } from './abilities/SalvoAbility';
import RAPIER from '@dimforge/rapier3d-compat';
import { Groups } from '../physics/CollisionGroups';
import { DamagePipeline } from '../combat/DamagePipeline';

/**
 * ADC (Attack Damage Carry) - Personaje de daño a distancia.
 * Extiende Character y añade mecánicas de ataque a distancia, proyectiles y habilidades de rango.
 */
export class AdcCharacter extends Character {
  /** Modelo 3D del arquero/ranger (contenedor padre) */
  private model: THREE.Group | null = null;
  /** Malla interna para animaciones */
  private innerMesh: THREE.Object3D | null = null;
  /** Referencia al SceneManager para agregar/remover el modelo */
  private sceneManager: SceneManager;
  /** AssetLoader para cargar el modelo */
  private assetLoader: AssetLoader;
  /** Contador de flechas consecutivas (para pasiva de velocidad de ataque) */
  private consecutiveShots: number = 0;
  /** Tiempo del último disparo */
  private lastShotTime: number = 0;
  /** Pool de proyectiles activos (ahora pueden ser Mesh o Group) */
  private activeProjectiles: THREE.Object3D[] = [];
  /** Dirección de movimiento actual (vector 3D) */
  private moveDirection: THREE.Vector3 = new THREE.Vector3();
  /** Rotación suave del modelo */
  private rotationLerpAlpha: number = 0.1;
  /** Controlador de animaciones */
  private animationController: AnimationController | null = null;
  /** Mixer de animaciones THREE.js */
  private mixer: THREE.AnimationMixer | null = null;
  /** Acciones de animación */
  private actions: Record<string, THREE.AnimationAction> = {};
  /** Acción de animación actual */
  private currentAction: THREE.AnimationAction | null = null;
  /** Nombre de la animación actualmente en reproducción */
  private currentAnimationName: string = '';

  /** Flag para evitar spam de warnings de animaciones */
  private hasShownAnimationWarning: boolean = false;

  /** Arma del personaje (arco) */
  private weapon: THREE.Object3D | null = null;

  /** Aljaba en la espalda */
  private quiver: THREE.Object3D | null = null;

  /** Modelo GLTF de flecha para proyectiles */
  private arrowGltf: GLTF | null = null;

  /** Habilidad pasiva Perforación */
  private piercePassive: PiercePassive | null = null;

  /** Habilidad activa Salva */
  private salvoAbility: SalvoAbility | null = null;

  /** Pipeline centralizado de daño */
  private damagePipeline: DamagePipeline | null = null;

  /** Stats base del ADC según M4-03 */
  static readonly BASE_STATS: CharacterStats = {
    hp: 80,
    maxHp: 80,
    speed: 5,
    damage: 15,
    attackSpeed: 2,
    range: 8,
    armor: 2,
  };

  constructor(
    id: string,
    eventBus: EventBus,
    sceneManager: SceneManager,
    assetLoader: AssetLoader,
    physicsWorld?: PhysicsWorld,
    physicsBody?: RigidBodyHandle
  ) {
    super(id, AdcCharacter.BASE_STATS, eventBus, physicsWorld, physicsBody);
    this.sceneManager = sceneManager;
    this.assetLoader = assetLoader;

    // Inicializar habilidades
    this.piercePassive = new PiercePassive(eventBus, id);
    this.salvoAbility = new SalvoAbility(eventBus, this, id, sceneManager);

    // Cargar modelo asíncronamente
    void this.loadModel();
  }

  /**
   * Carga el modelo GLTF del arquero/ranger y lo agrega a la escena.
   * Versión con estructura "caja de cartón" para sincronización física.
   */
  private async loadModel(): Promise<void> {
    try {
      const assets = await Promise.all([
        this.assetLoader.load('/models/Rogue_Hooded.glb'),
        this.assetLoader.load('/models/Rig_Medium_MovementBasic.glb'),
        this.assetLoader.load('/models/Rig_Medium_CombatRanged.glb'),
        this.assetLoader.load('/models/Rig_Medium_General.glb'),
        this.assetLoader.load('/models/weapons/bow.gltf'),
        this.assetLoader.load('/models/weapons/quiver.gltf'),
      ]);
      const modelGltf = assets[0] as GLTF;
      const movementGltf = assets[1] as GLTF;
      const combatGltf = assets[2] as GLTF;
      const generalGltf = assets[3] as GLTF;
      const weaponGltf = assets[4] as GLTF;
      const quiverGltf = assets[5] as GLTF;

      // Cargar flecha por separado para que no bloquee el modelo principal si falla
      try {
        const arrowGltf = await this.assetLoader.load('/models/weapons/arrow_bow.gltf');
        this.arrowGltf = arrowGltf as GLTF;
      } catch (arrowError) {
        console.warn(
          `[AdcCharacter ${this.id}] No se pudo cargar el modelo de flecha, usando fallback cónico:`,
          arrowError
        );
      }

      // 1. Clonado de esqueleto independiente
      this.innerMesh = SkeletonUtils.clone(modelGltf.scene);

      // 2. Configuración de sombras y visibilidad
      this.innerMesh.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
        if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
          child.frustumCulled = false;
        }
      });

      // 3. Jerarquía: Contenedor -> Malla
      this.model = new THREE.Group();
      this.innerMesh.position.set(0, 0, 0);
      this.model.add(this.innerMesh);
      this.sceneManager.add(this.model);

      // 4. CARGAR ARMA REAL (arco KayKit)
      await this.loadWeapon(weaponGltf);

      // 5. CARGAR ALJABA EN LA ESPALDA
      await this.loadQuiver(quiverGltf);

      // 6. Inicialización del Mixer
      this.mixer = new THREE.AnimationMixer(this.innerMesh);

      // 5. Mapeo Inteligente
      const allClips = [
        ...modelGltf.animations,
        ...movementGltf.animations,
        ...combatGltf.animations,
        ...generalGltf.animations,
      ];
      allClips.forEach(clip => {
        const action = this.mixer!.clipAction(clip);
        this.actions[clip.name] = action;

        const name = clip.name.toLowerCase();
        if (name.includes('idle')) this.actions['Idle'] = action;
        if (name.includes('run') || name.includes('walk')) this.actions['Run'] = action;
        if (name.includes('shoot') || name.includes('attack') || name.includes('ranged'))
          this.actions['Attack'] = action;
        if (name.includes('death') || name.includes('die')) this.actions['Death'] = action;
      });

      if (!this.actions['Idle'] && allClips.length > 0) {
        this.actions['Idle'] = this.mixer!.clipAction(allClips[0]);
      }

      this.playAnimation('Idle');
    } catch (error) {
      console.error('Error cargando ADC:', error);
      this.createFallbackModel();
    }
  }

  /**
   * Reproduce una animación por nombre.
   */
  /** Nombre de la animación actualmente en reproducción */

  private playAnimation(name: string): void {
    // Si no hay acciones cargadas, simplemente retornar sin error
    if (Object.keys(this.actions).length === 0) {
      // Solo mostrar warning una vez para evitar spam en consola
      if (!this.hasShownAnimationWarning) {
        console.warn(
          `[AdcCharacter ${this.id}] No hay animaciones cargadas. Saltando playAnimation('${name}')`
        );
        this.hasShownAnimationWarning = true;
      }
      return;
    }

    if (!this.mixer) return;
    if (name === this.currentAnimationName) return;

    const action = this.actions[name];
    if (!action) return;

    if (this.currentAction) {
      this.currentAction.fadeOut(0.2);
    }

    action.reset().fadeIn(0.2).play();
    this.currentAction = action;
    this.currentAnimationName = name;

    // Configuración estricta para ataque
    if (name.toLowerCase().includes('attack') || name.toLowerCase().includes('shoot')) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true; // El modelo se queda en el frame final del impacto
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
    }
  }

  /**
   * Crea un modelo de fallback (cubo con color distintivo) si el GLTF no carga.
   * Mantiene la misma estructura de contenedor y malla interna.
   */
  private createFallbackModel(): void {
    const geometry = new THREE.CylinderGeometry(0.5, 0.5, 2, 8);
    const material = new THREE.MeshStandardMaterial({ color: 0x228b22 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `ADC_Fallback_Inner_${this.id}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // 1. La malla interna es el cilindro
    this.innerMesh = mesh;

    // 2. Crear contenedor Group
    this.model = new THREE.Group();
    this.model.name = `ADC_Fallback_Container_${this.id}`;

    // 3. Meter el cilindro dentro del contenedor
    this.model.add(this.innerMesh);

    // 4. Añadir contenedor a la escena
    this.sceneManager.add(this.model);

    // Crear AnimationController con animaciones procedurales
    this.animationController = new AnimationController(this.model, []);
    console.log(`[AdcCharacter ${this.id}] AnimationController de fallback creado`);
  }

  /**
   * Obtiene la posición del cuerpo físico si existe.
   */
  private getBodyPosition(): THREE.Vector3 | null {
    if (!this.physicsBody || !this.physicsWorld) return null;

    const body = this.physicsWorld.getBody(this.physicsBody);
    if (!body) return null;

    const pos = body.translation();
    return new THREE.Vector3(pos.x, pos.y, pos.z);
  }

  /**
   * Mueve el cuerpo físico usando velocidad lineal (setLinvel).
   * Solución definitiva para el problema de movimiento.
   */
  private moveBody(input: InputState): void {
    // Si no hay cuerpo físico o el personaje está muerto, no hacer nada
    if (!this.physicsBody || !this.physicsWorld || !this.isAlive()) return;

    const body = this.physicsWorld.getBody(this.physicsBody);
    if (!body) return;

    // 1. Usar moveDir del InputState (ya está normalizado)
    const moveDir = input.moveDir;

    // 2. Convertir Vector2 a Vector3 para movimiento isométrico
    const direction = this.inputToIsometric(moveDir);

    // 3. Definir la velocidad (ajusta este número a tu gusto)
    const SPEED = 8.0;

    // 4. LA MAGIA: Aplicar Velocidad Lineal o Frenar en Seco
    const currentVel = body.linvel();

    // Si el jugador no está oprimiendo nada (el vector dirección es 0)
    if (direction.lengthSq() === 0) {
      // FRENAR EN SECO (manteniendo la gravedad en Y)
      body.setLinvel({ x: 0, y: currentVel.y, z: 0 }, true);
    } else {
      // APLICAR VELOCIDAD
      body.setLinvel(
        {
          x: direction.x * SPEED,
          y: currentVel.y, // Respetar la gravedad original en el eje Y
          z: direction.z * SPEED,
        },
        true
      ); // ¡ESTE 'TRUE' ES VITAL! Despierta el cuerpo físico inmediatamente
    }

    // 5. (Opcional) Rotar el modelo hacia donde está caminando
    if (direction.lengthSq() > 0 && this.model) {
      const targetAngle = Math.atan2(direction.x, direction.z);
      this.model.rotation.y = targetAngle;
    }

    if (import.meta.env.DEV) {
      if (direction.lengthSq() > 0) {
        // Mostrar información detallada de direcciones
        const keyPressed = [];
        if (moveDir.y > 0) keyPressed.push('W (up)');
        if (moveDir.y < 0) keyPressed.push('S (down)');
        if (moveDir.x > 0) keyPressed.push('D (right)');
        if (moveDir.x < 0) keyPressed.push('A (left)');

        console.log(
          `[AdcCharacter ${this.id}] moveBody: keys=[${keyPressed.join(', ') || 'none'}], moveDir=(${moveDir.x.toFixed(2)}, ${moveDir.y.toFixed(2)}), dir3D=(${direction.x.toFixed(2)}, ${direction.y.toFixed(2)}, ${direction.z.toFixed(2)}), vel=(${(direction.x * SPEED).toFixed(2)}, ${(direction.z * SPEED).toFixed(2)})`
        );
      } else {
        console.log(
          `[AdcCharacter ${this.id}] moveBody: FRENANDO, vel=(0, ${currentVel.y.toFixed(2)}, 0)`
        );
      }
    }
  }

  /**
   * Convierte input 2D a movimiento 3D isométrico.
   */
  private inputToIsometric(moveDir: THREE.Vector2): THREE.Vector3 {
    // Crear vector 3D a partir del input 2D
    // NOTA: Invertir Z porque en la vista isométrica, "arriba" en pantalla
    // corresponde a movimiento en -Z (hacia la cámara) o similar
    const inputVector = new THREE.Vector3(moveDir.x, 0, -moveDir.y);

    // DEBUG: Mostrar input original
    if (import.meta.env.DEV && moveDir.lengthSq() > 0) {
      console.log(
        `[AdcCharacter ${this.id}] inputToIsometric: moveDir=(${moveDir.x.toFixed(2)}, ${moveDir.y.toFixed(2)}), inputVector=(${inputVector.x.toFixed(2)}, ${inputVector.y.toFixed(2)}, ${inputVector.z.toFixed(2)})`
      );
    }

    // Rotar 45° alrededor del eje Y (perspectiva isométrica)
    // Volver a usar rotación positiva pero con Z invertido
    const isoMatrix = new THREE.Matrix4().makeRotationY(Math.PI / 4);
    inputVector.applyMatrix4(isoMatrix);

    // DEBUG: Mostrar resultado
    if (import.meta.env.DEV && moveDir.lengthSq() > 0) {
      console.log(
        `[AdcCharacter ${this.id}] inputToIsometric: result=(${inputVector.x.toFixed(2)}, ${inputVector.y.toFixed(2)}, ${inputVector.z.toFixed(2)})`
      );
    }

    return inputVector.normalize();
  }

  /**
   * Actualiza el movimiento del personaje basado en input y tiempo delta.
   * Versión consolidada "a prueba de balas" con sincronización directa.
   */
  update(dt: number, inputState?: InputState): void {
    if (!this.physicsBody || !this.physicsWorld || this.state === CharacterState.Dead) {
      // Si está muerto, solo actualizar el mixer si hay animación de muerte reproduciéndose
      if (this.state === CharacterState.Dead && this.mixer) {
        this.mixer.update(dt);
      }
      return;
    }

    // Actualizar mixer de animaciones THREE.js
    if (this.mixer) this.mixer.update(dt);

    // Actualizar habilidades
    if (this.salvoAbility) {
      this.salvoAbility.update(dt);
    }

    // Actualizar proyectiles
    this.updateProjectiles(dt);

    // Obtener el cuerpo físico real
    const body = this.physicsWorld.getBody(this.physicsBody);
    if (!body) return;

    let isMoving = false;
    const direction = new THREE.Vector3(0, 0, 0);

    if (inputState) {
      // Convertir inputState.moveDir a dirección 3D
      if (inputState.moveDir.lengthSq() > 0.01) {
        direction.copy(this.inputToIsometric(inputState.moveDir));
      }

      // Manejar ataque y habilidad
      this.handleAttack(inputState);
      this.handleAbility(inputState);
    }

    const currentVel = body.linvel();

    if (direction.lengthSq() > 0) {
      direction.normalize();
      const SPEED = this.getEffectiveStat('speed');

      body.setLinvel(
        {
          x: direction.x * SPEED,
          y: currentVel.y,
          z: direction.z * SPEED,
        },
        true
      );

      // Rotar el CONTENEDOR hacia donde caminamos
      if (this.model) {
        this.model.rotation.y = Math.atan2(direction.x, direction.z);
      }

      this.playAnimation('Run');
      isMoving = true;
    } else {
      // FRENO
      if (Math.abs(currentVel.x) > 0.1 || Math.abs(currentVel.z) > 0.1) {
        body.setLinvel({ x: 0, y: currentVel.y, z: 0 }, true);
      }
      this.playAnimation('Idle');
    }
  }

  /**
   * Sincroniza el modelo visual con la posición física actual.
   * Debe llamarse DESPUÉS de physicsWorld.stepAll() para evitar desfase de 1 frame.
   */
  public syncToPhysics(): void {
    if (!this.model || this.physicsBody === undefined || !this.physicsWorld) return;
    const body = this.physicsWorld.getBody(this.physicsBody);
    if (!body) return;
    const pos = body.translation();

    this.model.position.set(pos.x, pos.y - 0.5, pos.z);
  }

  /**
   * Obtiene la posición actual del personaje en el mundo 3D.
   * @returns Vector3 con la posición, o null si el modelo no está inicializado
   */
  getPosition(): THREE.Vector3 | null {
    if (!this.model) return null;
    return this.model.position.clone();
  }

  /**
   * Maneja el movimiento basado en input.
   */
  private handleMovement(dt: number, inputState: InputState): void {
    if (inputState.moveDir.lengthSq() > 0.01) {
      this.moveDirection = this.inputToIsometric(inputState.moveDir);

      if (this.physicsBody && this.physicsWorld) {
        this.moveBody(inputState);
      } else {
        // Movimiento sin física (fallback) - mantener compatibilidad
        const speed = this.getEffectiveStat('speed');
        const displacement = this.moveDirection.clone().multiplyScalar(speed * dt);
        if (this.model) {
          this.model.position.add(displacement);
        }
      }

      this.setState(CharacterState.Moving);
    } else {
      this.setState(CharacterState.Idle);
      this.moveDirection.set(0, 0, 0);
    }
  }

  /**
   * Maneja el ataque a distancia.
   */
  private handleAttack(inputState: InputState): void {
    if (inputState.attacking && this.state !== CharacterState.Attacking) {
      this.shootProjectile(inputState);
    }
  }

  /**
   * Maneja la habilidad Q (lluvia de flechas).
   */
  private handleAbility(inputState: InputState): void {
    if (inputState.abilityQ) {
      this.abilityQ(inputState);
    }
  }

  /**
   * Sincroniza la posición del modelo 3D con el cuerpo físico.
   */
  private syncModelWithPhysics(): void {
    if (this.model && this.physicsBody && this.physicsWorld) {
      const position = this.getBodyPosition();
      if (position) {
        this.model.position.copy(position);
        if (import.meta.env.DEV && this.state === CharacterState.Moving) {
          console.log(
            `[AdcCharacter ${this.id}] syncModelWithPhysics: pos=(${position.x.toFixed(2)}, ${position.z.toFixed(2)})`
          );
        }
      }
    }
  }

  /**
   * Actualiza la rotación del modelo suavemente hacia la dirección de movimiento.
   */
  private updateModelRotation(_dt: number): void {
    if (!this.model || this.moveDirection.lengthSq() < 0.01) return;

    const targetAngle = Math.atan2(this.moveDirection.x, this.moveDirection.z);
    const currentAngle = this.model.rotation.y;
    const angleDiff = targetAngle - currentAngle;
    const normalizedDiff = ((angleDiff + Math.PI) % (2 * Math.PI)) - Math.PI;
    const newAngle = currentAngle + normalizedDiff * this.rotationLerpAlpha;

    this.model.rotation.y = newAngle;
  }

  /**
   * Actualiza las animaciones según el estado del personaje.
   */
  private updateAnimations(dt: number): void {
    if (!this.animationController) return;

    // Convertir CharacterState a string y flags
    const stateStr = this.state === CharacterState.Moving ? 'moving' : 'idle';
    const isAttacking = this.state === CharacterState.Attacking;
    const isDead = this.state === CharacterState.Dead;

    // Log para depuración
    if (import.meta.env.DEV && this.state !== CharacterState.Idle) {
      console.log(
        `[AdcCharacter ${this.id}] Estado: ${this.state}, isAttacking: ${isAttacking}, isDead: ${isDead}`
      );
    }

    // Sincronizar estado del personaje con animaciones
    this.animationController.syncWithCharacterState(stateStr, isAttacking, isDead);

    // Actualizar mixer del AnimationController
    this.animationController.update(dt);
  }

  /**
   * Dispara un proyectil (flecha) en la dirección del mouse o del modelo.
   * @param inputState Estado de entrada opcional que contiene coordenadas del mouse
   */
  private shootProjectile(inputState?: InputState): void {
    if (this.state === CharacterState.Dead) return;

    this.setState(CharacterState.Attacking);
    this.consecutiveShots++;

    // Reproducir animación de ataque
    this.playAnimation('Attack'); // O 'CombatRanged' según tu mapeo

    // 1. Obtener posición mundial del arma (arco) si existe, sino usar pecho
    const spawnPos = new THREE.Vector3();
    if (this.weapon) {
      this.weapon.getWorldPosition(spawnPos);
      console.log(`[AdcCharacter ${this.id}] Disparando desde arma en posición:`, spawnPos);
    } else if (this.model) {
      this.model.getWorldPosition(spawnPos);
      spawnPos.y += 1.2; // Altura del pecho
      console.log(
        `[AdcCharacter ${this.id}] Disparando desde pecho (no hay arma) en posición:`,
        spawnPos
      );
    } else {
      spawnPos.set(0, 1.2, 0);
    }

    // 2. Calcular dirección de disparo: priorizar mouse targeting si hay inputState con mouseNDC
    let forwardDir = new THREE.Vector3(0, 0, -1);

    // Intentar usar mouse targeting si está disponible
    if (inputState?.mouseNDC && this.sceneManager) {
      const camera = this.sceneManager.getCamera();
      if (camera) {
        forwardDir = this.calculateAimDirection(camera, inputState.mouseNDC);
        console.log(
          `[AdcCharacter] Usando dirección de mouse: (${forwardDir.x.toFixed(2)}, ${forwardDir.y.toFixed(2)}, ${forwardDir.z.toFixed(2)})`
        );
      } else {
        console.warn('[AdcCharacter] No hay cámara disponible para mouse targeting');
      }
    }

    // Fallback: dirección forward del modelo (comportamiento anterior)
    if (forwardDir.lengthSq() < 0.01 && this.model) {
      // Obtener dirección mundial (hacia Z positivo por defecto en Three.js)
      const worldDirection = new THREE.Vector3();
      this.model.getWorldDirection(worldDirection);

      // Determinar si debemos invertir basado en la dirección de movimiento actual
      let shouldNegate = false;
      if (this.moveDirection && this.moveDirection.lengthSq() > 0.01) {
        const moveDir = this.moveDirection.clone().normalize();
        const dotWithWorld = moveDir.dot(worldDirection);
        const dotWithNegated = moveDir.dot(worldDirection.clone().negate());
        shouldNegate = dotWithNegated > dotWithWorld;
      }

      forwardDir = worldDirection.clone();
      if (shouldNegate) {
        forwardDir.negate();
      }

      console.log(
        `[AdcCharacter] Usando dirección del modelo: (${forwardDir.x.toFixed(2)}, ${forwardDir.y.toFixed(2)}, ${forwardDir.z.toFixed(2)}), invertir? ${shouldNegate}`
      );
    }

    // 3. Offset para que el proyectil no choque con el propio personaje
    const spawnOffset = 1.0;
    spawnPos.add(forwardDir.clone().multiplyScalar(spawnOffset));

    // 4. Crear proyectil visual (flecha 3D KayKit)
    let arrowGroup: THREE.Group;

    if (this.arrowGltf) {
      // Clonar el modelo GLTF de la flecha (modelo estático, sin skinning)
      try {
        arrowGroup = this.assetLoader.clone(this.arrowGltf);
        arrowGroup.scale.set(1.5, 1.5, 1.5);
        // Teñir la flecha de verde brillante (equipo aliado) con glow
        arrowGroup.traverse(child => {
          if (child instanceof THREE.Mesh && child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach(mat => {
              mat.color.setHex(0x00ff00);
              mat.emissive = new THREE.Color(0x00ff00);
              mat.emissiveIntensity = 0.6;
              mat.needsUpdate = true;
            });
          }
        });
      } catch (cloneError) {
        console.warn(
          `[AdcCharacter ${this.id}] Error clonando flecha, usando fallback:`,
          cloneError
        );
        arrowGroup = this.assetLoader.createFallback();
      }
    } else {
      // Fallback: cono amarillo
      arrowGroup = this.assetLoader.createFallback();
    }

    // Posición y rotación del contenedor
    arrowGroup.position.copy(spawnPos);
    const lookTarget = spawnPos.clone().add(forwardDir);
    arrowGroup.lookAt(lookTarget);

    // Almacenar dirección en userData para uso en updateProjectiles
    arrowGroup.userData = { direction: forwardDir.clone() };

    this.sceneManager.add(arrowGroup);
    this.activeProjectiles.push(arrowGroup);

    // Notificar a la pasiva de piercing que se ha disparado un proyectil
    if (this.piercePassive) {
      this.piercePassive.notifyProjectileShot();
    }

    // 5. Detectar colisiones con raycast (disparo instantáneo)
    this.detectHitsWithRay(spawnPos, forwardDir, this.getEffectiveStat('damage'));

    // 6. Animación visual del proyectil (movimiento lineal) - ahora se maneja en updateProjectiles()
    // this.animateProjectile(arrowGroup, forwardDir);

    // Escuchar cuando el AnimationMixer termine el clip de ataque
    const onFinished = (e: THREE.Event) => {
      const action = (e as any).action as THREE.AnimationAction;
      if (
        action?.getClip().name.toLowerCase().includes('shoot') ||
        action?.getClip().name.toLowerCase().includes('attack')
      ) {
        this.setState(CharacterState.Idle);
        this.mixer?.removeEventListener('finished', onFinished);
      }
    };
    this.mixer?.addEventListener('finished', onFinished);

    // Aplicar pasiva: cada 3 disparos consecutivos aumenta velocidad de ataque temporal
    if (this.consecutiveShots >= 3) {
      this.applyModifier(
        'attackSpeed',
        0.3,
        ModifierType.Multiplicative,
        'adc_passive',
        'Pasiva: +30% velocidad de ataque'
      );
      setTimeout(() => {
        this.removeModifier('adc_passive');
      }, 3000);
      this.consecutiveShots = 0;
    }

    // Volver a Idle después de un tiempo
    setTimeout(() => {
      if (this.state === CharacterState.Attacking) {
        this.setState(CharacterState.Idle);
      }
    }, 300);
  }

  /**
   * Detecta colisiones con un rayo (disparo instantáneo) y aplica daño.
   * Soporta piercing: si canPierce es true, el rayo continúa atravesando enemigos.
   */
  private detectHitsWithRay(origin: THREE.Vector3, direction: THREE.Vector3, damage: number): void {
    if (!this.physicsWorld) {
      console.warn('[AdcCharacter] No hay physicsWorld disponible para detectar colisiones');
      return;
    }

    const world = this.physicsWorld.getWorld();
    if (!world) return;

    const rayDir = { x: direction.x, y: direction.y, z: direction.z };
    const rayOrigin = { x: origin.x, y: origin.y, z: origin.z };
    const ray = new RAPIER.Ray(rayOrigin, rayDir);

    const maxRange = 25.0; // Alcance del ADC
    const solid = false; // Permite detectar el interior de las hitboxes

    console.log(
      `[AdcCharacter] Lanzando raycast desde (${origin.x.toFixed(2)}, ${origin.y.toFixed(2)}, ${origin.z.toFixed(2)}) dirección (${direction.x.toFixed(2)}, ${direction.y.toFixed(2)}, ${direction.z.toFixed(2)})`
    );

    // Determinar si este proyectil tiene piercing (consultar pasiva)
    const canPierce = this.checkPiercePassive();

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
            const intersectionAny = intersection as any;
            const toi =
              intersectionAny.toi ??
              intersectionAny.timeOfImpact ??
              intersectionAny.distance ??
              intersectionAny.t ??
              0;
            console.log(
              '[AdcCharacter] Intersection props:',
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

        return true;
      }
    );

    console.log(
      `[AdcCharacter] Piercing activo para este disparo: ${canPierce}, hits recolectados: ${hits.length}, wallHitToi: ${wallHitToi}`
    );
    if (hits.length > 0) {
      console.log(`[AdcCharacter] Distancias: ${hits.map(h => h.toi.toFixed(2)).join(', ')}`);
    }

    // 2. ORDENAR MATEMÁTICAMENTE: Del más cercano (menor toi) al más lejano (mayor toi)
    hits.sort((a, b) => a.toi - b.toi);

    // 3. Verificar si el muro está ANTES que cualquier enemigo
    // Si el muro está más cerca que el primer enemigo, el proyectil impacta el muro y no pasa
    if (wallHitToi >= 0 && (hits.length === 0 || wallHitToi < hits[0].toi)) {
      console.log(`[AdcCharacter] Proyectil impactó muro a distancia ${wallHitToi.toFixed(2)}, destruido`);
      return; // El proyectil se destruye contra el muro
    }

    // 4. APLICAR DAÑO Y LÓGICA DE PIERCING (usando DamagePipeline)
    const enemiesHit = new Set<number>();
    for (const hit of hits) {
      if (!enemiesHit.has(hit.id)) {
        // Verificar si hay un muro entre el origen y este enemigo
        if (wallHitToi >= 0 && wallHitToi < hit.toi) {
          console.log(`[AdcCharacter] Muro bloquea el impacto al enemigo ID: ${hit.id} (muro: ${wallHitToi.toFixed(2)} < enemigo: ${hit.toi.toFixed(2)})`);
          break; // El muro bloquea el proyectil antes de llegar a este enemigo
        }

        // Usar el pipeline centralizado si está disponible
        if (this.damagePipeline) {
          const hitPos = new THREE.Vector3(
            origin.x + direction.x * hit.toi,
            origin.y + direction.y * hit.toi,
            origin.z + direction.z * hit.toi
          );
          this.damagePipeline.applyDamage(this, hit.entity, damage, {
            position: hitPos,
            source: 'ranged',
            attackerId: this.id,
            canCrit: true,
            critChance: 0.1,
            critMultiplier: 1.5,
          });
        } else {
          // Fallback: aplicar daño directamente (sin pipeline)
          hit.entity.takeDamage(damage);
        }
        enemiesHit.add(hit.id);
        console.log(
          `🎯 Impacto ordenado en enemigo ID: ${hit.id} a distancia: ${(hit.toi ?? 0).toFixed(2)}`
        );

        // Si NO hay piercing, la bala se destruye al golpear al PRIMER enemigo (el más cercano)
        if (!canPierce) {
          break;
        }
      }
    }
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

      const spawnPos = new THREE.Vector3();
      if (this.model) {
        this.model.getWorldPosition(spawnPos);
        spawnPos.y = 1.2;
      } else {
        spawnPos.set(0, 1.2, 0);
      }

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
    const fallback = new THREE.Vector3(0, 0, -1);
    if (this.model) {
      this.model.getWorldDirection(fallback);
      fallback.y = 0;
      if (fallback.lengthSq() > 0.0001) {
        fallback.normalize();
      }
    }
    return fallback;
  }

  /**
   * Verifica si la pasiva de piercing está activa para este jugador.
   * Consulta el estado de PiercePassive y consume el efecto si está activo.
   */
  private checkPiercePassive(): boolean {
    if (!this.piercePassive) {
      return false;
    }
    // consumePierce() devuelve true si el próximo proyectil tiene piercing y lo consume
    const hasPierce = this.piercePassive.consumePierce();
    if (hasPierce) {
      console.log(`[AdcCharacter] Proyectil con piercing activado!`);
    }
    return hasPierce;
  }

  /**
   * Anima el movimiento visual del proyectil.
   */
  private animateProjectile(projectile: THREE.Object3D, direction: THREE.Vector3): void {
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
  private removeProjectile(projectile: THREE.Object3D): void {
    if (projectile.parent) {
      this.sceneManager.remove(projectile);

      // Si es un Group, buscar y eliminar la malla interna
      if (projectile instanceof THREE.Group && projectile.children.length > 0) {
        const mesh = projectile.children[0];
        if (mesh instanceof THREE.Mesh) {
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
        }
      } else if (projectile instanceof THREE.Mesh) {
        // Para compatibilidad con proyectiles antiguos (Mesh)
        projectile.geometry.dispose();
        (projectile.material as THREE.Material).dispose();
      }

      // Eliminar de la lista de proyectiles activos
      const index = this.activeProjectiles.indexOf(projectile);
      if (index !== -1) {
        this.activeProjectiles.splice(index, 1);
      }
    }
  }

  /**
   * Actualiza la posición de todos los proyectiles activos.
   */
  private updateProjectiles(dt: number): void {
    const speed = 50; // Velocidad aumentada para que el proyectil sea más rápido
    const maxDistance = 40; // Distancia máxima aumentada

    for (let i = this.activeProjectiles.length - 1; i >= 0; i--) {
      const projectile = this.activeProjectiles[i];
      // Usar dirección almacenada en userData o calcular a partir de la orientación
      let direction = projectile.userData?.direction;
      if (direction && direction instanceof THREE.Vector3) {
        direction = direction.clone(); // Clonar para no modificar el original
        direction.y = 0;
        if (direction.lengthSq() > 0.0001) {
          direction.normalize();
        } else {
          direction.set(0, 0, -1);
        }
      } else {
        direction = new THREE.Vector3();
        projectile.getWorldDirection(direction);
        direction.y = 0;
        if (direction.lengthSq() > 0.0001) {
          direction.normalize();
        } else {
          direction.set(0, 0, -1);
        }
      }
      console.log(
        `[AdcCharacter] updateProjectiles: direction (${direction.x.toFixed(2)}, ${direction.y.toFixed(2)}, ${direction.z.toFixed(2)})`
      );
      projectile.position.add(direction.multiplyScalar(speed * dt));

      // Verificar colisión (placeholder)
      const distance = projectile.position.distanceTo(this.model?.position || new THREE.Vector3());
      if (distance > maxDistance) {
        this.sceneManager.remove(projectile);
        this.activeProjectiles.splice(i, 1);
      }
    }
  }

  /**
   * Habilidad Q: Lluvia de flechas.
   * Activa la habilidad de salva si está disponible.
   * @param inputState Estado de entrada que contiene coordenadas del mouse
   */
  private abilityQ(inputState?: InputState): void {
    if (!this.salvoAbility) return;

    // Activar la habilidad de salva pasando el inputState para mouse targeting
    this.salvoAbility.activate(inputState);
  }

  /**
   * Verifica si el personaje está vivo.
   */
  isAlive(): boolean {
    return this.state !== CharacterState.Dead;
  }

  /**
   * Contador de kills para estadísticas de fin de partida.
   */
  private killCount: number = 0;

  /**
   * Incrementa el contador de kills.
   */
  incrementKillCount(): void {
    this.killCount++;
  }

  /**
   * Obtiene el contador de kills actual.
   */
  getKillCount(): number {
    return this.killCount;
  }

  /**
   * Reinicia las estadísticas de la partida (para "Jugar de nuevo").
   */
  resetMatchStats(): void {
    super.resetMatchStats();
    this.killCount = 0;
  }

  /**
   * Expone la habilidad de salva para el HUD.
   */
  getSalvoAbility(): SalvoAbility | null {
    return this.salvoAbility;
  }

  /**
   * Limpia recursos cuando el personaje muere.
   */
  die(): void {
    super.die();

    // Remover modelo de la escena y limpiar referencias
    if (this.model) {
      this.sceneManager.remove(this.model);
      this.model = null;
    }
    if (this.innerMesh) {
      this.innerMesh = null;
    }
    // Detener el mixer de animaciones
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    // Limpiar aljaba
    if (this.quiver) {
      this.quiver = null;
    }
    // Remover proyectiles
    this.activeProjectiles.forEach(proj => this.sceneManager.remove(proj));
    this.activeProjectiles = [];
  }

  /**
   * Establece el pipeline centralizado de daño.
   * Todas las fuentes de daño (proyectiles, rayos) usarán este pipeline.
   */
  setDamagePipeline(pipeline: DamagePipeline): void {
    this.damagePipeline = pipeline;
  }

  /**
   * Crea un cuerpo físico para este personaje usando BodyFactory.
   */
  createPhysicsBody(position: THREE.Vector3): void {
    if (!this.physicsWorld) {
      console.warn('Cannot create physics body: no physics world');
      return;
    }

    const body = BodyFactory.createCharacterBody(this.physicsWorld, position, true, this);
    this.setPhysicsBody(body);

    if (this.model) {
      this.model.position.copy(position);
      // NOTA: Ya no usamos syncToThree. La sincronización se hace directamente en update()
    }
  }

  /**
   * Carga y asigna un arma al personaje
   * @param weaponGltf - Modelo GLTF del arma
   */
  private async loadWeapon(weaponGltf: GLTF): Promise<void> {
    try {
      // Clonar el modelo del arma
      const weaponModel = SkeletonUtils.clone(weaponGltf.scene);

      // Buscar el hueso de la mano derecha en el esqueleto del personaje
      let handBone: any = null;
      this.innerMesh!.traverse((child: any) => {
        if (child.isBone) {
          // Buscar huesos de la mano (puede variar según el modelo)
          if (
            child.name.toLowerCase().includes('hand') &&
            (child.name.toLowerCase().includes('right') || child.name.toLowerCase().includes('r_'))
          ) {
            handBone = child;
          }
        }
      });

      // Si no encontramos un hueso específico, buscar cualquier hueso de mano
      if (!handBone) {
        this.innerMesh!.traverse((child: any) => {
          if (child.isBone && child.name.toLowerCase().includes('hand')) {
            handBone = child;
          }
        });
      }

      // Si encontramos un hueso de mano, adjuntar el arma
      if (handBone) {
        // Ajustar posición y rotación del arma relativa a la mano
        weaponModel.position.set(0.1, 0, 0.1);
        weaponModel.rotation.set(0, Math.PI, 0);
        weaponModel.scale.set(0.8, 0.8, 0.8);

        // Añadir el arma como hijo del hueso de la mano
        handBone.add(weaponModel);
        this.weapon = weaponModel;

        console.log(`[AdcCharacter ${this.id}] Arma asignada a la mano: ${handBone.name}`);
      } else {
        // Si no encontramos hueso, adjuntar al modelo general
        weaponModel.position.set(0.5, 1, 0);
        weaponModel.rotation.set(0, Math.PI, 0);
        weaponModel.scale.set(0.8, 0.8, 0.8);
        this.innerMesh!.add(weaponModel);
        this.weapon = weaponModel;
        console.log(
          `[AdcCharacter ${this.id}] Arma asignada al modelo general (no se encontró hueso de mano)`
        );
      }

      // Configurar sombras y propiedades del arma
      weaponModel.traverse((child: any) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          console.log(`[AdcCharacter ${this.id}] Mesh del arma: ${child.name}`);
        }
      });

      console.log(`[AdcCharacter ${this.id}] Arma cargada y asignada exitosamente`);
    } catch (error) {
      console.error(`[AdcCharacter ${this.id}] Error cargando el arma:`, error);
    }
  }

  /**
   * Carga y adjunta la aljaba en la espalda del personaje.
   * Usa assetLoader.clone() para clonar correctamente el modelo estático (sin skeleton).
   */
  private async loadQuiver(quiverGltf: GLTF): Promise<void> {
    try {
      const quiverModel = this.assetLoader.clone(quiverGltf);

      // Buscar hueso de la columna/spine en el esqueleto
      let spineBone: any = null;
      this.innerMesh!.traverse((child: any) => {
        if (child.isBone) {
          const name = child.name.toLowerCase();
          if (
            name.includes('spine') ||
            name.includes('chest') ||
            name.includes('upper') ||
            name.includes('hips')
          ) {
            spineBone = child;
          }
        }
      });

      quiverModel.scale.set(1.3, 1.3, 1.3);

      if (spineBone) {
        // Adjuntar al hueso de la columna (sigue las animaciones del torso)
        quiverModel.position.set(0, 0.15, -0.35);
        quiverModel.rotation.set(0, Math.PI, 0);
        spineBone.add(quiverModel);
      } else {
        // Fallback: posición fija en la espalda, relativa al modelo
        quiverModel.position.set(0, 0.9, -0.5);
        quiverModel.rotation.set(0, Math.PI, 0);
        this.model!.add(quiverModel);
      }

      // Configurar sombras
      quiverModel.traverse((child: any) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      this.quiver = quiverModel;
    } catch (error) {
      console.error(`[AdcCharacter ${this.id}] Error cargando la aljaba:`, error);
    }
  }

  /**
   * Crea un arma simple programáticamente (fallback cuando no se puede cargar el GLTF)
   */
  private createSimpleWeapon(): void {
    try {
      // Crear un arco curvo usando un torus segmentado (medio anillo)
      const bowRadius = 0.8;
      const tubeRadius = 0.03;
      const bowGeometry = new THREE.TorusGeometry(bowRadius, tubeRadius, 8, 24, Math.PI); // Media circunferencia (180 grados)

      // Cuerda del arco (línea recta entre los extremos del arco)
      const stringGeometry = new THREE.CylinderGeometry(0.01, 0.01, bowRadius * 2, 6);

      // Empuñadura (cilindro corto en el centro)
      const gripGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.2, 8);

      // Materiales
      const bowMaterial = new THREE.MeshStandardMaterial({
        color: 0x8b4513, // Marrón madera
        metalness: 0.1,
        roughness: 0.9,
      });
      const stringMaterial = new THREE.MeshStandardMaterial({
        color: 0xf5f5f5, // Blanco hueso
        metalness: 0.0,
        roughness: 0.5,
        emissive: 0x111111,
      });
      const gripMaterial = new THREE.MeshStandardMaterial({
        color: 0x4e342e, // Marrón oscuro
        metalness: 0.2,
        roughness: 0.8,
      });

      // Crear mallas
      const bow = new THREE.Mesh(bowGeometry, bowMaterial);
      const string = new THREE.Mesh(stringGeometry, stringMaterial);
      const grip = new THREE.Mesh(gripGeometry, gripMaterial);

      // Posicionar y rotar las partes para formar un arco vertical
      // El torus por defecto está en el plano XY, lo rotamos para que esté vertical
      bow.rotation.x = Math.PI / 2; // Rotar 90 grados para que el anillo quede vertical
      bow.rotation.z = Math.PI / 2; // Rotar para que la apertura quede hacia el jugador
      bow.position.set(0, 0, 0);

      // Cuerda: línea recta entre los extremos del arco (en el plano YZ)
      string.position.set(0, 0, 0);
      string.rotation.x = Math.PI / 2; // Horizontal
      string.rotation.z = Math.PI / 2; // Alineada con la apertura del arco

      // Empuñadura: en el centro del arco, ligeramente desplazada
      grip.position.set(0, 0, -0.1);
      grip.rotation.x = Math.PI / 2;

      // Crear un grupo para el arma
      const weaponGroup = new THREE.Group();
      weaponGroup.add(bow);
      weaponGroup.add(string);
      weaponGroup.add(grip);

      // Escala general del arma (más grande)
      weaponGroup.scale.set(0.4, 0.4, 0.4);

      // Buscar hueso de la mano derecha (o cualquier mano)
      let handBone: any = null;
      this.innerMesh!.traverse((child: any) => {
        if (child.isBone) {
          const name = child.name.toLowerCase();
          if (name.includes('hand') || name.includes('wrist')) {
            handBone = child;
          }
        }
      });

      if (handBone) {
        // Ajustar posición y orientación para que se sostenga naturalmente
        weaponGroup.position.set(0.15, 0.05, 0.1);
        weaponGroup.rotation.set(-Math.PI / 6, Math.PI / 4, Math.PI / 12);

        handBone.add(weaponGroup);
        this.weapon = weaponGroup;
        console.log(`[AdcCharacter ${this.id}] Arco curvo creado y asignado a la mano`);
      } else {
        // Adjuntar al modelo general como fallback
        weaponGroup.position.set(0.5, 1.2, 0.3);
        this.innerMesh!.add(weaponGroup);
        this.weapon = weaponGroup;
        console.log(`[AdcCharacter ${this.id}] Arco curvo creado (sin hueso de mano)`);
      }

      // Configurar sombras para todas las partes
      [bow, string, grip].forEach(part => {
        part.castShadow = true;
        part.receiveShadow = true;
      });
    } catch (error) {
      console.error(`[AdcCharacter ${this.id}] Error creando arma simple:`, error);
    }
  }

  /**
   * Obtiene el modelo 3D (para debugging).
   */
  getModel(): THREE.Group | null {
    return this.model;
  }

  /**
   * Establece el cuerpo físico (método público de Character).
   */
  setPhysicsBody(body: RigidBodyHandle): void {
    this.physicsBody = body;
  }
}
