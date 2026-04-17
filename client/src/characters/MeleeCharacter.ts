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
    this.loadModel();
  }

  /**
   * Carga el modelo GLTF del caballero y lo agrega a la escena.
   */
  private async loadModel(): Promise<void> {
    console.log(`[MeleeCharacter ${this.id}] Creating procedural knight model...`);
    
    // Crear un modelo simple de caballero usando geometrías básicas
    const group = new THREE.Group();
    group.name = `Knight_${this.id}`;
    
    // Cuerpo (cilindro)
    const bodyGeometry = new THREE.CylinderGeometry(0.4, 0.5, 1.2, 8);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a4b8d, // Azul metálico
      metalness: 0.7,
      roughness: 0.3
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.6;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    
    // Cabeza (esfera)
    const headGeometry = new THREE.SphereGeometry(0.3, 8, 8);
    const headMaterial = new THREE.MeshStandardMaterial({
      color: 0xd4af37, // Dorado
      metalness: 0.8,
      roughness: 0.2
    });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 1.5;
    head.castShadow = true;
    head.receiveShadow = true;
    group.add(head);
    
    // Brazos (cilindros)
    const armGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.8, 6);
    const armMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a4b8d,
      metalness: 0.7,
      roughness: 0.3
    });
    
    const leftArm = new THREE.Mesh(armGeometry, armMaterial);
    leftArm.position.set(-0.6, 0.8, 0);
    leftArm.rotation.z = Math.PI / 6;
    leftArm.castShadow = true;
    leftArm.receiveShadow = true;
    group.add(leftArm);
    
    const rightArm = new THREE.Mesh(armGeometry, armMaterial);
    rightArm.position.set(0.6, 0.8, 0);
    rightArm.rotation.z = -Math.PI / 6;
    rightArm.castShadow = true;
    rightArm.receiveShadow = true;
    group.add(rightArm);
    
    // Piernas (cilindros)
    const legGeometry = new THREE.CylinderGeometry(0.15, 0.15, 1.0, 6);
    const legMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a3b7d,
      metalness: 0.7,
      roughness: 0.3
    });
    
    const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
    leftLeg.position.set(-0.25, -0.5, 0);
    leftLeg.castShadow = true;
    leftLeg.receiveShadow = true;
    group.add(leftLeg);
    
    const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
    rightLeg.position.set(0.25, -0.5, 0);
    rightLeg.castShadow = true;
    rightLeg.receiveShadow = true;
    group.add(rightLeg);
    
    // Espada (caja + cilindro)
    const swordHandleGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6);
    const swordHandleMaterial = new THREE.MeshStandardMaterial({
      color: 0x8b4513, // Marrón
      metalness: 0.5,
      roughness: 0.5
    });
    const swordHandle = new THREE.Mesh(swordHandleGeometry, swordHandleMaterial);
    swordHandle.position.set(0.8, 0.8, 0);
    swordHandle.rotation.z = Math.PI / 2;
    swordHandle.castShadow = true;
    swordHandle.receiveShadow = true;
    group.add(swordHandle);
    
    const swordBladeGeometry = new THREE.BoxGeometry(0.05, 0.8, 0.1);
    const swordBladeMaterial = new THREE.MeshStandardMaterial({
      color: 0xcccccc, // Plateado
      metalness: 0.9,
      roughness: 0.1
    });
    const swordBlade = new THREE.Mesh(swordBladeGeometry, swordBladeMaterial);
    swordBlade.position.set(0.8, 1.2, 0);
    swordBlade.castShadow = true;
    swordBlade.receiveShadow = true;
    group.add(swordBlade);
    
    // Escudo (cilindro aplanado)
    const shieldGeometry = new THREE.CylinderGeometry(0.4, 0.4, 0.05, 8);
    const shieldMaterial = new THREE.MeshStandardMaterial({
      color: 0xc41e3a, // Rojo
      metalness: 0.6,
      roughness: 0.4
    });
    const shield = new THREE.Mesh(shieldGeometry, shieldMaterial);
    shield.position.set(-0.8, 0.8, 0);
    shield.rotation.x = Math.PI / 2;
    shield.castShadow = true;
    shield.receiveShadow = true;
    group.add(shield);
    
    // Configurar el grupo completo
    group.scale.set(1, 1, 1);
    group.position.set(0, 0, 0);
    
    this.model = group;
    // Agregar a la escena
    this.sceneManager.add(group);
    console.log(`[MeleeCharacter ${this.id}] Procedural knight model created and added to scene`);

    // Si hay cuerpo físico, sincronizar posición inicial
    if (this.physicsBody && this.physicsWorld) {
      const position = this.getBodyPosition();
      if (position) {
        group.position.copy(position);
        console.log(`[MeleeCharacter ${this.id}] Model positioned at physics body:`, position);
      }
    }
  }

  /**
   * Crea un modelo de fallback (cubo) si el GLTF no carga.
   */
  private createFallbackModel(): void {
    const geometry = new THREE.BoxGeometry(1, 2, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
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
  private updateModelRotation(dt: number): void {
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
    console.log(`Knight ${this.id} attacks!`);
    
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
    
    console.log(`Knight ${this.id} uses Charge ability!`);
    
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
      console.log(`Knight ${this.id} fury ready!`);
      
      // Emitir evento visual/auditivo (placeholder)
      // Nota: Necesitamos agregar este evento a GameEvents si queremos tipado fuerte
      this.eventBus.emit('player:furyReady' as any, { playerId: this.id });
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