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
import { MeleeAttack } from '../combat/MeleeAttack';

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

  /** Stats base del Caballero */
  static readonly BASE_STATS: CharacterStats = {
    hp: 150,
    maxHp: 150,
    speed: 4,
    damage: 25,
    attackSpeed: 0.8,
    range: 1.5,
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
    this.chargeAbility = new ChargeAbility(eventBus, this, id);

    // Inicializar sistema de ataque melee
    this.meleeAttack = new MeleeAttack(eventBus, this, id, {
      range: this.getEffectiveStat('range'),
      width: 1.5,
      height: 1.0,
      arcAngle: 120,
      baseDamage: 10
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
      // 1. Cargamos y forzamos el tipo para que TS reconozca '.scene'
      const assets = await Promise.all([
        this.assetLoader.load('/models/Knight.glb'),
        this.assetLoader.load('/models/Rig_Medium_MovementBasic.glb'),
        this.assetLoader.load('/models/Rig_Medium_CombatMelee.glb'),
        this.assetLoader.load('/models/Rig_Medium_General.glb')
      ]);
      
      const modelGltf = assets[0] as GLTF;
      const movementGltf = assets[1] as GLTF;
      const combatGltf = assets[2] as GLTF;
      const generalGltf = assets[3] as GLTF;

      // 2. CLONACIÓN (Ahora SkeletonUtils.clone funcionará porque importamos con *)
      this.innerMesh = SkeletonUtils.clone(modelGltf.scene);
      
      // 3. CONFIGURACIÓN DE MALLA
      this.innerMesh.traverse((child) => {
        if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
          child.frustumCulled = false; // Evita que desaparezca al moverse
        }
      });

      // 4. JERARQUÍA (Contenedor -> Malla)
      this.model = new THREE.Group();
      this.innerMesh.position.set(0, 0, 0);
      this.model.add(this.innerMesh);
      this.sceneManager.add(this.model);

      // 5. ANIMACIONES
      this.mixer = new THREE.AnimationMixer(this.innerMesh);

      const allClips = [
        ...modelGltf.animations,
        ...movementGltf.animations,
        ...combatGltf.animations,
        ...generalGltf.animations
      ];
      allClips.forEach((clip) => {
        const action = this.mixer!.clipAction(clip);
        this.actions[clip.name] = action;
        
        const name = clip.name.toLowerCase();
        if (name.includes('idle')) this.actions['Idle'] = action;
        if (name.includes('run') || name.includes('walk')) this.actions['Run'] = action;
        if (name.includes('attack') || name.includes('melee')) this.actions['Attack'] = action;
        if (name.includes('death') || name.includes('die')) this.actions['Death'] = action;
      });

      // Iniciamos con animación idle
      this.playAnimation('Idle');

    } catch (error) {
      console.error('Error cargando el caballero:', error);
      this.createFallbackModel();
    }
  }
  /** Nombre de la animación actualmente en reproducción */
  private currentAnimationName: string = '';

  /**
   * Reproduce una animación por nombre con crossfade suave.
   * Incluye guarda para evitar resetear la misma animación cada frame.
   */
  private playAnimation(name: string): void {
    if (this.currentAnimationName === name) return;

    // "name" debe ser exacto, ej: 'Attack', 'Idle', 'Run'
    const action = this.actions[name];
    if (action) {
      if (this.currentAction) {
        this.currentAction.fadeOut(0.2);
      }

      action.reset().fadeIn(0.2);
      
      // Prevenir el bucle infinito del ataque
      if (name === 'Attack') {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
      }

      action.play();
      this.currentAction = action;
      this.currentAnimationName = name;
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
      body.setLinvel({
        x: direction.x * SPEED,
        y: currentVel.y, // Respetar la gravedad original en el eje Y
        z: direction.z * SPEED
      }, true); // ¡ESTE 'TRUE' ES VITAL! Despierta el cuerpo físico inmediatamente
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
        
        console.log(`[MeleeCharacter ${this.id}] moveBody: keys=[${keyPressed.join(', ') || 'none'}], moveDir=(${moveDir.x.toFixed(2)}, ${moveDir.y.toFixed(2)}), dir3D=(${direction.x.toFixed(2)}, ${direction.y.toFixed(2)}, ${direction.z.toFixed(2)}), vel=(${(direction.x * SPEED).toFixed(2)}, ${(direction.z * SPEED).toFixed(2)})`);
      } else {
        console.log(`[MeleeCharacter ${this.id}] moveBody: FRENANDO, vel=(0, ${currentVel.y.toFixed(2)}, 0)`);
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
      console.log(`[MeleeCharacter ${this.id}] inputToIsometric: moveDir=(${moveDir.x.toFixed(2)}, ${moveDir.y.toFixed(2)}), inputVector=(${inputVector.x.toFixed(2)}, ${inputVector.y.toFixed(2)}, ${inputVector.z.toFixed(2)})`);
    }

    // Rotar 45° alrededor del eje Y (perspectiva isométrica)
    // Volver a usar rotación positiva pero con Z invertido
    const isoMatrix = new THREE.Matrix4().makeRotationY(Math.PI / 4);
    inputVector.applyMatrix4(isoMatrix);

    // DEBUG: Mostrar resultado
    if (import.meta.env.DEV && moveDir.lengthSq() > 0) {
      console.log(`[MeleeCharacter ${this.id}] inputToIsometric: result=(${inputVector.x.toFixed(2)}, ${inputVector.y.toFixed(2)}, ${inputVector.z.toFixed(2)})`);
    }

    return inputVector.normalize();
  }

  /**
   * Actualiza el movimiento del personaje basado en input y tiempo delta.
   * Versión consolidada "a prueba de balas" con sincronización directa.
   */
  update(dt: number, inputState?: InputState): void {
    if (this.mixer) this.mixer.update(dt);
    if (!this.physicsBody || !this.physicsWorld || this.state === CharacterState.Dead) return;

    // Actualizar habilidades
    if (this.chargeAbility) {
      this.chargeAbility.update(dt);
    }

    // Actualizar sistema de ataque melee
    if (this.meleeAttack) {
      this.meleeAttack.update(dt);
    }

    // Obtener el cuerpo físico real
    const body = this.physicsWorld.getBody(this.physicsBody);
    if (!body) return;

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

    // Solo actualizar estado de movimiento si no está atacando
    if (this.state !== CharacterState.Attacking) {
      if (direction.lengthSq() > 0) {
        direction.normalize();
        const SPEED = this.getEffectiveStat('speed');
        
        body.setLinvel({
          x: direction.x * SPEED,
          y: currentVel.y,
          z: direction.z * SPEED
        }, true);

        // Rotar el CONTENEDOR hacia donde caminamos
        if (this.model) {
          this.model.rotation.y = Math.atan2(direction.x, direction.z);
        }
        
        if (this.state !== CharacterState.Moving) {
          if (import.meta.env.DEV) {
            console.log(`[MeleeCharacter ${this.id}] Cambiando estado a Moving`);
          }
          this.setState(CharacterState.Moving);
        }
      } else {
        // FRENO
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
    } else {
      if (import.meta.env.DEV) {
        console.log(`[MeleeCharacter ${this.id}] Estado Attacking, ignorando movimiento`);
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
   * Maneja el movimiento basado en input.
   */
  private handleMovement(dt: number, inputState: InputState): void {
    if (inputState.moveDir.lengthSq() > 0.01) {
      // Convertir input a dirección isométrica
      this.moveDirection = this.inputToIsometric(inputState.moveDir);

      // Calcular desplazamiento
      const speed = this.getEffectiveStat('speed');
      const displacement = this.moveDirection.clone().multiplyScalar(speed * dt);

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
    if (inputState.abilityQ && this.furyReady) {
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
          console.log(`[MeleeCharacter ${this.id}] syncModelWithPhysics: pos=(${position.x.toFixed(2)}, ${position.z.toFixed(2)})`);
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
   */
  public attack(): void {
    if (this.state === CharacterState.Dead) return;

    // Usar el sistema MeleeAttack para detección de golpes
    if (this.meleeAttack && this.meleeAttack.tryAttack()) {
      // El sistema MeleeAttack ya maneja la animación a través del evento
      // y la detección de golpes con Rapier
      this.setState(CharacterState.Attacking);
      
      if (import.meta.env.DEV) {
        console.log(`[MeleeCharacter ${this.id}] Ataque iniciado, estado: Attacking`);
      }
      
      // Reproducir animación de ataque
      this.playAnimation('Attack');
      
      // Fail-safe: Destrabar al personaje en 1200ms por si la animación falla
      // (la animación de ataque suele durar ~1 segundo)
      setTimeout(() => {
        if (this.state === CharacterState.Attacking) {
          if (import.meta.env.DEV) {
            console.log(`[MeleeCharacter ${this.id}] Fail-safe: volviendo a Idle después de timeout`);
          }
          this.setState(CharacterState.Idle);
          this.playAnimation('Idle');
        }
      }, 1200);
    }
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
   * Limpia recursos cuando el personaje muere.
   */
  die(): void {
    super.die();

    // Remover modelo de la escena
    if (this.model) {
      this.sceneManager.remove(this.model);
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

    const body = BodyFactory.createCharacterBody(this.physicsWorld, position, true);
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

