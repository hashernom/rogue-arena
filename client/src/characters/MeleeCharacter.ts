import * as THREE from 'three';
import { Character, type CharacterStats, CharacterState } from './Character';
import type { InputState } from '../engine/InputManager';
import type { PhysicsWorld, RigidBodyHandle } from '../physics/PhysicsWorld';
import { EventBus } from '../engine/EventBus';
import { AssetLoader } from '../engine/AssetLoader';
import { SceneManager } from '../engine/SceneManager';
import { BodyFactory } from '../physics/BodyFactory';
import { AnimationController } from './AnimationController';

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

    // Cargar modelo asíncronamente
    void this.loadModel();
  }

  /**
   * Carga el modelo GLTF del caballero y lo agrega a la escena.
   */
  private async loadModel(): Promise<void> {
    try {
      const [modelGltf, movementGltf] = await Promise.all([
        this.assetLoader.load('/models/Knight.glb'),
        this.assetLoader.load('/models/Rig_Medium_MovementBasic.glb')
      ]);

      // 1. EL TRUCO DEL CONTENEDOR (Soluciona que el modelo no siga a la caja)
      this.innerMesh = this.assetLoader.clone(modelGltf); // El modelo visual real
      this.model = new THREE.Group();                     // La "caja de cartón" vacía
      this.model.add(this.innerMesh!);                    // Metemos el modelo en la caja (usamos ! porque sabemos que no es null)
      this.sceneManager.add(this.model);                  // Añadimos la caja al mundo

      // 2. EL MIXER SE CONECTA AL MODELO INTERNO, NO AL CONTENEDOR
      this.mixer = new THREE.AnimationMixer(this.innerMesh!);

      // 3. MAPEO INTELIGENTE DE NOMBRES (Soluciona el error de "Animación no encontrada")
      const allAnimations = [...modelGltf.animations, ...movementGltf.animations];
      allAnimations.forEach((clip) => {
        const action = this.mixer!.clipAction(clip);
        this.actions[clip.name] = action; // Guardamos el nombre original por si acaso
        
        const lowerName = clip.name.toLowerCase();
        if (lowerName.includes('idle')) this.actions['Idle'] = action;
        if (lowerName.includes('run') || lowerName.includes('walk')) this.actions['Run'] = action;
      });

      // Si no encuentra 'Idle', usa la primera animación disponible para no crashear
      if (!this.actions['Idle'] && allAnimations.length > 0) {
          this.actions['Idle'] = this.mixer!.clipAction(allAnimations[0]);
      }

      this.playAnimation('Idle');

    } catch (error) {
      console.error('Error cargando modelo:', error);
      this.createFallbackModel();
    }
  }

  /**
   * Reproduce una animación por nombre.
   */
  private playAnimation(name: string): void {
    if (!this.mixer) return;
    
    // Detener todas las animaciones actuales
    Object.values(this.actions).forEach(action => {
      action.stop();
    });
    
    // Reproducir la animación solicitada si existe
    const action = this.actions[name];
    if (action) {
      action.reset();
      action.play();
      console.log(`[MeleeCharacter ${this.id}] Reproduciendo animación: ${name}`);
    } else {
      console.warn(`[MeleeCharacter ${this.id}] Animación no encontrada: ${name}`);
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

    // Crear AnimationController con animaciones procedurales
    this.animationController = new AnimationController(this.model, []);
    console.log(`[MeleeCharacter ${this.id}] AnimationController de fallback creado`);
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
        console.log(`[MeleeCharacter ${this.id}] moveBody: moveDir=(${moveDir.x.toFixed(2)}, ${moveDir.y.toFixed(2)}), dir=(${direction.x.toFixed(2)}, ${direction.z.toFixed(2)}), vel=(${(direction.x * SPEED).toFixed(2)}, ${(direction.z * SPEED).toFixed(2)})`);
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
    const inputVector = new THREE.Vector3(moveDir.x, 0, moveDir.y);

    // Rotar 45° alrededor del eje Y (perspectiva isométrica)
    const isoMatrix = new THREE.Matrix4().makeRotationY(Math.PI / 4);
    inputVector.applyMatrix4(isoMatrix);

    return inputVector.normalize();
  }

  /**
   * Actualiza el movimiento del personaje basado en input y tiempo delta.
   * Versión consolidada "a prueba de balas" con sincronización directa.
   */
  update(dt: number, inputState?: InputState): void {
    if (this.mixer) this.mixer.update(dt);
    if (!this.physicsBody || !this.physicsWorld || this.state === CharacterState.Dead) return;

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
      
      body.setLinvel({
        x: direction.x * SPEED,
        y: currentVel.y,
        z: direction.z * SPEED
      }, true);

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

    // 4. SINCRONIZACIÓN VISUAL DEL CONTENEDOR
    if (this.model && this.physicsBody) {
      const pos = body.translation();
      // Movemos el contenedor (que no tiene bloqueos de animación) a la caja de físicas
      this.model.position.set(pos.x, pos.y - 0.5, pos.z);
    }
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
      console.log(`[MeleeCharacter ${this.id}] Estado: ${this.state}, isAttacking: ${isAttacking}, isDead: ${isDead}`);
    }

    // Sincronizar estado del personaje con animaciones
    this.animationController.syncWithCharacterState(stateStr, isAttacking, isDead);

    // Actualizar mixer del AnimationController
    this.animationController.update(dt);
  }

  /**
   * Ataque melee básico.
   * Por ahora es un placeholder que cambiará el estado.
   * En M5 se implementará el swing con daño.
   */
  attack(): void {
    if (this.state === CharacterState.Dead) return;

    this.setState(CharacterState.Attacking);

    // TODO: Implementar lógica de ataque en M5

    // Volver a Idle después de un tiempo (simulado)
    setTimeout(() => {
      if (this.state === CharacterState.Attacking) {
        this.setState(CharacterState.Idle);
      }
    }, 500);
  }

  /**
   * Habilidad Q: Embestida.
   * Placeholder que se conectará en M5.
   */
  abilityQ(): void {
    if (!this.furyReady) return;

    // Consumir furia
    this.furyReady = false;

    // TODO: Implementar movimiento rápido en línea recta en M5
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
   * Obtiene el modelo 3D (para debugging).
   */
  getModel(): THREE.Group | null {
    return this.model;
  }
}
