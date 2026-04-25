import * as THREE from 'three';
import { EnemyType } from '../enemies/Enemy';
import { EnemyPool } from '../enemies/EnemyPool';
import { SceneManager } from '../engine/SceneManager';
import type { WaveConfig } from './WaveManager';
import { getEnemyStatsForRound } from './DifficultyScaler';

/**
 * Puntos de spawn fijos en los bordes de la arena 30×30m.
 */
export const SPAWN_POINTS: { x: number; z: number }[] = [
  { x: -14, z: 0 },
  { x: 14, z: 0 },
  { x: 0, z: -14 },
  { x: 0, z: 14 },
  { x: -10, z: -10 },
  { x: 10, z: -10 },
  { x: -10, z: 10 },
  { x: 10, z: 10 },
];

/** Duración del indicador visual antes de que aparezca el enemigo (segundos) */
const INDICATOR_DURATION = 0.5;

/** Duración de la animación de aparición del enemigo (segundos) */
const SPAWN_ANIMATION_DURATION = 0.4;

/**
 * Estado interno de un spawn en progreso.
 */
interface PendingSpawn {
  /** Tipo de enemigo a spawnear */
  type: EnemyType;
  /** Índice del punto de spawn en SPAWN_POINTS */
  pointIndex: number;
  /** Temporizador: cuenta regresiva hasta que aparece el enemigo */
  timer: number;
  /** Fase actual: 'indicator' → mostrando círculo, 'spawning' → enemigo apareciendo */
  phase: 'indicator' | 'spawning';
  /** Referencia al indicador visual (círculo en el suelo) */
  indicator: THREE.Mesh | null;
  /** Referencia al enemigo ya spawneado (solo en fase 'spawning') */
  enemy: any | null;
}

/**
 * Sistema de spawn que materializa enemigos en los bordes de la arena
 * con indicadores visuales y animación de aparición.
 *
 * Flujo:
 * 1. Se encola un spawn con `enqueueSpawn(type, pointIndex)`
 * 2. Aparece un círculo en el suelo 0.5s antes
 * 3. El enemigo se spawnea con animación de escalado 0→1 (0.4s)
 * 4. Durante la animación el enemigo es invulnerable (EnemyState.Spawning)
 */
export class Spawner {
  private sceneManager: SceneManager;
  private enemyPool: EnemyPool;
  private pendingSpawns: PendingSpawn[] = [];
  private scene: THREE.Scene;
  /** Ronda actual para escalado de dificultad */
  private currentRound: number = 1;

  /** Geometría compartida para los indicadores visuales */
  private static indicatorGeometry: THREE.RingGeometry | null = null;
  /** Material compartido para los indicadores visuales */
  private static indicatorMaterial: THREE.MeshBasicMaterial | null = null;

  constructor(sceneManager: SceneManager, enemyPool: EnemyPool) {
    this.sceneManager = sceneManager;
    this.enemyPool = enemyPool;
    this.scene = sceneManager.getScene();

    // Crear geometría y material compartidos para indicadores
    if (!Spawner.indicatorGeometry) {
      Spawner.indicatorGeometry = new THREE.RingGeometry(0.3, 0.5, 24);
    }
    if (!Spawner.indicatorMaterial) {
      Spawner.indicatorMaterial = new THREE.MeshBasicMaterial({
        color: 0xff4444,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
    }
  }

  /**
   * Establece la ronda actual para el escalado de dificultad.
   * Debe llamarse antes de spawnWave() para que los enemigos aparezcan
   * con las estadísticas escaladas correspondientes.
   * @param round - Número de ronda actual (1-based)
   */
  setCurrentRound(round: number): void {
    this.currentRound = round;
  }

  /**
   * Distribuye los enemigos de una WaveConfig entre los puntos de spawn
   * de forma aleatoria pero uniforme, y los encola para spawn.
   * @param config - Configuración de la oleada
   */
  spawnWave(config: WaveConfig): void {
    // Recolectar todos los enemigos a spawnear con su delay
    const spawnEntries: { type: EnemyType; delay: number }[] = [];
    for (const group of config.enemyGroups) {
      for (let i = 0; i < group.count; i++) {
        spawnEntries.push({ type: group.type, delay: group.spawnDelay });
      }
    }

    // Distribuir equitativamente entre los 8 puntos
    const pointCount = SPAWN_POINTS.length;
    const shuffledPoints = this.shuffleArray(
      Array.from({ length: pointCount }, (_, i) => i)
    );

    // Asignar puntos rotando para distribución uniforme
    for (let i = 0; i < spawnEntries.length; i++) {
      const pointIndex = shuffledPoints[i % pointCount];
      this.enqueueSpawn(spawnEntries[i].type, pointIndex, spawnEntries[i].delay);
    }
  }

  /**
   * Encola el spawn de un enemigo en un punto específico.
   * @param type - Tipo de enemigo
   * @param pointIndex - Índice en SPAWN_POINTS
   * @param delay - Delay adicional antes del indicador (desde WaveConfig)
   */
  enqueueSpawn(type: EnemyType, pointIndex: number, delay: number = 0): void {
    this.pendingSpawns.push({
      type,
      pointIndex,
      timer: delay + INDICATOR_DURATION,
      phase: 'indicator',
      indicator: null,
      enemy: null,
    });
  }

  /**
   * Actualiza los spawns pendientes. Llamar cada frame.
   * @param dt - Delta time en segundos
   */
  update(dt: number): void {
    for (let i = this.pendingSpawns.length - 1; i >= 0; i--) {
      const spawn = this.pendingSpawns[i];
      spawn.timer -= dt;

      if (spawn.phase === 'indicator') {
        this.updateIndicator(spawn);
      } else if (spawn.phase === 'spawning') {
        this.updateSpawning(spawn);
      }

      // Remover spawns completados
      if (spawn.timer <= 0 && spawn.phase === 'spawning') {
        this.cleanupIndicator(spawn);
        this.pendingSpawns.splice(i, 1);
      }
    }
  }

  /**
   * Fase de indicador visual: muestra el círculo en el suelo.
   */
  private updateIndicator(spawn: PendingSpawn): void {
    // Crear indicador si no existe
    if (!spawn.indicator) {
      spawn.indicator = this.createIndicator(SPAWN_POINTS[spawn.pointIndex]);
    }

    // Animar opacidad: aparece gradualmente
    if (spawn.indicator) {
      const progress = 1 - Math.max(0, spawn.timer / INDICATOR_DURATION);
      const material = spawn.indicator.material as THREE.MeshBasicMaterial;
      material.opacity = Math.min(progress * 1.5, 0.8);

      // Escalar el indicador: crece de 0.5 a 1.5
      const scale = 0.5 + progress;
      spawn.indicator.scale.set(scale, scale, scale);
    }

    // Transicionar a fase de spawning cuando el timer llegue a 0
    if (spawn.timer <= 0) {
      this.startSpawning(spawn);
    }
  }

  /**
   * Crea el indicador visual (círculo en el suelo).
   */
  private createIndicator(point: { x: number; z: number }): THREE.Mesh {
    const mesh = new THREE.Mesh(
      Spawner.indicatorGeometry!,
      Spawner.indicatorMaterial!.clone()
    );
    mesh.position.set(point.x, -1.95, point.z); // Justo sobre el suelo (y=-2)
    mesh.rotation.x = -Math.PI / 2; // Plano horizontal
    mesh.scale.set(0.01, 0.01, 0.01); // Empieza invisible
    this.scene.add(mesh);
    return mesh;
  }

  /**
   * Inicia la fase de spawning: crea el enemigo y lo spawnea.
   * Aplica escalado de dificultad según la ronda actual.
   */
  private startSpawning(spawn: PendingSpawn): void {
    spawn.phase = 'spawning';
    spawn.timer = SPAWN_ANIMATION_DURATION;

    const point = SPAWN_POINTS[spawn.pointIndex];
    const pos = new THREE.Vector3(point.x, 0, point.z);

    // Calcular stats escalados para la ronda actual
    const scaledStats = getEnemyStatsForRound(spawn.type, this.currentRound);

    // Adquirir enemigo del pool con stats escalados por dificultad
    const enemy = this.enemyPool.acquire(spawn.type, { position: pos }, scaledStats);
    if (enemy) {
      spawn.enemy = enemy;
      // El Enemy.spawn() ya pone EnemyState.Spawning y escala 0.0001
      // El updateSpawnAnimation() del Enemy se encarga de escalar 0→1
    } else {
      // Si no hay enemigos disponibles, limpiar
      this.cleanupIndicator(spawn);
      const idx = this.pendingSpawns.indexOf(spawn);
      if (idx >= 0) this.pendingSpawns.splice(idx, 1);
    }
  }

  /**
   * Fase de spawning: espera a que termine la animación del enemigo.
   */
  private updateSpawning(spawn: PendingSpawn): void {
    // El enemigo ya se está animando solo (Enemy.updateSpawnAnimation)
    // Solo esperamos a que el timer llegue a 0 para limpiar el indicador
    if (spawn.indicator) {
      // Parpadear el indicador mientras el enemigo aparece
      const material = spawn.indicator.material as THREE.MeshBasicMaterial;
      material.opacity = 0.3 + Math.sin(spawn.timer * 20) * 0.3;
    }
  }

  /**
   * Limpia el indicador visual de la escena.
   */
  private cleanupIndicator(spawn: PendingSpawn): void {
    if (spawn.indicator) {
      this.scene.remove(spawn.indicator);
      spawn.indicator.geometry?.dispose();
      (spawn.indicator.material as THREE.Material)?.dispose();
      spawn.indicator = null;
    }
  }

  /**
   * Mezcla un array aleatoriamente (Fisher-Yates).
   */
  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Limpia todos los spawns pendientes e indicadores.
   */
  reset(): void {
    for (const spawn of this.pendingSpawns) {
      this.cleanupIndicator(spawn);
    }
    this.pendingSpawns = [];
  }

  /**
   * Libera recursos estáticos.
   */
  static dispose(): void {
    if (Spawner.indicatorGeometry) {
      Spawner.indicatorGeometry.dispose();
      Spawner.indicatorGeometry = null;
    }
    if (Spawner.indicatorMaterial) {
      Spawner.indicatorMaterial.dispose();
      Spawner.indicatorMaterial = null;
    }
  }
}
