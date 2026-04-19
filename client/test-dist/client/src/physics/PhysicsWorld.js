"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhysicsWorld = void 0;
const rapier3d_compat_1 = require("@dimforge/rapier3d-compat");
const THREE = require("three");
const CollisionGroups_1 = require("./CollisionGroups");
/**
 * Wrapper sobre la API de Rapier que sincroniza automáticamente
 * las posiciones de Three.js con el mundo físico.
 */
class PhysicsWorld {
    /**
     * Constructor privado (usar init()).
     */
    constructor(gravity) {
        this.world = null;
        this.timeStep = 1 / 60; // 60 Hz, igual que el game loop
        // Mapeo de handles a objetos Three.js para sincronización masiva
        this.bodyToMesh = new Map();
        // Mapeo inverso para limpieza
        this.meshToBody = new WeakMap();
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
    static async init(gravity) {
        // 1. Inicializar el módulo WASM de Rapier (esto descarga y compila el .wasm)
        await rapier3d_compat_1.default.init();
        // 2. Crear instancia con gravedad por defecto si no se proporciona
        // Para un juego top-down, usamos gravedad fuerte en Y para constraints, pero podríamos ponerla a 0.
        const g = gravity ?? new THREE.Vector3(0, -20, 0);
        const instance = new PhysicsWorld(g);
        // 3. Crear el mundo de física Rapier
        instance.world = new rapier3d_compat_1.default.World({
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
    createBody(options) {
        const world = this.getWorld();
        let bodyDesc;
        switch (options.type) {
            case 'dynamic':
                bodyDesc = rapier3d_compat_1.default.RigidBodyDesc.dynamic();
                break;
            case 'static':
                bodyDesc = rapier3d_compat_1.default.RigidBodyDesc.fixed();
                break;
            case 'kinematic':
                bodyDesc = rapier3d_compat_1.default.RigidBodyDesc.kinematicVelocityBased();
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
        const body = world.createRigidBody(bodyDesc);
        // Colisionador (opcional)
        if (options.collider) {
            // Aplicar grupos de colisión si se especifican
            if (options.collisionGroup !== undefined) {
                const membership = options.collisionGroup;
                const filter = options.collisionMask ?? 0xffffffff; // por defecto colisiona con todo
                const groups = (0, CollisionGroups_1.makeCollisionGroups)(membership, filter);
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
    syncToThree(mesh, bodyHandle) {
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
    step(deltaTime /* eslint-disable-line @typescript-eslint/no-unused-vars */) {
        if (!this.world) {
            throw new Error('PhysicsWorld no inicializado. Llama a init() primero.');
        }
        // Rapier no acepta un dt en step(); usa el timestep configurado internamente.
        // Para manejar diferentes deltaTimes, necesitamos acumular tiempo y hacer múltiples steps.
        // Implementación simple: hacer un step por cada frame (asumiendo deltaTime ≈ timestep fijo)
        this.world.step();
    }
    /**
     * Sincroniza todos los meshes registrados con sus cuerpos físicos.
     * Debe llamarse después de step() en cada fixed update.
     */
    syncAll() {
        // Optimización: si no hay bodies, salir temprano
        if (this.bodyToMesh.size === 0)
            return;
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
    stepAll(deltaTime) {
        this.step(deltaTime);
        this.syncAll();
    }
    /**
     * Sincroniza un mesh individual (método interno).
     */
    syncMesh(handle, mesh) {
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
    removeBody(handle) {
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
    getBody(handle) {
        return this.getWorld().getRigidBody(handle);
    }
    /**
     * Obtiene el handle asociado a un mesh (si existe).
     * @param mesh Objeto Three.js
     * @returns Handle o undefined
     */
    getBodyHandle(mesh) {
        return this.meshToBody.get(mesh);
    }
    /**
     * Obtiene el mundo Rapier subyacente (para operaciones avanzadas).
     * @returns RAPIER.World
     */
    getWorld() {
        if (!this.world) {
            throw new Error('PhysicsWorld no inicializado.');
        }
        return this.world;
    }
    /**
     * Libera todos los recursos WASM (llamar al finalizar la aplicación).
     */
    dispose() {
        if (this.world) {
            this.world.free();
            this.world = null;
        }
        this.bodyToMesh.clear();
    }
}
exports.PhysicsWorld = PhysicsWorld;
