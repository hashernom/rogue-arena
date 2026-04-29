import { EventBus } from '../engine/EventBus';
import { MeleeCharacter } from '../characters/MeleeCharacter';
import { AdcCharacter } from '../characters/AdcCharacter';
import { WaveManager } from '../waves/WaveManager';
import { MoneySystem } from '../progression/MoneySystem';
import { EnemyPool } from '../enemies/EnemyPool';

/**
 * Datos de estadísticas de un jugador para la pantalla de fin de partida.
 */
export interface PlayerStats {
  id: string;
  label: string;
  icon: string;
  kills: number;
  damageDealt: number;
  damageReceived: number;
  itemsBought: number;
}

/**
 * Callbacks para las acciones de la pantalla de Game Over.
 */
export interface GameOverCallbacks {
  /** Se ejecuta cuando el jugador hace clic en "Jugar de nuevo" */
  onPlayAgain: () => void;
}

/**
 * Pantalla de fin de partida (Game Over).
 *
 * Muestra una superposición full-screen con:
 * - Título dinámico según las rondas sobrevividas
 * - "Rondas sobrevividas: N"
 * - Estadísticas por jugador (kills, daño infligido, daño recibido, ítems comprados)
 * - Botón "Jugar de nuevo"
 *
 * Se suscribe al evento `game:over` del EventBus para mostrarse automáticamente.
 */
export class GameOverScreen {
  private eventBus: EventBus;
  private container: HTMLElement | null = null;
  private callbacks: GameOverCallbacks;
  private meleeCharacter: MeleeCharacter | null = null;
  private adcCharacter: AdcCharacter | null = null;
  private waveManager: WaveManager | null = null;
  private moneySystem: MoneySystem | null = null;
  private enemyPool: EnemyPool | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(eventBus: EventBus, callbacks: GameOverCallbacks) {
    this.eventBus = eventBus;
    this.callbacks = callbacks;
    this.subscribeToEvents();
  }

  /**
   * Establece las referencias necesarias para recolectar estadísticas.
   */
  setReferences(
    melee: MeleeCharacter | null,
    adc: AdcCharacter | null,
    waveManager: WaveManager | null,
    moneySystem: MoneySystem | null,
    enemyPool: EnemyPool | null
  ): void {
    this.meleeCharacter = melee;
    this.adcCharacter = adc;
    this.waveManager = waveManager;
    this.moneySystem = moneySystem;
    this.enemyPool = enemyPool;
  }

  /**
   * Se suscribe al evento `game:over` para mostrar la pantalla automáticamente.
   */
  private subscribeToEvents(): void {
    this.unsubscribe = this.eventBus.on('game:over', (data: { rounds: number }) => {
      this.show(data.rounds);
    });
  }

  /**
   * Obtiene el título dinámico según las rondas sobrevividas.
   */
  private getTitle(rounds: number): string {
    if (rounds <= 4) return 'Aprendices';
    if (rounds <= 9) return 'Aventureros';
    return 'Héroes';
  }

  /**
   * Obtiene el subtítulo según las rondas sobrevividas.
   */
  private getSubtitle(rounds: number): string {
    if (rounds <= 4)
      return 'Sobreviviste las primeras oleadas, pero aún queda camino por recorrer.';
    if (rounds <= 9) return 'Demostraste valor en la arena. Los desafíos mayores te esperan.';
    return '¡Una hazaña legendaria! Tu nombre será recordado en la arena.';
  }

  /**
   * Recolecta las estadísticas de ambos jugadores.
   */
  private collectStats(): PlayerStats[] {
    const stats: PlayerStats[] = [];

    // Player 1: MeleeCharacter
    if (this.meleeCharacter) {
      const p1Kills = this.meleeCharacter.getKillCount();
      stats.push({
        id: 'player1',
        label: 'P1 — Caballero',
        icon: '⚔️',
        kills: p1Kills,
        damageDealt: this.meleeCharacter.damageDealt,
        damageReceived: this.meleeCharacter.damageReceived,
        itemsBought: this.meleeCharacter.appliedItems.length,
      });
    }

    // Player 2: AdcCharacter
    if (this.adcCharacter) {
      const p2Kills = this.adcCharacter.getKillCount();
      stats.push({
        id: 'player2',
        label: 'P2 — Arquero',
        icon: '🏹',
        kills: p2Kills,
        damageDealt: this.adcCharacter.damageDealt,
        damageReceived: this.adcCharacter.damageReceived,
        itemsBought: this.adcCharacter.appliedItems.length,
      });
    }

    return stats;
  }

  /**
   * Construye y muestra la pantalla de Game Over.
   */
  show(rounds: number): void {
    // Remover pantalla anterior si existe
    this.hide();

    const title = this.getTitle(rounds);
    const subtitle = this.getSubtitle(rounds);
    const stats = this.collectStats();

    // Crear contenedor principal
    const container = document.createElement('div');
    container.id = 'game-over-screen';
    this.container = container;

    // Estilos del contenedor
    Object.assign(container.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      bottom: '0',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: '9999',
      background:
        'radial-gradient(ellipse at center, rgba(10,10,20,0.92) 0%, rgba(0,0,0,0.96) 100%)',
      backdropFilter: 'blur(8px)',
      fontFamily: 'monospace',
      opacity: '0',
      transition: 'opacity 0.4s ease',
    });

    // Panel principal
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      maxWidth: '640px',
      width: '90%',
      maxHeight: '90vh',
      overflowY: 'auto',
      background: 'linear-gradient(180deg, rgba(15,15,30,0.98) 0%, rgba(8,8,18,0.99) 100%)',
      borderRadius: '16px',
      padding: '36px 32px 28px',
      border: '1px solid rgba(255,170,0,0.15)',
      boxShadow: '0 20px 60px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.05)',
      textAlign: 'center',
    });

    // ================================================================
    // ENCABEZADO: Título dinámico + Rondas
    // ================================================================

    // Título dinámico
    const titleEl = document.createElement('div');
    titleEl.textContent = title;
    Object.assign(titleEl.style, {
      fontSize: '48px',
      fontWeight: 'bold',
      color: '#ffaa00',
      lineHeight: '1',
      marginBottom: '4px',
      textShadow: '0 0 30px rgba(255,170,0,0.3)',
    });

    // Subtítulo
    const subtitleEl = document.createElement('div');
    subtitleEl.textContent = subtitle;
    Object.assign(subtitleEl.style, {
      fontSize: '13px',
      color: '#888',
      marginBottom: '24px',
      lineHeight: '1.4',
      padding: '0 16px',
    });

    // Separador
    const separator1 = document.createElement('div');
    Object.assign(separator1.style, {
      height: '1px',
      background: 'linear-gradient(90deg, transparent, rgba(255,170,0,0.2), transparent)',
      marginBottom: '20px',
    });

    // Rondas sobrevividas
    const roundsContainer = document.createElement('div');
    Object.assign(roundsContainer.style, {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      gap: '12px',
      marginBottom: '24px',
    });

    const roundsIcon = document.createElement('span');
    roundsIcon.textContent = '🏆';
    roundsIcon.style.fontSize = '28px';

    const roundsLabel = document.createElement('span');
    roundsLabel.textContent = 'Rondas sobrevividas:';
    Object.assign(roundsLabel.style, {
      fontSize: '16px',
      color: '#aaa',
      textTransform: 'uppercase',
      letterSpacing: '1px',
    });

    const roundsValue = document.createElement('span');
    roundsValue.textContent = String(rounds);
    Object.assign(roundsValue.style, {
      fontSize: '42px',
      fontWeight: 'bold',
      color: '#fff',
      lineHeight: '1',
    });

    roundsContainer.appendChild(roundsIcon);
    roundsContainer.appendChild(roundsLabel);
    roundsContainer.appendChild(roundsValue);

    // Separador
    const separator2 = document.createElement('div');
    Object.assign(separator2.style, {
      height: '1px',
      background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)',
      marginBottom: '20px',
    });

    // ================================================================
    // ESTADÍSTICAS POR JUGADOR
    // ================================================================

    const statsContainer = document.createElement('div');
    Object.assign(statsContainer.style, {
      display: 'flex',
      gap: '16px',
      justifyContent: 'center',
      flexWrap: 'wrap' as const,
      marginBottom: '28px',
    });

    stats.forEach((playerStat, index) => {
      const card = this.createPlayerStatCard(playerStat, index);
      statsContainer.appendChild(card);
    });

    // ================================================================
    // BOTÓN: JUGAR DE NUEVO
    // ================================================================

    const playAgainBtn = document.createElement('button');
    playAgainBtn.textContent = '🔄  Jugar de nuevo';
    Object.assign(playAgainBtn.style, {
      background: 'linear-gradient(180deg, #ffaa00 0%, #e69900 100%)',
      color: '#1a1a2e',
      border: 'none',
      borderRadius: '10px',
      padding: '14px 40px',
      fontSize: '18px',
      fontWeight: 'bold',
      fontFamily: 'monospace',
      cursor: 'pointer',
      transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      boxShadow: '0 4px 20px rgba(255,170,0,0.3)',
      letterSpacing: '0.5px',
    });

    // Hover effect
    playAgainBtn.addEventListener('mouseenter', () => {
      playAgainBtn.style.transform = 'scale(1.05)';
      playAgainBtn.style.boxShadow = '0 6px 30px rgba(255,170,0,0.5)';
    });
    playAgainBtn.addEventListener('mouseleave', () => {
      playAgainBtn.style.transform = 'scale(1)';
      playAgainBtn.style.boxShadow = '0 4px 20px rgba(255,170,0,0.3)';
    });

    playAgainBtn.addEventListener('click', () => {
      this.hide();
      this.callbacks.onPlayAgain();
    });

    // Hint
    const hintEl = document.createElement('div');
    hintEl.textContent = 'Todos los progresos se reiniciarán al volver al lobby.';
    Object.assign(hintEl.style, {
      fontSize: '11px',
      color: '#555',
      marginTop: '12px',
    });

    // ================================================================
    // ENSAMBLAR PANEL
    // ================================================================

    panel.appendChild(titleEl);
    panel.appendChild(subtitleEl);
    panel.appendChild(separator1);
    panel.appendChild(roundsContainer);
    panel.appendChild(separator2);
    panel.appendChild(statsContainer);
    panel.appendChild(playAgainBtn);
    panel.appendChild(hintEl);

    container.appendChild(panel);
    document.body.appendChild(container);

    // Animar entrada
    requestAnimationFrame(() => {
      container.style.opacity = '1';
    });
  }

  /**
   * Crea la tarjeta de estadísticas para un jugador.
   */
  private createPlayerStatCard(playerStat: PlayerStats, index: number): HTMLElement {
    const card = document.createElement('div');
    Object.assign(card.style, {
      flex: '1',
      minWidth: '220px',
      maxWidth: '280px',
      background: 'rgba(255,255,255,0.03)',
      borderRadius: '12px',
      padding: '20px 16px',
      border: `1px solid ${index === 0 ? 'rgba(255,170,0,0.15)' : 'rgba(68,170,255,0.15)'}`,
    });

    // Encabezado del jugador
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      marginBottom: '16px',
      paddingBottom: '12px',
      borderBottom: `1px solid ${index === 0 ? 'rgba(255,170,0,0.1)' : 'rgba(68,170,255,0.1)'}`,
    });

    const iconEl = document.createElement('span');
    iconEl.textContent = playerStat.icon;
    iconEl.style.fontSize = '24px';

    const nameEl = document.createElement('span');
    nameEl.textContent = playerStat.label;
    Object.assign(nameEl.style, {
      fontSize: '14px',
      fontWeight: 'bold',
      color: index === 0 ? '#ffaa00' : '#44aaff',
    });

    header.appendChild(iconEl);
    header.appendChild(nameEl);

    // Estadísticas
    const statRows = [
      { label: 'Kills totales', value: String(playerStat.kills), color: '#ff6644' },
      {
        label: 'Daño infligido',
        value: String(Math.round(playerStat.damageDealt)),
        color: '#ff4444',
      },
      {
        label: 'Daño recibido',
        value: String(Math.round(playerStat.damageReceived)),
        color: '#44aaff',
      },
      { label: 'Ítems comprados', value: String(playerStat.itemsBought), color: '#ffaa00' },
    ];

    const statsList = document.createElement('div');
    Object.assign(statsList.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
    });

    statRows.forEach(row => {
      const rowEl = document.createElement('div');
      Object.assign(rowEl.style, {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '13px',
      });

      const labelEl = document.createElement('span');
      labelEl.textContent = row.label;
      Object.assign(labelEl.style, {
        color: '#888',
      });

      const valueEl = document.createElement('span');
      valueEl.textContent = row.value;
      Object.assign(valueEl.style, {
        color: row.color,
        fontWeight: 'bold',
        fontSize: '16px',
      });

      rowEl.appendChild(labelEl);
      rowEl.appendChild(valueEl);
      statsList.appendChild(rowEl);
    });

    card.appendChild(header);
    card.appendChild(statsList);

    return card;
  }

  /**
   * Oculta y elimina la pantalla de Game Over del DOM.
   */
  hide(): void {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
      this.container = null;
    }
  }

  /**
   * Limpia los recursos y desuscribe eventos.
   */
  dispose(): void {
    this.hide();
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}
