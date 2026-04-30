/**
 * Cargador de mapas desde archivos JSON + generación procedural de obstáculos.
 *
 * Responsabilidades:
 * 1. Fetch del JSON desde /public/assets/maps/
 * 2. Validación estricta de la estructura (errores descriptivos)
 * 3. Construcción de meshes Three.js para cada obstáculo
 * 4. Creación de colliders Rapier con grupo WALL para cada obstáculo
 * 5. Generación procedural de obstáculos con seeded random (Mulberry32)
 *    para layout determinístico entre ambos jugadores
 *
 * Los spawn points se devuelven para que el Spawner los consuma.
 */

import * as THREE from 'three';
import type { SceneManager } from '../engine/SceneManager';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { BodyFactory } from '../physics/BodyFactory';
import type { MapConfig, MapObstacle, SpawnPoint } from './MapConfig';
import type { RigidBodyHandle } from '../physics/PhysicsWorld';
import { seededRandom } from '../utils/seededRandom';

// ---------------------------------------------------------------------------
// Colores para obstáculos con temática de mazmorra/castillo
// ---------------------------------------------------------------------------

const OBSTACLE_COLORS = {
  box: 0x5a5a5a,           // Piedra gris principal
  cylinder: 0x6b5b4f,      // Piedra marrón para columnas
} as const;

/** Colores decorativos para obstáculos de mazmorra */
const DECORATION_COLORS = {
  trim: 0x7a6a5e,          // Borde/remate más claro
  capital: 0x8a7a6e,       // Capitel de columna (más claro)
  base: 0x4a3a2e,          // Base de columna (más oscuro)
  accent: 0x3a4a3a,        // Acento verdoso (musgo/hierro)
  darkStone: 0x3a3a3a,     // Piedra oscura para detalles
} as const;

// ---------------------------------------------------------------------------
// TilemapLoader
// ---------------------------------------------------------------------------

export class TilemapLoader {
  /** Posiciones (x,z) de todos los obstáculos, expuesto para obstacle avoidance de enemigos */
  static obstaclePositions: { x: number; z: number }[] = [];

  private sceneManager: SceneManager;
  private physicsWorld: PhysicsWorld;

  /** Grupo Three.js que contiene todos los obstáculos (para limpieza fácil) */
  private obstacleGroup: THREE.Group;

  /** Handles de cuerpos físicos de los obstáculos */
  private obstacleBodies: RigidBodyHandle[] = [];

  /** Puntos de spawn parseados del JSON */
  private spawnPoints: SpawnPoint[] = [];

  constructor(sceneManager: SceneManager, physicsWorld: PhysicsWorld) {
    this.sceneManager = sceneManager;
    this.physicsWorld = physicsWorld;
    this.obstacleGroup = new THREE.Group();
    this.obstacleGroup.name = 'TilemapObstacles';
  }

  // -----------------------------------------------------------------------
  // API pública
  // -----------------------------------------------------------------------

  /**
   * Carga un archivo de mapa desde una URL relativa a /public.
   * Ejemplo: load('/assets/maps/arena_01.json')
   *
   * Construye los obstáculos definidos en el JSON. Si se proporciona un seed,
   * genera obstáculos procedurales en lugar de los estáticos del JSON.
   *
   * @param url - Ruta al archivo JSON del mapa
   * @param seed - Opcional. Semilla para generar obstáculos procedurales
   * @returns La configuración validada del mapa
   * @throws Error descriptivo si el JSON es inválido o no se puede cargar
   */
  async load(url: string, seed?: number): Promise<MapConfig> {
    const config = await this.fetchAndValidate(url);
    this.spawnPoints = [...config.spawnPoints];

    if (seed !== undefined) {
      // Generación procedural con seeded random
      const playerSpawns: { x: number; z: number }[] = [
        { x: -3, z: 0 },
        { x: 3, z: 0 },
      ];
      const procObstacles = this.generateObstacleLayout(
        8,
        seed,
        config.size.width,
        playerSpawns,
        this.spawnPoints,
      );
      this.buildObstacles(procObstacles);
      console.log(
        `[TilemapLoader] Mapa "${config.name}" — ${procObstacles.length} obstáculos procedurales (seed=${seed})`,
      );
    } else {
      // Obstáculos estáticos desde el JSON
      this.buildObstacles(config.obstacles);
      console.log(
        `[TilemapLoader] Mapa "${config.name}" cargado: ${config.obstacles.length} obstáculos, ${config.spawnPoints.length} spawn points`,
      );
    }

    this.sceneManager.add(this.obstacleGroup);
    return config;
  }

  /** Retorna los spawn points del mapa cargado. */
  getSpawnPoints(): SpawnPoint[] {
    return this.spawnPoints;
  }

  /**
   * Limpia todos los obstáculos de la escena y libera cuerpos físicos.
   * Reinicia spawnPoints a un array vacío.
   */
  dispose(): void {
    // Remover meshes
    this.sceneManager.remove(this.obstacleGroup);

    // Liberar cuerpos físicos
    for (const handle of this.obstacleBodies) {
      this.physicsWorld.removeBody(handle);
    }
    this.obstacleBodies = [];

    // Liberar geometrías y materiales
    this.obstacleGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });

    this.spawnPoints = [];
    console.log('[TilemapLoader] Obstáculos liberados');
  }

  // -----------------------------------------------------------------------
  // Generación procedural de obstáculos (seeded random)
  // -----------------------------------------------------------------------

  /**
   * Genera un layout de N obstáculos con distribución pseudo-aleatoria
   * determinística usando el algoritmo Mulberry32.
   *
   * Reglas de colocación:
   * - Mínimo 2 metros de separación entre obstáculos
   * - Mínimo 3 metros de distancia a los spawn points de jugadores
   * - Mínimo 2 metros de distancia a los spawn points de enemigos
   * - Mínimo 1 metro de distancia a las paredes de la arena
   * - Máximo 200 intentos por obstáculo para evitar loops infinitos
   * - Tamaños entre 1×1 y 3×2, altura fija de 1.5m
   *
   * @param count   - Número de obstáculos a generar (N=10)
   * @param seed    - Semilla entera para el PRNG
   * @param arenaSize - Tamaño de la arena (ancho = alto = arenaSize)
   * @param playerSpawns - Puntos de spawn de jugadores [(x,z)]
   * @param enemySpawns  - Puntos de spawn de enemigos [(x,z)]
   * @returns Array de MapObstacle listos para construir
   */
  generateObstacleLayout(
    count: number,
    seed: number,
    arenaSize: number,
    playerSpawns: { x: number; z: number }[],
    enemySpawns: { x: number; z: number }[],
  ): MapObstacle[] {
    const rng = seededRandom(seed);
    const obstacles: MapObstacle[] = [];
    const halfSize = arenaSize / 2;
    const wallMargin = 1.0; // distancia mínima a paredes — reducida para usar más espacio

    // Reunir todos los puntos prohibidos (spawns de jugadores y enemigos)
    const forbiddenPoints: { x: number; z: number }[] = [
      ...playerSpawns,
      ...enemySpawns,
    ];

    for (let i = 0; i < count; i++) {
      let placed = false;

      for (let attempt = 0; attempt < 200; attempt++) {
        // Tamaño aleatorio con más variedad: ancho 1..4, profundidad 1..3
        const w = Math.floor(rng() * 4) + 1; // 1, 2, 3, o 4
        const d = Math.floor(rng() * 3) + 1; // 1, 2, o 3
        const h = 4.0; // altura fija — antes 1.5, parecían pinturas en el piso

        // Alternar entre box y cylinder para variedad visual
        const type: 'box' | 'cylinder' = rng() > 0.5 ? 'box' : 'cylinder';

        // Posición dentro de la arena usando toda la superficie disponible
        const margin = wallMargin + Math.max(w, d) / 2;
        const x = (rng() * (arenaSize - margin * 2)) - (halfSize - margin);
        const z = (rng() * (arenaSize - margin * 2)) - (halfSize - margin);

        // Validar que no esté sobre spawn points de jugadores (min 3m)
        let valid = true;
        for (const fp of forbiddenPoints) {
          const dx = x - fp.x;
          const dz = z - fp.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist < 3.0) {
            valid = false;
            break;
          }
        }
        if (!valid) continue;

        // Validar separación entre obstáculos (min 4.5m para mejor esparcimiento)
        for (const obs of obstacles) {
          const dx = x - obs.x;
          const dz = z - obs.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist < 4.5) {
            valid = false;
            break;
          }
        }
        if (!valid) continue;

        // Reducir zona de exclusión del centro a 1m (más espacio utilizable)
        const distCenter = Math.sqrt(x * x + z * z);
        if (distCenter < 1.0) continue;

        obstacles.push({ type, x, z, w, h, d });
        placed = true;
        break;
      }

      if (!placed) {
        console.warn(
          `[TilemapLoader] No se pudo colocar obstáculo #${i} tras 200 intentos`,
        );
      }
    }

    return obstacles;
  }

  // -----------------------------------------------------------------------
  // Fetch + validación
  // -----------------------------------------------------------------------

  /**
   * Fetch del JSON y validación completa de la estructura.
   * Lanza errores descriptivos para cada campo faltante o inválido.
   */
  private async fetchAndValidate(url: string): Promise<MapConfig> {
    let response: Response;
    try {
      response = await fetch(url);
    } catch (err) {
      throw new Error(
        `[TilemapLoader] No se pudo cargar "${url}": ${err instanceof Error ? err.message : 'error de red'}`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `[TilemapLoader] Error HTTP ${response.status} al cargar "${url}": ${response.statusText}`,
      );
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new Error(
        `[TilemapLoader] "${url}" no contiene JSON válido`,
      );
    }

    return this.validate(data);
  }

  /**
   * Validación estricta del objeto parseado.
   * Cada chequeo produce un error específico indicando qué campo falta o es inválido.
   */
  private validate(data: any): MapConfig {
    const errors: string[] = [];

    if (!data || typeof data !== 'object') {
      throw new Error('[TilemapLoader] El mapa debe ser un objeto JSON');
    }

    // name
    if (typeof data.name !== 'string' || data.name.length === 0) {
      errors.push('"name" debe ser un string no vacío');
    }

    // size
    if (!data.size || typeof data.size !== 'object') {
      errors.push('"size" debe ser un objeto { width, height }');
    } else {
      if (typeof data.size.width !== 'number' || data.size.width <= 0) {
        errors.push('"size.width" debe ser un número positivo');
      }
      if (typeof data.size.height !== 'number' || data.size.height <= 0) {
        errors.push('"size.height" debe ser un número positivo');
      }
    }

    // obstacles
    if (!Array.isArray(data.obstacles)) {
      errors.push('"obstacles" debe ser un array');
    } else {
      for (let i = 0; i < data.obstacles.length; i++) {
        const obs = data.obstacles[i];
        const prefix = `obstacles[${i}]`;
        if (!obs || typeof obs !== 'object') {
          errors.push(`${prefix} debe ser un objeto`);
          continue;
        }
        if (!['box', 'cylinder'].includes(obs.type)) {
          errors.push(`${prefix}.type debe ser "box" o "cylinder", recibió "${obs.type}"`);
        }
        if (typeof obs.x !== 'number') errors.push(`${prefix}.x debe ser un número`);
        if (typeof obs.z !== 'number') errors.push(`${prefix}.z debe ser un número`);
        if (typeof obs.w !== 'number' || obs.w <= 0) errors.push(`${prefix}.w debe ser un número positivo`);
        if (typeof obs.h !== 'number' || obs.h <= 0) errors.push(`${prefix}.h debe ser un número positivo`);
        if (typeof obs.d !== 'number' || obs.d <= 0) errors.push(`${prefix}.d debe ser un número positivo`);
      }
    }

    // spawnPoints
    if (!Array.isArray(data.spawnPoints)) {
      errors.push('"spawnPoints" debe ser un array');
    } else {
      for (let i = 0; i < data.spawnPoints.length; i++) {
        const sp = data.spawnPoints[i];
        const prefix = `spawnPoints[${i}]`;
        if (!sp || typeof sp !== 'object') {
          errors.push(`${prefix} debe ser un objeto { x, z }`);
          continue;
        }
        if (typeof sp.x !== 'number') errors.push(`${prefix}.x debe ser un número`);
        if (typeof sp.z !== 'number') errors.push(`${prefix}.z debe ser un número`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`[TilemapLoader] Errores de validación:\n  - ${errors.join('\n  - ')}`);
    }

    return data as MapConfig;
  }

  // -----------------------------------------------------------------------
  // Construcción de obstáculos
  // -----------------------------------------------------------------------

  /**
   * Construye meshes Three.js y colliders Rapier para cada obstáculo.
   * Cada obstáculo se añade al grupo interno para limpieza posterior.
   */
  private buildObstacles(obstacles: MapObstacle[]): void {
    // Resetear posiciones de obstáculos para obstacle avoidance
    TilemapLoader.obstaclePositions = [];

    for (let i = 0; i < obstacles.length; i++) {
      const obs = obstacles[i];
      const color = OBSTACLE_COLORS[obs.type] ?? 0x888888;

      // Altura: el suelo está en y=-2, el obstáculo se apoya en el suelo
      const yPos = -2 + obs.h / 2;

      // Registrar posición para obstacle avoidance de enemigos
      TilemapLoader.obstaclePositions.push({ x: obs.x, z: obs.z });

      switch (obs.type) {
        case 'box':
          this.buildBoxObstacle(obs, yPos, color, i);
          break;
        case 'cylinder':
          this.buildCylinderObstacle(obs, yPos, color, i);
          break;
      }
    }
  }

  /**
   * Construye un obstáculo tipo caja (BoxGeometry + cuboid collider).
   * Con decoraciones de piedra de mazmorra: remate superior y cantoneras.
   */
  private buildBoxObstacle(
    obs: MapObstacle,
    yPos: number,
    color: number,
    index: number,
  ): void {
    // --- Cuerpo principal ---
    const geometry = new THREE.BoxGeometry(obs.w, obs.h, obs.d);
    const material = new THREE.MeshPhongMaterial({
      color,
      flatShading: true,
      shininess: 10,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(obs.x, yPos, obs.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `Obstacle_box_${index}`;
    this.obstacleGroup.add(mesh);

    // --- Remate superior (coping) — losa de piedra que sobresale ligeramente ---
    const trimOverhang = 0.15;
    const trimHeight = 0.12;
    const trimGeo = new THREE.BoxGeometry(
      obs.w + trimOverhang * 2,
      trimHeight,
      obs.d + trimOverhang * 2,
    );
    const trimMat = new THREE.MeshPhongMaterial({
      color: DECORATION_COLORS.trim,
      flatShading: true,
      shininess: 8,
    });
    const trim = new THREE.Mesh(trimGeo, trimMat);
    trim.position.set(obs.x, yPos + obs.h / 2 - trimHeight / 2, obs.z);
    trim.castShadow = true;
    trim.receiveShadow = true;
    trim.name = `Obstacle_box_${index}_trim`;
    this.obstacleGroup.add(trim);

    // --- Cantoneras (4 esquinas superiores) — pequeños cubos decorativos ---
    const cornerSize = 0.2;
    const cornerMat = new THREE.MeshPhongMaterial({
      color: DECORATION_COLORS.darkStone,
      flatShading: true,
      shininess: 5,
    });
    const cornerGeo = new THREE.BoxGeometry(cornerSize, cornerSize, cornerSize);
    const hw = obs.w / 2;
    const hd = obs.d / 2;
    const cy = yPos + obs.h / 2 - trimHeight - cornerSize / 2;
    const cornerPositions = [
      [-hw, -hd], [hw, -hd],
      [-hw, hd], [hw, hd],
    ];
    for (const [dx, dz] of cornerPositions) {
      const corner = new THREE.Mesh(cornerGeo, cornerMat);
      corner.position.set(obs.x + dx, cy, obs.z + dz);
      corner.castShadow = true;
      corner.receiveShadow = true;
      corner.name = `Obstacle_box_${index}_corner`;
      this.obstacleGroup.add(corner);
    }

    // --- Collider físico ---
    const size = new THREE.Vector3(obs.w, obs.h, obs.d);
    const bodyPos = new THREE.Vector3(obs.x, yPos, obs.z);
    const bodyHandle = BodyFactory.createObstacleBody(this.physicsWorld, bodyPos, size);
    this.obstacleBodies.push(bodyHandle);
  }

  /**
   * Construye un obstáculo tipo cilindro (CylinderGeometry + ball collider aproximado).
   * Decorado como columna de mazmorra con capitel y base.
   * NOTA: Rapier3D no tiene collider de cilindro nativo; usamos un ball (esfera)
   * con radio = max(w, d) / 2 como aproximación.
   */
  private buildCylinderObstacle(
    obs: MapObstacle,
    yPos: number,
    color: number,
    index: number,
  ): void {
    const radius = obs.w / 2;
    const topY = yPos + obs.h / 2;
    const bottomY = yPos - obs.h / 2;

    // --- Fuste (columna principal) ---
    const geometry = new THREE.CylinderGeometry(radius, radius, obs.h, 12);
    const material = new THREE.MeshPhongMaterial({
      color,
      flatShading: true,
      shininess: 10,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(obs.x, yPos, obs.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `Obstacle_cylinder_${index}`;
    this.obstacleGroup.add(mesh);

    // --- Capitel (anillo superior decorativo) ---
    const capitalRadius = radius + 0.12;
    const capitalHeight = 0.15;
    const capitalGeo = new THREE.CylinderGeometry(capitalRadius, capitalRadius, capitalHeight, 12);
    const capitalMat = new THREE.MeshPhongMaterial({
      color: DECORATION_COLORS.capital,
      flatShading: true,
      shininess: 8,
    });
    const capital = new THREE.Mesh(capitalGeo, capitalMat);
    capital.position.set(obs.x, topY - capitalHeight / 2, obs.z);
    capital.castShadow = true;
    capital.name = `Obstacle_cylinder_${index}_capital`;
    this.obstacleGroup.add(capital);

    // --- Base (anillo inferior decorativo) ---
    const baseRadius = radius + 0.15;
    const baseHeight = 0.12;
    const baseGeo = new THREE.CylinderGeometry(baseRadius, baseRadius, baseHeight, 12);
    const baseMat = new THREE.MeshPhongMaterial({
      color: DECORATION_COLORS.base,
      flatShading: true,
      shininess: 5,
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.set(obs.x, bottomY + baseHeight / 2, obs.z);
    base.castShadow = true;
    base.name = `Obstacle_cylinder_${index}_base`;
    this.obstacleGroup.add(base);

    // Collider físico: usamos un cuboide con las mismas dimensiones como aproximación
    const size = new THREE.Vector3(obs.w, obs.h, obs.d);
    const bodyPos = new THREE.Vector3(obs.x, yPos, obs.z);
    const bodyHandle = BodyFactory.createObstacleBody(this.physicsWorld, bodyPos, size);
    this.obstacleBodies.push(bodyHandle);
  }
}


