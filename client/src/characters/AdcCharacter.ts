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
 * ADC (Attack Damage Carry) - Personaje de daÃ±o a distancia.
 * Extiende Character y aÃ±ade mecÃ¡nicas de ataque a distancia, proyectiles y habilidades de rango.
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
  /** Tiempo del Ãºltimo disparo */
  private lastShotTime: number = 0;
  /** Pool de proyectiles activos (ahora pueden ser Mesh o Group) */
  private activeProjectiles: THREE.Object3D[] = [];
  /** DirecciÃ³n de movimiento actual (vector 3D) */
  private moveDirection: THREE.Vector3 = new THREE.Vector3();
  /** RotaciÃ³n suave del modelo */
  private rotationLerpAlpha: number = 0.1;
  /** Controlador de animaciones */
  private animationController: AnimationController | null = null;
  /** Mixer de animaciones THREE.js */
  private mixer: THREE.AnimationMixer | null = null;
  /** Acciones de animaciÃ³n */
  private actions: Record<string, THREE.AnimationAction> = {};
  /** AcciÃ³n de animaciÃ³n actual */
  private currentAction: THREE.AnimationAction | null = null;
  /** Nombre de la animaciÃ³n actualmente en reproducciÃ³n */
  private currentAnimationName: string = '';

  /** Flag para evitar spam de warnings de animaciones */
  private hasShownAnimationWarning: boolean = false;

  /** Arma del personaje (arco) */
  private weapon: THREE.Object3D | null = null;

  /** Aljaba en la espalda */
  private quiver: THREE.Object3D | null = null;

  /** Modelo GLTF de flecha para proyectiles */
  private arrowGltf: GLTF | null = null;

  /** Habilidad pasiva PerforaciÃ³n */
  private piercePassive: PiercePassive | null = null;

  /** Habilidad activa Salva */
  private salvoAbility: SalvoAbility | null = null;

  /** Pool de vectores reutilizables para evitar allocaciones en el game loop. */
  private _reusableDir: THREE.Vector3 = new THREE.Vector3();
  private _reusableStep: THREE.Vector3 = new THREE.Vector3();
  private _reusableTarget: THREE.Vector3 = new THREE.Vector3();

  /** Set de efectos de impacto activos para limpieza controlada. */
  private _activeImpactEffects: Set<{ particles: THREE.Points; geometry: THREE.BufferGeometry; material: THREE.Material; }> = new Set();

  /** Pipeline centralizado de daÃ±o */
  private damagePipeline: DamagePipeline | null = null;

  /** Posición objetivo para auto-aim en modo local */
  private autoAimPosition: THREE.Vector3 | null = null;

  // ============================================================
  // SISTEMA DE MUNICIÓN (Arquero)
  // ============================================================
  /** Máximo de flechas que puede llevar */
  maxAmmo: number = 10;
  /** Flechas actuales */
  currentAmmo: number = 10;
  /** Tiempo de recarga en segundos */
  private reloadTime: number = 3.0;
  /** Si está recargando actualmente */
  isReloading: boolean = false;
  /** Temporizador de recarga (se decrementa con dt) */
  private reloadTimer: number = 0;

  /** Sprite indicador circular de recarga sobre la cabeza */
  private reloadIndicator: THREE.Sprite | null = null;

  /** Stats base del ADC segÃºn M4-03 */
  static readonly BASE_STATS: CharacterStats = {
    hp: 80,
    maxHp: 80,
    speed: 5.5,
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

    // Cargar modelo asÃ­ncronamente
    void this.loadModel();
  }

  /**
   * Carga el modelo GLTF del arquero/ranger y lo agrega a la escena.
   * VersiÃ³n con estructura "caja de cartÃ³n" para sincronizaciÃ³n fÃ­sica.
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
          `[AdcCharacter ${this.id}] No se pudo cargar el modelo de flecha, usando fallback cÃ³nico:`,
          arrowError
        );
      }

      // 1. Clonado de esqueleto independiente
      this.innerMesh = SkeletonUtils.clone(modelGltf.scene);

      // 2. ConfiguraciÃ³n de sombras y visibilidad
      this.innerMesh.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
        if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
          child.frustumCulled = false;
        }
      });

      // 3. JerarquÃ­a: Contenedor -> Malla
      this.model = new THREE.Group();
      this.innerMesh.position.set(0, 0, 0);
      this.model.add(this.innerMesh);
      this.sceneManager.add(this.model);

      // 4. CARGAR ARMA REAL (arco KayKit)
      await this.loadWeapon(weaponGltf);

      // 5. CARGAR ALJABA EN LA ESPALDA
      await this.loadQuiver(quiverGltf);

      // 6. InicializaciÃ³n del Mixer
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
   * Reproduce una animaciÃ³n por nombre.
   */
  /** Nombre de la animaciÃ³n actualmente en reproducciÃ³n */

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

    // ConfiguraciÃ³n estricta para ataque
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

    // 4. AÃ±adir contenedor a la escena
    this.sceneManager.add(this.model);

    // Crear AnimationController con animaciones procedurales
    this.animationController = new AnimationController(this.model, []);
    console.log(`[AdcCharacter ${this.id}] AnimationController de fallback creado`);
  }

  /**
   * Obtiene la posiciÃ³n del cuerpo fÃ­sico si existe.
   */
  private getBodyPosition(): THREE.Vector3 | null {
    if (!this.physicsBody || !this.physicsWorld) return null;

    const body = this.physicsWorld.getBody(this.physicsBody);
    if (!body) return null;

    const pos = body.translation();
    return new THREE.Vector3(pos.x, pos.y, pos.z);
  }

  /**
   * Mueve el cuerpo fÃ­sico usando velocidad lineal (setLinvel).
   * SoluciÃ³n definitiva para el problema de movimiento.
   */
  private moveBody(input: InputState): void {
    // Si no hay cuerpo fÃ­sico o el personaje estÃ¡ muerto, no hacer nada
    if (!this.physicsBody || !this.physicsWorld || !this.isAlive()) return;

    const body = this.physicsWorld.getBody(this.physicsBody);
    if (!body) return;

    // 1. Usar moveDir del InputState (ya estÃ¡ normalizado)
    const moveDir = input.moveDir;

    // 2. Convertir Vector2 a Vector3 para movimiento isomÃ©trico
    const direction = this.inputToIsometric(moveDir);

    // 3. Usar la velocidad efectiva del personaje (stats + modificadores)
    const SPEED = this.getEffectiveStat('speed');

    // 4. LA MAGIA: Aplicar Velocidad Lineal o Frenar en Seco
    const currentVel = body.linvel();

    // Si el jugador no estÃ¡ oprimiendo nada (el vector direcciÃ³n es 0)
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
      ); // Â¡ESTE 'TRUE' ES VITAL! Despierta el cuerpo fÃ­sico inmediatamente
    }

    // 5. (Opcional) Rotar el modelo hacia donde estÃ¡ caminando
    if (direction.lengthSq() > 0 && this.model) {
      const targetAngle = Math.atan2(direction.x, direction.z);
      this.model.rotation.y = targetAngle;
    }

    if (import.meta.env.DEV) {
      if (direction.lengthSq() > 0) {
        // Mostrar informaciÃ³n detallada de direcciones
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
   * Convierte input 2D a movimiento 3D isomÃ©trico.
   */
  private inputToIsometric(moveDir: THREE.Vector2): THREE.Vector3 {
    // Crear vector 3D a partir del input 2D
    // NOTA: Invertir Z porque en la vista isomÃ©trica, "arriba" en pantalla
    // corresponde a movimiento en -Z (hacia la cÃ¡mara) o similar
    const inputVector = new THREE.Vector3(moveDir.x, 0, -moveDir.y);

    // DEBUG: Mostrar input original
    if (import.meta.env.DEV && moveDir.lengthSq() > 0) {
      console.log(
        `[AdcCharacter ${this.id}] inputToIsometric: moveDir=(${moveDir.x.toFixed(2)}, ${moveDir.y.toFixed(2)}), inputVector=(${inputVector.x.toFixed(2)}, ${inputVector.y.toFixed(2)}, ${inputVector.z.toFixed(2)})`
      );
    }

    // Rotar 45Â° alrededor del eje Y (perspectiva isomÃ©trica)
    // Volver a usar rotaciÃ³n positiva pero con Z invertido
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
   * VersiÃ³n consolidada "a prueba de balas" con sincronizaciÃ³n directa.
   */
  update(dt: number, inputState?: InputState): void {
    if (!this.physicsBody || !this.physicsWorld || this.state === CharacterState.Dead) {
      // Si estÃ¡ muerto, solo actualizar el mixer si hay animaciÃ³n de muerte reproduciÃ©ndose
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

    // Obtener el cuerpo fÃ­sico real
    const body = this.physicsWorld.getBody(this.physicsBody);
    if (!body) return;

    let isMoving = false;
    const direction = new THREE.Vector3(0, 0, 0);

    if (inputState) {
      // Convertir inputState.moveDir a direcciÃ³n 3D
      if (inputState.moveDir.lengthSq() > 0.01) {
        direction.copy(this.inputToIsometric(inputState.moveDir));
      }

      // Manejar ataque y habilidad
      this.handleAttack(inputState);
      this.handleAbility(inputState);
    }

    // ============================================================
    // AUTO-AIM (modo local): rotar hacia el objetivo y auto-atacar
    // ============================================================
    if (this.autoAimPosition && this.model) {
      const charPos = this.getBodyPosition();
      if (charPos) {
        const toTarget = new THREE.Vector3()
          .subVectors(this.autoAimPosition, charPos);
        toTarget.y = 0;

        if (toTarget.lengthSq() > 0.01) {
          toTarget.normalize();

          // Rotar el modelo hacia el objetivo del auto-aim
          const targetAngle = Math.atan2(toTarget.x, toTarget.z);
          const currentAngle = this.model.rotation.y;
          const angleDiff = targetAngle - currentAngle;
          const normalizedDiff = ((angleDiff + Math.PI) % (2 * Math.PI)) - Math.PI;
          this.model.rotation.y = currentAngle + normalizedDiff * this.rotationLerpAlpha;
        }

        // AUTO-ATTACK: disparar si el enemigo está en rango
        const dist = charPos.distanceTo(this.autoAimPosition);
        const attackRange = this.getEffectiveStat('range');
        if (dist <= attackRange && this.state !== CharacterState.Attacking) {
          this.shootProjectile(inputState);
        }
      }
    }

    // ============================================================
    // SISTEMA DE RECARGA (Arquero)
    // ============================================================
    if (this.currentAmmo <= 0 && !this.isReloading) {
      this.isReloading = true;
      this.reloadTimer = this.reloadTime;
    }

    if (this.isReloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.currentAmmo = this.maxAmmo;
        this.isReloading = false;
        this.reloadTimer = 0;
      }
    }

    // ============================================================
    // INDICADOR VISUAL DE RECARGA (círculo animado sobre la cabeza)
    // ============================================================
    if (this.isReloading && this.model) {
      if (!this.reloadIndicator) {
        this.reloadIndicator = this.createReloadIndicator();
      }
      const progress = 1 - (this.reloadTimer / this.reloadTime);
      this.updateReloadIndicator(progress);
      this.reloadIndicator.position.copy(this.model.position);
      this.reloadIndicator.position.y += 2.8;
      this.reloadIndicator.visible = true;
    } else if (this.reloadIndicator) {
      this.reloadIndicator.visible = false;
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

      // Rotar el CONTENEDOR hacia donde caminamos (solo si NO hay auto-aim)
      if (!this.autoAimPosition && this.model) {
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
   * Sincroniza el modelo visual con la posiciÃ³n fÃ­sica actual.
   * Debe llamarse DESPUÃ‰S de physicsWorld.stepAll() para evitar desfase de 1 frame.
   */
  public syncToPhysics(): void {
    if (!this.model || this.physicsBody === undefined || !this.physicsWorld) return;
    const body = this.physicsWorld.getBody(this.physicsBody);
    if (!body) return;
    const pos = body.translation();

    this.model.position.set(pos.x, pos.y - 0.5, pos.z);
  }

  /**
   * Obtiene la posiciÃ³n actual del personaje en el mundo 3D.
   * @returns Vector3 con la posiciÃ³n, o null si el modelo no estÃ¡ inicializado
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
        // Movimiento sin fÃ­sica (fallback) - mantener compatibilidad
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
   * Sincroniza la posiciÃ³n del modelo 3D con el cuerpo fÃ­sico.
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
   * Actualiza la rotaciÃ³n del modelo suavemente hacia la direcciÃ³n de movimiento.
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
   * Actualiza las animaciones segÃºn el estado del personaje.
   */
  private updateAnimations(dt: number): void {
    if (!this.animationController) return;

    // Convertir CharacterState a string y flags
    const stateStr = this.state === CharacterState.Moving ? 'moving' : 'idle';
    const isAttacking = this.state === CharacterState.Attacking;
    const isDead = this.state === CharacterState.Dead;

    // Log para depuraciÃ³n
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
   * Dispara un proyectil (flecha) en la direcciÃ³n del mouse o del modelo.
   * Consume una flecha del cargador. Si no hay munición, no dispara.
   * @param inputState Estado de entrada opcional que contiene coordenadas del mouse
   */
  private shootProjectile(inputState?: InputState): void {
    if (this.state === CharacterState.Dead) return;

    // Verificar munición
    if (this.currentAmmo <= 0 || this.isReloading) return;

    this.setState(CharacterState.Attacking);
    this.currentAmmo--;
    this.consecutiveShots++;

    // Reproducir animaciÃ³n de ataque
    this.playAnimation('Attack'); // O 'CombatRanged' segÃºn tu mapeo

    // 1. Obtener posiciÃ³n mundial del arma (arco) si existe, sino usar pecho
    const spawnPos = new THREE.Vector3();
    if (this.weapon) {
      this.weapon.getWorldPosition(spawnPos);
      console.log(`[AdcCharacter ${this.id}] Disparando desde arma en posiciÃ³n:`, spawnPos);
    } else if (this.model) {
      this.model.getWorldPosition(spawnPos);
      spawnPos.y += 1.2; // Altura del pecho
      console.log(
        `[AdcCharacter ${this.id}] Disparando desde pecho (no hay arma) en posiciÃ³n:`,
        spawnPos
      );
    } else {
      spawnPos.set(0, 1.2, 0);
    }

    // 2. Calcular direcciÃ³n de disparo
    let forwardDir = new THREE.Vector3(0, 0, -1);

    // AUTO-AIM (modo local): apuntar hacia la posiciÃ³n objetivo del auto-aim
    if (this.autoAimPosition) {
      const charPos = this.getBodyPosition();
      if (charPos) {
        const toTarget = new THREE.Vector3().subVectors(this.autoAimPosition, charPos);
        toTarget.y = 0;
        if (toTarget.lengthSq() > 0.01) {
          forwardDir = toTarget.normalize();
        }
      }
    }
    // Intentar usar mouse targeting si estÃ¡ disponible (modo online)
    else if (inputState?.mouseNDC && this.sceneManager) {
      const camera = this.sceneManager.getCamera();
      if (camera) {
        forwardDir = this.calculateAimDirection(camera, inputState.mouseNDC);
        // Forzar Y=0 para que la flecha vuele horizontal y el sphere-sweep
        // tenga direcciÃ³n puramente horizontal (consistente con detectHitsWithRay)
        forwardDir.y = 0;
        if (forwardDir.lengthSq() > 0.001) {
          forwardDir.normalize();
        }
        console.log(
          `[AdcCharacter] Usando direcciÃ³n de mouse: (${forwardDir.x.toFixed(2)}, ${forwardDir.y.toFixed(2)}, ${forwardDir.z.toFixed(2)})`
        );
      } else {
        console.warn('[AdcCharacter] No hay cÃ¡mara disponible para mouse targeting');
      }
    }

    // Fallback: direcciÃ³n forward del modelo (comportamiento anterior)
    if (forwardDir.lengthSq() < 0.01 && this.model) {
      // Obtener direcciÃ³n mundial (hacia Z positivo por defecto en Three.js)
      const worldDirection = new THREE.Vector3();
      this.model.getWorldDirection(worldDirection);

      // Determinar si debemos invertir basado en la direcciÃ³n de movimiento actual
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
        `[AdcCharacter] Usando direcciÃ³n del modelo: (${forwardDir.x.toFixed(2)}, ${forwardDir.y.toFixed(2)}, ${forwardDir.z.toFixed(2)}), invertir? ${shouldNegate}`
      );
    }

    // 3. Crear proyectil visual (flecha 3D KayKit)
    let arrowGroup: THREE.Group;

    if (this.arrowGltf) {
      // Clonar el modelo GLTF de la flecha (modelo estÃ¡tico, sin skinning)
      try {
        arrowGroup = this.assetLoader.clone(this.arrowGltf);
        arrowGroup.scale.set(1.5, 1.5, 1.5);
        // TeÃ±ir la flecha de verde brillante (equipo aliado) con glow
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

    // PosiciÃ³n y rotaciÃ³n del contenedor
    arrowGroup.position.copy(spawnPos);
    const lookTarget = spawnPos.clone().add(forwardDir);
    arrowGroup.lookAt(lookTarget);

    // Almacenar datos en userData para uso en updateProjectiles
    arrowGroup.userData = {
      direction: forwardDir.clone(),
      spawnPosition: spawnPos.clone(),
      totalDistance: 0,
    };

    this.sceneManager.add(arrowGroup);
    this.activeProjectiles.push(arrowGroup);

    // Notificar a la pasiva de piercing que se ha disparado un proyectil
    if (this.piercePassive) {
      this.piercePassive.notifyProjectileShot();
    }

    // 5. Detectar colisiones con raycast (disparo instantÃ¡neo)
    // Se pasa el arrowGroup para que se destruya visualmente si impacta una pared
    this.detectHitsWithRay(spawnPos, forwardDir, this.getEffectiveStat('damage'), arrowGroup);

    // 6. AnimaciÃ³n visual del proyectil (movimiento lineal) - ahora se maneja en updateProjectiles()
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

    // Volver a Idle despuÃ©s de un tiempo
    setTimeout(() => {
      if (this.state === CharacterState.Attacking) {
        this.setState(CharacterState.Idle);
      }
    }, 300);
  }

  /**
   * Detecta colisiones con un rayo (disparo instantÃ¡neo) y aplica daÃ±o.
   * Soporta piercing: si canPierce es true, el rayo continÃºa atravesando enemigos.
   */
  /**
   * Detecta impactos del proyectil usando mÃºltiples raycasts a diferentes alturas.
   *
   * Debido a la perspectiva isomÃ©trica, cuando el jugador apunta a la parte superior
   * del enemigo en pantalla, el rayo del mouse interseca el suelo DETRÃS del enemigo.
   * Un solo rayo horizontal a y=1.2 puede pasar por encima de la cÃ¡psula del enemigo
   * (que abarca y[0.05, 1.35]). Para resolver esto, lanzamos 3 rayos a diferentes
   * alturas simultÃ¡neamente, asegurando que al menos uno intersecte al enemigo sin
   * importar dÃ³nde apunte el cursor en el cuerpo del enemigo.
   *
   * @param origin PosiciÃ³n de origen del disparo (normalmente a la altura del pecho/arma)
   * @param direction DirecciÃ³n horizontal del disparo (sin componente Y)
   * @param damage Cantidad de daÃ±o base del proyectil
   * @param arrowGroup Grupo visual de la flecha (opcional, para animaciÃ³n de vuelo)
   */
  /**
   * Revamp completo del sistema de detección de impactos.
   *
   * PROBLEMA ORIGINAL:
   * El raycast con `intersectionsWithRay` es intrínsecamente frágil porque un rayo
   * infinitamente delgado puede pasar entre la geometría de la cápsula del enemigo,
   * especialmente cuando:
   *   - La dirección tiene componente Y (mouse online), desviando el rayo verticalmente
   *   - Solo se prueban 3 alturas discretas (0.3, 0.8, 1.3)
   *   - El wall ray (y=-0.75) está en un origen distinto al enemy ray (y=0.8)
   *
   * SOLUCIÓN:
   * Reemplazamos el triple-raycast por overlap de esferas (`intersectionsWithShape`).
   * Las esferas tienen VOLUMEN, garantizando que cualquier enemigo dentro del radio
   * sea detectado sin importar la orientación del disparo.
   *
   * Para auto-aim (local): una sola esfera en la posición exacta del objetivo.
   * Para mouse (online): barrido de esferas a lo largo de la trayectoria.
   *
   * @param origin Posición de origen del disparo (arma/pecho)
   * @param direction Dirección del disparo
   * @param damage Daño base a aplicar
   * @param arrowGroup Grupo visual de la flecha (opcional)
   */
  private detectHitsWithRay(origin: THREE.Vector3, direction: THREE.Vector3, damage: number, arrowGroup?: THREE.Object3D): void {
    if (!this.physicsWorld) {
      console.warn('[AdcCharacter] No hay physicsWorld disponible para detectar colisiones');
      return;
    }

    const world = this.physicsWorld.getWorld();
    if (!world) return;

    // ================================================================
    // Normalizar dirección: FORZAR Y=0 para garantizar que el barrido
    // de esferas se mantenga dentro del rango vertical de la cápsula
    // enemiga (medium: y[-0.5, 1.9], radio 0.55).
    // ================================================================
    const flatDir = direction.clone();
    flatDir.y = 0;
    if (flatDir.lengthSq() < 0.001) return;
    flatDir.normalize();

    const maxRange = this.getEffectiveStat('range');
    const canPierce = this.checkPiercePassive();

    // ================================================================
    // FASE 0: AUTO-AIM (local) — ruta directa y 100% certera
    // Cuando autoAimPosition está definida, SABEMOS exactamente dónde
    // está el enemigo. No necesitamos barrer: solo verificar pared y
    // buscar la entidad enemiga con una esfera en la posición objetivo.
    // ================================================================
    if (this.autoAimPosition) {
      const charPos = this.getBodyPosition();
      if (charPos) {
        const distToTarget = charPos.distanceTo(this.autoAimPosition);

        // Verificar si hay pared bloqueando entre el personaje y el objetivo
        const wallBlocked = this.checkWallBlocking(world, charPos, this.autoAimPosition, maxRange);

        if (!wallBlocked && distToTarget <= maxRange) {
          // Buscar entidad enemiga en la posición del auto-aim
          const enemy = this.findEnemyAtPosition(world, this.autoAimPosition);
          if (enemy) {
            if (this.damagePipeline) {
              this.damagePipeline.applyDamage(this, enemy, damage, {
                position: this.autoAimPosition.clone(),
                source: 'ranged',
                attackerId: this.id,
                canCrit: true,
                critChance: 0.1,
                critMultiplier: 1.5,
              });
            } else {
              enemy.takeDamage(damage, this.id);
            }
            console.log(`[AdcCharacter] Impacto auto-aim 100% en enemigo a distancia ${distToTarget.toFixed(2)}`);
            if (arrowGroup) {
              arrowGroup.userData.hitDistance = distToTarget;
            }
            return;
          } else {
            console.warn('[AdcCharacter] autoAimPosition definida pero no se encontró entidad enemiga en esa posición');
          }
        }
      }
    }

    // ================================================================
    // FASE 1: Detectar paredes a lo largo de la trayectoria
    // Usamos un rayo a la altura del centro de la cápsula enemiga (y=0.8)
    // para verificar si hay paredes/obstáculos bloqueando el paso.
    // Las paredes de arena son cuboides altos (h=3, y[-2, 1]), por lo que
    // un rayo a y=0.8 las detecta sin problema.
    // ================================================================
    let wallHitToi = -1;
    const wallRayOrigin = { x: origin.x, y: 0.8, z: origin.z };
    const wallRayDir = { x: flatDir.x, y: 0, z: flatDir.z };
    const wallRay = new RAPIER.Ray(wallRayOrigin, wallRayDir);

    world.intersectionsWithRay(
      wallRay,
      maxRange,
      false,
      (intersection: RAPIER.RayColliderIntersection) => {
        const collider = intersection.collider;
        const groups = collider.collisionGroups();
        const membership = (groups >> 16) & 0xffff;

        if ((membership & (Groups.WALL | Groups.OBSTACLE)) !== 0) {
          const toi = (intersection as any).toi ?? 0;
          if (wallHitToi < 0 || toi < wallHitToi) {
            wallHitToi = toi;
          }
        }
        return true;
      }
    );

    // Si hay pared antes del rango mínimo, no hay trayectoria útil
    if (wallHitToi >= 0 && wallHitToi < 0.5) {
      console.log(`[AdcCharacter] Pared muy cerca (${wallHitToi.toFixed(2)}), impacto bloqueado`);
      if (arrowGroup) {
        arrowGroup.userData.hitDistance = wallHitToi;
      }
      return;
    }

    // Distancia máxima de búsqueda (limitada por pared si existe)
    const searchDist = (wallHitToi >= 0) ? Math.min(maxRange, wallHitToi) : maxRange;

    // ================================================================
    // FASE 2: Barrido de esferas de overlap para detectar enemigos
    //
    // En lugar de rayos infinitamente delgados, usamos esferas con
    // radio 1.0. La cápsula enemiga (medium) tiene radio 0.55, y
    // cada esfera en el barrido tiene radio 1.0.
    //
    // Con STEP_SIZE = 2.0 y SPHERE_RADIUS = 1.0:
    //   - El espacio entre esferas adyacentes es 2.0 - 2*1.0 = 0.0
    //   - Cualquier enemigo entre dos esferas es detectado porque
    //     la separación (0.0) < radio_enemigo + radio_esfera (1.55)
    //   - Garantía de detección del 100% en toda la trayectoria
    //
    // Posición Y fija en 0.8 (centro de la cápsula enemiga):
    //   - Esfera en y=0.8 con radio 1.0 → spans y[-0.2, 1.8]
    //   - Cápsula enemiga → spans y[-0.5, 1.9]
    //   - Overlap vertical: [-0.2, 1.8] ✅
    // ================================================================
    const SPHERE_RADIUS = 1.0;
    const STEP_SIZE = 2.0;
    const enemyHitMap = new Map<number, { entity: any; dist: number }>();

    const totalSteps = Math.ceil(searchDist / STEP_SIZE);

    for (let step = 0; step <= totalSteps; step++) {
      const d = step * STEP_SIZE;
      if (d > searchDist) break;

      const spherePos = {
        x: origin.x + flatDir.x * d,
        y: 0.8,
        z: origin.z + flatDir.z * d,
      };

      const sphereShape = new RAPIER.Ball(SPHERE_RADIUS);
      const identityRot = { x: 0, y: 0, z: 0, w: 1 };

      world.intersectionsWithShape(
        spherePos,
        identityRot,
        sphereShape,
        (collider: RAPIER.Collider) => {
          const groups = collider.collisionGroups();
          const membership = (groups >> 16) & 0xffff;

          // Solo nos interesan enemigos
          if ((membership & Groups.ENEMY) === 0) return true;

          const userData = collider.parent()?.userData as { entity?: any; id?: number } | undefined;
          if (userData?.entity && typeof userData.entity.takeDamage === 'function') {
            const enemyId = userData.id;
            if (enemyId !== undefined && !enemyHitMap.has(enemyId)) {
              // Calcular distancia horizontal real desde el origen
              const bodyPos = collider.parent()?.translation();
              let enemyDist = d;
              if (bodyPos) {
                enemyDist = Math.sqrt(
                  (bodyPos.x - origin.x) ** 2 +
                  (bodyPos.z - origin.z) ** 2
                );
              }
              enemyHitMap.set(enemyId, { entity: userData.entity, dist: enemyDist });
            }
          }
          return true;
        }
      );

      // Early exit: si ya encontramos enemigos Y hay pared cerca, detener barrido
      if (enemyHitMap.size > 0 && wallHitToi >= 0 && d > wallHitToi) break;
    }

    // ================================================================
    // FASE 3: Procesar resultados y aplicar daño
    // ================================================================
    if (enemyHitMap.size > 0) {
      // Ordenar por distancia (más cercano primero)
      const sortedHits = Array.from(enemyHitMap.values()).sort((a, b) => a.dist - b.dist);

      console.log(
        `[AdcCharacter] Sphere-sweep encontró ${enemyHitMap.size} enemigo(s): ` +
        sortedHits.map(h => `${h.dist.toFixed(2)}u`).join(', ')
      );

      const appliedIds = new Set<number>();
      for (const hit of sortedHits) {
        const hitEntityId = (hit.entity as any).id ?? hit.entity.hashCode?.() ?? -1;
        if (!appliedIds.has(hitEntityId)) {
          appliedIds.add(hitEntityId);

          // Aplicar daño
          if (this.damagePipeline) {
            const hitPos = new THREE.Vector3(
              origin.x + flatDir.x * hit.dist,
              0.8,
              origin.z + flatDir.z * hit.dist
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
            hit.entity.takeDamage(damage, this.id);
          }

          if (arrowGroup) {
            arrowGroup.userData.hitDistance = hit.dist;
          }

          if (!canPierce) break;
        }
      }
    } else {
      console.log('[AdcCharacter] Sphere-sweep: no se encontraron enemigos en la trayectoria');
    }
  }

  /**
   * Verifica si hay una pared/obstáculo entre dos posiciones usando un raycast.
   * @returns true si hay un muro bloqueando entre origin y target
   */
  private checkWallBlocking(
    world: RAPIER.World,
    origin: THREE.Vector3,
    target: THREE.Vector3,
    maxRange: number
  ): boolean {
    const dir = new THREE.Vector3().subVectors(target, origin);
    dir.y = 0;
    if (dir.lengthSq() < 0.001) return false;
    const normDir = dir.normalize();
    const distToTarget = origin.distanceTo(target);

    const rayOrigin = { x: origin.x, y: 0.8, z: origin.z };
    const rayDir = { x: normDir.x, y: 0, z: normDir.z };
    const ray = new RAPIER.Ray(rayOrigin, rayDir);

    let wallToi = -1;
    world.intersectionsWithRay(
      ray,
      Math.min(maxRange, distToTarget),
      false,
      (intersection: RAPIER.RayColliderIntersection) => {
        const collider = intersection.collider;
        const groups = collider.collisionGroups();
        const membership = (groups >> 16) & 0xffff;

        if ((membership & (Groups.WALL | Groups.OBSTACLE)) !== 0) {
          const toi = (intersection as any).toi ?? 0;
          if (wallToi < 0 || toi < wallToi) {
            wallToi = toi;
          }
        }
        return true;
      }
    );

    return wallToi >= 0 && wallToi < distToTarget;
  }

  /**
   * Busca una entidad enemiga en una posición usando una esfera de overlap.
   * @returns La entidad enemiga encontrada, o null si no hay ninguna
   */
  private findEnemyAtPosition(
    world: RAPIER.World,
    position: THREE.Vector3
  ): any | null {
    const searchRadius = 1.5; // Suficiente para abarcar la cápsula enemiga (radio 0.55)
    const sphereShape = new RAPIER.Ball(searchRadius);
    const spherePos = { x: position.x, y: 0.8, z: position.z };
    const identityRot = { x: 0, y: 0, z: 0, w: 1 };

    let found: any = null;

    world.intersectionsWithShape(
      spherePos,
      identityRot,
      sphereShape,
      (collider: RAPIER.Collider) => {
        const groups = collider.collisionGroups();
        const membership = (groups >> 16) & 0xffff;

        if ((membership & Groups.ENEMY) === 0) return true;

        const userData = collider.parent()?.userData as { entity?: any } | undefined;
        if (userData?.entity && typeof userData.entity.takeDamage === 'function') {
          found = userData.entity;
          return false; // Detener búsqueda
        }
        return true;
      }
    );

    return found;
  }

  /**
   * Calcula la direcciÃ³n de disparo basada en la posiciÃ³n del mouse usando raycasting.
   * Intersecta un rayo desde la cÃ¡mara a travÃ©s de las coordenadas NDC del mouse con un plano en Y=0.6 (centro de masa del enemigo).
   * La direcciÃ³n resultante barre naturalmente hacia abajo desde el pecho (yâ‰ˆ1.2) hasta el centro del enemigo (yâ‰ˆ0.6),
   * asegurando que el rayo intersecte la cÃ¡psula del enemigo sin importar a quÃ© parte del cuerpo apunte el mouse.
   * @param camera CÃ¡mara desde la cual se lanza el rayo
   * @param mouseNDC Coordenadas normalizadas del mouse en rango [-1, 1]
   * @returns DirecciÃ³n normalizada hacia el punto de intersecciÃ³n, o fallback a direcciÃ³n forward del modelo
   */
  private calculateAimDirection(camera: THREE.Camera, mouseNDC: THREE.Vector2): THREE.Vector3 {
    // ðŸ”¥ FORZAR LA ACTUALIZACIÃ“N DE LA CÃMARA ðŸ”¥
    camera.updateMatrixWorld();

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouseNDC, camera);

    // ðŸ”¥ CAMBIO CLAVE: Intersectamos el centro de masa (Y = 0.6) en vez del suelo ðŸ”¥
    // La cÃ¡psula del enemigo (medium) abarca y[0.05, 1.35] con centro en y=0.7.
    // Al intersectar y=0.6 (ligeramente debajo del centro), el rayo apunta directamente
    // al cuerpo del enemigo. El spawn estÃ¡ en yâ‰ˆ1.2 (pecho), creando un barrido descendente
    // que garantiza intersecciÃ³n sin importar dÃ³nde apunte el mouse en la vertical.
    const bodyPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.6);
    const targetPos = new THREE.Vector3();

    if (raycaster.ray.intersectPlane(bodyPlane, targetPos)) {
      // targetPos.y = 0.6 por la definiciÃ³n del plano

      const spawnPos = new THREE.Vector3();
      if (this.model) {
        this.model.getWorldPosition(spawnPos);
        spawnPos.y = 1.2;
      } else {
        spawnPos.set(0, 1.2, 0);
      }

      const direction = new THREE.Vector3().subVectors(targetPos, spawnPos);
      // NO forzar direction.y = 0 â€” el barrido descendente (yâ‰ˆ1.2 â†’ yâ‰ˆ0.6)
      // garantiza que el rayo pase a travÃ©s de la cÃ¡psula del enemigo.

      if (direction.lengthSq() > 0.0001) {
        return direction.normalize();
      }
    }

    // ðŸ”¥ 2. LA SOLUCIÃ“N AL CORTE (Mouse apuntando al horizonte/cielo) ðŸ”¥
    // Si el rayo no choca con el plano, usamos la direcciÃ³n de la cÃ¡mara proyectada en 2D
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
   * Verifica si la pasiva de piercing estÃ¡ activa para este jugador.
   * Consulta el estado de PiercePassive y consume el efecto si estÃ¡ activo.
   */
  private checkPiercePassive(): boolean {
    if (!this.piercePassive) {
      return false;
    }
    // consumePierce() devuelve true si el prÃ³ximo proyectil tiene piercing y lo consume
    const hasPierce = this.piercePassive.consumePierce();
    if (hasPierce) {
      console.log(`[AdcCharacter] Proyectil con piercing activado!`);
    }
    return hasPierce;
  }

  // NOTA: animateProjectile() eliminado. El movimiento de proyectiles se maneja
  // exclusivamente en updateProjectiles() (game-loop based) para evitar fugas de
  // memoria por RAF no cancelado y duplicaciÃ³n de lÃ³gica.

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
   * Limpia todos los proyectiles activos del ADC y los efectos de impacto pendientes.
   * Se invoca entre rondas para liberar recursos GPU y evitar fugas de memoria.
   */
  clearActiveProjectiles(): void {
    const projectiles = [...this.activeProjectiles];
    for (const projectile of projectiles) {
      if (projectile.parent) {
        this.sceneManager.remove(projectile);
        if (projectile instanceof THREE.Group && projectile.children.length > 0) {
          projectile.children.forEach(child => {
            if (child instanceof THREE.Mesh) {
              try { child.geometry.dispose(); } catch {}
              if (Array.isArray(child.material)) {
                child.material.forEach(m => { try { m.dispose(); } catch {} });
              } else {
                try { (child.material as THREE.Material).dispose(); } catch {}
              }
            }
          });
        } else if (projectile instanceof THREE.Mesh) {
          try { projectile.geometry.dispose(); } catch {}
          try { (projectile.material as THREE.Material).dispose(); } catch {}
        }
      }
    }
    this.activeProjectiles = [];

    // TambiÃ©n limpiar efectos de impacto pendientes (impact particles)
    this.clearImpactEffects();
  }

  /**
   * Actualiza la posiciÃ³n de todos los proyectiles activos.
   * OPTIMIZADO: usa vectores reutilizables (_reusableDir, _reusableTarget, _reusableStep)
   * para evitar allocaciones temporales en cada frame (zero-GC en hot path).
   */
  private updateProjectiles(dt: number): void {
    const speed = 50;
    const maxDistance = 40;

    for (let i = this.activeProjectiles.length - 1; i >= 0; i--) {
      const projectile = this.activeProjectiles[i];
      const ud = projectile.userData;

      // Obtener direcciÃ³n (usando _reusableDir en vez de .clone())
      let direction: THREE.Vector3;
      if (ud?.direction && ud.direction instanceof THREE.Vector3) {
        this._reusableDir.copy(ud.direction);
        direction = this._reusableDir;
      } else {
        this._reusableTarget.set(0, 0, -1);
        direction = this._reusableTarget;
        projectile.getWorldDirection(direction);
      }
      direction.y = 0;
      if (direction.lengthSq() > 0.0001) {
        direction.normalize();
      } else {
        direction.set(0, 0, -1);
      }

      // Avanzar la flecha desde su spawnPosition segÃºn la distancia total recorrida
      const step = speed * dt;
      ud.totalDistance = (ud.totalDistance || 0) + step;

      // Posicionar la flecha en spawnPosition + direction * totalDistance
      const spawnPos = ud.spawnPosition;
      if (spawnPos) {
        projectile.position.copy(spawnPos);
        projectile.position.add(this._reusableTarget.copy(direction).multiplyScalar(ud.totalDistance));
      } else {
        projectile.position.add(direction.multiplyScalar(step));
      }

      // Verificar si la flecha ha alcanzado su destino (hitDistance o maxDistance)
      const targetDistance = ud.hitDistance ?? maxDistance;
      if (ud.totalDistance >= targetDistance) {
        if (spawnPos) {
          projectile.position.copy(spawnPos);
          projectile.position.add(this._reusableTarget.copy(direction).multiplyScalar(targetDistance));
        }

        // Efecto de impacto visual con vector reutilizable
        this.spawnImpactEffect(this._reusableStep.copy(projectile.position));

        this.removeProjectile(projectile);
      }
    }
  }

  /**
   * Crea un pequeÃ±o efecto de partÃ­culas en la posiciÃ³n de impacto del proyectil.
   * Los efectos se trackean en _activeImpactEffects para limpieza controlada
   * (evita fugas de GPU resources si el juego se reinicia antes de que terminen).
   */
  private spawnImpactEffect(position: THREE.Vector3): void {
    const count = 8;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    for (let j = 0; j < count; j++) {
      const idx = j * 3;
      positions[idx] = (Math.random() - 0.5) * 0.5;
      positions[idx + 1] = (Math.random() - 0.5) * 0.5;
      positions[idx + 2] = (Math.random() - 0.5) * 0.5;
      colors[idx] = 0.0;
      colors[idx + 1] = 1.0;
      colors[idx + 2] = 0.3;
      sizes[j] = 0.1 + Math.random() * 0.15;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
      size: 0.15,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const particles = new THREE.Points(geometry, material);
    particles.position.copy(position);
    this.sceneManager.add(particles);

    // Trackear el efecto para limpieza controlada
    const effect = { particles, geometry, material };
    this._activeImpactEffects.add(effect);

    // Animar desvanecimiento y destrucciÃ³n
    const startTime = performance.now();
    const duration = 300;

    const fadeParticles = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      material.opacity = 1 - t;
      particles.scale.setScalar(1 + t * 0.5);

      if (t < 1) {
        requestAnimationFrame(fadeParticles);
      } else {
        // Remover del tracking antes de liberar recursos
        this._activeImpactEffects.delete(effect);
        material.dispose();
        geometry.dispose();
        this.sceneManager.remove(particles);
      }
    };
    requestAnimationFrame(fadeParticles);
  }

  /**
   * Limpia todos los efectos de impacto activos pendientes, liberando recursos GPU.
   * Se invoca desde resetMatchStats() para evitar fugas al reiniciar partida.
   */
  private clearImpactEffects(): void {
    for (const effect of this._activeImpactEffects) {
      try { effect.material.dispose(); } catch {}
      try { effect.geometry.dispose(); } catch {}
      try { this.sceneManager.remove(effect.particles); } catch {}
    }
    this._activeImpactEffects.clear();
  }

  /**
   * Habilidad Q: Lluvia de flechas.
   * Activa la habilidad de salva si estÃ¡ disponible.
   * @param inputState Estado de entrada que contiene coordenadas del mouse
   */
  private abilityQ(inputState?: InputState): void {
    if (!this.salvoAbility) return;

    // En modo local con auto-aim, pasar la posición objetivo
    // En modo online, pasar inputState con mouseNDC
    this.salvoAbility.activate(inputState, this.autoAimPosition || undefined);
  }

  /**
   * Establece la posiciÃ³n objetivo para auto-aim en modo local.
   * Cuando se establece, el personaje apunta y dispara automÃ¡ticamente
   * hacia esa posiciÃ³n sin necesidad de un segundo mouse.
   * @param position PosiciÃ³n objetivo o null para desactivar auto-aim
   */
  setAutoAimTarget(position: THREE.Vector3 | null): void {
    this.autoAimPosition = position;
  }

  /**
   * Verifica si el personaje estÃ¡ vivo.
   */
  isAlive(): boolean {
    return this.state !== CharacterState.Dead;
  }

  /**
   * Contador de kills para estadÃ­sticas de fin de partida.
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
   * Reinicia las estadÃ­sticas de la partida (para "Jugar de nuevo").
   */
  resetMatchStats(): void {
    super.resetMatchStats();
    this.killCount = 0;
    this.currentAmmo = this.maxAmmo;
    this.isReloading = false;
    this.reloadTimer = 0;

    // Limpiar proyectiles activos y sus recursos GPU
    this.clearActiveProjectiles();
    // Limpiar efectos de impacto pendientes
    this.clearImpactEffects();
  }

  /**
   * Expone la habilidad de salva para el HUD.
   */
  getSalvoAbility(): SalvoAbility | null {
    return this.salvoAbility;
  }

  // ============================================================
  // GETTERS PÃBLICOS — Munición (para HUD)
  // ============================================================

  /** Flechas actuales en el cargador */
  getCurrentAmmo(): number {
    return this.currentAmmo;
  }

  /** Capacidad máxima de flechas */
  getMaxAmmo(): number {
    return this.maxAmmo;
  }

  /** Tiempo restante de recarga en segundos */
  getReloadTimer(): number {
    return this.reloadTimer;
  }

  /** Si está recargando actualmente */
  isReloadingNow(): boolean {
    return this.isReloading;
  }

  /** Tiempo total de recarga en segundos */
  getReloadTime(): number {
    return this.reloadTime;
  }

  /** Aumenta la capacidad máxima de flechas (ítem de tienda) */
  addMaxAmmo(amount: number): void {
    this.maxAmmo += amount;
    this.currentAmmo += amount;
  }

  /** Reduce el tiempo de recarga (ítem de tienda), mínimo 0.5s */
  reduceReloadTime(amount: number): void {
    this.reloadTime = Math.max(0.5, this.reloadTime - amount);
  }

  // ============================================================
  // INDICADOR DE RECARGA — Sprite Canvas circular
  // ============================================================

  /**
   * Crea un sprite con Canvas para el círculo de progreso de recarga.
   * Se posiciona sobre la cabeza del personaje mediante update().
   */
  private createReloadIndicator(): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(1.2, 1.2, 1);
    this.sceneManager.add(sprite);
    return sprite;
  }

  /**
   * Actualiza el Canvas del sprite para reflejar el progreso de recarga.
   * @param progress Valor entre 0.0 (inicio) y 1.0 (completo).
   */
  private updateReloadIndicator(progress: number): void {
    if (!this.reloadIndicator) return;
    const material = this.reloadIndicator.material as THREE.SpriteMaterial;
    if (!material.map) return;
    const canvas = material.map.image as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;    // 64
    const h = canvas.height;   // 64
    const cx = w / 2;           // 32
    const cy = h / 2;           // 32
    const radius = 24;

    ctx.clearRect(0, 0, w, h);

    // Fondo: círculo oscuro semi-transparente
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20, 20, 20, 0.7)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(100, 100, 100, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Arco de progreso (relleno tipo "pie" desde arriba, sentido horario)
    if (progress > 0) {
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + Math.PI * 2 * Math.min(progress, 1);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = '#FFD700'; // dorado
      ctx.fill();
    }

    // Borde exterior del círculo
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();

    material.map.needsUpdate = true;
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

    // Limpiar indicador de recarga
    if (this.reloadIndicator) {
      this.sceneManager.remove(this.reloadIndicator);
      (this.reloadIndicator.material as THREE.SpriteMaterial).dispose();
      this.reloadIndicator = null;
    }
  }

  /**
   * Establece el pipeline centralizado de daÃ±o.
   * Todas las fuentes de daÃ±o (proyectiles, rayos) usarÃ¡n este pipeline.
   */
  setDamagePipeline(pipeline: DamagePipeline): void {
    this.damagePipeline = pipeline;
  }

  /**
   * Crea un cuerpo fÃ­sico para este personaje usando BodyFactory.
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
      // NOTA: Ya no usamos syncToThree. La sincronizaciÃ³n se hace directamente en update()
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
          // Buscar huesos de la mano (puede variar segÃºn el modelo)
          if (
            child.name.toLowerCase().includes('hand') &&
            (child.name.toLowerCase().includes('right') || child.name.toLowerCase().includes('r_'))
          ) {
            handBone = child;
          }
        }
      });

      // Si no encontramos un hueso especÃ­fico, buscar cualquier hueso de mano
      if (!handBone) {
        this.innerMesh!.traverse((child: any) => {
          if (child.isBone && child.name.toLowerCase().includes('hand')) {
            handBone = child;
          }
        });
      }

      // Si encontramos un hueso de mano, adjuntar el arma
      if (handBone) {
        // Ajustar posiciÃ³n y rotaciÃ³n del arma relativa a la mano
        weaponModel.position.set(0.1, 0, 0.1);
        weaponModel.rotation.set(0, Math.PI, 0);
        weaponModel.scale.set(0.8, 0.8, 0.8);

        // AÃ±adir el arma como hijo del hueso de la mano
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
          `[AdcCharacter ${this.id}] Arma asignada al modelo general (no se encontrÃ³ hueso de mano)`
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
   * Usa assetLoader.clone() para clonar correctamente el modelo estÃ¡tico (sin skeleton).
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
        // Fallback: posiciÃ³n fija en la espalda, relativa al modelo
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
   * Crea un arma simple programÃ¡ticamente (fallback cuando no se puede cargar el GLTF)
   */
  private createSimpleWeapon(): void {
    try {
      // Crear un arco curvo usando un torus segmentado (medio anillo)
      const bowRadius = 0.8;
      const tubeRadius = 0.03;
      const bowGeometry = new THREE.TorusGeometry(bowRadius, tubeRadius, 8, 24, Math.PI); // Media circunferencia (180 grados)

      // Cuerda del arco (lÃ­nea recta entre los extremos del arco)
      const stringGeometry = new THREE.CylinderGeometry(0.01, 0.01, bowRadius * 2, 6);

      // EmpuÃ±adura (cilindro corto en el centro)
      const gripGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.2, 8);

      // Materiales
      const bowMaterial = new THREE.MeshStandardMaterial({
        color: 0x8b4513, // MarrÃ³n madera
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
        color: 0x4e342e, // MarrÃ³n oscuro
        metalness: 0.2,
        roughness: 0.8,
      });

      // Crear mallas
      const bow = new THREE.Mesh(bowGeometry, bowMaterial);
      const string = new THREE.Mesh(stringGeometry, stringMaterial);
      const grip = new THREE.Mesh(gripGeometry, gripMaterial);

      // Posicionar y rotar las partes para formar un arco vertical
      // El torus por defecto estÃ¡ en el plano XY, lo rotamos para que estÃ© vertical
      bow.rotation.x = Math.PI / 2; // Rotar 90 grados para que el anillo quede vertical
      bow.rotation.z = Math.PI / 2; // Rotar para que la apertura quede hacia el jugador
      bow.position.set(0, 0, 0);

      // Cuerda: lÃ­nea recta entre los extremos del arco (en el plano YZ)
      string.position.set(0, 0, 0);
      string.rotation.x = Math.PI / 2; // Horizontal
      string.rotation.z = Math.PI / 2; // Alineada con la apertura del arco

      // EmpuÃ±adura: en el centro del arco, ligeramente desplazada
      grip.position.set(0, 0, -0.1);
      grip.rotation.x = Math.PI / 2;

      // Crear un grupo para el arma
      const weaponGroup = new THREE.Group();
      weaponGroup.add(bow);
      weaponGroup.add(string);
      weaponGroup.add(grip);

      // Escala general del arma (mÃ¡s grande)
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
        // Ajustar posiciÃ³n y orientaciÃ³n para que se sostenga naturalmente
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
   * Establece el cuerpo fÃ­sico (mÃ©todo pÃºblico de Character).
   */
  setPhysicsBody(body: RigidBodyHandle): void {
    this.physicsBody = body;
  }
}
