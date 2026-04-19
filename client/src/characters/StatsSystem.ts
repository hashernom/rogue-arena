import type { CharacterStats } from './Character';

export type ModType = 'addFlat' | 'addPercent' | 'multiplyBase';

export interface StatModifier {
  stat: keyof CharacterStats;
  value: number;
  type: ModType;
  source: string;
}

/**
 * Sistema de estadísticas extendible con caché y soporte para tres tipos de modificadores:
 * - addFlat: Suma un valor fijo (ej: +10 daño)
 * - addPercent: Suma un porcentaje (ej: +50% = 0.5)
 * - multiplyBase: Multiplica el valor base (ej: ×1.5)
 * 
 * Fórmula: efectivo = (base + sumFlat) * (1 + sumPercent/100) * productMultipliers
 */
export class StatsSystem {
  // Valores base inmutables por modificadores (se alteran por nivel/curación)
  private baseStats: CharacterStats;
  // Caché de valores calculados
  private cachedStats: CharacterStats;
  // Diccionario de modificadores activos
  private modifiers: Map<string, StatModifier> = new Map();
  // Set de stats que necesitan ser recalculados
  private dirtyStats: Set<keyof CharacterStats> = new Set();
  
  private nextId: number = 1;

  constructor(initialStats: CharacterStats) {
    // Clonamos profundamente para evitar referencias compartidas
    this.baseStats = { ...initialStats };
    this.cachedStats = { ...initialStats };
  }

  /**
   * Añade un modificador y retorna su ID único.
   */
  public addModifier(mod: StatModifier): string {
    const id = `mod_${this.nextId++}_${mod.source}`;
    
    let oldMaxHp = 0;
    if (mod.stat === 'maxHp') {
      oldMaxHp = this.getStat('maxHp');
    }

    this.modifiers.set(id, mod);
    this.dirtyStats.add(mod.stat);

    // Regla especial: maxHp bonus también sana al jugador en esa cantidad
    if (mod.stat === 'maxHp') {
      const newMaxHp = this.getStat('maxHp'); // Llama getStat para forzar recálculo
      const diff = newMaxHp - oldMaxHp;
      if (diff > 0) {
        // Curamos el HP base directamente
        this.baseStats.hp += diff;
        this.dirtyStats.add('hp');
      }
    }

    return id;
  }

  /**
   * Remueve un modificador dado su ID.
   */
  public removeModifier(id: string): void {
    const mod = this.modifiers.get(id);
    if (!mod) return;

    this.modifiers.delete(id);
    this.dirtyStats.add(mod.stat);

    // Regla especial: si el maxHp baja, el hp actual no puede superarlo
    if (mod.stat === 'maxHp') {
      const currentMaxHp = this.getStat('maxHp');
      if (this.baseStats.hp > currentMaxHp) {
        this.baseStats.hp = currentMaxHp;
        this.dirtyStats.add('hp');
      }
    }
  }

  /**
   * Obtiene el stat final calculado. Solo recalcula si el caché está "sucio".
   */
  public getStat(stat: keyof CharacterStats): number {
    if (this.dirtyStats.has(stat)) {
      this.recalculateStat(stat);
    }
    return this.cachedStats[stat];
  }

  /**
   * Obtiene todos los stats calculados.
   */
  public getAllStats(): CharacterStats {
    // Asegurar que todos los stats estén actualizados
    const stats: (keyof CharacterStats)[] = ['hp', 'maxHp', 'speed', 'damage', 'attackSpeed', 'range', 'armor'];
    stats.forEach(stat => {
      if (this.dirtyStats.has(stat)) {
        this.recalculateStat(stat);
      }
    });
    
    return { ...this.cachedStats };
  }

  /**
   * Permite actualizar un stat base directamente (ej: recibir daño o subir de nivel)
   */
  public setBaseStat(stat: keyof CharacterStats, value: number): void {
    this.baseStats[stat] = value;
    this.dirtyStats.add(stat);
  }

  /**
   * Obtiene el valor base de un stat (sin modificadores)
   */
  public getBaseStat(stat: keyof CharacterStats): number {
    return this.baseStats[stat];
  }

  /**
   * Aplica daño al personaje, reduciendo hp.
   */
  public takeDamage(amount: number): void {
    const currentHp = this.getStat('hp');
    const newHp = Math.max(0, currentHp - amount);
    this.setBaseStat('hp', newHp);
  }

  /**
   * Cura al personaje, sin exceder maxHp.
   */
  public heal(amount: number): void {
    const currentHp = this.getStat('hp');
    const maxHp = this.getStat('maxHp');
    const newHp = Math.min(maxHp, currentHp + amount);
    this.setBaseStat('hp', newHp);
  }

  /**
   * Obtiene todos los modificadores activos.
   */
  public getModifiers(): StatModifier[] {
    return Array.from(this.modifiers.values());
  }

  /**
   * Limpia todos los modificadores.
   */
  public clearAllModifiers(): void {
    const statsToInvalidate = new Set<keyof CharacterStats>();
    this.modifiers.forEach(mod => statsToInvalidate.add(mod.stat));
    this.modifiers.clear();
    statsToInvalidate.forEach(stat => this.dirtyStats.add(stat));
  }

  /**
   * Lógica interna de recálculo según la fórmula del M8.
   */
  private recalculateStat(stat: keyof CharacterStats): void {
    const base = this.baseStats[stat];
    
    let sumFlat = 0;
    let sumPercent = 0;
    let productMultipliers = 1;

    for (const mod of this.modifiers.values()) {
      if (mod.stat === stat) {
        switch (mod.type) {
          case 'addFlat':
            sumFlat += mod.value;
            break;
          case 'addPercent':
            sumPercent += mod.value;
            break;
          case 'multiplyBase':
            productMultipliers *= mod.value;
            break;
        }
      }
    }

    // Fórmula: efectivo = (base + sumFlat) * (1 + sumPercent/100) * productMultipliers
    let result = (base + sumFlat) * (1 + sumPercent / 100) * productMultipliers;
    
    // Para hp y maxHp, asegurar que no sean negativos
    if (stat === 'hp' || stat === 'maxHp') {
      result = Math.max(0, result);
    }
    
    this.cachedStats[stat] = result;
    
    // Limpiamos el flag de suciedad
    this.dirtyStats.delete(stat);
  }
}