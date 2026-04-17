import type { GameEvents } from '../../../shared/src/types/Events';

/**
 * Listener de eventos con tipado fuerte.
 */
type Listener<T = unknown> = (data: T) => void;

/**
 * Bus de eventos genérico con tipado TypeScript.
 * Permite que los sistemas del juego se comuniquen sin depender directamente entre sí.
 *
 * @template T - Mapa de eventos (por defecto GameEvents)
 */
export class EventBus<T extends object = GameEvents> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private listeners: Map<keyof T, Set<Listener<any>>> = new Map();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onceListeners: Map<keyof T, Set<Listener<any>>> = new Map();

  /**
   * Suscribe un listener a un evento específico.
   * @param event Nombre del evento
   * @param listener Función que recibe el payload tipado
   * @returns Función para desuscribir (off)
   */
  on<K extends keyof T>(event: K, listener: Listener<T[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  /**
   * Suscribe un listener que se ejecuta una sola vez.
   * @param event Nombre del evento
   * @param listener Función que se ejecutará una vez
   * @returns Función para desuscribir (off)
   */
  once<K extends keyof T>(event: K, listener: Listener<T[K]>): () => void {
    if (!this.onceListeners.has(event)) {
      this.onceListeners.set(event, new Set());
    }
    this.onceListeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  /**
   * Elimina un listener específico de un evento.
   * @param event Nombre del evento
   * @param listener Listener a eliminar (debe ser la misma referencia)
   */
  off<K extends keyof T>(event: K, listener: Listener<T[K]>): void {
    this.listeners.get(event)?.delete(listener);
    this.onceListeners.get(event)?.delete(listener);
  }

  /**
   * Emite un evento, notificando a todos los listeners suscritos.
   * @param event Nombre del evento
   * @param data Payload del evento (debe coincidir con el tipo definido en T[K])
   */
  emit<K extends keyof T>(event: K, data: T[K]): void {
    // Notificar listeners regulares
    this.listeners.get(event)?.forEach(listener => {
      try {
        listener(data);
      } catch (err) {
        console.error(`Error en listener de evento "${String(event)}":`, err);
      }
    });

    // Notificar listeners de una vez y eliminarlos
    const onceSet = this.onceListeners.get(event);
    if (onceSet) {
      onceSet.forEach(listener => {
        try {
          listener(data);
        } catch (err) {
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
  clear(event?: keyof T): void {
    if (event !== undefined) {
      this.listeners.delete(event);
      this.onceListeners.delete(event);
    } else {
      this.listeners.clear();
      this.onceListeners.clear();
    }
  }

  /**
   * Número total de listeners registrados (incluyendo once).
   */
  get listenerCount(): number {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    for (const set of this.onceListeners.values()) total += set.size;
    return total;
  }
}

/**
 * Instancia singleton del bus de eventos, tipada con GameEvents.
 * Úsala en todo el proyecto para comunicación desacoplada.
 */
export const events = new EventBus<GameEvents>();
