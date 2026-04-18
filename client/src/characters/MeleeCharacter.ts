import * as THREE from 'three';
import { Character, type CharacterStats, CharacterState } from './Character';
import type { InputState } from '../engine/InputManager';
import type { PhysicsWorld, RigidBodyHandle } from '../physics/PhysicsWorld';
import { EventBus } from '../engine/EventBus';
import { AssetLoader } from '../engine/AssetLoader';
import { SceneManager } from '../engine/SceneManager';
import { BodyFactory } from '../physics/BodyFactory';

/**
 * Caballero melee, primer personaje jugable.
 * Extiende Character y añade movimiento isométrico, modelo 3D y habilidades especiales.
 */
export class MeleeCharacter extends Character {
  /** Modelo 3D del caballero */
  private model: THREE.Group | null = null;
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
      // Cargar modelo GLB desde la carpeta pública
      const gltf = await this.assetLoader.load('/models/Knight.glb');
      const model = this.assetLoader.clone(gltf);
      model.name = `Knight_${this.id}`;

      // Ajustar escala y orientación para que coincida con el mundo del juego
      // El modelo de KayKit puede ser demasiado grande; escalar a 0.5
      model.scale.set(0.5, 0.5, 0.5);
      // Rotar para que mire hacia la dirección correcta (depende del modelo)
      model.rotation.y = Math.PI; // 180 grados si es necesario
      model.position.set(0, 0, 0);

      // Configurar sombras
      model.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      this.model = model;
      // Agregar a la escena
      this.sceneManager.add(model);

      // Si hay cuerpo físico, sincronizar posición inicial
      if (this.physicsBody && this.physicsWorld) {
        const position = this.getBodyPosition();
        if (position) {
          model.position.copy(position);
        }
      }
    } catch (error) {
      console.error(`[MeleeCharacter ${this.id}] Failed to load knight GLB:`, error);
      // Fallback a modelo procedural
      this.createFallbackModel();
    }
  }

  /**
   * Crea un modelo de fallback (cubo) si el GLTF no carga.
   */
  private createFallbackModel(): void {
    const geometry = new THREE.BoxGeometry(1, 2, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `Knight_Fallback_${this.id}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const group = new THREE.Group();
    group.add(mesh);
    this.model = group;
    this.sceneManager.add(group);
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

    // Para cuerpos cinemáticos, usar setNextKinematicTranslation
    const currentPos = body.translation();
    const newPos = {
      x: currentPos.x + displacement.x,
      y: currentPos.y + displacement.y,
      z: currentPos.z + displacement.z,
    };

    body.setNextKinematicTranslation(newPos);
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
        this.moveBody(displacement);
      } else {
        // Movimiento sin física (fallback)
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
    }
  }

  /**
   * Obtiene el modelo 3D (para debugging).
   */
  getModel(): THREE.Group | null {
    return this.model;
  }
}
