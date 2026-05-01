import * as THREE from 'three';
import { EnemyPool } from '../enemies/EnemyPool';

/**
 * Resultado del auto-aim para un personaje.
 */
export interface AutoAimResult {
  /** Posición objetivo hacia donde apuntar/disparar */
  targetPosition: THREE.Vector3;
  /** Cantidad de enemigos en el cluster seleccionado */
  enemyCount: number;
  /** Distancia al cluster desde el personaje */
  distance: number;
}

/**
 * Sistema de auto-aim para modo local.
 *
 * Algoritmo: clusteriza enemigos por proximidad y selecciona el cluster
 * más cercano con mayor cantidad de enemigos (score = tamaño / distancia).
 *
 * Los personajes en modo local no tienen mouse individual, por lo que
 * este sistema calcula automáticamente el mejor objetivo para cada uno.
 */
export class AutoAimSystem {
  /** Distancia máxima para considerar que dos enemigos pertenecen al mismo cluster */
  private static readonly CLUSTER_DISTANCE = 4.0;

  /** Distancia máxima a la que el sistema considera enemigos */
  private static readonly MAX_AIM_RANGE = 20.0;

  /** Distancia mínima para considerar un cluster válido */
  private static readonly MIN_CLUSTER_SIZE = 1;

  private enemyPool: EnemyPool;

  constructor(enemyPool: EnemyPool) {
    this.enemyPool = enemyPool;
  }

  /**
   * Calcula el mejor objetivo de auto-aim para un personaje.
   * Retorna el centro del cluster más valioso (mayor densidad de enemigos cercanos).
   * Ideal para personajes cuerpo a cuerpo con AOE (Melee).
   * @param characterPosition Posición actual del personaje
   * @returns El mejor objetivo encontrado, o null si no hay enemigos
   */
  public getTarget(characterPosition: THREE.Vector3): AutoAimResult | null {
    const activeEnemies = this.enemyPool.getAllActiveEnemies().filter(e => e.isAlive());

    if (activeEnemies.length === 0) return null;

    // Paso 1: Obtener posiciones de enemigos vivos
    const enemyPositions: THREE.Vector3[] = [];
    for (const enemy of activeEnemies) {
      const pos = enemy.getPosition();
      if (pos) {
        enemyPositions.push(pos);
      }
    }

    if (enemyPositions.length === 0) return null;

    // Paso 2: Clusterizar por proximidad
    const clusters = this.clusterEnemies(enemyPositions);

    if (clusters.length === 0) return null;

    // Paso 3: Evaluar cada cluster y seleccionar el mejor
    let bestCluster = clusters[0];
    let bestScore = -1;

    for (const cluster of clusters) {
      const center = this.getClusterCenter(cluster);
      const dist = characterPosition.distanceTo(center);

      if (dist > AutoAimSystem.MAX_AIM_RANGE) continue;

      // Score: más enemigos + más cerca = mejor
      // Usamos tamaño^2 para priorizar grupos grandes sobre grupos cercanos pequeños
      const score = (cluster.length * cluster.length) / Math.max(dist, 0.1);

      if (score > bestScore) {
        bestScore = score;
        bestCluster = cluster;
      }
    }

    const targetPos = this.getClusterCenter(bestCluster);
    const dist = characterPosition.distanceTo(targetPos);

    return {
      targetPosition: targetPos,
      enemyCount: bestCluster.length,
      distance: dist,
    };
  }

  /**
   * Calcula el objetivo más cercano y preciso para personajes de rango (ADC).
   * Retorna la posición exacta del enemigo vivo más cercano, NO el centro del cluster.
   * Esto asegura que los proyectiles siempre apunten directamente al enemigo,
   * sin desviarse por centros de cluster que pueden quedar entre varios enemigos.
   * @param characterPosition Posición actual del personaje
   * @returns El enemigo más cercano, o null si no hay enemigos
   */
  public getNearestTarget(characterPosition: THREE.Vector3): AutoAimResult | null {
    const activeEnemies = this.enemyPool.getAllActiveEnemies().filter(e => e.isAlive());

    if (activeEnemies.length === 0) return null;

    let nearestEnemy: THREE.Vector3 | null = null;
    let nearestDist = Infinity;

    for (const enemy of activeEnemies) {
      const pos = enemy.getPosition();
      if (pos) {
        const dist = characterPosition.distanceTo(pos);
        if (dist < nearestDist && dist <= AutoAimSystem.MAX_AIM_RANGE) {
          nearestDist = dist;
          nearestEnemy = pos.clone();
        }
      }
    }

    if (!nearestEnemy) return null;

    // Apuntar al centro del pecho del enemigo (y=0.8) para máxima precisión
    nearestEnemy.y = 0.8;

    return {
      targetPosition: nearestEnemy,
      enemyCount: 1,
      distance: nearestDist,
    };
  }

  /**
   * Calcula el centro de un cluster como el promedio de todas las posiciones.
   */
  private getClusterCenter(cluster: THREE.Vector3[]): THREE.Vector3 {
    const center = new THREE.Vector3(0, 0, 0);
    for (const pos of cluster) {
      center.add(pos);
    }
    center.divideScalar(cluster.length);
    center.y = 0.6; // Altura del pecho del enemigo para apuntar correctamente
    return center;
  }

  /**
   * Clusteriza posiciones de enemigos por proximidad.
   * Usa un approach greedy: para cada enemigo no asignado,
   * agrupa con todos los enemigos dentro de CLUSTER_DISTANCE.
   */
  private clusterEnemies(positions: THREE.Vector3[]): THREE.Vector3[][] {
    const assigned = new Set<number>();
    const clusters: THREE.Vector3[][] = [];

    for (let i = 0; i < positions.length; i++) {
      if (assigned.has(i)) continue;

      const cluster: THREE.Vector3[] = [positions[i]];
      assigned.add(i);

      // Buscar enemigos cercanos a este cluster
      for (let j = i + 1; j < positions.length; j++) {
        if (assigned.has(j)) continue;

        // Verificar si está cerca de ALGÚN enemigo ya en el cluster
        for (const clusterPos of cluster) {
          const dist = clusterPos.distanceTo(positions[j]);
          if (dist <= AutoAimSystem.CLUSTER_DISTANCE) {
            cluster.push(positions[j]);
            assigned.add(j);
            break;
          }
        }
      }

      if (cluster.length >= AutoAimSystem.MIN_CLUSTER_SIZE) {
        clusters.push(cluster);
      }
    }

    // Ordenar clusters por tamaño descendente
    clusters.sort((a, b) => b.length - a.length);

    return clusters;
  }
}
