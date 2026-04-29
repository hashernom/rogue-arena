import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import { Character, type CharacterStats, CharacterState } from './Character';
import type { InputState } from '../engine/InputManager';
import type { PhysicsWorld, RigidBodyHandle } from '../physics/PhysicsWorld';
import { EventBus } from '../engine/EventBus';
import { AssetLoader } from '../engine/AssetLoader';
import { SceneManager } from '../engine/SceneManager';
import { BodyFactory } from '../physics/BodyFactory';
import { AnimationController } from './AnimationController';
import { FuryPassive } from './abilities/FuryPassive';
import { ChargeAbility } from './abilities/ChargeAbility';
import { Enemy } from '../enemies/Enemy';
import { MeleeAttack } from '../combat/MeleeAttack';
import { DamagePipeline } from '../combat/DamagePipeline';

/**
 * Caballero melee, primer personaje jugable.
 * Extiende Character y añade movimiento isométrico, modelo 3D y habilidades especiales.
 */
export class MeleeCharacter extends Character {
  /** Modelo 3D del caballero (contenedor padre) */
  private model: THREE.Group | null = null;
  /** Malla interna para animaciones */
  private innerMesh: THREE.Object3D | null = null;
  /** Referencia al SceneManager para agregar/remover el modelo */
  private sceneManager: SceneManager;
  /** AssetLoader para cargar el modelo */
  private assetLoader: AssetLoader;
  /** Contador de kills para la pasiva Furia */
  private killCount: number = 0;
  /** Flag que indica si la furia está lista (3 kills) */
  private furyReady: boolean = false;
  /** Tiempo acumulado para rotación suave */
  private rotationLerpAlpha: number = 0.1;
  /** Dirección de movimiento actual (vector 3D) */
  private moveDirection: THREE.Vector3 = new THREE.Vector3();
  /** Última dirección de movimiento NO nula (para habilidades como el dash) */
  private lastMoveDirection: THREE.Vector3 = new THREE.Vector3(0, 0, -1);
  /** Controlador de animaciones */
  private animationController: AnimationController | null = null;
  /** Mixer de animaciones THREE.js */
  private mixer: THREE.AnimationMixer | null = null;
  /** Acciones de animación */
  private actions: Record<string, THREE.AnimationAction> = {};
  /** Acción de animación actual */
  private currentAction: THREE.AnimationAction | null = null;

  /** Habilidad pasiva Furia */
  private furyPassive: FuryPassive | null = null;

  /** Habilidad activa Carga */
  private chargeAbility: ChargeAbility | null = null;

  /** Sistema de ataque melee */
  private meleeAttack: MeleeAttack | null = null;

  /** Arma del personaje (espada) */
  private weapon: THREE.Object3D | null = null;

  /** Stats base del Caballero */
  static readonly BASE_STATS: CharacterStats = {
    hp: 150,
    maxHp: 150,
    speed: 8,
    damage: 25,
    attackSpeed: 0.8,
    range: 3.0,
    armor: 10,
  };

  constructor(
    id: string,
    eventBus: EventBus,
    sceneManager: SceneManager,
    assetLoader: AssetLoader,
    physicsWorld?: PhysicsWorld,
    physicsBody?: RigidBodyHandle
  ) {
    super(id, MeleeCharacter.BASE_STATS, eventBus, physicsWorld, physicsBody);
    this.sceneManager = sceneManager;
    this.assetLoader = assetLoader;

    // Inicializar habilidades
    this.furyPassive = new FuryPassive(eventBus, id);
    // ChargeAbility se crea sin callback de enemigos; se asignará después via setGetActiveEnemies()
    this.chargeAbility = new ChargeAbility(eventBus, this, id, () => [], sceneManager);

    // Inicializar sistema de ataque melee
    this.meleeAttack = new MeleeAttack(eventBus, this, id, {
      range: this.getEffectiveStat('range'),
      width: 1.5,
      height: 1.0,
      arcAngle: 120,
      baseDamage: 10,
    });

    // Pasar PhysicsWorld si está disponible
    if (physicsWorld) {
      this.meleeAttack.setPhysicsWorld(physicsWorld);
    }

    // Cargar modelo asíncronamente
    void this.loadModel();
  }

  /**
   * Carga el modelo GLTF del caballero y lo agrega a la escena.
   */
  /**
   * Carga los assets 3D y configura la jerarquía de mallas y animaciones.
   * Implementa SkeletonUtils y el patrón contenedor para resolver el bloqueo en el origen (0,0,0).
   */
  private async loadModel(): Promise<void> {
    try {
      // 1. Cargamos los modelos esenciales primero (personaje + animaciones + arma)
      const essentialAssets = await Promise.all([
        this.assetLoader.load('/models/Knight.glb'),
        this.assetLoader.load('/models/Rig_Medium_MovementBasic.glb'),
        this.assetLoader.load('/models/Rig_Medium_CombatMelee.glb'),
        this.assetLoader.load('/models/Rig_Medium_General.glb'),
        this.assetLoader.load('/models/weapons/sword_1handed.gltf'),
      ]);

      const modelGltf = essentialAssets[0] as GLTF;
      const movementGltf = essentialAssets[1] as GLTF;
      const combatGltf = essentialAssets[2] as GLTF;
      const generalGltf = essentialAssets[3] as GLTF;
      const weaponGltf = essentialAssets[4] as GLTF;

      // 2. CLONACIÓN (Ahora SkeletonUtils.clone funcionará porque importamos con *)
      this.innerMesh = SkeletonUtils.clone(modelGltf.scene);

      // 3. CONFIGURACIÓN DE MALLA (sombras + frustum)
      this.innerMesh.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
        if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
          child.frustumCulled = false; // Evita que desaparezca al moverse
        }
      });

      // 4. JERARQUÍA (Contenedor -> Malla)
      this.model = new THREE.Group();
      this.innerMesh.position.set(0, 0, 0);
      this.model.add(this.innerMesh);
      this.sceneManager.add(this.model);

      // 5. CARGAR ARMA REAL (espada KayKit)
      await this.loadWeapon(weaponGltf);

      // 6. ANIMACIONES
      this.mixer = new THREE.AnimationMixer(this.innerMesh);

      const allClips = [
        ...modelGltf.animations,
        ...movementGltf.animations,
        ...combatGltf.animations,
        ...generalGltf.animations,
      ];
      console.log(
        `[MeleeCharacter ${this.id}] Animaciones cargadas:`,
        allClips.map(clip => clip.name)
      );
      allClips.forEach(clip => {
        const action = this.mixer!.clipAction(clip);
        this.actions[clip.name] = action;

        const name = clip.name.toLowerCase();
        if (name.includes('idle')) this.actions['Idle'] = action;
        if (name.includes('run') || name.includes('walk')) this.actions['Run'] = action;
        if (name.includes('death') || name.includes('die')) this.actions['Death'] = action;
      });

      // Seleccionar animación de ataque más visualmente impactante
      // Priorizar animaciones con swing amplio
      const attackClipNames = allClips
        .map(clip => clip.name)
        .filter(name => name.toLowerCase().includes('attack'));

      console.log(
        `[MeleeCharacter ${this.id}] Animaciones de ataque disponibles:`,
        attackClipNames
      );

      // Preferir animaciones de ataque con chop o slice (más movimiento visual)
      let selectedAttackClip = null;
      const preferredNames = [
        'Melee_1H_Attack_Chop',
        'Melee_1H_Attack_Slice_Diagonal',
        'Melee_1H_Attack_Slice_Horizontal',
        'Melee_2H_Attack_Chop',
      ];

      for (const prefName of preferredNames) {
        const clip = allClips.find(c => c.name === prefName);
        if (clip) {
          selectedAttackClip = clip;
          console.log(`[MeleeCharacter ${this.id}] Seleccionada animación de ataque: ${prefName}`);
          break;
        }
      }

      // Fallback: usar la primera animación de ataque disponible
      if (!selectedAttackClip && attackClipNames.length > 0) {
        selectedAttackClip = allClips.find(c => c.name === attackClipNames[0]);
        console.log(
          `[MeleeCharacter ${this.id}] Usando animación de ataque fallback: ${attackClipNames[0]}`
        );
      }

      if (selectedAttackClip) {
        const attackAction = this.mixer!.clipAction(selectedAttackClip);
        this.actions['Attack'] = attackAction;
        console.log(
          `[MeleeCharacter ${this.id}] Animación 'Attack' asignada a: ${selectedAttackClip.name}`
        );
      } else {
        console.warn(
          `[MeleeCharacter ${this.id}] No se encontró ninguna animación de ataque adecuada`
        );
      }

      // Iniciamos con animación idle
      this.playAnimation('Idle');
    } catch (error) {
      console.error('Error cargando el caballero:', error);
      this.createFallbackModel();
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
      const boneNames: string[] = [];
      this.innerMesh!.traverse((child: any) => {
        if (child.isBone) {
          boneNames.push(child.name);
          // Buscar huesos de la mano (puede variar según el modelo)
          if (
            child.name.toLowerCase().includes('hand') &&
            (child.name.toLowerCase().includes('right') || child.name.toLowerCase().includes('r_'))
          ) {
            handBone = child;
          }
        }
      });
      console.log(`[MeleeCharacter ${this.id}] Huesos encontrados:`, boneNames);

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
        weaponModel.rotation.set(0, Math.PI / 2, 0);
        weaponModel.scale.set(1.0, 1.0, 1.0);

        // Añadir el arma como hijo del hueso de la mano
        handBone.add(weaponModel);
        this.weapon = weaponModel;

        console.log(`[MeleeCharacter ${this.id}] Arma asignada a la mano: ${handBone.name}`);
      } else {
        // Si no encontramos hueso, adjuntar al modelo general
        weaponModel.position.set(0.5, 1, 0);
        weaponModel.rotation.set(0, Math.PI / 2, 0);
        weaponModel.scale.set(1.0, 1.0, 1.0);
        this.innerMesh!.add(weaponModel);
        this.weapon = weaponModel;
        console.log(
          `[MeleeCharacter ${this.id}] Arma asignada al modelo general (no se encontró hueso de mano)`
        );
      }

      // Configurar sombras y propiedades del arma
      weaponModel.traverse((child: any) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          console.log(`[MeleeCharacter ${this.id}] Mesh del arma: ${child.name}`);
        }
      });

      console.log(`[MeleeCharacter ${this.id}] Arma cargada y asignada exitosamente`);
    } catch (error) {
      console.error(`[MeleeCharacter ${this.id}] Error cargando el arma:`, error);
    }
  }

  /**
   * Crea un arma simple programáticamente (fallback cuando no se puede cargar el GLTF)
   */
  private createSimpleWeapon(): void {
    try {
      // Crear una espada más detallada con múltiples partes
      // Hoja (blade) - forma de prisma alargado
      const bladeGeometry = new THREE.BoxGeometry(0.08, 1.2, 0.03);
      // Guarda (guard) - cruz que protege la mano
      const guardGeometry = new THREE.BoxGeometry(0.25, 0.05, 0.05);
      // Mango (hilt) - cilindro para agarre
      const hiltGeometry = new THREE.CylinderGeometry(0.06, 0.06, 0.3, 8);
      // Pomo (pommel) - esfera en el extremo
      const pommelGeometry = new THREE.SphereGeometry(0.08, 8, 8);

      // Materiales con apariencia metálica y de madera
      const bladeMaterial = new THREE.MeshStandardMaterial({
        color: 0xaaaaaa,
        metalness: 0.9,
        roughness: 0.1,
        emissive: 0x111111,
      });
      const guardMaterial = new THREE.MeshStandardMaterial({
        color: 0x888888,
        metalness: 0.7,
        roughness: 0.3,
      });
      const hiltMaterial = new THREE.MeshStandardMaterial({
        color: 0x5d4037,
        metalness: 0.2,
        roughness: 0.8,
      });
      const pommelMaterial = new THREE.MeshStandardMaterial({
        color: 0xaaaaaa,
        metalness: 0.8,
        roughness: 0.2,
      });

      // Crear mallas
      const blade = new THREE.Mesh(bladeGeometry, bladeMaterial);
      const guard = new THREE.Mesh(guardGeometry, guardMaterial);
      const hilt = new THREE.Mesh(hiltGeometry, hiltMaterial);
      const pommel = new THREE.Mesh(pommelGeometry, pommelMaterial);

      // Posicionar las partes relativas al centro del grupo
      blade.position.set(0, 0.6, 0); // Hoja centrada, extendiéndose hacia arriba
      guard.position.set(0, 0.1, 0); // Guarda justo debajo de la hoja
      hilt.position.set(0, -0.15, 0); // Mango debajo de la guarda
      pommel.position.set(0, -0.35, 0); // Pomo en el extremo inferior

      // Rotar el mango para que sea vertical
      hilt.rotation.x = Math.PI / 2;

      // Crear un grupo para el arma
      const weaponGroup = new THREE.Group();
      weaponGroup.add(blade);
      weaponGroup.add(guard);
      weaponGroup.add(hilt);
      weaponGroup.add(pommel);

      // Buscar hueso de la mano derecha (generalmente "hand_r" o "hand")
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
        weaponGroup.rotation.set(-Math.PI / 8, Math.PI / 4, Math.PI / 8);
        weaponGroup.scale.set(0.9, 0.9, 0.9); // Escala aumentada

        handBone.add(weaponGroup);
        this.weapon = weaponGroup;
        console.log(
          `[MeleeCharacter ${this.id}] Espada detallada creada y asignada a la mano (escala: 0.9)`
        );
      } else {
        // Adjuntar al modelo general como fallback
        weaponGroup.position.set(0.5, 1.2, 0.3);
        weaponGroup.scale.set(1.0, 1.0, 1.0); // Escala aumentada
        this.innerMesh!.add(weaponGroup);
        this.weapon = weaponGroup;
        console.log(
          `[MeleeCharacter ${this.id}] Espada detallada creada (sin hueso de mano, escala: 1.0)`
        );
      }

      // Configurar sombras para todas las partes
      [blade, guard, hilt, pommel].forEach(part => {
        part.castShadow = true;
        part.receiveShadow = true;
      });
    } catch (error) {
      console.error(`[MeleeCharacter ${this.id}] Error creando arma simple:`, error);
    }
  }

  /** Nombre de la animación actualmente en reproducción */
  private currentAnimationName: string = '';

  /** Flag para evitar spam de warnings de animaciones */
  private hasShownAnimationWarning: boolean = false;

  /**
   * Reproduce una animación por nombre con crossfade suave.
   * Incluye guarda para evitar resetear la misma animación cada frame.
   */
  private playAnimation(name: string): void {
    // Si no hay acciones cargadas, simplemente retornar sin error
    if (Object.keys(this.actions).length === 0) {
      // Solo mostrar warning una vez para evitar spam en consola
      if (!this.hasShownAnimationWarning) {
        console.warn(
          `[MeleeCharacter ${this.id}] No hay animaciones cargadas. Saltando playAnimation('${name}')`
        );
        this.hasShownAnimationWarning = true;
      }
      return;
    }

    if (this.currentAnimationName === name) {
      console.log(`[MeleeCharacter ${this.id}] Ya está reproduciendo '${name}', omitiendo`);
      return;
    }

    // "name" debe ser exacto, ej: 'Attack', 'Idle', 'Run'
    const action = this.actions[name];
    if (action) {
      console.log(
        `[MeleeCharacter ${this.id}] playAnimation: '${name}' encontrada, clip: ${action.getClip().name}, duración: ${action.getClip().duration.toFixed(2)}s`
      );

      if (this.currentAction) {
        console.log(
          `[MeleeCharacter ${this.id}] Desvaneciendo animación anterior: ${this.currentAnimationName}`
        );
        this.currentAction.fadeOut(0.2);
      }

      action.reset().fadeIn(0.2);

      // Prevenir el bucle infinito del ataque
      if (name === 'Attack') {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        console.log(
          `[MeleeCharacter ${this.id}] Configurando animación de ataque: LoopOnce, clampWhenFinished=true`
        );

        // Agregar listener para cuando termine la animación
        action.getMixer().addEventListener('finished', e => {
          if (e.action === action) {
            console.log(`[MeleeCharacter ${this.id}] Animación de ataque terminada naturalmente`);
          }
        });
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
      }

      action.play();
      this.currentAction = action;
      this.currentAnimationName = name;
      console.log(
        `[MeleeCharacter ${this.id}] Animación '${name}' iniciada (clip: ${action.getClip().name})`
      );

      // Log del estado actual del mixer
      if (this.mixer) {
        console.log(`[MeleeCharacter ${this.id}] Mixer time: ${this.mixer.time.toFixed(2)}`);
      }
    } else {
      console.warn(
        `[MeleeCharacter ${this.id}] No se encontró acción para '${name}'. Acciones disponibles:`,
        Object.keys(this.actions)
      );
    }
  }

  /**
   * Crea un modelo de fallback (cubo) si el GLTF no carga.
   * Mantiene la misma estructura de contenedor y malla interna.
   */
  private createFallbackModel(): void {
    const geometry = new THREE.BoxGeometry(1, 2, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `Knight_Fallback_Inner_${this.id}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // 1. La malla interna es el cubo
    this.innerMesh = mesh;

    // 2. Crear contenedor Group
    this.model = new THREE.Group();
    this.model.name = `Knight_Fallback_Container_${this.id}`;

    // 3. Meter el cubo dentro del contenedor
    this.model.add(this.innerMesh);

    // 4. Añadir contenedor a la escena
    this.sceneManager.add(this.model);

    // Iniciar con animación idle
    this.playAnimation('Idle');
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
          `[MeleeCharacter ${this.id}] moveBody: keys=[${keyPressed.join(', ') || 'none'}], moveDir=(${moveDir.x.toFixed(2)}, ${moveDir.y.toFixed(2)}), dir3D=(${direction.x.toFixed(2)}, ${direction.y.toFixed(2)}, ${direction.z.toFixed(2)}), vel=(${(direction.x * SPEED).toFixed(2)}, ${(direction.z * SPEED).toFixed(2)})`
        );
      } else {
        console.log(
          `[MeleeCharacter ${this.id}] moveBody: FRENANDO, vel=(0, ${currentVel.y.toFixed(2)}, 0)`
        );
      }
    }
  }

  /**
   * Convierte input 2D a movimiento 3D isométrico.
   * Rotación 45° para compensar la perspectiva isométrica.
   */
  private inputToIsometric(moveDir: THREE.Vector2): THREE.Vector3 {
    // Crear vector 3D a partir del input 2D
    // NOTA: Invertir Z porque en la vista isométrica, "arriba" en pantalla
    // corresponde a movimiento en -Z (hacia la cámara) o similar
    const inputVector = new THREE.Vector3(moveDir.x, 0, -moveDir.y);

    // DEBUG: Mostrar input original
    if (import.meta.env.DEV && moveDir.lengthSq() > 0) {
      console.log(
        `[MeleeCharacter ${this.id}] inputToIsometric: moveDir=(${moveDir.x.toFixed(2)}, ${moveDir.y.toFixed(2)}), inputVector=(${inputVector.x.toFixed(2)}, ${inputVector.y.toFixed(2)}, ${inputVector.z.toFixed(2)})`
      );
    }

    // Rotar 45° alrededor del eje Y (perspectiva isométrica)
    // Volver a usar rotación positiva pero con Z invertido
    const isoMatrix = new THREE.Matrix4().makeRotationY(Math.PI / 4);
    inputVector.applyMatrix4(isoMatrix);

    // DEBUG: Mostrar resultado
    if (import.meta.env.DEV && moveDir.lengthSq() > 0) {
      console.log(
        `[MeleeCharacter ${this.id}] inputToIsometric: result=(${inputVector.x.toFixed(2)}, ${inputVector.y.toFixed(2)}, ${inputVector.z.toFixed(2)})`
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
    if (this.mixer) this.mixer.update(dt);

    // Actualizar habilidades
    if (this.chargeAbility) {
      this.chargeAbility.update(dt);
    }

    // Actualizar sistema de ataque melee
    if (this.meleeAttack) {
      this.meleeAttack.update(dt);
    }

    // Si el personaje está en dash, NO sobrescribir la velocidad (el dash la controla)
    const isDashing = this.chargeAbility?.isDashingActive() ?? false;
    if (isDashing) {
      // Rotar el modelo hacia la dirección del dash
      if (this.model && this.chargeAbility) {
        // La rotación se mantiene de la última dirección conocida
      }
      // Saltar el bloque de movimiento normal para no anular la velocidad del dash
      return;
    }

    // Obtener el cuerpo físico real
    const body = this.physicsWorld.getBody(this.physicsBody);
    if (!body) return;

    const direction = new THREE.Vector3(0, 0, 0);

    if (inputState) {
      // Convertir inputState.moveDir a dirección 3D
      if (inputState.moveDir.lengthSq() > 0.01) {
        direction.copy(this.inputToIsometric(inputState.moveDir));
        // Actualizar la última dirección de movimiento NO nula (para habilidades como el dash)
        this.lastMoveDirection.copy(direction);
        this.moveDirection.copy(direction);
      }

      // Manejar ataque y habilidad
      this.handleAttack(inputState);
      this.handleAbility(inputState);
    }

    const currentVel = body.linvel();

    // El personaje puede moverse MIENTRAS ataca — ya no se ancla al piso.
    // Simplemente aplicamos velocidad de movimiento en cualquier estado
    // (Idle, Moving, Attacking) excepto Dead.
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

      if (this.state !== CharacterState.Moving && this.state !== CharacterState.Attacking) {
        if (import.meta.env.DEV) {
          console.log(`[MeleeCharacter ${this.id}] Cambiando estado a Moving`);
        }
        this.setState(CharacterState.Moving);
      }
    } else {
      // FRENO — solo si no está atacando (para no interrumpir el swing)
      if (this.state !== CharacterState.Attacking) {
        if (Math.abs(currentVel.x) > 0.1 || Math.abs(currentVel.z) > 0.1) {
          body.setLinvel({ x: 0, y: currentVel.y, z: 0 }, true);
        }
        if (this.state !== CharacterState.Idle) {
          if (import.meta.env.DEV) {
            console.log(`[MeleeCharacter ${this.id}] Cambiando estado a Idle`);
          }
          this.setState(CharacterState.Idle);
        }
      }
    }

    // Actualizar animaciones basadas en el estado actual (sistema legacy)
    if (this.state === CharacterState.Moving) {
      this.playAnimation('Run');
    } else if (this.state === CharacterState.Idle) {
      this.playAnimation('Idle');
    }
    // Nota: El estado Attacking se maneja en el método attack()
  }

  /**
   * Sincroniza el modelo visual con la posición física actual.
   * Debe llamarse DESPUÉS de physicsWorld.stepAll() para evitar desfase de 1 frame.
   */
  syncToPhysics(): void {
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
      // Convertir input a dirección isométrica
      this.moveDirection = this.inputToIsometric(inputState.moveDir);
      // Guardar la última dirección NO nula para habilidades como el dash
      this.lastMoveDirection.copy(this.moveDirection);

      // Aplicar movimiento al cuerpo físico si existe
      if (this.physicsBody && this.physicsWorld) {
        this.moveBody(inputState);
      } else {
        // Movimiento sin física (fallback) - mantener compatibilidad
        const speed = this.getEffectiveStat('speed');
        const displacement = this.moveDirection.clone().multiplyScalar(speed * dt);
        if (this.model) {
          this.model.position.add(displacement);
        } else {
          console.warn(`[MeleeCharacter ${this.id}] No model to move`);
        }
      }

      this.setState(CharacterState.Moving);
    } else {
      this.setState(CharacterState.Idle);
      this.moveDirection.set(0, 0, 0);
    }
  }

  /**
   * Maneja el ataque básico.
   */
  private handleAttack(inputState: InputState): void {
    if (inputState.attacking && this.state !== CharacterState.Attacking) {
      this.attack();
    }
  }

  /**
   * Maneja la habilidad Q.
   */
  private handleAbility(inputState: InputState): void {
    if (inputState.abilityQ && this.chargeAbility?.isReady()) {
      this.abilityQ();
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
            `[MeleeCharacter ${this.id}] syncModelWithPhysics: pos=(${position.x.toFixed(2)}, ${position.z.toFixed(2)})`
          );
        }
      }
    }
  }

  /**
   * Actualiza la rotación del modelo suavemente hacia la dirección de movimiento.
   */
  private updateModelRotation(
    _dt: number /* eslint-disable-line @typescript-eslint/no-unused-vars */
  ): void {
    if (!this.model || this.moveDirection.lengthSq() < 0.01) return;

    // Calcular ángulo de rotación hacia la dirección de movimiento
    const targetAngle = Math.atan2(this.moveDirection.x, this.moveDirection.z);

    // Rotación actual del modelo
    const currentAngle = this.model.rotation.y;

    // Interpolación lineal suave (LERP)
    const angleDiff = targetAngle - currentAngle;

    // Normalizar diferencia al rango [-π, π]
    const normalizedDiff = ((angleDiff + Math.PI) % (2 * Math.PI)) - Math.PI;

    // Aplicar rotación suave
    const newAngle = currentAngle + normalizedDiff * this.rotationLerpAlpha;

    this.model.rotation.y = newAngle;
  }

  /**
   * Ataque melee básico.
   * Por ahora es un placeholder que cambiará el estado.
   * En M5 se implementará el swing con daño.
   */

  /**
   * Ataque melee básico.
   * Usa el sistema MeleeAttack para detección de golpes con Rapier.
   * El daño se aplica cuando la espada está en la parte más baja del swing (~250ms).
   */
  public attack(): void {
    if (this.state === CharacterState.Dead) return;

    // Verificar que tenemos el sistema de ataque
    if (!this.meleeAttack) {
      console.warn(`[MeleeCharacter ${this.id}] MeleeAttack no existe`);
      return;
    }

    // Iniciar estado de ataque y animación
    this.setState(CharacterState.Attacking);

    console.log(`[MeleeCharacter ${this.id}] Ataque iniciado, estado: Attacking`);
    console.log(`[MeleeCharacter ${this.id}] Arma presente: ${this.weapon ? 'Sí' : 'No'}`);
    if (this.weapon) {
      console.log(`[MeleeCharacter ${this.id}] Posición inicial del arma:`, this.weapon.position);
    }

    // Reproducir animación de ataque
    console.log(`[MeleeCharacter ${this.id}] Llamando playAnimation('Attack')`);
    this.playAnimation('Attack');

    // Programar el daño para casi el final de la animación (395ms de 400ms)
    // para que cuadre visualmente con el momento en que la espada baja.
    setTimeout(() => {
      if (this.state === CharacterState.Attacking && this.meleeAttack) {
        console.log(`[MeleeCharacter ${this.id}] Aplicando daño (punto más bajo del swing)`);
        if (this.meleeAttack.tryAttack()) {
          console.log(`[MeleeCharacter ${this.id}] Golpe exitoso`);
        } else {
          console.log(`[MeleeCharacter ${this.id}] Golpe falló (sin objetivos)`);
        }
      }
    }, 395);

    // Fail-safe: Destrabar al personaje en 400ms
    setTimeout(() => {
      if (this.state === CharacterState.Attacking) {
        console.log(`[MeleeCharacter ${this.id}] Fail-safe: volviendo a Idle después de timeout`);
        this.setState(CharacterState.Idle);
        this.playAnimation('Idle');
      }
    }, 400);
  }

  /**
   * Habilidad Q: Embestida.
   * Activa la habilidad de carga si está disponible.
   */
  abilityQ(): void {
    if (!this.chargeAbility) return;

    // Activar la habilidad de carga
    this.chargeAbility.activate();
  }

  /**
   * Incrementa el contador de kills y activa la furia al llegar a 3.
   */
  /**
   * Establece un pipeline de daño compartido.
   * Reemplaza el pipeline interno de MeleeAttack si ya fue creado.
   */
  setDamagePipeline(pipeline: DamagePipeline): void {
    if (this.meleeAttack) {
      this.meleeAttack.setDamagePipeline(pipeline);
    }
  }

  incrementKillCount(): void {
    this.killCount++;

    if (this.killCount >= 3 && !this.furyReady) {
      this.furyReady = true;

      // Emitir evento visual/auditivo (placeholder)
      // Nota: Necesitamos agregar este evento a GameEvents si queremos tipado fuerte
      this.eventBus.emit('player:furyReady' as any, { playerId: this.id }); // eslint-disable-line @typescript-eslint/no-explicit-any
    }
  }

  /**
   * Obtiene el contador de kills actual.
   */
  getKillCount(): number {
    return this.killCount;
  }

  /**
   * Verifica si la furia está lista.
   */
  isFuryReady(): boolean {
    return this.furyReady;
  }

  /**
   * Expone la habilidad de carga para el HUD.
   */
  getChargeAbility(): ChargeAbility | null {
    return this.chargeAbility;
  }

  /**
   * Establece el callback para obtener enemigos activos (usado por ChargeAbility).
   * Debe llamarse después de que EnemyPool esté inicializado.
   */
  setGetActiveEnemies(callback: () => Enemy[]): void {
    // Reemplazar la ChargeAbility con una nueva que tenga el callback
    if (this.chargeAbility) {
      this.chargeAbility.dispose();
    }
    this.chargeAbility = new ChargeAbility(
      this.eventBus,
      this,
      this.id,
      callback,
      this.sceneManager
    );
  }

  /**
   * Reinicia las estadísticas de la partida (para "Jugar de nuevo").
   */
  resetMatchStats(): void {
    super.resetMatchStats();
    this.killCount = 0;
    this.furyReady = false;
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

    // Sincronizar modelo si ya existe
    if (this.model) {
      this.model.position.copy(position);
      // NOTA: Ya no usamos syncToThree. La sincronización se hace directamente en update()
    }
  }

  /**
   * Obtiene el sistema de ataque melee (para debugging).
   */
  getMeleeAttack(): MeleeAttack | null {
    return this.meleeAttack;
  }

  /**
   * Obtiene el modelo 3D (para debugging).
   */
  getModel(): THREE.Group | null {
    return this.model;
  }
}
