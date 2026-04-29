/**
 * Cargador de mapas desde archivos JSON.
 *
 * Responsabilidades:
 * 1. Fetch del JSON desde /public/assets/maps/
 * 2. Validación estricta de la estructura (errores descriptivos)
 * 3. Construcción de meshes Three.js para cada obstáculo
 * 4. Creación de colliders Rapier con grupo WALL para cada obstáculo
 *
 * Los spawn points se devuelven para que el Spawner los consuma.
 */

import * as THREE from 'three';
import type { SceneManager } from '../engine/SceneManager';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { BodyFactory } from '../physics/BodyFactory';
import type { MapConfig, MapObstacle, SpawnPoint } from './MapConfig';
import type { RigidBodyHandle } from '../physics/PhysicsWorld';

// ---------------------------------------------------------------------------
// Colores para obstáculos según tipo (estética low-poly)
// ---------------------------------------------------------------------------

const OBSTACLE_COLORS = {
  box: 0x6b5b4e,       // Marrón piedra
  cylinder: 0x5a6b5a,  // Verde grisáceo
} as const;

// ---------------------------------------------------------------------------
// TilemapLoader
// ---------------------------------------------------------------------------

export class TilemapLoader {
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
   * @param url - Ruta al archivo JSON del mapa
   * @returns La configuración validada del mapa
   * @throws Error descriptivo si el JSON es inválido o no se puede cargar
   */
  async load(url: string): Promise<MapConfig> {
    const config = await this.fetchAndValidate(url);
    this.buildObstacles(config.obstacles);
    this.spawnPoints = [...config.spawnPoints];
    this.sceneManager.add(this.obstacleGroup);
    console.log(
      `[TilemapLoader] Mapa "${config.name}" cargado: ${config.obstacles.length} obstáculos, ${config.spawnPoints.length} spawn points`,
    );
    return config;
  }

  /** Retorna los spawn points del mapa cargado. */
  getSpawnPoints(): SpawnPoint[] {
    return this.spawnPoints;
  }

  /**
   * Limpia todos los obstáculos de la escena y libera cuerpos físicos.
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
    for (let i = 0; i < obstacles.length; i++) {
      const obs = obstacles[i];
      const color = OBSTACLE_COLORS[obs.type] ?? 0x888888;

      // Altura: el suelo está en y=-2, el obstáculo se apoya en el suelo
      const yPos = -2 + obs.h / 2;

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
   */
  private buildBoxObstacle(
    obs: MapObstacle,
    yPos: number,
    color: number,
    index: number,
  ): void {
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

    // Collider físico
    const size = new THREE.Vector3(obs.w, obs.h, obs.d);
    const bodyPos = new THREE.Vector3(obs.x, yPos, obs.z);
    const bodyHandle = BodyFactory.createWallBody(this.physicsWorld, bodyPos, size);
    this.obstacleBodies.push(bodyHandle);
  }

  /**
   * Construye un obstáculo tipo cilindro (CylinderGeometry + ball collider aproximado).
   * NOTA: Rapier3D no tiene collider de cilindro nativo; usamos un ball (esfera)
   * con radio = max(w, d) / 2 como aproximación.
   */
  private buildCylinderObstacle(
    obs: MapObstacle,
    yPos: number,
    color: number,
    index: number,
  ): void {
    // Mesh visual: cilindro con radio = w/2, altura = h, segmentos = 12 (low-poly)
    const radius = obs.w / 2;
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

    // Collider físico: usamos un cuboide con las mismas dimensiones como aproximación
    // (Rapier3D no tiene CylinderCollider; cuboid es la mejor opción)
    // Si el cilindro es casi circular en base (w ≈ d), el cuboide funciona bien
    const size = new THREE.Vector3(obs.w, obs.h, obs.d);
    const bodyPos = new THREE.Vector3(obs.x, yPos, obs.z);
    const bodyHandle = BodyFactory.createWallBody(this.physicsWorld, bodyPos, size);
    this.obstacleBodies.push(bodyHandle);
  }
}
