/**
 * Interpolation.ts — Entity Interpolation con Render Delay.
 *
 * Arquitectura:
 * 1. Mantiene un buffer de los últimos snapshots con sus timestamps.
 * 2. Para renderizar entidades remotas, usa un "render delay" de 100ms:
 *    - renderTime = now - RENDER_DELAY_MS
 *    - Busca el snapshot anterior (N-1) y posterior (N) que envuelvan renderTime
 *    - Interpola linealmente entre ellos según t = (renderTime - t0) / (t1 - t0)
 * 3. Si el buffer tiene < 2 snapshots (inicio o pérdida de paquetes):
 *    - Muestra la última posición conocida (sin interpolar)
 * 4. Garantiza movimiento suave incluso con pérdida ocasional de paquetes.
 */
import * as THREE from 'three';
import type { SnapshotPlayer, SnapshotEnemy, GameStateSnapshot } from '../shared-types';

// ================================================================
// Constantes
// ================================================================

/** Render delay: miramos 100ms hacia atrás para tener un snapshot "futuro" que interpolar */
const RENDER_DELAY_MS = 100;

/** Número máximo de snapshots en el buffer */
const MAX_BUFFER_SIZE = 10;

// ================================================================
// Tipos
// ================================================================

export interface StoredSnapshot {
  /** Timestamp del servidor (en ms) */
  serverTime: number;
  /** Timestamp local de recepción (en ms) */
  receiveTime: number;
  /** Datos del snapshot */
  snapshot: GameStateSnapshot;
}

export interface InterpolatedState {
  /** Posición interpolada */
  position: THREE.Vector3;
  /** Rotación interpolada */
  rotation: number;
  /** Estado de vida interpolado */
  alive: boolean;
  /** Salud interpolada */
  health: number;
}

// ================================================================
// Interpolation class
// ================================================================

export class Interpolation {
  /** Buffer de snapshots ordenados por timestamp */
  private buffer: StoredSnapshot[] = [];
  /** Render delay en ms */
  private renderDelayMs: number;
  /** Última posición conocida para cada entidad (fallback cuando no hay suficientes snapshots) */
  private lastKnownPositions: Map<string, THREE.Vector3> = new Map();
  /** Última rotación conocida para cada entidad */
  private lastKnownRotations: Map<string, number> = new Map();

  constructor(renderDelayMs: number = RENDER_DELAY_MS) {
    this.renderDelayMs = renderDelayMs;
  }

  // ============================================================
  // API pública
  // ============================================================

  /**
   * Agrega un snapshot al buffer.
   * Se llama cada vez que llega un snapshot del servidor.
   */
  pushSnapshot(snapshot: GameStateSnapshot): void {
    const now = Date.now();
    this.buffer.push({
      serverTime: snapshot.timestamp,
      receiveTime: now,
      snapshot,
    });

    // Actualizar últimas posiciones conocidas para todas las entidades
    for (const player of snapshot.players) {
      this.lastKnownPositions.set(
        this.getEntityKey('player', player.id),
        new THREE.Vector3(player.position.x, player.position.y, player.position.z)
      );
      this.lastKnownRotations.set(
        this.getEntityKey('player', player.id),
        player.rotation
      );
    }
    for (const enemy of snapshot.enemies) {
      this.lastKnownPositions.set(
        this.getEntityKey('enemy', enemy.id),
        new THREE.Vector3(enemy.position.x, enemy.position.y, enemy.position.z)
      );
      this.lastKnownRotations.set(
        this.getEntityKey('enemy', enemy.id),
        enemy.rotation
      );
    }

    // Limitar tamaño del buffer (eliminar los más viejos)
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER_SIZE);
    }
  }

  /**
   * Obtiene el estado interpolado de un jugador remoto.
   * @param playerId - ID del jugador
   * @returns Estado interpolado o null si no hay datos suficientes
   */
  getPlayerState(playerId: string): InterpolatedState | null {
    return this.getInterpolatedState('player', playerId);
  }

  /**
   * Obtiene el estado interpolado de un enemigo.
   * @param enemyId - ID del enemigo
   * @returns Estado interpolado o null si no hay datos suficientes
   */
  getEnemyState(enemyId: string): InterpolatedState | null {
    return this.getInterpolatedState('enemy', enemyId);
  }

  /**
   * Obtiene todos los enemigos con sus estados interpolados.
   * Útil para sincronizar todos los enemigos en el game loop.
   */
  getAllEnemyStates(): Map<string, InterpolatedState> {
    const result = new Map<string, InterpolatedState>();
    const renderTime = Date.now() - this.renderDelayMs;
    const { prev, next } = this.findSurroundingSnapshots(renderTime);

    if (!prev || !next) {
      // No hay suficientes snapshots, devolver últimas posiciones conocidas
      const latestSnapshot = this.buffer[this.buffer.length - 1];
      if (latestSnapshot) {
        for (const enemy of latestSnapshot.snapshot.enemies) {
          const key = this.getEntityKey('enemy', enemy.id);
          const pos = this.lastKnownPositions.get(key);
          if (pos) {
            result.set(enemy.id, {
              position: pos.clone(),
              rotation: this.lastKnownRotations.get(key) ?? 0,
              alive: enemy.alive,
              health: enemy.health,
            });
          }
        }
      }
      return result;
    }

    // Interpolar cada enemigo entre prev y next
    const t = this.calculateT(renderTime, prev.serverTime, next.serverTime);

    for (const nextEnemy of next.snapshot.enemies) {
      const prevEnemy = prev.snapshot.enemies.find(e => e.id === nextEnemy.id);
      if (prevEnemy) {
        const interpolated = this.lerpEnemy(prevEnemy, nextEnemy, t);
        result.set(nextEnemy.id, interpolated);
      } else {
        // Enemigo nuevo (no estaba en prev), usar posición actual
        const key = this.getEntityKey('enemy', nextEnemy.id);
        const pos = this.lastKnownPositions.get(key) ?? new THREE.Vector3(
          nextEnemy.position.x, nextEnemy.position.y, nextEnemy.position.z
        );
        result.set(nextEnemy.id, {
          position: pos.clone(),
          rotation: nextEnemy.rotation,
          alive: nextEnemy.alive,
          health: nextEnemy.health,
        });
      }
    }

    return result;
  }

  /**
   * Limpia el buffer y los estados conocidos.
   */
  reset(): void {
    this.buffer = [];
    this.lastKnownPositions.clear();
    this.lastKnownRotations.clear();
  }

  /**
   * Obtiene el tamaño actual del buffer (para depuración).
   */
  getBufferSize(): number {
    return this.buffer.length;
  }

  // ============================================================
  // Métodos privados
  // ============================================================

  /**
   * Obtiene el estado interpolado de una entidad.
   */
  private getInterpolatedState(
    entityType: 'player' | 'enemy',
    entityId: string
  ): InterpolatedState | null {
    const renderTime = Date.now() - this.renderDelayMs;
    const { prev, next } = this.findSurroundingSnapshots(renderTime);

    if (!prev || !next) {
      // No hay suficientes snapshots, devolver última posición conocida
      const key = this.getEntityKey(entityType, entityId);
      const pos = this.lastKnownPositions.get(key);
      if (!pos) return null;

      // Buscar datos actuales en el último snapshot
      const latestSnapshot = this.buffer[this.buffer.length - 1];
      if (latestSnapshot) {
        const entity = entityType === 'player'
          ? latestSnapshot.snapshot.players.find(p => p.id === entityId)
          : latestSnapshot.snapshot.enemies.find(e => e.id === entityId);
        if (entity) {
          return {
            position: pos.clone(),
            rotation: this.lastKnownRotations.get(key) ?? entity.rotation,
            alive: entity.alive,
            health: entity.health,
          };
        }
      }
      return {
        position: pos.clone(),
        rotation: this.lastKnownRotations.get(key) ?? 0,
        alive: true,
        health: 100,
      };
    }

    // Encontrar la entidad en ambos snapshots
    const nextEntity = entityType === 'player'
      ? next.snapshot.players.find(p => p.id === entityId)
      : next.snapshot.enemies.find(e => e.id === entityId);

    const prevEntity = entityType === 'player'
      ? prev.snapshot.players.find(p => p.id === entityId)
      : prev.snapshot.enemies.find(e => e.id === entityId);

    if (!nextEntity) return null;

    if (!prevEntity) {
      // Entidad nueva, no estaba en el snapshot anterior
      const key = this.getEntityKey(entityType, entityId);
      const pos = this.lastKnownPositions.get(key) ?? new THREE.Vector3(
        nextEntity.position.x, nextEntity.position.y, nextEntity.position.z
      );
      return {
        position: pos.clone(),
        rotation: nextEntity.rotation,
        alive: nextEntity.alive,
        health: nextEntity.health,
      };
    }

    // Interpolar
    const t = this.calculateT(renderTime, prev.serverTime, next.serverTime);
    return entityType === 'player'
      ? this.lerpPlayer(prevEntity as SnapshotPlayer, nextEntity as SnapshotPlayer, t)
      : this.lerpEnemy(prevEntity as SnapshotEnemy, nextEntity as SnapshotEnemy, t);
  }

  /**
   * Encuentra los snapshots anterior (prev) y posterior (next) que envuelven un tiempo dado.
   * Usa búsqueda binaria para eficiencia.
   */
  private findSurroundingSnapshots(
    renderTime: number
  ): { prev: StoredSnapshot | null; next: StoredSnapshot | null } {
    if (this.buffer.length < 2) {
      return { prev: null, next: null };
    }

    // Búsqueda binaria para encontrar el snapshot más reciente con serverTime <= renderTime
    let low = 0;
    let high = this.buffer.length - 1;
    let prevIndex = -1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.buffer[mid].serverTime <= renderTime) {
        prevIndex = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (prevIndex === -1) {
      // renderTime es anterior a todos los snapshots
      // Usar el primer snapshot como prev y el segundo como next
      return { prev: this.buffer[0], next: this.buffer[1] };
    }

    if (prevIndex >= this.buffer.length - 1) {
      // renderTime es posterior a todos los snapshots
      // Usar el penúltimo y último
      return {
        prev: this.buffer[this.buffer.length - 2],
        next: this.buffer[this.buffer.length - 1],
      };
    }

    return {
      prev: this.buffer[prevIndex],
      next: this.buffer[prevIndex + 1],
    };
  }

  /**
   * Calcula el factor t de interpolación (0-1).
   * t = (renderTime - prevTime) / (nextTime - prevTime)
   */
  private calculateT(renderTime: number, prevTime: number, nextTime: number): number {
    const duration = nextTime - prevTime;
    if (duration <= 0) return 0;
    return Math.max(0, Math.min(1, (renderTime - prevTime) / duration));
  }

  /**
   * Interpola entre dos snapshots de jugador.
   */
  private lerpPlayer(prev: SnapshotPlayer, next: SnapshotPlayer, t: number): InterpolatedState {
    const pos = new THREE.Vector3(
      prev.position.x + (next.position.x - prev.position.x) * t,
      prev.position.y + (next.position.y - prev.position.y) * t,
      prev.position.z + (next.position.z - prev.position.z) * t
    );

    const rotation = prev.rotation + (next.rotation - prev.rotation) * t;

    return {
      position: pos,
      rotation,
      alive: next.alive,
      health: next.health,
    };
  }

  /**
   * Interpola entre dos snapshots de enemigo.
   */
  private lerpEnemy(prev: SnapshotEnemy, next: SnapshotEnemy, t: number): InterpolatedState {
    const pos = new THREE.Vector3(
      prev.position.x + (next.position.x - prev.position.x) * t,
      prev.position.y + (next.position.y - prev.position.y) * t,
      prev.position.z + (next.position.z - prev.position.z) * t
    );

    const rotation = prev.rotation + (next.rotation - prev.rotation) * t;

    return {
      position: pos,
      rotation,
      alive: next.alive,
      health: next.health,
    };
  }

  /**
   * Genera una clave única para una entidad en los mapas de últimas posiciones.
   */
  private getEntityKey(entityType: 'player' | 'enemy', entityId: string): string {
    return `${entityType}:${entityId}`;
  }
}
