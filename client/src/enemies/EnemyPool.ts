import * as THREE from 'three';
import { EventBus } from '../engine/EventBus';
import { SceneManager } from '../engine/SceneManager';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Enemy, type EnemyStats, type SpawnOptions, EnemyType, SKELETON_MINION_STATS } from './Enemy';

/**
 * Configuración para un tipo de enemigo en el pool
 */
interface EnemyPoolConfig {
  /** Tipo de enemigo */
  type: EnemyType;
  /** Estadísticas base del enemigo */
  stats: EnemyStats;
  /** Número inicial de instancias a pre-crear */
  initialCount: number;
  /** Tamaño máximo del pool (0 = ilimitado) */
  maxSize?: number;
}

/**
 * Pool de enemigos que reutiliza instancias en lugar de crear/destruir objetos.
 * Mejora el rendimiento reduciendo la sobrecarga de garbage collection.
 */
export class EnemyPool {
  /** Configuraciones por tipo de enemigo */
  private configs: Map<EnemyType, EnemyPoolConfig> = new Map();
  /** Instancias disponibles por tipo de enemigo */
  private available: Map<EnemyType, Enemy[]> = new Map();
  /** Instancias en uso por tipo de enemigo */
  private inUse: Map<EnemyType, Enemy[]> = new Map();
  /** Referencia al EventBus */
  private eventBus: EventBus;
  /** Referencia al SceneManager */
  private sceneManager: SceneManager;
  /** Referencia al PhysicsWorld */
  private physicsWorld: PhysicsWorld;
  /** Generador de UUIDs */
  private uuidCounter: number = 0;

  /**
   * Crea un nuevo pool de enemigos
   * @param eventBus - Bus de eventos para comunicación
   * @param sceneManager - Manager de escena para agregar modelos
   * @param physicsWorld - Mundo físico para colisiones
   */
  constructor(eventBus: EventBus, sceneManager: SceneManager, physicsWorld: PhysicsWorld) {
    this.eventBus = eventBus;
    this.sceneManager = sceneManager;
    this.physicsWorld = physicsWorld;

    // Inicializar mapas
    this.available.set(EnemyType.SkeletonMinion, []);
    this.inUse.set(EnemyType.SkeletonMinion, []);
  }

  /**
   * Registra un tipo de enemigo en el pool
   * @param config - Configuración del tipo de enemigo
   */
  registerEnemyType(config: EnemyPoolConfig): void {
    this.configs.set(config.type, config);
    this.available.set(config.type, []);
    this.inUse.set(config.type, []);

    // Pre-crear instancias iniciales
    this.precreateInstances(config.type, config.initialCount);
  }

  /**
   * Pre-crea instancias de un tipo de enemigo
   * @param type - Tipo de enemigo
   * @param count - Número de instancias a crear
   */
  private precreateInstances(type: EnemyType, count: number): void {
    const config = this.configs.get(type);
    if (!config) {
      console.warn(`[EnemyPool] No hay configuración para el tipo ${type}`);
      return;
    }

    const available = this.available.get(type)!;

    for (let i = 0; i < count; i++) {
      const enemy = this.createEnemyInstance(type, config.stats);
      enemy.release(); // Marcarlo como disponible
      available.push(enemy);
    }

    console.log(`[EnemyPool] Pre-creadas ${count} instancias de ${type}`);
  }

  /**
   * Crea una nueva instancia de enemigo (no la agrega al pool)
   * @param type - Tipo de enemigo
   * @param stats - Estadísticas del enemigo
   * @returns Nueva instancia de enemigo
   */
  private createEnemyInstance(type: EnemyType, stats: EnemyStats): Enemy {
    const enemyId = `enemy_${this.uuidCounter++}_${type}`;

    switch (type) {
      case EnemyType.SkeletonMinion:
        return new Enemy(
          enemyId,
          this.eventBus,
          this.sceneManager,
          this.physicsWorld,
          undefined, // Sin body handle (se creará automáticamente)
          0xff0000,  // Color rojo por defecto
          1.0,       // Tamaño estándar
          stats.knockbackResistance,
          type,
          stats
        );
      // Futuros tipos de enemigos pueden agregarse aquí
      default:
        throw new Error(`[EnemyPool] Tipo de enemigo no soportado: ${type}`);
    }
  }

  /**
   * Obtiene un enemigo del pool (o crea uno nuevo si es necesario)
   * @param type - Tipo de enemigo a obtener
   * @param spawnOptions - Opciones de spawn para el enemigo
   * @returns Instancia de enemigo lista para usar
   */
  acquire(type: EnemyType, spawnOptions: SpawnOptions): Enemy | null {
    const config = this.configs.get(type);
    if (!config) {
      console.warn(`[EnemyPool] Tipo de enemigo no registrado: ${type}`);
      return null;
    }

    const available = this.available.get(type)!;
    const inUse = this.inUse.get(type)!;

    let enemy: Enemy;

    // Intentar reutilizar una instancia disponible
    if (available.length > 0) {
      enemy = available.pop()!;
      enemy.reset(); // Resetear estado
    } else {
      // Crear nueva instancia si no hay disponibles y no se ha alcanzado el límite
      if (config.maxSize && inUse.length >= config.maxSize) {
        console.warn(`[EnemyPool] Límite máximo alcanzado para ${type} (${config.maxSize})`);
        return null;
      }
      enemy = this.createEnemyInstance(type, config.stats);
    }

    // Spawnear el enemigo en la posición especificada
    enemy.spawn(spawnOptions);

    // Mover a la lista de en uso
    inUse.push(enemy);

    console.log(`[EnemyPool] Enemigo ${enemy.id} adquirido (${inUse.length} en uso, ${available.length} disponibles)`);
    return enemy;
  }

  /**
   * Libera un enemigo de vuelta al pool
   * @param enemy - Enemigo a liberar
   */
  release(enemy: Enemy): void {
    const type = enemy.type;
    const available = this.available.get(type);
    const inUse = this.inUse.get(type);

    if (!available || !inUse) {
      console.warn(`[EnemyPool] Tipo de enemigo no manejado: ${type}`);
      return;
    }

    // Remover de la lista de en uso
    const index = inUse.indexOf(enemy);
    if (index === -1) {
      console.warn(`[EnemyPool] Enemigo ${enemy.id} no encontrado en lista de en uso`);
      return;
    }
    inUse.splice(index, 1);

    // Liberar recursos del enemigo
    enemy.release();

    // Agregar a la lista de disponibles
    available.push(enemy);

    console.log(`[EnemyPool] Enemigo ${enemy.id} liberado (${inUse.length} en uso, ${available.length} disponibles)`);
  }

  /**
   * Libera todos los enemigos de un tipo específico
   * @param type - Tipo de enemigo (opcional, si no se especifica libera todos)
   */
  releaseAll(type?: EnemyType): void {
    if (type) {
      const inUse = this.inUse.get(type);
      if (!inUse) return;

      // Copiar la lista porque release() modificará la original
      const enemiesToRelease = [...inUse];
      enemiesToRelease.forEach(enemy => this.release(enemy));
    } else {
      // Liberar todos los tipos
      for (const t of this.inUse.keys()) {
        this.releaseAll(t);
      }
    }
  }

  /**
   * Actualiza todos los enemigos en uso
   * @param dt - Delta time en segundos
   * @param players - Lista de jugadores en el juego
   * @param world - Referencia al mundo del juego (opcional)
   */
  update(dt: number, players: any[], world?: any): void {
    for (const [type, enemies] of this.inUse) {
      for (const enemy of enemies) {
        // Incluir 'dying' para que la animación de muerte y partículas avancen
        if (enemy.getEnemyState() === 'active' || enemy.getEnemyState() === 'spawning' || enemy.getEnemyState() === 'dying') {
          enemy.update(dt);
          enemy.updateAI(dt, players);
        }
      }
    }
  }

  /**
   * Obtiene todos los enemigos actualmente en uso
   * @returns Lista de enemigos activos
   */
  getAllActiveEnemies(): Enemy[] {
    const result: Enemy[] = [];
    for (const enemies of this.inUse.values()) {
      result.push(...enemies);
    }
    return result;
  }

  /**
   * Obtiene estadísticas del pool
   */
  getStats(): Record<string, { available: number; inUse: number; maxSize?: number }> {
    const stats: Record<string, { available: number; inUse: number; maxSize?: number }> = {};

    for (const [type, config] of this.configs) {
      const available = this.available.get(type)?.length || 0;
      const inUse = this.inUse.get(type)?.length || 0;
      stats[type] = { available, inUse, maxSize: config.maxSize };
    }

    return stats;
  }

  /**
   * Limpia todos los recursos del pool (disposición completa)
   */
  dispose(): void {
    // Liberar todos los enemigos
    this.releaseAll();

    // Disposición completa de todas las instancias
    for (const [type, available] of this.available) {
      for (const enemy of available) {
        enemy.dispose();
      }
      available.length = 0;
    }

    console.log('[EnemyPool] Pool limpiado completamente');
  }
}
