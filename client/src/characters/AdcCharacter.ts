import * as THREE from 'three';
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
  /** Modelo 3D del arquero/ranger */
  private model: THREE.Group | null = null;
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
   */
  private async loadModel(): Promise<void> {
    try {
      // Cargar modelo GLB desde la carpeta pública (usar Rogue_Hooded.glb como placeholder)
      const gltf = await this.assetLoader.load('/models/Rogue_Hooded.glb');
      const model = this.assetLoader.clone(gltf);
      model.name = `ADC_${this.id}`;

      // Ajustar escala y orientación
      model.scale.set(0.5, 0.5, 0.5);
      model.rotation.y = Math.PI;
      model.position.set(0, 0, 0);

      // Configurar sombras
      model.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      this.model = model;
      this.sceneManager.add(model);

      // Crear AnimationController con los clips del GLTF
      if (gltf.animations && gltf.animations.length > 0) {
        console.log(`[AdcCharacter ${this.id}] GLTF tiene ${gltf.animations.length} animaciones:`, gltf.animations.map(a => a.name));
        this.animationController = new AnimationController(model, gltf.animations);
        console.log(`[AdcCharacter ${this.id}] AnimationController creado con ${gltf.animations.length} clips`);
      } else {
        console.warn(`[AdcCharacter ${this.id}] GLTF no tiene animaciones, usando fallback`);
        this.animationController = new AnimationController(model, []);
      }

      // Sincronizar posición con cuerpo físico si existe y registrar para actualización automática
      if (this.physicsBody && this.physicsWorld) {
        const position = this.getBodyPosition();
        if (position) {
          model.position.copy(position);
        }
        // REGISTRO CRÍTICO: Sincronizar modelo con cuerpo físico para actualización automática
        console.log(`[AdcCharacter ${this.id}] Sincronizando modelo con cuerpo físico`);
        this.physicsWorld.syncToThree(model, this.physicsBody);
      }
    } catch (error) {
      console.error(`[AdcCharacter ${this.id}] Failed to load ranger GLB:`, error);
      this.createFallbackModel();
    }
  }

  /**
   * Crea un modelo de fallback (cubo con color distintivo) si el GLTF no carga.
   */
  private createFallbackModel(): void {
    const geometry = new THREE.CylinderGeometry(0.5, 0.5, 2, 8);
    const material = new THREE.MeshStandardMaterial({ color: 0x228b22 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `ADC_Fallback_${this.id}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const group = new THREE.Group();
    group.add(mesh);
    this.model = group;
    this.sceneManager.add(group);

    // Crear AnimationController con animaciones procedurales
    this.animationController = new AnimationController(group, []);
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
   * Mueve el cuerpo físico a una nueva posición.
   */
  private moveBody(displacement: THREE.Vector3): void {
    if (!this.physicsBody || !this.physicsWorld) return;

    const body = this.physicsWorld.getBody(this.physicsBody);
    if (!body) return;

    const currentPos = body.translation();
    const newPos = {
      x: currentPos.x + displacement.x,
      y: currentPos.y + displacement.y,
      z: currentPos.z + displacement.z,
    };

    if (import.meta.env.DEV) {
      console.log(`[AdcCharacter ${this.id}] moveBody: displ=(${displacement.x.toFixed(2)}, ${displacement.z.toFixed(2)}), newPos=(${newPos.x.toFixed(2)}, ${newPos.z.toFixed(2)})`);
    }

    body.setNextKinematicTranslation(newPos);
  }

  /**
   * Convierte input 2D a movimiento 3D isométrico.
   */
  private inputToIsometric(moveDir: THREE.Vector2): THREE.Vector3 {
    const inputVector = new THREE.Vector3(moveDir.x, 0, moveDir.y);
    const isoMatrix = new THREE.Matrix4().makeRotationY(Math.PI / 4);
    inputVector.applyMatrix4(isoMatrix);
    return inputVector.normalize();
  }

  /**
   * Actualiza el movimiento del personaje basado en input y tiempo delta.
   */
  update(dt: number, inputState?: InputState): void {
    if (!this.isAlive()) return;

    // Actualizar estado según input
    if (inputState) {
      this.handleMovement(dt, inputState);
      this.handleAttack(inputState);
      this.handleAbility(inputState);
    }

    // Sincronizar modelo con cuerpo físico
    this.syncModelWithPhysics();

    // Actualizar rotación suave del modelo
    this.updateModelRotation(dt);

    // Actualizar proyectiles
    this.updateProjectiles(dt);

    // Actualizar animaciones
    this.updateAnimations(dt);
  }

  /**
   * Maneja el movimiento basado en input.
   */
  private handleMovement(dt: number, inputState: InputState): void {
    if (inputState.moveDir.lengthSq() > 0.01) {
      this.moveDirection = this.inputToIsometric(inputState.moveDir);
      const speed = this.getEffectiveStat('speed');
      const displacement = this.moveDirection.clone().multiplyScalar(speed * dt);

      if (this.physicsBody && this.physicsWorld) {
        this.moveBody(displacement);
      } else {
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
      // REGISTRO CRÍTICO: Sincronizar modelo con cuerpo físico para actualización automática
      this.physicsWorld.syncToThree(this.model, body);
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