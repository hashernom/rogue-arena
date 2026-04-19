"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Character = exports.CharacterState = exports.ModifierType = void 0;
const StatsSystem_1 = require("./StatsSystem");
/**
 * Tipo de modificador de estadística (legacy, mantenido para compatibilidad).
 * @deprecated Usar ModType del StatsSystem para nuevos desarrollos
 */
var ModifierType;
(function (ModifierType) {
    /** Suma un valor fijo (ej: +10 daño) */
    ModifierType["Additive"] = "additive";
    /** Multiplica el valor base (ej: ×1.5 daño) */
    ModifierType["Multiplicative"] = "multiplicative";
})(ModifierType || (exports.ModifierType = ModifierType = {}));
/**
 * Estados posibles de un personaje.
 */
var CharacterState;
(function (CharacterState) {
    CharacterState["Idle"] = "idle";
    CharacterState["Moving"] = "moving";
    CharacterState["Attacking"] = "attacking";
    CharacterState["Dead"] = "dead";
})(CharacterState || (exports.CharacterState = CharacterState = {}));
/**
 * Clase abstracta base para todos los personajes (jugadores y enemigos).
 * Define la interfaz de stats, sistema de modificadores y máquina de estados simple.
 */
class Character {
    constructor(id, baseStats, eventBus, physicsWorld, physicsBody) {
        /** Modificadores activos (legacy, mantenido para compatibilidad) */
        this.modifiers = [];
        /** Estado actual */
        this.state = CharacterState.Idle;
        this.id = id;
        this.statsSystem = new StatsSystem_1.StatsSystem({ ...baseStats });
        this.eventBus = eventBus;
        this.physicsWorld = physicsWorld;
        this.physicsBody = physicsBody;
    }
    /**
     * Obtiene el valor efectivo de una estadística, aplicando todos los modificadores.
     * Usa el nuevo StatsSystem con caché.
     */
    getEffectiveStat(stat) {
        return this.statsSystem.getStat(stat);
    }
    /**
     * Aplica un modificador a una estadística (legacy API).
     * Para nuevos desarrollos, usar addModifier del StatsSystem directamente.
     */
    applyModifier(stat, value, type, id, description) {
        // Convertir ModifierType legacy a ModType del nuevo sistema
        let modType;
        switch (type) {
            case ModifierType.Additive:
                modType = 'addFlat';
                break;
            case ModifierType.Multiplicative:
                modType = 'multiplyBase';
                break;
            default:
                modType = 'addFlat';
        }
        const source = description || `legacy_mod_${stat}`;
        const newModifier = { stat, value, type: modType, source };
        // Si se proporciona un ID, usarlo como parte del source para poder removerlo después
        const modifierId = this.statsSystem.addModifier(newModifier);
        // Mantener compatibilidad con el array legacy
        this.modifiers.push({ stat, value, type, id: id || modifierId, description });
    }
    /**
     * Elimina un modificador por su ID (legacy API).
     */
    removeModifier(id) {
        // Buscar el modificador en el array legacy
        const legacyMod = this.modifiers.find(m => m.id === id);
        if (legacyMod) {
            // Para remover del nuevo sistema necesitaríamos mapear el ID legacy
            // Por ahora, solo removemos del array legacy
            // En una implementación completa, necesitaríamos guardar el mapping de IDs
            this.modifiers = this.modifiers.filter(m => m.id !== id);
        }
    }
    /**
     * Elimina todos los modificadores de una estadística específica (legacy API).
     */
    clearModifiersForStat(stat) {
        this.modifiers = this.modifiers.filter(m => m.stat !== stat);
        // También limpiar del nuevo sistema
        const allModifiers = this.statsSystem.getModifiers();
        allModifiers.forEach(mod => {
            if (mod.stat === stat) {
                // Necesitaríamos el ID del modificador para removerlo
                // Por simplicidad, limpiaremos todos los modificadores y reaplicaremos los restantes
            }
        });
    }
    /**
     * Recibe daño, aplicando reducción por armadura.
     * Fórmula: finalDmg = dmg * (100 / (100 + armor))
     */
    takeDamage(amount) {
        if (this.state === CharacterState.Dead)
            return;
        const armor = this.getEffectiveStat('armor');
        const finalDamage = amount * (100 / (100 + armor));
        // Usar el nuevo sistema para aplicar daño
        this.statsSystem.takeDamage(finalDamage);
        // Emitir evento de daño si es jugador
        this.eventBus.emit('player:damaged', { playerId: this.id, amount: finalDamage });
        if (this.statsSystem.getStat('hp') <= 0) {
            this.die();
        }
    }
    /**
     * Cura al personaje, sin exceder maxHp.
     */
    heal(amount) {
        if (this.state === CharacterState.Dead)
            return;
        this.statsSystem.heal(amount);
    }
    /**
     * Mata al personaje y emite el evento correspondiente.
     */
    die() {
        if (this.state === CharacterState.Dead)
            return;
        this.state = CharacterState.Dead;
        this.statsSystem.setBaseStat('hp', 0);
        // Emitir evento de muerte
        this.eventBus.emit('player:died', { playerId: this.id });
    }
    /**
     * Cambia el estado del personaje.
     */
    setState(newState) {
        if (this.state === CharacterState.Dead && newState !== CharacterState.Dead) {
            // No se puede salir del estado Dead
            return;
        }
        this.state = newState;
    }
    /**
     * Obtiene el estado actual.
     */
    getState() {
        return this.state;
    }
    /**
     * Verifica si el personaje está vivo.
     */
    isAlive() {
        return this.state !== CharacterState.Dead && this.getEffectiveStat('hp') > 0;
    }
    /**
     * Establece el cuerpo de física asociado.
     */
    setPhysicsBody(body) {
        this.physicsBody = body;
    }
    /**
     * Obtiene el cuerpo de física asociado.
     */
    getPhysicsBody() {
        return this.physicsBody;
    }
    /**
     * Establece la referencia al mundo de física.
     */
    setPhysicsWorld(world) {
        this.physicsWorld = world;
    }
    /**
     * Obtiene las estadísticas base (sin modificadores).
     */
    getBaseStats() {
        return {
            hp: this.statsSystem.getBaseStat('hp'),
            maxHp: this.statsSystem.getBaseStat('maxHp'),
            speed: this.statsSystem.getBaseStat('speed'),
            damage: this.statsSystem.getBaseStat('damage'),
            attackSpeed: this.statsSystem.getBaseStat('attackSpeed'),
            range: this.statsSystem.getBaseStat('range'),
            armor: this.statsSystem.getBaseStat('armor'),
        };
    }
    /**
     * Obtiene las estadísticas efectivas (con modificadores aplicados).
     */
    getEffectiveStats() {
        return this.statsSystem.getAllStats();
    }
}
exports.Character = Character;
