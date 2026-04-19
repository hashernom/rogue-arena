"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.events = exports.EventBus = void 0;
/**
 * Bus de eventos genérico con tipado TypeScript.
 * Permite que los sistemas del juego se comuniquen sin depender directamente entre sí.
 *
 * @template T - Mapa de eventos (por defecto GameEvents)
 */
class EventBus {
    constructor() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.listeners = new Map();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.onceListeners = new Map();
    }
    /**
     * Suscribe un listener a un evento específico.
     * @param event Nombre del evento
     * @param listener Función que recibe el payload tipado
     * @returns Función para desuscribir (off)
     */
    on(event, listener) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(listener);
        return () => this.off(event, listener);
    }
    /**
     * Suscribe un listener que se ejecuta una sola vez.
     * @param event Nombre del evento
     * @param listener Función que se ejecutará una vez
     * @returns Función para desuscribir (off)
     */
    once(event, listener) {
        if (!this.onceListeners.has(event)) {
            this.onceListeners.set(event, new Set());
        }
        this.onceListeners.get(event).add(listener);
        return () => this.off(event, listener);
    }
    /**
     * Elimina un listener específico de un evento.
     * @param event Nombre del evento
     * @param listener Listener a eliminar (debe ser la misma referencia)
     */
    off(event, listener) {
        this.listeners.get(event)?.delete(listener);
        this.onceListeners.get(event)?.delete(listener);
    }
    /**
     * Emite un evento, notificando a todos los listeners suscritos.
     * @param event Nombre del evento
     * @param data Payload del evento (debe coincidir con el tipo definido en T[K])
     */
    emit(event, data) {
        // Notificar listeners regulares
        this.listeners.get(event)?.forEach(listener => {
            try {
                listener(data);
            }
            catch (err) {
                console.error(`Error en listener de evento "${String(event)}":`, err);
            }
        });
        // Notificar listeners de una vez y eliminarlos
        const onceSet = this.onceListeners.get(event);
        if (onceSet) {
            onceSet.forEach(listener => {
                try {
                    listener(data);
                }
                catch (err) {
                    console.error(`Error en listener once de evento "${String(event)}":`, err);
                }
            });
            onceSet.clear();
        }
    }
    /**
     * Elimina todos los listeners de un evento específico.
     * @param event Nombre del evento (opcional). Si no se proporciona, limpia todos los eventos.
     */
    clear(event) {
        if (event !== undefined) {
            this.listeners.delete(event);
            this.onceListeners.delete(event);
        }
        else {
            this.listeners.clear();
            this.onceListeners.clear();
        }
    }
    /**
     * Número total de listeners registrados (incluyendo once).
     */
    get listenerCount() {
        let total = 0;
        for (const set of this.listeners.values())
            total += set.size;
        for (const set of this.onceListeners.values())
            total += set.size;
        return total;
    }
}
exports.EventBus = EventBus;
/**
 * Instancia singleton del bus de eventos, tipada con GameEvents.
 * Úsala en todo el proyecto para comunicación desacoplada.
 */
exports.events = new EventBus();
