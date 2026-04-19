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
  /** Pool de proyectiles activos */
  private activeProjectiles: THREE.Mesh[] = [];
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
        this.assetLoader.load('/models/Rig_Medium_General.glb')
      ]);
      const modelGltf = assets[0] as GLTF;
      const movementGltf = assets[1] as GLTF;
      const combatGltf = assets[2] as GLTF;
      const generalGltf = assets[3] as GLTF;

      // 1. Clonado de esqueleto independiente
      this.innerMesh = SkeletonUtils.clone(modelGltf.scene);
      
      // 2. Configuración de sombras y visibilidad
      this.innerMesh.traverse((child) => {
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

      // 4. Inicialización del Mixer
      this.mixer = new THREE.AnimationMixer(this.innerMesh);

      // 5. Mapeo Inteligente
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
        if (name.includes('shoot') || name.includes('attack') || name.includes('ranged')) this.actions['Attack'] = action;
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
        
        console.log(`[AdcCharacter ${this.id}] moveBody: keys=[${keyPressed.join(', ') || 'none'}], moveDir=(${moveDir.x.toFixed(2)}, ${moveDir.y.toFixed(2)}), dir3D=(${direction.x.toFixed(2)}, ${direction.y.toFixed(2)}, ${direction.z.toFixed(2)}), vel=(${(direction.x * SPEED).toFixed(2)}, ${(direction.z * SPEED).toFixed(2)})`);
      } else {
        console.log(`[AdcCharacter ${this.id}] moveBody: FRENANDO, vel=(0, ${currentVel.y.toFixed(2)}, 0)`);
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
      console.log(`[AdcCharacter ${this.id}] inputToIsometric: moveDir=(${moveDir.x.toFixed(2)}, ${moveDir.y.toFixed(2)}), inputVector=(${inputVector.x.toFixed(2)}, ${inputVector.y.toFixed(2)}, ${inputVector.z.toFixed(2)})`);
    }

    // Rotar 45° alrededor del eje Y (perspectiva isométrica)
    // Volver a usar rotación positiva pero con Z invertido
    const isoMatrix = new THREE.Matrix4().makeRotationY(Math.PI / 4);
    inputVector.applyMatrix4(isoMatrix);

    // DEBUG: Mostrar resultado
    if (import.meta.env.DEV && moveDir.lengthSq() > 0) {
      console.log(`[AdcCharacter ${this.id}] inputToIsometric: result=(${inputVector.x.toFixed(2)}, ${inputVector.y.toFixed(2)}, ${inputVector.z.toFixed(2)})`);
    }

    return inputVector.normalize();
  }

  /**
   * Actualiza el movimiento del personaje basado en input y tiempo delta.
   * Versión consolidada "a prueba de balas" con sincronización directa.
   */
  update(dt: number, inputState?: InputState): void {
    // Actualizar mixer de animaciones THREE.js
    if (this.mixer) this.mixer.update(dt);
    
    // Actualizar proyectiles
    this.updateProjectiles(dt);

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
    this.model.updateMatrixWorld(true); // Fuerza la actualización de la jerarquía
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
      this.shootProjectile();
    }
  }

  /**
   * Maneja la habilidad Q (lluvia de flechas).
   */
  private handleAbility(inputState: InputState): void {
    if (inputState.abilityQ) {
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
          console.log(`[AdcCharacter ${this.id}] syncModelWithPhysics: pos=(${position.x.toFixed(2)}, ${position.z.toFixed(2)})`);
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
      console.log(`[AdcCharacter ${this.id}] Estado: ${this.state}, isAttacking: ${isAttacking}, isDead: ${isDead}`);
    }

    // Sincronizar estado del personaje con animaciones
    this.animationController.syncWithCharacterState(stateStr, isAttacking, isDead);

    // Actualizar mixer del AnimationController
    this.animationController.update(dt);
  }

  /**
   * Dispara un proyectil (flecha) en la dirección actual del modelo.
   */
  private shootProjectile(): void {
    if (this.state === CharacterState.Dead) return;

    this.setState(CharacterState.Attacking);
    this.consecutiveShots++;

    // Crear geometría de flecha
    const geometry = new THREE.ConeGeometry(0.1, 0.5, 8);
    const material = new THREE.MeshStandardMaterial({ color: 0xffff00 });
    const arrow = new THREE.Mesh(geometry, material);
    arrow.castShadow = true;

    // Posición inicial: frente del personaje
    if (this.model) {
      const direction = new THREE.Vector3(0, 0, -1);
      direction.applyQuaternion(this.model.quaternion);
      arrow.position.copy(this.model.position).add(direction.multiplyScalar(1.5));
      arrow.rotation.copy(this.model.rotation);
      arrow.rotateX(Math.PI / 2);
    } else {
      arrow.position.set(0, 1, 0);
    }

    this.sceneManager.add(arrow);
    this.activeProjectiles.push(arrow);

    // Aplicar pasiva: cada 3 disparos consecutivos aumenta velocidad de ataque temporal
    if (this.consecutiveShots >= 3) {
      this.applyModifier('attackSpeed', 0.3, ModifierType.Multiplicative, 'adc_passive', 'Pasiva: +30% velocidad de ataque');
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
   * Actualiza la posición de todos los proyectiles activos.
   */
  private updateProjectiles(dt: number): void {
    const speed = 15;
    const maxDistance = 30;

    for (let i = this.activeProjectiles.length - 1; i >= 0; i--) {
      const projectile = this.activeProjectiles[i];
      const direction = new THREE.Vector3(0, 0, -1);
      direction.applyQuaternion(projectile.quaternion);
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
   * Dispara 5 flechas en un arco frontal.
   */
  private abilityQ(): void {
    if (this.state === CharacterState.Dead) return;

    const count = 5;
    const spread = Math.PI / 6;

    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        if (!this.isAlive()) return;

        // Crear flecha con rotación variada
        const geometry = new THREE.ConeGeometry(0.1, 0.5, 8);
        const material = new THREE.MeshStandardMaterial({ color: 0xff4500 });
        const arrow = new THREE.Mesh(geometry, material);
        arrow.castShadow = true;

        if (this.model) {
          const angle = (i - (count - 1) / 2) * spread;
          const direction = new THREE.Vector3(Math.sin(angle), 0, -Math.cos(angle));
          direction.applyQuaternion(this.model.quaternion);
          arrow.position.copy(this.model.position).add(direction.multiplyScalar(2));
          arrow.lookAt(arrow.position.clone().add(direction));
          arrow.rotateX(Math.PI / 2);
        }

        this.sceneManager.add(arrow);
        this.activeProjectiles.push(arrow);
      }, i * 100);
    }
  }

  /**
   * Verifica si el personaje está vivo.
   */
  isAlive(): boolean {
    return this.state !== CharacterState.Dead;
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

    // Remover proyectiles
    this.activeProjectiles.forEach(proj => this.sceneManager.remove(proj));
    this.activeProjectiles = [];
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

  /**
   * Establece el cuerpo físico (método público de Character).
   */
  setPhysicsBody(body: RigidBodyHandle): void {
    this.physicsBody = body;
  }
}