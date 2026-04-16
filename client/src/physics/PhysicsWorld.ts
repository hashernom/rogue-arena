import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

/**
 * Mundo físico basado en Rapier3D.
 * Encapsula el mundo de física, los cuerpos rígidos y las colisiones.
 */
export class PhysicsWorld {
  private world: RAPIER.World | null = null;
  private gravity: THREE.Vector3;
  private timeStep: number = 1 / 60; // 60 Hz, igual que el game loop

  /**
   * Constructor privado (usar init()).
   */
  private constructor(gravity: THREE.Vector3) {
    this.gravity = gravity;
  }

  /**
   * Inicializa el módulo WASM de Rapier y crea una instancia de PhysicsWorld.
   * @param gravity Vector de gravedad (por defecto { x: 0, y: -9.81, z: 0 })
   * @returns Promise<PhysicsWorld> instancia lista para usar
   */
  static async init(gravity?: THREE.Vector3): Promise<PhysicsWorld> {
    // 1. Inicializar el módulo WASM de Rapier (esto descarga y compila el .wasm)
    await RAPIER.init();

    // 2. Crear instancia con gravedad por defecto si no se proporciona
    const g = gravity ?? new THREE.Vector3(0, -9.81, 0);
    const instance = new PhysicsWorld(g);

    // 3. Crear el mundo de física Rapier
    instance.world = new RAPIER.World({
      x: g.x,
      y: g.y,
      z: g.z,
    });

    console.log('✅ PhysicsWorld inicializado con Rapier3D');
    return instance;
  }

  /**
   * Avanza la simulación física un paso fijo.
   * @param deltaTime Tiempo transcurrido desde el último paso (en segundos)
   */
  step(deltaTime: number): void {
    if (!this.world) {
      throw new Error('PhysicsWorld no inicializado. Llama a init() primero.');
    }
    // Usar el timestep fijo para determinismo, pero permitir escalado si es necesario
    this.world.step(undefined); // event queue opcional (no necesitamos eventos de colisión por ahora)
  }

  /**
   * Obtiene el mundo Rapier subyacente (para operaciones avanzadas).
   * @returns RAPIER.World
   */
  getWorld(): RAPIER.World {
    if (!this.world) {
      throw new Error('PhysicsWorld no inicializado.');
    }
    return this.world;
  }

  /**
   * Crea un cuerpo rígido estático en la posición dada.
   * @param position Posición inicial (Vector3)
   * @param collider Descriptor del colisionador (opcional)
   * @returns RAPIER.RigidBody
   */
  createStaticBody(position: THREE.Vector3, collider?: RAPIER.ColliderDesc): RAPIER.RigidBody {
    const world = this.getWorld();
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z);
    const body = world.createRigidBody(bodyDesc);

    if (collider) {
      world.createCollider(collider, body);
    }

    return body;
  }

  /**
   * Crea un cuerpo rígido dinámico.
   * @param position Posición inicial
   * @param collider Descriptor del colisionador
   * @returns RAPIER.RigidBody
   */
  createDynamicBody(position: THREE.Vector3, collider: RAPIER.ColliderDesc): RAPIER.RigidBody {
    const world = this.getWorld();
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y, position.z);
    const body = world.createRigidBody(bodyDesc);
    world.createCollider(collider, body);
    return body;
  }

  /**
   * Limpia todos los cuerpos y colisionadores del mundo.
   */
  clear(): void {
    if (this.world) {
      // Nota: Rapier no tiene un método clear() directo, necesitamos iterar.
      // Por simplicidad, recreamos el mundo.
      const gravity = this.world.gravity;
      this.world.free();
      this.world = new RAPIER.World(gravity);
    }
  }

  /**
   * Libera los recursos WASM (llamar al finalizar la aplicación).
   */
  dispose(): void {
    if (this.world) {
      this.world.free();
      this.world = null;
    }
  }
}