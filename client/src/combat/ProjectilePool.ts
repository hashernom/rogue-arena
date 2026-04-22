import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Groups, Masks } from '../physics/CollisionGroups';
import { Projectile } from './Projectile';
import { EventBus } from '../engine/EventBus';

/**
 * Pool de proyectiles reutilizables para evitar garbage collection frecuente.
 * Pre-crea N proyectiles inactivos y los recicla.
 */
export class ProjectilePool {
  private pool: Projectile[] = [];
  private activeProjectiles: Set<Projectile> = new Set();
  private readonly maxSize: number;

  /**
   * @param maxSize Número máximo de proyectiles en el pool (por defecto 50)
   * @param physicsWorld Referencia al mundo físico para crear cuerpos
   * @param scene Escena Three.js para añadir los meshes
   * @param eventBus Bus de eventos para emitir daños
   */
  constructor(
    private readonly physicsWorld: PhysicsWorld,
    private readonly scene: THREE.Scene,
    private readonly eventBus: EventBus,
    maxSize: number = 50
  ) {
    this.maxSize = maxSize;
    this.initializePool();
  }

  /**
   * Pre-crea todos los proyectiles inactivos.
   */
  private initializePool(): void {
    for (let i = 0; i < this.maxSize; i++) {
      const projectile = new Projectile(this.physicsWorld, this.scene, this.eventBus);
      this.pool.push(projectile);
    }
    console.log(`[ProjectilePool] Pool inicializado con ${this.maxSize} proyectiles`);
  }

  /**
   * Adquiere un proyectil inactivo del pool.
   * @returns Proyectil listo para usar, o null si no hay disponibles
   */
  acquire(): Projectile | null {
    if (this.pool.length === 0) {
      console.warn('[ProjectilePool] No hay proyectiles disponibles en el pool');
      return null;
    }

    const projectile = this.pool.pop()!;
    this.activeProjectiles.add(projectile);
    return projectile;
  }

  /**
   * Libera un proyectil activo y lo devuelve al pool.
   * @param projectile Proyectil a liberar
   */
  release(projectile: Projectile): void {
    if (!this.activeProjectiles.has(projectile)) {
      console.warn('[ProjectilePool] Intento de liberar proyectil no activo');
      return;
    }

    projectile.reset();
    this.activeProjectiles.delete(projectile);
    this.pool.push(projectile);
  }

  /**
   * Actualiza todos los proyectiles activos.
   * @param deltaTime Tiempo transcurrido desde el último frame (en segundos)
   */
  update(deltaTime: number): void {
    for (const projectile of this.activeProjectiles) {
      projectile.update(deltaTime);

      // Verificar si el proyectil debe ser liberado (por rango o tiempo)
      if (projectile.shouldBeReleased()) {
        this.release(projectile);
      }
    }
  }

  /**
   * Libera todos los proyectiles activos (por ejemplo, al cambiar de nivel).
   */
  releaseAll(): void {
    for (const projectile of this.activeProjectiles) {
      projectile.reset();
      this.pool.push(projectile);
    }
    this.activeProjectiles.clear();
  }

  /**
   * Obtiene estadísticas del pool.
   */
  getStats(): { total: number; active: number; available: number } {
    return {
      total: this.maxSize,
      active: this.activeProjectiles.size,
      available: this.pool.length,
    };
  }
}