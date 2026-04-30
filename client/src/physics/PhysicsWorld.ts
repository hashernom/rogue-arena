import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { makeCollisionGroups } from './CollisionGroups';

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
  linearDamping?: number;
  /**
   * Masa adicional para cuerpos dinámicos.
   * Útil para crear cuerpos muy pesados que no sean empujados fácilmente.
   */
  additionalMass?: number;
  /**
   * Habilita Continuous Collision Detection para cuerpos que se mueven a alta velocidad.
   * Útil para proyectiles.
   */
  ccdEnabled?: boolean;
  /**
   * Grupo de colisión al que pertenece este cuerpo.
   * Puede ser uno de los grupos predefinidos (Groups.PLAYER, etc.) o una combinación bitwise.
   * Si se proporciona, se aplicará automáticamente al collider.
   * Si no se proporciona, se usará el grupo por defecto (colisiona con todo).
   */
  collisionGroup?: number;
  /**
   * Máscara de colisión que define con qué grupos puede colisionar.
   * Por defecto se usa la máscara correspondiente al grupo (Masks).
   */
  collisionMask?: number;
  /**
   * Datos personalizados para asociar con el cuerpo físico.
   * Útil para almacenar identificadores (id) u otra información de la entidad.
   */
  userData?: Record<string, any>;
  /**
   * Desactiva el "sueño" del cuerpo dinámico.
   * Rapier duerme cuerpos estacionarios por defecto (canSleep=true),
   * lo que DESACTIVA la resolución de colisiones.
   * Los jugadores DEBEN tener canSleep=false para no atravesar paredes
   * tras estar estáticos contra ellas unos segundos.
   */
  canSleep?: boolean;
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
   * Conjunto de cuerpos que NUNCA deben dormirse (wakeUp() periódico).
   * Rapier duerme cuerpos dinámicos estacionarios tras ~1s, lo que
   * DESACTIVA la resolución de colisiones. Los jugadores necesitan
   * wakeUp() constante para no atravesar paredes/obstáculos.
   * Usamos wakeUp() en lugar de setCanSleep() porque este último
   * no está disponible en el wrapper rapier3d-compat y crashearía.
   */
  private alwaysAwakeBodies: Set<RigidBodyHandle> = new Set();

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
   * @remarks
   * Para arenas top-down donde la gravedad no es necesaria, se puede pasar { x: 0, y: 0, z: 0 }.
   * La gravedad en Y negativa es útil para constraints de personajes, pero puede ajustarse.
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

    return instance;
  }

  // Nota: Para cambiar la gravedad en tiempo de ejecución, se necesita recrear el mundo
  // o usar una API específica de Rapier. En la versión actual, la gravedad se establece
  // solo en la inicialización. Para arenas top-down, usar gravedad cero al init.

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
        // kinematicVelocityBased: el cuerpo se mueve via setLinvel().
        // Los cuerpos cinemáticos NO colisionan entre sí en Rapier,
        // por lo que player y enemies NO pueden ser ambos cinemáticos.
        // Los enemies se crean como dynamic con masa alta para colisionar.
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

    // Damping lineal (para freno suave)
    if (options.linearDamping !== undefined) {
      bodyDesc.setLinearDamping(options.linearDamping);
    }

    // Masa adicional para cuerpos dinámicos pesados
    if (options.additionalMass !== undefined) {
      bodyDesc.setAdditionalMass(options.additionalMass);
    }

    // Continuous Collision Detection (para proyectiles de alta velocidad)
    if (options.ccdEnabled) {
      bodyDesc.setCcdEnabled(true);
    }

    const body = world.createRigidBody(bodyDesc);

    // Desactivar "sueño" físico si se solicita (esencial para jugadores).
    // Rapier duerme cuerpos dinámicos estacionarios tras ~1s sin movimiento,
    // lo que DESACTIVA la resolución de colisiones contra estáticos.
    // Los jugadores DEBEN tener canSleep=false para no atravesar paredes.
    // En lugar de setCanSleep() (que NO existe en rapier3d-compat v0.19.3),
    // registramos el handle para wakeUp() periódico en step().
    if (options.canSleep !== undefined && !options.canSleep) {
      this.alwaysAwakeBodies.add(body.handle);
    }

    // Asignar userData si se proporciona
    if (options.userData) {
      body.userData = options.userData;
    }

    // Colisionador (opcional)
    if (options.collider) {
      // Aplicar grupos de colisión si se especifican
      if (options.collisionGroup !== undefined) {
        const membership = options.collisionGroup;
        const filter = options.collisionMask ?? 0xffffffff; // por defecto colisiona con todo
        const groups = makeCollisionGroups(membership, filter);
        options.collider.setCollisionGroups(groups);
      }
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
   * Avanza la simulación física un paso fijo.
   * @param deltaTime Tiempo transcurrido desde el último paso (en segundos)
   * @remarks
   * Para determinismo, se recomienda usar un timestep fijo (ej: 1/60 ≈ 0.0167).
   * Este método debe llamarse desde el fixed update del GameLoop.
   * Rapier maneja internamente la integración con el timestep configurado.
   */
  step(deltaTime: number /* eslint-disable-line @typescript-eslint/no-unused-vars */): void {
    if (!this.world) {
      throw new Error('PhysicsWorld no inicializado. Llama a init() primero.');
    }
    // Rapier no acepta un dt en step(); usa el timestep configurado internamente.
    // Para manejar diferentes deltaTimes, necesitamos acumular tiempo y hacer múltiples steps.
    // Implementación simple: hacer un step por cada frame (asumiendo deltaTime ≈ timestep fijo)
    this.world.step();

    // Despertar cuerpos que nunca deben dormirse (ej: jugadores).
    // Rapier duerme cuerpos dinámicos estacionarios tras ~1s, lo que
    // desactiva la resolución de colisiones contra objetos estáticos.
    // Sin wakeUp(), el jugador atravesaría paredes tras ~1s quieto.
    if (this.alwaysAwakeBodies.size > 0) {
      for (const handle of this.alwaysAwakeBodies) {
        const body = this.world.getRigidBody(handle);
        if (body) {
          body.wakeUp();
        } else {
          // Limpiar handles huérfanos (body fue eliminado externamente)
          this.alwaysAwakeBodies.delete(handle);
        }
      }
    }
  }

  /**
   * Sincroniza todos los meshes registrados con sus cuerpos físicos.
   * Debe llamarse después de step() en cada fixed update.
   */
  syncAll(): void {
    // Optimización: si no hay bodies, salir temprano
    if (this.bodyToMesh.size === 0) return;

    for (const [handle, mesh] of this.bodyToMesh) {
      this.syncMesh(handle, mesh);
    }
  }

  /**
   * Paso completo: avanza la simulación y sincroniza todos los meshes.
   * @param deltaTime Tiempo transcurrido (en segundos)
   * @remarks
   * Este método es conveniente para usar directamente desde el game loop.
   * Para mayor control, se pueden llamar step() y syncAll() por separado.
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

    // Limpiar del set de siempre-despiertos
    this.alwaysAwakeBodies.delete(handle);
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
    this.alwaysAwakeBodies.clear();
  }
}
