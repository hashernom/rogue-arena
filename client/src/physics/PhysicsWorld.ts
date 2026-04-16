import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

/**
 * Handle opaco para referenciar un cuerpo rígido de Rapier.
 * Es simplemente el índice del cuerpo en el mundo Rapier.
 */
export type RigidBodyHandle = number;

/**
 * Opciones para crear un cuerpo físico.
 */
export interface BodyOptions {
  type: 'dynamic' | 'static' | 'kinematic';
  position: THREE.Vector3;
  rotation?: THREE.Euler;
  collider?: RAPIER.ColliderDesc;
  lockRotations?: boolean; // Para personajes top-down
  lockTranslations?: boolean;
  gravityScale?: number;
}

/**
 * Wrapper sobre la API de Rapier que sincroniza automáticamente
 * las posiciones de Three.js con el mundo físico.
 */
export class PhysicsWorld {
  private world: RAPIER.World | null = null;
  private gravity: THREE.Vector3;
  private timeStep: number = 1 / 60; // 60 Hz, igual que el game loop

  // Mapeo de handles a objetos Three.js para sincronización masiva
  private bodyToMesh: Map<RigidBodyHandle, THREE.Object3D> = new Map();
  // Mapeo inverso para limpieza
  private meshToBody: WeakMap<THREE.Object3D, RigidBodyHandle> = new WeakMap();

  /**
   * Constructor privado (usar init()).
   */
  private constructor(gravity: THREE.Vector3) {
    this.gravity = gravity;
  }

  /**
   * Inicializa el módulo WASM de Rapier y crea una instancia de PhysicsWorld.
   * @param gravity Vector de gravedad (por defecto { x: 0, y: -20, z: 0 } para top-down)
   * @returns Promise<PhysicsWorld> instancia lista para usar
   */
  static async init(gravity?: THREE.Vector3): Promise<PhysicsWorld> {
    // 1. Inicializar el módulo WASM de Rapier (esto descarga y compila el .wasm)
    await RAPIER.init();

    // 2. Crear instancia con gravedad por defecto si no se proporciona
    // Para un juego top-down, usamos gravedad fuerte en Y para constraints, pero podríamos ponerla a 0.
    const g = gravity ?? new THREE.Vector3(0, -20, 0);
    const instance = new PhysicsWorld(g);

    // 3. Crear el mundo de física Rapier
    instance.world = new RAPIER.World({
      x: g.x,
      y: g.y,
      z: g.z,
    });

    console.log('✅ PhysicsWorld inicializado con Rapier3D (gravedad:', g, ')');
    return instance;
  }

  /**
   * Crea un cuerpo físico y retorna un handle.
   * @param options Configuración del cuerpo
   * @returns RigidBodyHandle que puede usarse para sincronizar o eliminar
   */
  createBody(options: BodyOptions): RigidBodyHandle {
    const world = this.getWorld();
    let bodyDesc: RAPIER.RigidBodyDesc;

    switch (options.type) {
      case 'dynamic':
        bodyDesc = RAPIER.RigidBodyDesc.dynamic();
        break;
      case 'static':
        bodyDesc = RAPIER.RigidBodyDesc.fixed();
        break;
      case 'kinematic':
        bodyDesc = RAPIER.RigidBodyDesc.kinematicVelocityBased();
        break;
      default:
        throw new Error(`Tipo de cuerpo no soportado: ${options.type}`);
    }

    // Posición
    bodyDesc.setTranslation(options.position.x, options.position.y, options.position.z);

    // Rotación (si se proporciona)
    if (options.rotation) {
      const q = new THREE.Quaternion().setFromEuler(options.rotation);
      bodyDesc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }

    // Bloqueos de movimiento (útil para personajes top-down)
    if (options.lockRotations) {
      bodyDesc.lockRotations();
    }
    if (options.lockTranslations) {
      bodyDesc.lockTranslations();
    }

    // Escala de gravedad
    if (options.gravityScale !== undefined) {
      bodyDesc.setGravityScale(options.gravityScale);
    }

    const body = world.createRigidBody(bodyDesc);

    // Colisionador (opcional)
    if (options.collider) {
      world.createCollider(options.collider, body);
    }

    return body.handle;
  }

  /**
   * Registra un mesh de Three.js para sincronización automática con un cuerpo físico.
   * @param mesh Objeto Three.js que se moverá según la simulación
   * @param bodyHandle Handle del cuerpo creado con createBody
   */
  syncToThree(mesh: THREE.Object3D, bodyHandle: RigidBodyHandle): void {
    const world = this.getWorld();
    const body = world.getRigidBody(bodyHandle);
    if (!body) {
      throw new Error(`No existe un cuerpo con handle ${bodyHandle}`);
    }

    // Sincronizar posición inicial de Rapier a Three.js
    const pos = body.translation();
    const rot = body.rotation();
    mesh.position.set(pos.x, pos.y, pos.z);
    mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);

    // Registrar en los mapas
    this.bodyToMesh.set(bodyHandle, mesh);
    this.meshToBody.set(mesh, bodyHandle);
  }

  /**
   * Avanza la simulación física un paso fijo y sincroniza todos los meshes registrados.
   * @param deltaTime Tiempo transcurrido desde el último paso (en segundos)
   */
  step(deltaTime: number): void {
    if (!this.world) {
      throw new Error('PhysicsWorld no inicializado. Llama a init() primero.');
    }
    // Usar el timestep fijo para determinismo
    this.world.step(undefined); // event queue opcional
  }

  /**
   * Sincroniza todos los meshes registrados con sus cuerpos físicos.
   * Debe llamarse después de step() en cada fixed update.
   */
  syncAll(): void {
    for (const [handle, mesh] of this.bodyToMesh) {
      this.syncMesh(handle, mesh);
    }
  }

  /**
   * Paso completo: avanza la simulación y sincroniza todos los meshes.
   * @param deltaTime Tiempo transcurrido (en segundos)
   */
  stepAll(deltaTime: number): void {
    this.step(deltaTime);
    this.syncAll();
  }

  /**
   * Sincroniza un mesh individual (método interno).
   */
  private syncMesh(handle: RigidBodyHandle, mesh: THREE.Object3D): void {
    const world = this.getWorld();
    const body = world.getRigidBody(handle);
    if (!body) {
      // El cuerpo pudo haber sido eliminado, limpiar el mapping
      this.bodyToMesh.delete(handle);
      return;
    }

    const pos = body.translation();
    const rot = body.rotation();
    mesh.position.set(pos.x, pos.y, pos.z);
    mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
  }

  /**
   * Elimina un cuerpo físico y limpia sus referencias.
   * @param handle Handle del cuerpo a eliminar
   */
  removeBody(handle: RigidBodyHandle): void {
    const world = this.getWorld();
    const body = world.getRigidBody(handle);
    if (!body) {
      console.warn(`Intentando eliminar cuerpo inexistente (handle ${handle})`);
      return;
    }

    // Eliminar colisionadores asociados (Rapier los elimina automáticamente al eliminar el cuerpo)
    world.removeRigidBody(body);

    // Limpiar mappings
    const mesh = this.bodyToMesh.get(handle);
    if (mesh) {
      this.bodyToMesh.delete(handle);
      this.meshToBody.delete(mesh);
    }
  }

  /**
   * Obtiene el cuerpo Rapier a partir de su handle.
   * @param handle Handle del cuerpo
   * @returns RAPIER.RigidBody o null si no existe
   */
  getBody(handle: RigidBodyHandle): RAPIER.RigidBody | null {
    return this.getWorld().getRigidBody(handle);
  }

  /**
   * Obtiene el handle asociado a un mesh (si existe).
   * @param mesh Objeto Three.js
   * @returns Handle o undefined
   */
  getBodyHandle(mesh: THREE.Object3D): RigidBodyHandle | undefined {
    return this.meshToBody.get(mesh);
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
   * Libera todos los recursos WASM (llamar al finalizar la aplicación).
   */
  dispose(): void {
    if (this.world) {
      this.world.free();
      this.world = null;
    }
    this.bodyToMesh.clear();
  }
}