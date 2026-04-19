import { EventBus } from '../../engine/EventBus';

/**
 * Habilidad pasiva "Furia" para el Caballero (MeleeCharacter).
 *
 * Mecánica:
 * - Escucha eventos enemy:died para el playerId específico (extendido con killerId)
 * - Acumula kills en un contador
 * - Al llegar a 3 kills: activa furyReady = true y resetea contador
 * - En el siguiente ataque: si furyReady, el daño es ×2 y se consume furyReady
 * - Feedback visual: aura/glow en el modelo cuando furyReady
 */
export class FuryPassive {
  private eventBus: EventBus;
  private playerId: string;
  
  private killCount: number = 0;
  private furyReady: boolean = false;
  
  // Para feedback visual (placeholder - se integrará con el sistema de efectos visuales)
  private visualEffectActive: boolean = false;

  constructor(eventBus: EventBus, playerId: string) {
    this.eventBus = eventBus;
    this.playerId = playerId;
    
    this.setupEventListeners();
  }

  /**
   * Configura los listeners de eventos para esta habilidad.
   */
  private setupEventListeners(): void {
    // Escuchar eventos de muerte de enemigos (usando any temporalmente hasta que se extienda el tipo)
    (this.eventBus as any).on('enemy:died', this.handleEnemyDied.bind(this));
    
    // Escuchar eventos de ataque para consumir la furia (evento personalizado)
    (this.eventBus as any).on('player:attack', this.handlePlayerAttack.bind(this));
  }

  /**
   * Maneja la muerte de un enemigo.
   * Nota: El evento enemy:died actual no incluye killerId, pero asumimos que se extenderá.
   */
  private handleEnemyDied(data: any): void {
    // Extraer killerId si existe, de lo contrario asumir que este jugador no mató al enemigo
    const killerId = data.killerId;
    if (killerId !== this.playerId) return;

    this.killCount++;
    
    console.log(`[FuryPassive] ${this.playerId} kill count: ${this.killCount}/3`);

    // Al llegar a 3 kills, activar furia
    if (this.killCount >= 3) {
      this.activateFury();
      this.killCount = 0; // Resetear contador
    }
  }

  /**
   * Maneja el ataque del jugador para aplicar el bonus de daño.
   */
  private handlePlayerAttack(data: any): void {
    if (data.playerId !== this.playerId) return;
    
    // Si la furia está lista, aplicar bonus de daño
    if (this.furyReady) {
      const boostedDamage = data.damage * 2;
      console.log(`[FuryPassive] ${this.playerId} furia activada! Daño: ${data.damage} → ${boostedDamage}`);
      
      // Emitir evento con daño modificado (evento personalizado)
      (this.eventBus as any).emit('player:attack:modified', {
        playerId: this.playerId,
        originalDamage: data.damage,
        modifiedDamage: boostedDamage,
        reason: 'fury'
      });
      
      // Consumir la furia
      this.furyReady = false;
      this.updateVisualEffect(false);
    }
  }

  /**
   * Activa la furia del jugador.
   */
  private activateFury(): void {
    this.furyReady = true;
    console.log(`[FuryPassive] ${this.playerId} FURIA LISTA! El próximo ataque hará ×2 daño.`);
    
    // Activar efecto visual
    this.updateVisualEffect(true);
    
    // Emitir evento para UI/HUD (evento personalizado)
    (this.eventBus as any).emit('player:fury:ready', {
      playerId: this.playerId,
      ready: true
    });
  }

  /**
   * Actualiza el efecto visual de la furia (placeholder).
   */
  private updateVisualEffect(active: boolean): void {
    this.visualEffectActive = active;
    
    // En una implementación real, esto activaría/desactivaría un shader o glow en el modelo
    if (active) {
      console.log(`[FuryPassive] Efecto visual activado para ${this.playerId}`);
      // this.applyGlowEffect();
    } else {
      console.log(`[FuryPassive] Efecto visual desactivado para ${this.playerId}`);
      // this.removeGlowEffect();
    }
  }

  /**
   * Notifica que el jugador ha matado a un enemigo (método alternativo si el evento no tiene killerId).
   */
  public notifyKill(): void {
    this.killCount++;
    console.log(`[FuryPassive] ${this.playerId} kill count (notify): ${this.killCount}/3`);

    if (this.killCount >= 3) {
      this.activateFury();
      this.killCount = 0;
    }
  }

  /**
   * Aplica el bonus de furia a un ataque si está lista.
   * @returns Multiplicador de daño (2 si furyReady, 1 si no)
   */
  public applyFuryToAttack(): number {
    if (this.furyReady) {
      console.log(`[FuryPassive] ${this.playerId} aplicando furia (×2 daño)`);
      this.furyReady = false;
      this.updateVisualEffect(false);
      return 2;
    }
    return 1;
  }

  /**
   * Obtiene el estado actual de la furia.
   */
  public getFuryState(): { killCount: number; furyReady: boolean } {
    return {
      killCount: this.killCount,
      furyReady: this.furyReady
    };
  }

  /**
   * Reinicia el estado de la habilidad (ej. al morir o respawnear).
   */
  public reset(): void {
    this.killCount = 0;
    this.furyReady = false;
    this.updateVisualEffect(false);
    
    console.log(`[FuryPassive] ${this.playerId} estado reiniciado`);
  }

  /**
   * Limpia los listeners de eventos al destruir la instancia.
   */
  public dispose(): void {
    (this.eventBus as any).off('enemy:died', this.handleEnemyDied.bind(this));
    (this.eventBus as any).off('player:attack', this.handlePlayerAttack.bind(this));
  }
}