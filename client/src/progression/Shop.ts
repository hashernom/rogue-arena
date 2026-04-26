import { EventBus } from '../engine/EventBus';
import { MoneySystem } from './MoneySystem';
import { UpgradeApplier } from './UpgradeApplier';
import { PassiveEffects } from './PassiveEffects';
import { Character } from '../characters/Character';
import type { ItemDefinition, ItemsCatalog, ReactiveEffect } from '../../../shared/src/types/Items';

// =================================================================
// TIPOS DEL SISTEMA DE TIENDA
// =================================================================

/**
 * Resultado de una compra en la tienda.
 */
export interface ShopPurchaseResult {
  success: boolean;
  newBalance: number;
  message: string;
  itemId?: string;
}

/**
 * Oferta generada para un jugador en una ronda.
 */
export interface PlayerOffer {
  /** Ronda en la que se generó la oferta */
  round: number;
  /** Ítems disponibles para comprar (máximo 3) */
  items: ItemDefinition[];
}

// =================================================================
// SHOP
// =================================================================

/**
 * Sistema de tienda entre rondas.
 *
 * Cada jugador recibe una oferta independiente de 3 ítems aleatorios
 * del catálogo global. La selección tiene sesgo de precio: ítems más
 * caros aparecen con menor probabilidad en rondas bajas.
 *
 * Responsabilidades:
 * - Generar ofertas aleatorias por jugador al abrirse la tienda
 * - Validar saldo antes de procesar compras
 * - Aplicar efectos de ítems via UpgradeApplier
 * - Descontar el precio del saldo del jugador
 * - Evitar que un mismo ítem se ofrezca dos veces en la misma sesión
 */
export class Shop {
  private moneySystem: MoneySystem;
  private upgradeApplier: UpgradeApplier;
  private passiveEffects: PassiveEffects;
  private itemCatalog: ItemsCatalog;
  private eventBus: EventBus;

  /** Ofertas activas por jugador: playerId → PlayerOffer */
  private currentOffers: Map<string, PlayerOffer> = new Map();

  /** IDs de ítems ya comprados en esta sesión (para evitar repetir ofertas) */
  private purchasedItemIds: Set<string> = new Set();

  /** IDs de ítems ya ofrecidos en esta sesión (para evitar repetir en ofertas) */
  private offeredItemIds: Set<string> = new Set();

  constructor(
    moneySystem: MoneySystem,
    upgradeApplier: UpgradeApplier,
    passiveEffects: PassiveEffects,
    itemCatalog: ItemsCatalog,
    eventBus: EventBus
  ) {
    this.moneySystem = moneySystem;
    this.upgradeApplier = upgradeApplier;
    this.passiveEffects = passiveEffects;
    this.itemCatalog = itemCatalog;
    this.eventBus = eventBus;
  }

  // =================================================================
  // GENERACIÓN DE OFERTAS
  // =================================================================

  /**
   * Genera una oferta de 3 ítems aleatorios para un jugador.
   * La selección tiene sesgo de precio: en rondas bajas, los ítems
   * más caros tienen menos probabilidad de aparecer.
   *
   * @param playerId - ID del jugador ('player1' | 'player2')
   * @param round - Ronda actual (para sesgo de precio)
   * @returns Array con hasta 3 ítems ofrecidos
   */
  generateOffer(playerId: string, round: number): ItemDefinition[] {
    const pool = this.itemCatalog.items;

    if (pool.length === 0) {
      console.warn('[Shop] Catálogo vacío, no se pueden generar ofertas');
      this.currentOffers.set(playerId, { round, items: [] });
      return [];
    }

    // Calcular el precio máximo "accesible" para esta ronda
    // Fórmula: 15 + round * 3 — en ronda 1 el máximo accesible es 18,
    // en ronda 5 es 30, en ronda 10 es 45
    const maxAffordable = 15 + round * 3;

    // Filtrar ítems: excluir los ya comprados y los ya ofrecidos en esta sesión
    const available = pool.filter(
      item => !this.purchasedItemIds.has(item.id) && !this.offeredItemIds.has(item.id)
    );

    if (available.length === 0) {
      // Si no hay ítems nuevos, resetear el tracking de ofrecidos
      // (pero no los comprados — esos ya no vuelven)
      this.offeredItemIds.clear();
      // Re-filtrar solo excluyendo comprados
      const refillPool = pool.filter(item => !this.purchasedItemIds.has(item.id));
      return this.selectItemsWithBias(refillPool, maxAffordable, playerId, round);
    }

    return this.selectItemsWithBias(available, maxAffordable, playerId, round);
  }

  /**
   * Selecciona 3 ítems del pool con sesgo de precio.
   * Los ítems más caros que `maxAffordable` tienen probabilidad reducida.
   */
  private selectItemsWithBias(
    pool: ItemDefinition[],
    maxAffordable: number,
    playerId: string,
    round: number
  ): ItemDefinition[] {
    // Separar ítems "accesibles" y "caros"
    const affordable = pool.filter(item => item.price <= maxAffordable);
    const expensive = pool.filter(item => item.price > maxAffordable);

    // Mezclar usando Fisher-Yates para aleatoriedad
    const shuffledAffordable = this.shuffle([...affordable]);
    const shuffledExpensive = this.shuffle([...expensive]);

    const selected: ItemDefinition[] = [];

    // Prioridad: 2 accesibles + 1 caro (con probabilidad)
    // Si hay suficientes accesibles, tomar 2 de ahí
    const affordableCount = Math.min(2, shuffledAffordable.length);
    for (let i = 0; i < affordableCount; i++) {
      selected.push(shuffledAffordable[i]);
    }

    // El tercer ítem: 70% accesible, 30% caro (si hay caros disponibles)
    if (selected.length < 3) {
      const remaining = 3 - selected.length;

      if (shuffledExpensive.length > 0 && Math.random() < 0.3) {
        // Tomar 1 caro
        selected.push(shuffledExpensive[0]);
        // Si aún faltan, llenar con accesibles
        const stillNeeded = 3 - selected.length;
        for (let i = affordableCount; i < Math.min(affordableCount + stillNeeded, shuffledAffordable.length); i++) {
          selected.push(shuffledAffordable[i]);
        }
      } else {
        // Llenar con accesibles
        for (let i = affordableCount; i < Math.min(affordableCount + remaining, shuffledAffordable.length); i++) {
          selected.push(shuffledAffordable[i]);
        }
      }
    }

    // Si aún no llegamos a 3 (pocos ítems en el pool), tomar del pool completo
    if (selected.length < 3) {
      const remaining = pool.filter(item => !selected.find(s => s.id === item.id));
      const shuffledRemaining = this.shuffle(remaining);
      for (let i = 0; i < Math.min(3 - selected.length, shuffledRemaining.length); i++) {
        selected.push(shuffledRemaining[i]);
      }
    }

    // Registrar los IDs ofrecidos para evitar repetir en la misma sesión
    for (const item of selected) {
      this.offeredItemIds.add(item.id);
    }

    // Guardar la oferta
    this.currentOffers.set(playerId, { round, items: selected });

    console.log(
      `[Shop] Oferta para ${playerId} (ronda ${round}):`,
      selected.map(i => `${i.name} (${i.price}g)`).join(', ')
    );

    return selected;
  }

  // =================================================================
  // COMPRA
  // =================================================================

  /**
   * Procesa la compra de un ítem para un jugador.
   *
   * Flujo:
   * 1. Verificar que el ítem esté en la oferta actual del jugador
   * 2. Verificar saldo suficiente
   * 3. Aplicar el efecto del ítem al personaje
   * 4. Descontar el precio del saldo
   * 5. Marcar el ítem como comprado
   *
   * @param playerId - ID del jugador
   * @param itemId - ID del ítem a comprar
   * @param character - Personaje del jugador (para aplicar efectos)
   * @returns Resultado de la compra
   */
  purchase(playerId: string, itemId: string, character: Character): ShopPurchaseResult {
    // 1. Verificar que el ítem esté en la oferta actual
    const offer = this.currentOffers.get(playerId);
    if (!offer) {
      return { success: false, newBalance: this.moneySystem.getBalance(playerId), message: 'No hay oferta activa para este jugador' };
    }

    const item = offer.items.find(i => i.id === itemId);
    if (!item) {
      return { success: false, newBalance: this.moneySystem.getBalance(playerId), message: `El ítem "${itemId}" no está disponible en tu oferta actual` };
    }

    // 2. Verificar saldo suficiente
    const balance = this.moneySystem.getBalance(playerId);
    if (balance < item.price) {
      return {
        success: false,
        newBalance: balance,
        message: `Saldo insuficiente: tienes ${balance}g, necesitas ${item.price}g`,
      };
    }

    // 3. Aplicar el efecto del ítem al personaje (con itemId/itemName para source tracking)
    const applyResult = this.upgradeApplier.applyEffect(character, item.effect, item.id, item.name);
    if (!applyResult.success) {
      return {
        success: false,
        newBalance: balance,
        message: applyResult.message,
      };
    }

    // 3b. Registrar el ítem en appliedItems del personaje (para HUD)
    character.appliedItems.push({
      itemId: item.id,
      itemName: item.name,
      round: offer.round,
      modifierIds: applyResult.modifierIds ?? [],
    });

    // 3c. Si el efecto es reactivo (onKill, onHit, onLowHP), registrarlo en PassiveEffects
    if (item.effect.type === 'reactive') {
      this.passiveEffects.register(playerId, item.id, item.effect as ReactiveEffect, character);
    }

    // 4. Descontar el precio
    const deducted = this.moneySystem.spendMoney(playerId, item.price);
    if (!deducted) {
      // Esto no debería ocurrir porque ya verificamos saldo, pero por seguridad
      return {
        success: false,
        newBalance: balance,
        message: 'Error al descontar el saldo',
      };
    }

    // 5. Marcar como comprado
    this.purchasedItemIds.add(item.id);

    // Remover el ítem de la oferta actual (ya no se puede comprar de nuevo)
    offer.items = offer.items.filter(i => i.id !== itemId);

    const newBalance = this.moneySystem.getBalance(playerId);

    console.log(
      `[Shop] ${playerId} compró "${item.name}" por ${item.price}g. ` +
      `Efecto: ${applyResult.message}. Balance restante: ${newBalance}g`
    );

    // Emitir evento de item comprado
    this.eventBus.emit('shop:itemBought' as any, { itemId, playerId } as any);

    return {
      success: true,
      newBalance,
      message: `¡${item.name} adquirido! ${applyResult.message}`,
      itemId: item.id,
    };
  }

  // =================================================================
  // CONSULTAS
  // =================================================================

  /**
   * Obtiene la oferta actual de un jugador.
   */
  getOffer(playerId: string): PlayerOffer | undefined {
    return this.currentOffers.get(playerId);
  }

  /**
   * Obtiene los ítems en la oferta actual de un jugador.
   */
  getOfferItems(playerId: string): ItemDefinition[] {
    return this.currentOffers.get(playerId)?.items ?? [];
  }

  // =================================================================
  // RESET
  // =================================================================

  /**
   * Resetea la tienda para una nueva sesión de juego.
   * Limpia ofertas activas, historial de ítems ofrecidos y comprados.
   */
  reset(): void {
    this.currentOffers.clear();
    this.purchasedItemIds.clear();
    this.offeredItemIds.clear();
    // Limpiar efectos reactivos al reiniciar la tienda (nueva partida)
    this.passiveEffects.unregisterAll();
    console.log('[Shop] Tienda reiniciada para nueva sesión');
  }

  /**
   * Limpia las ofertas actuales (se llama al iniciar una nueva ronda).
   * Los ítems no comprados desaparecen.
   */
  clearOffers(): void {
    this.currentOffers.clear();
    console.log('[Shop] Ofertas limpiadas (ítems no comprados descartados)');
  }

  // =================================================================
  // UTILIDADES
  // =================================================================

  /**
   * Fisher-Yates shuffle.
   */
  private shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}
