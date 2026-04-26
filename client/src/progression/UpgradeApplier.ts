import { Character, ModifierType } from '../characters/Character';
import type { ItemEffect } from '../../../shared/src/types/Items';

// =================================================================
// UPGRADE APPLIER
// =================================================================

/**
 * Resultado de aplicar un efecto de ítem a un personaje.
 */
export interface ApplyResult {
  success: boolean;
  message: string;
  /** IDs de los modificadores creados en StatsSystem (para tracking en appliedItems) */
  modifierIds?: string[];
}

/**
 * Aplica efectos de ítems a personajes jugadores.
 *
 * Responsabilidades:
 * - Interpretar `ItemEffect` y traducirlo a modificadores de stats
 * - Manejar efectos especiales (healImmediate, statModifier, special)
 * - Proveer feedback sobre el resultado de la aplicación
 * - Retornar los IDs de modificadores creados para tracking en el personaje
 */
export class UpgradeApplier {
  /**
   * Aplica un efecto de ítem a un personaje.
   * @param character - Personaje objetivo
   * @param effect - Efecto del ítem a aplicar
   * @param itemId - ID del ítem en el catálogo (para source tracking)
   * @param itemName - Nombre del ítem (para source tracking)
   * @returns Resultado de la operación
   */
  applyEffect(
    character: Character,
    effect: ItemEffect,
    itemId?: string,
    itemName?: string
  ): ApplyResult {
    switch (effect.type) {
      case 'healImmediate':
        return this.applyHeal(character, effect.value);

      case 'statModifier':
        return this.applyStatModifier(
          character,
          effect.stat,
          effect.value,
          effect.modType,
          itemId,
          itemName
        );

      case 'special':
        return this.applySpecial(character, effect.specialId, effect.params);

      default:
        return { success: false, message: `Tipo de efecto desconocido: ${(effect as any).type}` };
    }
  }

  /**
   * Aplica curación inmediata al personaje.
   */
  private applyHeal(character: Character, amount: number): ApplyResult {
    const maxHp = character.getEffectiveStat('maxHp');
    const currentHp = character.getEffectiveStat('hp');
    const actualHeal = Math.min(amount, maxHp - currentHp);

    if (actualHeal <= 0) {
      return { success: false, message: 'Ya tienes la vida al máximo' };
    }

    character.heal(actualHeal);
    return {
      success: true,
      message: `+${actualHeal} HP (${currentHp} → ${Math.min(currentHp + actualHeal, maxHp)})`,
    };
  }

  /**
   * Aplica un modificador permanente de estadística usando la API pública de Character.
   * El source incluye itemId/itemName para identificar el origen en el HUD.
   */
  private applyStatModifier(
    character: Character,
    stat: string,
    value: number,
    modType: 'addFlat' | 'multiply',
    itemId?: string,
    itemName?: string
  ): ApplyResult {
    // Convertir modType del schema al ModifierType de Character
    const legacyType = modType === 'addFlat' ? ModifierType.Additive : ModifierType.Multiplicative;

    // Source descriptivo que identifica el ítem específico
    const itemLabel = itemName || itemId || stat;
    const source = `shop:${itemLabel}`;

    character.applyModifier(
      stat as any,
      value,
      legacyType,
      undefined,
      source
    );

    const newValue = character.getEffectiveStat(stat as any);
    return {
      success: true,
      message: `${stat} +${value} (ahora: ${newValue})`,
      modifierIds: [source], // El source se usa como identificador en StatsSystem
    };
  }

  /**
   * Aplica un efecto especial.
   * Los efectos especiales requieren lógica custom y se registran aquí.
   */
  private applySpecial(
    character: Character,
    specialId: string,
    params?: Record<string, number | string | boolean>
  ): ApplyResult {
    switch (specialId) {
      case 'double_drop_next_wave': {
        // Marcar al jugador para recibir ×2 drops la próxima ronda
        // Usa la propiedad type-safe doubleDropNextWave en Character
        character.doubleDropNextWave = true;
        const multiplier = params?.multiplier ?? 2;
        return {
          success: true,
          message: `×${multiplier} drops de monedas la próxima ronda`,
        };
      }

      default:
        return {
          success: false,
          message: `Efecto especial no implementado: ${specialId}`,
        };
    }
  }
}
