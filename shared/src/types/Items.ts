// =================================================================
// TIPOS COMPARTIDOS PARA EL SISTEMA DE ÍTEMS
// =================================================================

/**
 * Efecto de curación inmediata al comprar/usar el ítem.
 */
export interface HealEffect {
  type: 'healImmediate';
  /** Cantidad de HP a curar */
  value: number;
}

/**
 * Efecto de modificación permanente de estadística.
 */
export interface StatModifierEffect {
  type: 'statModifier';
  /** Estadística a modificar (hp, maxHp, speed, damage, armor, attackSpeed, range, knockbackResistance) */
  stat: string;
  /** Valor del modificador */
  value: number;
  /** Tipo de modificación: addFlat (suma), multiply (multiplicación porcentual) */
  modType: 'addFlat' | 'multiply';
}

/**
 * Efecto especial que requiere lógica custom en la tienda.
 */
export interface SpecialEffect {
  type: 'special';
  /** Identificador del efecto especial */
  specialId: string;
  /** Parámetros adicionales del efecto */
  params?: Record<string, number | string | boolean>;
}

/**
 * Efecto reactivo que responde a eventos del juego.
 * No modifica stats directamente, sino que reacciona a eventos como
 * muertes de enemigos, daño recibido, etc.
 */
export interface ReactiveEffect {
  type: 'reactive';
  /** Evento que dispara el efecto */
  trigger: 'onKill' | 'onHit' | 'onLowHP';
  /** Acción a ejecutar cuando se dispara el trigger */
  action: 'heal' | 'critChance' | 'speedBoost';
  /** Valor del efecto (cantidad de heal, % de crit, % de speed) */
  value: number;
}

/** Unión de todos los tipos de efecto posibles */
export type ItemEffect = HealEffect | StatModifierEffect | SpecialEffect | ReactiveEffect;

/**
 * Schema de un ítem en el catálogo del juego.
 */
export interface ItemDefinition {
  /** Identificador único del ítem (snake_case) */
  id: string;
  /** Nombre mostrado en la tienda */
  name: string;
  /** Descripción del efecto */
  description: string;
  /** Precio en monedas del juego */
  price: number;
  /** Icono referencial (para futura implementación visual) */
  icon: string;
  /** Efecto(s) al comprar/usar el ítem */
  effect: ItemEffect;
}

/**
 * Schema completo del archivo items.json.
 */
export interface ItemsCatalog {
  items: ItemDefinition[];
}
