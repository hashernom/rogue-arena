import { EventBus } from '../engine/EventBus';
import type { GameEvents } from '../../../shared/src/types/Events';

/**
 * Configuración de una notificación individual.
 */
interface Toast {
  /** ID único para tracking */
  id: number;
  /** Mensaje a mostrar */
  message: string;
  /** Tipo visual (define color de borde/icono) */
  type: 'info' | 'warning' | 'success' | 'error';
  /** Elemento DOM de la notificación */
  element: HTMLElement;
  /** Temporizador de auto-destrucción */
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * Sistema de notificaciones flotantes (toasts).
 *
 * Muestra mensajes breves en la esquina superior central del HUD,
 * con un máximo de 3 notificaciones simultáneas. Las notificaciones
 * se desvanecen con CSS transitions (opacity + translateY) después
 * de 2.5 segundos.
 *
 * Uso:
 * ```ts
 * const toasts = new NotificationSystem(eventBus);
 * toasts.show('¡Oleada 3 iniciada!', 'info');
 * ```
 */
export class NotificationSystem {
  private static readonly MAX_VISIBLE = 3;
  private static readonly DURATION_MS = 2500;
  private static readonly ANIMATION_MS = 300;

  private eventBus: EventBus<GameEvents>;
  private container: HTMLElement;
  private activeToasts: Toast[] = [];
  private nextId = 0;
  private unsubscribers: (() => void)[] = [];

  constructor(eventBus: EventBus<GameEvents>) {
    this.eventBus = eventBus;
    this.container = this.createContainer();
    this.subscribeToEvents();
  }

  // ────────────────────────────── Público ──────────────────────────────

  /**
   * Muestra una notificación flotante.
   *
   * @param message Texto a mostrar
   * @param type    Categoría visual (info, warning, success, error)
   */
  show(message: string, type: Toast['type'] = 'info'): void {
    const id = this.nextId++;
    const element = this.createElement(message, type);

    const toast: Toast = {
      id,
      message,
      type,
      element,
      timeoutId: setTimeout(() => this.dismiss(id), NotificationSystem.DURATION_MS),
    };

    this.activeToasts.push(toast);
    this.container.appendChild(element);

    // Trigger reflow para que la transición de entrada funcione
    requestAnimationFrame(() => {
      element.classList.add('toast--visible');
    });

    this.enforceMaxVisible();
  }

  /**
   * Limpia todas las notificaciones activas y desuscribe eventos.
   */
  destroy(): void {
    this.unsubscribers.forEach(fn => fn());
    this.unsubscribers = [];
    this.activeToasts.forEach(t => {
      clearTimeout(t.timeoutId);
      t.element.remove();
    });
    this.activeToasts = [];
    this.container.remove();
  }

  // ────────────────────────────── Privado ──────────────────────────────

  /**
   * Crea el contenedor raíz de las notificaciones y lo inyecta en el DOM.
   */
  private createContainer(): HTMLElement {
    const existing = document.getElementById('toast-container');
    if (existing) return existing;

    const container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
    return container;
  }

  /**
   * Construye el elemento DOM de una notificación.
   */
  private createElement(message: string, type: Toast['type']): HTMLElement {
    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.textContent = message;
    el.setAttribute('role', 'alert');
    return el;
  }

  /**
   * Descarta una notificación por ID con animación de salida.
   */
  private dismiss(id: number): void {
    const index = this.activeToasts.findIndex(t => t.id === id);
    if (index === -1) return;

    const toast = this.activeToasts[index];
    clearTimeout(toast.timeoutId);

    const el = toast.element;
    el.classList.remove('toast--visible');
    el.classList.add('toast--hiding');

    // Remover del DOM después de la transición
    setTimeout(() => {
      el.remove();
      this.activeToasts = this.activeToasts.filter(t => t.id !== id);
      this.repositionActive();
    }, NotificationSystem.ANIMATION_MS);
  }

  /**
   * Si hay más de MAX_VISIBLE notificaciones, descarta la más antigua.
   */
  private enforceMaxVisible(): void {
    while (this.activeToasts.length > NotificationSystem.MAX_VISIBLE) {
      const oldest = this.activeToasts[0];
      if (oldest) this.dismiss(oldest.id);
    }
  }

  /**
   * Re-posiciona las notificaciones activas aplicando translateY
   * para que se desplacen hacia arriba cuando una desaparece.
   */
  private repositionActive(): void {
    this.activeToasts.forEach((toast, i) => {
      toast.element.style.setProperty('--toast-index', String(i));
    });
  }

  /**
   * Se suscribe a eventos del juego que disparan notificaciones automáticas.
   */
  private subscribeToEvents(): void {
    // Oleada iniciada
    this.unsubscribers.push(
      this.eventBus.on('wave:started', data => {
        this.show(`🌊 Oleada ${data.round} iniciada!`, 'info');
      })
    );

    // Oleada terminada
    this.unsubscribers.push(
      this.eventBus.on('wave:ended', data => {
        this.show(`✅ Oleada ${data.round} completada! (+${data.reward}💰)`, 'success');
      })
    );

    // Ítem comprado
    this.unsubscribers.push(
      this.eventBus.on('shop:itemBought', data => {
        this.show(`🛒 Ítem comprado: ${data.itemId}`, 'success');
      })
    );

    // Notificación genérica
    this.unsubscribers.push(
      this.eventBus.on('notification:show', data => {
        this.show(data.message, data.type);
      })
    );

    // Habilidad lista
    this.unsubscribers.push(
      this.eventBus.on('ability:ready', data => {
        const playerLabel = data.playerId === 'player1' ? 'P1' : 'P2';
        this.show(`⚡ ${playerLabel} — ¡${data.abilityName} lista!`, 'warning');
      })
    );

    // Jugador desconectado
    this.unsubscribers.push(
      this.eventBus.on('player:disconnected', data => {
        const playerLabel = data.playerId === 'player1' ? 'P1' : 'P2';
        this.show(`🔌 ${playerLabel} se desconectó — esperando 30s`, 'error');
      })
    );

    // Jugador murió
    this.unsubscribers.push(
      this.eventBus.on('player:died', data => {
        const playerLabel = data.playerId === 'player1' ? 'P1' : 'P2';
        this.show(`💀 ${playerLabel} ha caído!`, 'error');
      })
    );
  }
}
