import * as THREE from 'three';
import type { SceneManager } from '../engine/SceneManager';
import type { PhysicsWorld, RigidBodyHandle } from '../physics/PhysicsWorld';
import { BodyFactory } from '../physics/BodyFactory';

/**
 * Configuración visual de la arena.
 */
export interface ArenaColors {
  floor: number;
  outerFloor: number;
  wall: number;
  corner: number;
  floorLine: number;
  stoneTile: number;
  ruin: number;
  rock: number;
}

const DEFAULT_COLORS: ArenaColors = {
  floor: 0x4a4a4a,         // Piedra gris oscura para el piso interior
  outerFloor: 0x3a3a3a,    // Tierra/piedra más oscura para el exterior
  wall: 0x6b5b4f,          // Piedra de muro castillo (marrón-grisáceo)
  corner: 0x5a4a3e,        // Piedra más oscura para pilares de esquina
  floorLine: 0x3a3a3a,     // Línea de junta entre losas (tylería)
  stoneTile: 0x555555,     // Losa de piedra individual (más clara que el fondo)
  ruin: 0x6b5b4f,          // Color de ruinas (paredes caídas)
  rock: 0x5a5a5a,          // Rocas decorativas grises
};

/**
 * Arena de juego con temática de mazmorra/castillo medieval.
 *
 * - Suelo de losas de piedra con patrón de tylería
 * - Muros perimetrales de piedra con colliders Rapier
 * - Pilares robustos en las esquinas
 * - Ruinas y rocas decorativas en el exterior
 * - Postes de piedra a lo largo de los muros
 */
export class Arena {
  private sceneManager: SceneManager;
  private physicsWorld: PhysicsWorld;
  private colors: ArenaColors;

  /** Grupo que contiene todos los meshes de la arena (para limpieza fácil) */
  private group: THREE.Group;

  /** Grupo para decoraciones del exterior (ruinas, rocas) */
  private decorationsGroup: THREE.Group;

  /** Handles de los cuerpos físicos de los muros */
  private wallBodies: RigidBodyHandle[] = [];

  /** Handle del cuerpo físico del suelo */
  private floorBody: RigidBodyHandle | null = null;

  /** Dimensiones de la arena jugable (dentro de los muros) */
  public static readonly ARENA_SIZE = 34; // 34x34 metros

  /** Tamaño del piso exterior decorativo */
  public static readonly OUTER_FLOOR_SIZE = 120;

  /** Altura de los muros perimetrales */
  public static readonly WALL_HEIGHT = 3;

  /** Grosor de los muros perimetrales */
  public static readonly WALL_THICKNESS = 1.0;

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
    this.decorationsGroup = new THREE.Group();
    this.decorationsGroup.name = 'ArenaDecorations';
  }

  /**
   * Construye la arena completa con temática de mazmorra.
   */
  build(): void {
    this.createOuterFloor();
    this.createFloor();
    this.createFloorPattern();
    this.createWalls();
    this.createCorners();
    this.createRuins();
    this.createRockFormations();
    this.sceneManager.add(this.group);
    this.sceneManager.add(this.decorationsGroup);
    console.log('[Arena] Arena construida con temática de mazmorra/castillo');
  }

  // ======================================================================
  // PISOS
  // ======================================================================

  /**
   * Piso exterior: tierra/piedra oscura que se extiende más allá de la arena.
   */
  private createOuterFloor(): void {
    const geometry = new THREE.PlaneGeometry(Arena.OUTER_FLOOR_SIZE, Arena.OUTER_FLOOR_SIZE);
    const material = new THREE.MeshPhongMaterial({
      color: this.colors.outerFloor,
      shininess: 2,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -2.01;
    mesh.receiveShadow = true;
    mesh.name = 'OuterFloor';
    this.group.add(mesh);
  }

  /**
   * Suelo interior (zona jugable): losas de piedra.
   */
  private createFloor(): void {
    // Piso base oscuro (la base sobre la que van las losas)
    const geometry = new THREE.PlaneGeometry(Arena.ARENA_SIZE, Arena.ARENA_SIZE);
    const material = new THREE.MeshPhongMaterial({
      color: this.colors.floor,
      shininess: 5,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -2;
    mesh.receiveShadow = true;
    mesh.name = 'ArenaFloor';
    this.group.add(mesh);

    // Collider físico del suelo
    const floorSize = new THREE.Vector3(Arena.ARENA_SIZE, 0.2, Arena.ARENA_SIZE);
    const floorPos = new THREE.Vector3(0, -2, 0);
    this.floorBody = BodyFactory.createFloorBody(
      this.physicsWorld,
      floorPos,
      floorSize
    );
  }

  /**
   * Patrón de tylería (losas de piedra) en el suelo.
   * Crea líneas tenues formando un grid de losas rectangulares,
   * simulando un piso de piedra de castillo.
   */
  private createFloorPattern(): void {
    const halfSize = Arena.ARENA_SIZE / 2;
    const tileWidth = 1.5;  // Ancho de cada losa
    const tileDepth = 1.0;  // Profundidad de cada losa
    const lineColor = this.colors.floorLine;
    const lineOpacity = 0.15; // Muy sutil

    const lineMaterial = new THREE.MeshBasicMaterial({
      color: lineColor,
      transparent: true,
      opacity: lineOpacity,
      depthWrite: false,
    });

    // Líneas en eje X (horizontales)
    const xCount = Math.floor(Arena.ARENA_SIZE / tileDepth);
    for (let i = 0; i <= xCount; i++) {
      const z = -halfSize + i * tileDepth;
      const lineGeo = new THREE.PlaneGeometry(Arena.ARENA_SIZE, 0.03);
      const line = new THREE.Mesh(lineGeo, lineMaterial);
      line.rotation.x = -Math.PI / 2;
      line.position.set(0, -1.99, z);
      line.name = `FloorLineX_${i}`;
      this.group.add(line);
    }

    // Líneas en eje Z (verticales) con offset alternado para simular patrón de ladrillo
    const zCount = Math.floor(Arena.ARENA_SIZE / tileWidth);
    for (let i = 0; i <= zCount; i++) {
      const x = -halfSize + i * tileWidth;
      const lineGeo = new THREE.PlaneGeometry(0.03, Arena.ARENA_SIZE);
      const line = new THREE.Mesh(lineGeo, lineMaterial);
      line.rotation.x = -Math.PI / 2;
      line.position.set(x, -1.99, 0);
      line.name = `FloorLineZ_${i}`;
      this.group.add(line);
    }

    // Pequeñas variaciones: algunas losas individuales ligeramente más claras
    const slabMaterial = new THREE.MeshBasicMaterial({
      color: this.colors.stoneTile,
      transparent: true,
      opacity: 0.05,
      depthWrite: false,
    });

    // Colocar algunas losas resaltadas aleatoriamente (usando posiciones fijas)
    const slabPositions: Array<[number, number]> = [
      [-6, -4], [3, -2], [8, 5], [-3, 7], [-9, -6],
      [5, -7], [-7, 3], [2, -9], [10, 0], [-5, 8],
    ];
    for (const [sx, sz] of slabPositions) {
      const slabGeo = new THREE.PlaneGeometry(tileWidth * 0.85, tileDepth * 0.85);
      const slab = new THREE.Mesh(slabGeo, slabMaterial);
      slab.rotation.x = -Math.PI / 2;
      slab.position.set(sx, -1.98, sz);
      slab.name = `FloorSlab_${sx}_${sz}`;
      this.group.add(slab);
    }
  }

  // ======================================================================
  // MUROS DE PIEDRA
  // ======================================================================

  /**
   * Crea muros perimetrales de piedra con colliders Rapier.
   * Reemplaza la valla de madera anterior por muros de piedra macizos.
   */
  private createWalls(): void {
    const halfSize = Arena.ARENA_SIZE / 2;
    const wallHeight = Arena.WALL_HEIGHT;
    const wallThickness = Arena.WALL_THICKNESS;
    const wallY = -2 + wallHeight / 2;

    // Material base del muro de piedra
    const material = new THREE.MeshPhongMaterial({
      color: this.colors.wall,
      flatShading: true,
      shininess: 8,
    });

    // Material para las hiladas de piedra (detalles decorativos)
    const detailMaterial = new THREE.MeshPhongMaterial({
      color: this.colors.corner,
      flatShading: true,
      shininess: 5,
    });

    const wallConfigs: Array<{
      name: string;
      position: THREE.Vector3;
      size: THREE.Vector3;
      isHorizontal: boolean;
    }> = [
      {
        name: 'WallNorth',
        position: new THREE.Vector3(0, wallY, -halfSize),
        size: new THREE.Vector3(Arena.ARENA_SIZE, wallHeight, wallThickness),
        isHorizontal: true,
      },
      {
        name: 'WallSouth',
        position: new THREE.Vector3(0, wallY, halfSize),
        size: new THREE.Vector3(Arena.ARENA_SIZE, wallHeight, wallThickness),
        isHorizontal: true,
      },
      {
        name: 'WallWest',
        position: new THREE.Vector3(-halfSize, wallY, 0),
        size: new THREE.Vector3(wallThickness, wallHeight, Arena.ARENA_SIZE),
        isHorizontal: false,
      },
      {
        name: 'WallEast',
        position: new THREE.Vector3(halfSize, wallY, 0),
        size: new THREE.Vector3(wallThickness, wallHeight, Arena.ARENA_SIZE),
        isHorizontal: false,
      },
    ];

    for (const config of wallConfigs) {
      // Muro principal
      const geometry = new THREE.BoxGeometry(config.size.x, config.size.y, config.size.z);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(config.position);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = config.name;
      this.group.add(mesh);

      // Hilada decorativa superior (franja más oscura en la parte de arriba)
      const trimGeo = new THREE.BoxGeometry(
        config.size.x + 0.2,
        0.15,
        config.size.z + 0.2
      );
      const trim = new THREE.Mesh(trimGeo, detailMaterial);
      trim.position.copy(config.position);
      trim.position.y = wallY + wallHeight / 2 - 0.1;
      trim.castShadow = true;
      trim.receiveShadow = true;
      trim.name = `${config.name}_Trim`;
      this.group.add(trim);

      // Postes de piedra cada ~3m a lo largo del muro
      const isHorizontal = config.isHorizontal;
      const spanLength = isHorizontal ? config.size.x : config.size.z;
      const postSpacing = 3.0;
      const postCount = Math.max(1, Math.floor(spanLength / postSpacing) - 1);
      const startOffset = (spanLength - postSpacing * (postCount + 1)) / 2 + postSpacing;

      for (let i = 0; i < postCount; i++) {
        const offset = startOffset + i * postSpacing;
        const offsetFromCenter = offset - spanLength / 2;
        const postPos = config.position.clone();

        if (isHorizontal) {
          postPos.x += offsetFromCenter;
        } else {
          postPos.z += offsetFromCenter;
        }

        // Poste cuadrado de piedra
        const postGeo = new THREE.BoxGeometry(0.4, wallHeight * 0.8, 0.4);
        const post = new THREE.Mesh(postGeo, detailMaterial);
        post.position.copy(postPos);
        post.position.y = -2 + wallHeight * 0.4;
        post.castShadow = true;
        post.receiveShadow = true;
        post.name = `${config.name}_Post_${i}`;
        this.group.add(post);
      }

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
   * Pilares de piedra en las 4 esquinas de la arena.
   * Más anchos y ornamentados que los postes de los muros.
   */
  private createCorners(): void {
    const halfSize = Arena.ARENA_SIZE / 2;
    const wallHeight = Arena.WALL_HEIGHT;
    const wallY = -2 + wallHeight / 2;

    const material = new THREE.MeshPhongMaterial({
      color: this.colors.corner,
      flatShading: true,
      shininess: 10,
    });

    const capMaterial = new THREE.MeshPhongMaterial({
      color: 0x7a6a5e, // Piedra ligeramente más clara para el capitel
      flatShading: true,
      shininess: 12,
    });

    const positions: Array<[number, number, number]> = [
      [-halfSize, wallY, -halfSize], // Noroeste
      [halfSize, wallY, -halfSize],  // Noreste
      [-halfSize, wallY, halfSize],  // Suroeste
      [halfSize, wallY, halfSize],   // Sureste
    ];

    for (const [x, y, z] of positions) {
      // Pilar principal (más grueso que los postes)
      const pillarGeo = new THREE.BoxGeometry(0.8, wallHeight * 0.85, 0.8);
      const pillar = new THREE.Mesh(pillarGeo, material);
      pillar.position.set(x, y, z);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      pillar.name = `ArenaCorner_${x}_${z}`;
      this.group.add(pillar);

      // Capitel decorativo en la parte superior
      const capGeo = new THREE.BoxGeometry(1.0, 0.2, 1.0);
      const cap = new THREE.Mesh(capGeo, capMaterial);
      cap.position.set(x, y + wallHeight * 0.425, z);
      cap.castShadow = true;
      cap.receiveShadow = true;
      cap.name = `ArenaCornerCap_${x}_${z}`;
      this.group.add(cap);

      // Base del pilar
      const baseGeo = new THREE.BoxGeometry(1.0, 0.15, 1.0);
      const base = new THREE.Mesh(baseGeo, capMaterial);
      base.position.set(x, y - wallHeight * 0.425, z);
      base.castShadow = true;
      base.receiveShadow = true;
      base.name = `ArenaCornerBase_${x}_${z}`;
      this.group.add(base);
    }
  }

  // ======================================================================
  // DECORACIONES EXTERIORES
  // ======================================================================

  /**
   * Crea estructuras de ruinas fuera de la arena:
   * paredes caídas, columnas rotas, montículos de escombros.
   */
  private createRuins(): void {
    const halfSize = Arena.ARENA_SIZE / 2;
    const outerLimit = halfSize + 15; // Área exterior donde plantar ruinas

    const ruinMaterial = new THREE.MeshPhongMaterial({
      color: this.colors.ruin,
      flatShading: true,
      shininess: 3,
    });

    const rubbleMaterial = new THREE.MeshPhongMaterial({
      color: 0x4a4a4a,
      flatShading: true,
      shininess: 2,
    });

    // Configuraciones de ruinas: [x, z, ancho, alto, profundo, rotationY]
    const ruins: Array<[number, number, number, number, number, number]> = [
      // Esquina noroeste - muro caído
      [-halfSize - 4, -halfSize - 3, 3, 0.8, 0.8, 0.3],
      [-halfSize - 6, -halfSize - 1, 1.5, 0.5, 0.5, -0.5],
      [-halfSize - 2, -halfSize - 5, 4, 1.2, 0.6, 0.8],

      // Esquina noreste - columna rota y escombros
      [halfSize + 3, -halfSize - 4, 0.8, 1.5, 0.8, 0],
      [halfSize + 5, -halfSize - 2, 0.6, 0.8, 0.6, 0.5],
      [halfSize + 4, -halfSize - 5, 2, 0.4, 1.5, 0.2],

      // Esquina suroeste - pared semi-derrumbada
      [-halfSize - 5, halfSize + 2, 4, 1.0, 0.5, 0.6],
      [-halfSize - 3, halfSize + 4, 0.5, 1.8, 0.5, 0.3],
      [-halfSize - 7, halfSize + 3, 1.2, 0.4, 0.8, -0.4],

      // Esquina sureste - montículo de escombros
      [halfSize + 4, halfSize + 3, 2.5, 0.7, 1.5, 0.7],
      [halfSize + 2, halfSize + 5, 1.0, 0.3, 1.0, 0],
      [halfSize + 6, halfSize + 1, 0.6, 0.6, 0.6, 0.9],

      // Algunas ruinas dispersas
      [-10, -halfSize - 6, 1.2, 0.4, 0.4, 0.5],
      [12, -halfSize - 5, 0.8, 0.6, 0.3, -0.3],
      [-8, halfSize + 6, 1.5, 0.5, 0.8, 0.1],
      [14, halfSize + 4, 0.5, 0.7, 0.5, 0.8],
    ];

    for (const [rx, rz, rw, rh, rd, rotY] of ruins) {
      const ruinGeo = new THREE.BoxGeometry(rw, rh, rd);
      const ruin = new THREE.Mesh(ruinGeo, ruinMaterial);
      ruin.position.set(rx, -2 + rh / 2, rz);
      ruin.rotation.y = rotY;
      ruin.castShadow = true;
      ruin.receiveShadow = true;
      ruin.name = `Ruin_${rx}_${rz}`;
      this.decorationsGroup.add(ruin);
    }

    // Escombros pequeños (cubos pequeños dispersos alrededor de las ruinas)
    const rubblePositions: Array<[number, number, number, number]> = [
      [-halfSize - 3, -2, -halfSize - 2, 0.3],
      [-halfSize - 5, -2, -halfSize - 4, 0.2],
      [-halfSize - 1, -2, -halfSize - 6, 0.25],
      [halfSize + 4, -2, -halfSize - 3, 0.2],
      [halfSize + 6, -2, -halfSize - 4, 0.3],
      [halfSize + 2, -2, -halfSize - 6, 0.15],
      [-halfSize - 6, -2, halfSize + 3, 0.25],
      [-halfSize - 4, -2, halfSize + 5, 0.2],
      [halfSize + 5, -2, halfSize + 2, 0.3],
      [halfSize + 3, -2, halfSize + 4, 0.2],
      [halfSize + 7, -2, halfSize + 1, 0.15],
      [-11, -2, -halfSize - 5, 0.2],
      [13, -2, -halfSize - 4, 0.25],
      [-9, -2, halfSize + 5, 0.2],
      [15, -2, halfSize + 3, 0.15],
    ];

    for (const [rx, ry, rz, size] of rubblePositions) {
      const rubbleGeo = new THREE.BoxGeometry(size, size * 0.5, size);
      const rubble = new THREE.Mesh(rubbleGeo, rubbleMaterial);
      rubble.position.set(rx, ry + size * 0.25, rz);
      rubble.rotation.set(
        Math.random() * 0.5,
        Math.random() * Math.PI * 2,
        Math.random() * 0.5
      );
      rubble.castShadow = true;
      rubble.receiveShadow = true;
      rubble.name = `Rubble_${rx}_${rz}`;
      this.decorationsGroup.add(rubble);
    }
  }

  /**
   * Crea formaciones rocosas decorativas en el exterior de la arena.
   * Usa DodecahedronGeometry para dar apariencia de roca low-poly.
   */
  private createRockFormations(): void {
    const halfSize = Arena.ARENA_SIZE / 2;

    const rockMaterial1 = new THREE.MeshPhongMaterial({
      color: this.colors.rock,
      flatShading: true,
      shininess: 2,
    });

    const rockMaterial2 = new THREE.MeshPhongMaterial({
      color: 0x4e4e4e,
      flatShading: true,
      shininess: 3,
    });

    const rockMaterial3 = new THREE.MeshPhongMaterial({
      color: 0x636363,
      flatShading: true,
      shininess: 2,
    });

    const rockMats = [rockMaterial1, rockMaterial2, rockMaterial3];

    // Rocas grandes (Dodecahedron)
    const largeRocks: Array<[number, number, number, number]> = [
      [-halfSize - 8, -2.2, -halfSize - 8, 1.2],
      [-halfSize - 10, -2.0, -halfSize - 5, 0.9],
      [halfSize + 7, -2.1, -halfSize - 7, 1.0],
      [halfSize + 9, -2.3, -halfSize - 4, 1.4],
      [-halfSize - 9, -2.0, halfSize + 6, 1.1],
      [-halfSize - 7, -2.2, halfSize + 8, 0.8],
      [halfSize + 8, -2.1, halfSize + 7, 1.3],
      [halfSize + 6, -2.3, halfSize + 9, 1.0],
      // Rocas dispersas
      [-16, -2.0, 0, 0.8],
      [16, -2.1, 2, 1.1],
      [0, -2.2, -halfSize - 8, 0.9],
      [5, -2.0, -halfSize - 7, 0.7],
      [-7, -2.1, -halfSize - 9, 1.0],
      [0, -2.0, halfSize + 8, 0.8],
      [-5, -2.2, halfSize + 9, 1.2],
    ];

    for (const [rx, ry, rz, scale] of largeRocks) {
      const mat = rockMats[Math.floor(Math.random() * rockMats.length)];
      const geo = new THREE.DodecahedronGeometry(scale, 0);
      const rock = new THREE.Mesh(geo, mat);
      rock.position.set(rx, ry + scale * 0.3, rz);
      rock.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI
      );
      rock.castShadow = true;
      rock.receiveShadow = true;
      rock.name = `LargeRock_${rx}_${rz}`;
      this.decorationsGroup.add(rock);
    }

    // Rocas pequeñas (Icosahedron)
    const smallRocks: Array<[number, number, number, number]> = [
      [-halfSize - 7, -2.0, -halfSize - 7, 0.4],
      [-halfSize - 9, -2.0, -halfSize - 6, 0.3],
      [-halfSize - 11, -2.0, -halfSize - 4, 0.35],
      [halfSize + 6, -2.0, -halfSize - 6, 0.45],
      [halfSize + 8, -2.0, -halfSize - 5, 0.3],
      [halfSize + 10, -2.0, -halfSize - 3, 0.4],
      [-halfSize - 8, -2.0, halfSize + 5, 0.35],
      [-halfSize - 6, -2.0, halfSize + 7, 0.4],
      [-halfSize - 10, -2.0, halfSize + 4, 0.3],
      [halfSize + 7, -2.0, halfSize + 6, 0.4],
      [halfSize + 5, -2.0, halfSize + 8, 0.35],
      [halfSize + 9, -2.0, halfSize + 5, 0.45],
      // Dispersas
      [-15, -2.0, 3, 0.3],
      [15, -2.0, -3, 0.4],
      [-3, -2.0, -halfSize - 8, 0.35],
      [8, -2.0, -halfSize - 6, 0.3],
      [3, -2.0, halfSize + 8, 0.4],
      [-8, -2.0, halfSize + 7, 0.35],
    ];

    for (const [rx, ry, rz, scale] of smallRocks) {
      const mat = rockMats[Math.floor(Math.random() * rockMats.length)];
      const geo = new THREE.IcosahedronGeometry(scale, 0);
      const rock = new THREE.Mesh(geo, mat);
      rock.position.set(rx, ry + scale * 0.2, rz);
      rock.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI
      );
      rock.castShadow = true;
      rock.receiveShadow = true;
      rock.name = `SmallRock_${rx}_${rz}`;
      this.decorationsGroup.add(rock);
    }
  }

  // ======================================================================
  // LIMPIEZA
  // ======================================================================

  /**
   * Elimina la arena de la escena y libera los cuerpos físicos y recursos Three.js.
   */
  dispose(): void {
    // Remover grupos de la escena
    this.sceneManager.remove(this.group);
    this.sceneManager.remove(this.decorationsGroup);

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

    // Liberar geometrías y materiales del grupo principal
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

    // Liberar geometrías y materiales de las decoraciones
    this.decorationsGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });

    console.log('[Arena] Arena y decoraciones eliminadas, recursos liberados');
  }
}
