import * as THREE from 'three';
import type { SceneManager } from '../engine/SceneManager';
import type { PhysicsWorld, RigidBodyHandle } from '../physics/PhysicsWorld';
import { BodyFactory } from '../physics/BodyFactory';

/**
 * Configuración visual de la arena.
 */
export interface ArenaColors {
  floor: number;
  wall: number;
  corner: number;
  floorLine: number;
}

const DEFAULT_COLORS: ArenaColors = {
  floor: 0x3d5a3d,       // Verde oscuro piedra
  wall: 0x6b6b6b,        // Gris medio
  corner: 0x8a8a8a,      // Gris claro para esquinas
  floorLine: 0x2d4a2d,   // Línea divisoria más oscura
};

/**
 * Arena de juego con suelo, muros perimetrales con física y estética low poly.
 *
 * - Suelo: PlaneGeometry(30, 30) con color plano
 * - 4 muros perimetrales con colliders Rapier Fixed
 * - 4 esquinas decorativas
 * - Línea central divisoria
 */
export class Arena {
  private sceneManager: SceneManager;
  private physicsWorld: PhysicsWorld;
  private colors: ArenaColors;

  /** Grupo que contiene todos los meshes de la arena (para limpieza fácil) */
  private group: THREE.Group;

  /** Handles de los cuerpos físicos de los muros */
  private wallBodies: RigidBodyHandle[] = [];

  /** Handle del cuerpo físico del suelo */
  private floorBody: RigidBodyHandle | null = null;

  /** Dimensiones de la arena */
  public static readonly ARENA_SIZE = 30; // 30x30 metros
  public static readonly WALL_HEIGHT = 3; // Aumentado de 2 a 3 para cubrir toda la cápsula del jugador
  public static readonly WALL_THICKNESS = 1.0; // Aumentado de 0.5 a 1.0 para colisión más robusta

  constructor(
    sceneManager: SceneManager,
    physicsWorld: PhysicsWorld,
    colors?: Partial<ArenaColors>
  ) {
    this.sceneManager = sceneManager;
    this.physicsWorld = physicsWorld;
    this.colors = { ...DEFAULT_COLORS, ...colors };
    this.group = new THREE.Group();
    this.group.name = 'Arena';
  }

  /**
   * Construye la arena completa: suelo, muros, esquinas y colliders.
   */
  build(): void {
    this.createFloor();
    this.createCenterLine();
    this.createWalls();
    this.createCorners();
    this.sceneManager.add(this.group);
    console.log('[Arena] Arena 30x30m construida con muros físicos');
  }

  /**
   * Suelo: plano low poly de 30x30m.
   */
  private createFloor(): void {
    const geometry = new THREE.PlaneGeometry(Arena.ARENA_SIZE, Arena.ARENA_SIZE);
    const material = new THREE.MeshPhongMaterial({
      color: this.colors.floor,
      shininess: 10,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -2;
    mesh.receiveShadow = true;
    mesh.name = 'ArenaFloor';
    this.group.add(mesh);

    // Collider físico del suelo: cuboide delgado en y=-2
    // El suelo evita que los personajes caigan por debajo de la arena
    const floorSize = new THREE.Vector3(Arena.ARENA_SIZE, 0.2, Arena.ARENA_SIZE);
    const floorPos = new THREE.Vector3(0, -2, 0);
    this.floorBody = BodyFactory.createFloorBody(
      this.physicsWorld,
      floorPos,
      floorSize
    );
  }

  /**
   * Línea central decorativa que divide la arena en dos mitades.
   */
  private createCenterLine(): void {
    const geometry = new THREE.PlaneGeometry(0.15, Arena.ARENA_SIZE);
    const material = new THREE.MeshPhongMaterial({
      color: this.colors.floorLine,
      shininess: 5,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -1.99; // Ligeramente sobre el suelo
    mesh.receiveShadow = true;
    mesh.name = 'ArenaCenterLine';
    this.group.add(mesh);
  }

  /**
   * Crea los 4 muros perimetrales con sus colliders Rapier.
   *
   * Los muros se posicionan en los bordes del suelo (30x30).
   * Cada muro es un BoxGeometry con un collider cuboide Rapier Fixed.
   */
  private createWalls(): void {
    const halfSize = Arena.ARENA_SIZE / 2;
    const wallHeight = Arena.WALL_HEIGHT;
    const wallThickness = Arena.WALL_THICKNESS;

    // Material low poly para muros
    const material = new THREE.MeshPhongMaterial({
      color: this.colors.wall,
      flatShading: true,
      shininess: 15,
    });

    // Los muros se posicionan en el BORDE del suelo (halfSize).
    // Con wallThickness=1.0, el muro se extiende 0.5 hacia adentro y 0.5 hacia afuera.
    // La cara interior del muro está en halfSize - 0.5, que es el borde del suelo.
    // La posición Y del muro: el suelo está en y=-2, el muro tiene altura 3,
    // así que el centro está en y = -2 + 3/2 = -0.5, abarcando desde y=-2 hasta y=1.
    const wallY = -2 + wallHeight / 2; // -2 + 1.5 = -0.5

    // Configuración de cada muro: [nombre, posición, tamaño (ancho, alto, profundo)]
    const wallConfigs: Array<{
      name: string;
      position: THREE.Vector3;
      size: THREE.Vector3;
    }> = [
      // Muro norte (z = -halfSize)
      {
        name: 'WallNorth',
        position: new THREE.Vector3(0, wallY, -halfSize),
        size: new THREE.Vector3(Arena.ARENA_SIZE, wallHeight, wallThickness),
      },
      // Muro sur (z = +halfSize)
      {
        name: 'WallSouth',
        position: new THREE.Vector3(0, wallY, halfSize),
        size: new THREE.Vector3(Arena.ARENA_SIZE, wallHeight, wallThickness),
      },
      // Muro oeste (x = -halfSize)
      {
        name: 'WallWest',
        position: new THREE.Vector3(-halfSize, wallY, 0),
        size: new THREE.Vector3(wallThickness, wallHeight, Arena.ARENA_SIZE),
      },
      // Muro este (x = +halfSize)
      {
        name: 'WallEast',
        position: new THREE.Vector3(halfSize, wallY, 0),
        size: new THREE.Vector3(wallThickness, wallHeight, Arena.ARENA_SIZE),
      },
    ];

    for (const config of wallConfigs) {
      // Mesh visual
      const geometry = new THREE.BoxGeometry(config.size.x, config.size.y, config.size.z);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(config.position);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = config.name;
      this.group.add(mesh);

      // Collider físico
      const bodyHandle = BodyFactory.createWallBody(
        this.physicsWorld,
        config.position,
        config.size
      );
      this.wallBodies.push(bodyHandle);
    }
  }

  /**
   * Esquinas decorativas: cubos en las 4 esquinas de la arena.
   * Ayudan a dar sensación de "estructura" y ocultan las uniones de los muros.
   */
  private createCorners(): void {
    const halfSize = Arena.ARENA_SIZE / 2;
    const cornerSize = 0.8;
    const wallHeight = Arena.WALL_HEIGHT;
    const wallY = -2 + wallHeight / 2; // -0.5

    const material = new THREE.MeshPhongMaterial({
      color: this.colors.corner,
      flatShading: true,
      shininess: 20,
    });

    const positions: Array<[number, number, number]> = [
      [-halfSize, wallY, -halfSize], // Noroeste
      [halfSize, wallY, -halfSize],  // Noreste
      [-halfSize, wallY, halfSize],  // Suroeste
      [halfSize, wallY, halfSize],   // Sureste
    ];

    for (const [x, y, z] of positions) {
      const geometry = new THREE.BoxGeometry(cornerSize, wallHeight, cornerSize);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `ArenaCorner_${x}_${z}`;
      this.group.add(mesh);
    }
  }

  /**
   * Elimina la arena de la escena y libera los cuerpos físicos.
   */
  dispose(): void {
    // Remover meshes de la escena
    this.sceneManager.remove(this.group);

    // Liberar cuerpos físicos de los muros
    for (const handle of this.wallBodies) {
      this.physicsWorld.removeBody(handle);
    }
    this.wallBodies = [];

    // Liberar cuerpo físico del suelo
    if (this.floorBody) {
      this.physicsWorld.removeBody(this.floorBody);
      this.floorBody = null;
    }

    // Liberar geometrías y materiales
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });

    console.log('[Arena] Arena eliminada y recursos liberados');
  }
}
