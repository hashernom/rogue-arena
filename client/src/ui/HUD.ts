import { EventBus } from '../engine/EventBus';
import { MeleeCharacter } from '../characters/MeleeCharacter';
import { AdcCharacter } from '../characters/AdcCharacter';
import { WaveManager, WaveState } from '../waves/WaveManager';
import { MoneySystem } from '../progression/MoneySystem';

/**
 * Interfaz de juego superpuesta al canvas 3D.
 *
 * Muestra información crítica del gameplay sin obstruir la interacción:
 * - HP bars, nombre, dinero e ícono de personaje para P1 (izquierda) y P2 (derecha)
 * - Contador de oleada y enemigos restantes (centro superior)
 * - Timer de between-round (centro)
 * - Indicador de habilidad Q con overlay de cooldown rotatorio
 *
 * El HUD usa `pointer-events: none` para no interferir con el input del juego.
 * Se actualiza mediante suscripciones al EventBus y un método update() llamado
 * desde el render loop.
 */
export class HUD {
  private eventBus: EventBus;
  private container: HTMLElement;
  private p1Character: MeleeCharacter | null = null;
  private p2Character: AdcCharacter | null = null;
  private waveManager: WaveManager | null = null;
  private moneySystem: MoneySystem | null = null;

  // Elementos del DOM cacheados
  private p1HpFill!: HTMLElement;
  private p1HpText!: HTMLElement;
  private p1Name!: HTMLElement;
  private p1Money!: HTMLElement;
  private p1Icon!: HTMLElement;
  private p1AbilityIcon!: HTMLElement;
  private p1CooldownOverlay!: HTMLElement;

  private p2HpFill!: HTMLElement;
  private p2HpText!: HTMLElement;
  private p2Name!: HTMLElement;
  private p2Money!: HTMLElement;
  private p2Icon!: HTMLElement;
  private p2AbilityIcon!: HTMLElement;
  private p2CooldownOverlay!: HTMLElement;
  private p2AmmoText!: HTMLElement;
  private p2ReloadText!: HTMLElement;

  private waveCounter!: HTMLElement;
  private enemyCounter!: HTMLElement;
  private timerCounter!: HTMLElement;
  private betweenRoundTimer!: HTMLElement;

  // Unsubscribe functions
  private unsubscribers: (() => void)[] = [];

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.container = this.createContainer();
    this.buildDOM();
    this.subscribeToEvents();
  }

  /**
   * Asigna las referencias a los personajes y sistemas necesarios para el HUD.
   */
  setCharacters(
    p1: MeleeCharacter | null,
    p2: AdcCharacter | null,
    waveManager: WaveManager | null,
    moneySystem: MoneySystem | null
  ): void {
    this.p1Character = p1;
    this.p2Character = p2;
    this.waveManager = waveManager;
    this.moneySystem = moneySystem;

    // Actualizar nombres e íconos según los personajes
    if (p1) {
      this.p1Name.textContent = 'P1 — Caballero';
      this.p1Icon.textContent = '⚔️';
    }
    if (p2) {
      this.p2Name.textContent = 'P2 — Arquero';
      this.p2Icon.textContent = '🏹';
    }
  }

  /**
   * Actualización por frame llamada desde el render loop.
   * Refresca HP, cooldowns, contadores y timer.
   */
  update(): void {
    this.updatePlayerHP('player1', this.p1Character, this.p1HpFill, this.p1HpText);
    this.updatePlayerHP('player2', this.p2Character, this.p2HpFill, this.p2HpText);

    this.updateCooldown(
      this.p1Character?.getChargeAbility() ?? null,
      this.p1CooldownOverlay,
      this.p1AbilityIcon
    );
    this.updateCooldown(
      this.p2Character?.getSalvoAbility() ?? null,
      this.p2CooldownOverlay,
      this.p2AbilityIcon
    );

    this.updateWaveInfo();
    this.updateMoney();
    this.updateBetweenRoundTimer();
    this.updateAmmo();
  }

  /**
   * Limpia todos los listeners y remueve el HUD del DOM.
   */
  dispose(): void {
    this.unsubscribers.forEach(fn => fn());
    this.unsubscribers = [];
    if (this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }

  // ---------------------------------------------------------------
  // PRIVATE: Construcción del DOM
  // ---------------------------------------------------------------

  private createContainer(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'game-hud';
    Object.assign(el.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '1000',
      fontFamily: "'Segoe UI', 'Roboto', monospace",
      overflow: 'hidden',
    });
    document.body.appendChild(el);
    return el;
  }

  private buildDOM(): void {
    this.container.innerHTML = `
      <!-- P1: Izquierda -->
      <div id="hud-p1" style="
        position:absolute; left:16px; top:10px;
        display:flex; flex-direction:column; gap:4px;
        min-width:200px;
      ">
        <!-- Fila superior: icono + nombre + dinero -->
        <div style="display:flex; align-items:center; gap:6px;">
          <span id="hud-p1-icon" style="font-size:22px; width:28px; text-align:center;">⚔️</span>
          <span id="hud-p1-name" style="color:#ffaa00; font-weight:bold; font-size:13px; text-shadow:0 1px 4px rgba(0,0,0,0.8);">P1</span>
          <span style="color:#888; font-size:11px;">·</span>
          <span id="hud-p1-money" style="color:#ffd700; font-size:12px; text-shadow:0 1px 4px rgba(0,0,0,0.8);">0g</span>
        </div>
        <!-- HP Bar -->
        <div style="
          width:100%; height:14px;
          background:rgba(0,0,0,0.6);
          border-radius:7px;
          overflow:hidden;
          border:1px solid rgba(255,255,255,0.1);
          box-shadow:inset 0 1px 3px rgba(0,0,0,0.5);
        ">
          <div id="hud-p1-hp-fill" style="
            width:100%; height:100%;
            background:linear-gradient(90deg, #e53935, #ff6f60);
            border-radius:7px;
            transition:width 0.15s ease;
          "></div>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:10px; color:#aaa; padding:0 2px;">
          <span id="hud-p1-hp-text">100/100</span>
        </div>
        <!-- Habilidad Q -->
        <div style="display:flex; align-items:center; gap:6px; margin-top:2px;">
          <div id="hud-p1-ability" style="
            position:relative; width:32px; height:32px;
            border-radius:6px;
            background:rgba(0,0,0,0.5);
            border:1px solid rgba(255,255,255,0.15);
            display:flex; align-items:center; justify-content:center;
            font-size:16px;
          ">
            <span id="hud-p1-ability-icon">⚡</span>
            <div id="hud-p1-cooldown-overlay" style="
              position:absolute; top:0; left:0; width:100%; height:100%;
              border-radius:6px;
              pointer-events:none;
            "></div>
          </div>
          <span style="color:#888; font-size:10px;">[Q]</span>
        </div>
      </div>

      <!-- P2: Debajo de P1 (ADC) -->
      <div id="hud-p2" style="
        position:absolute; left:16px; top:108px;
        display:flex; flex-direction:column; gap:4px;
        min-width:200px;
      ">
        <!-- Fila superior: icono + nombre + dinero -->
        <div style="display:flex; align-items:center; gap:6px;">
          <span id="hud-p2-icon" style="font-size:22px; width:28px; text-align:center;">🏹</span>
          <span id="hud-p2-name" style="color:#44aaff; font-weight:bold; font-size:13px; text-shadow:0 1px 4px rgba(0,0,0,0.8);">P2</span>
          <span style="color:#888; font-size:11px;">·</span>
          <span id="hud-p2-money" style="color:#ffd700; font-size:12px; text-shadow:0 1px 4px rgba(0,0,0,0.8);">0g</span>
        </div>
        <!-- HP Bar -->
        <div style="
          width:100%; height:14px;
          background:rgba(0,0,0,0.6);
          border-radius:7px;
          overflow:hidden;
          border:1px solid rgba(255,255,255,0.1);
          box-shadow:inset 0 1px 3px rgba(0,0,0,0.5);
        ">
          <div id="hud-p2-hp-fill" style="
            width:100%; height:100%;
            background:linear-gradient(90deg, #e53935, #ff6f60);
            border-radius:7px;
            transition:width 0.15s ease;
          "></div>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:10px; color:#aaa; padding:0 2px;">
          <span id="hud-p2-hp-text">100/100</span>
        </div>
        <!-- Munición (más grande y visible) -->
        <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
          <span id="hud-p2-ammo-text" style="color:#ffcc00; font-size:18px; font-weight:bold; text-shadow:0 0 10px rgba(255,204,0,0.4), 0 1px 4px rgba(0,0,0,0.8);">🏹 10/10</span>
          <span id="hud-p2-reload-text" style="color:#ff4444; font-size:14px; font-weight:bold; text-shadow:0 0 10px rgba(255,68,68,0.4), 0 1px 4px rgba(0,0,0,0.8); display:none;">🔄 recargando...</span>
        </div>
        <!-- Habilidad Q -->
        <div style="display:flex; align-items:center; gap:6px; margin-top:2px;">
          <div id="hud-p2-ability" style="
            position:relative; width:32px; height:32px;
            border-radius:6px;
            background:rgba(0,0,0,0.5);
            border:1px solid rgba(255,255,255,0.15);
            display:flex; align-items:center; justify-content:center;
            font-size:16px;
          ">
            <span id="hud-p2-ability-icon">🔥</span>
            <div id="hud-p2-cooldown-overlay" style="
              position:absolute; top:0; left:0; width:100%; height:100%;
              border-radius:6px;
              pointer-events:none;
            "></div>
          </div>
          <span style="color:#888; font-size:10px;">[J]</span>
        </div>
      </div>

      <!-- Centro superior: contadores de oleada, timer y enemigos -->
      <div id="hud-center-top" style="
        position:absolute; top:10px; left:50%; transform:translateX(-50%);
        display:flex; flex-direction:column; align-items:center; gap:2px;
        pointer-events:none;
      ">
        <div id="hud-wave-counter" style="
          font-size:16px; font-weight:bold; color:#ffaa00;
          text-shadow:0 1px 6px rgba(0,0,0,0.9);
          letter-spacing:1px;
        ">Ronda 0</div>
        <div id="hud-timer-counter" style="
          font-size:11px; color:#ff6666;
          text-shadow:0 1px 4px rgba(0,0,0,0.8);
        "></div>
        <div id="hud-enemy-counter" style="
          font-size:11px; color:#cc6666;
          text-shadow:0 1px 4px rgba(0,0,0,0.8);
        ">0 enemigos</div>
      </div>

      <!-- Centro: timer de between-round (oculto por defecto) -->
      <div id="hud-between-timer" style="
        position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
        font-size:72px; font-weight:bold; color:#ffffff;
        text-shadow:0 0 30px rgba(255,170,0,0.4), 0 2px 8px rgba(0,0,0,0.8);
        opacity:0; transition:opacity 0.3s ease;
        pointer-events:none;
      "></div>
    `;

    // Cachear referencias del DOM
    this.p1HpFill = document.getElementById('hud-p1-hp-fill')!;
    this.p1HpText = document.getElementById('hud-p1-hp-text')!;
    this.p1Name = document.getElementById('hud-p1-name')!;
    this.p1Money = document.getElementById('hud-p1-money')!;
    this.p1Icon = document.getElementById('hud-p1-icon')!;
    this.p1AbilityIcon = document.getElementById('hud-p1-ability-icon')!;
    this.p1CooldownOverlay = document.getElementById('hud-p1-cooldown-overlay')!;

    this.p2HpFill = document.getElementById('hud-p2-hp-fill')!;
    this.p2HpText = document.getElementById('hud-p2-hp-text')!;
    this.p2Name = document.getElementById('hud-p2-name')!;
    this.p2Money = document.getElementById('hud-p2-money')!;
    this.p2Icon = document.getElementById('hud-p2-icon')!;
    this.p2AbilityIcon = document.getElementById('hud-p2-ability-icon')!;
    this.p2CooldownOverlay = document.getElementById('hud-p2-cooldown-overlay')!;
    this.p2AmmoText = document.getElementById('hud-p2-ammo-text')!;
    this.p2ReloadText = document.getElementById('hud-p2-reload-text')!;

    this.waveCounter = document.getElementById('hud-wave-counter')!;
    this.enemyCounter = document.getElementById('hud-enemy-counter')!;
    this.timerCounter = document.getElementById('hud-timer-counter')!;
    this.betweenRoundTimer = document.getElementById('hud-between-timer')!;
  }

  // ---------------------------------------------------------------
  // PRIVATE: Suscripción a eventos
  // ---------------------------------------------------------------

  private subscribeToEvents(): void {
    // player:damaged — actualizar HP bars
    this.unsubscribers.push(
      this.eventBus.on('player:damaged', (data: { playerId: string; amount: number }) => {
        this.refreshPlayerHP(data.playerId);
      })
    );

    // money:changed — actualizar dinero
    this.unsubscribers.push(
      this.eventBus.on('money:changed', (data: { playerId: string; newBalance: number }) => {
        this.updateSingleMoney(data.playerId, data.newBalance);
      })
    );

    // wave:started — actualizar contadores
    this.unsubscribers.push(
      this.eventBus.on('wave:started', (data: { round: number; enemyCount: number }) => {
        this.waveCounter.textContent = `Ronda ${data.round}`;
        this.enemyCounter.textContent = `${data.enemyCount} enemigos`;
        this.betweenRoundTimer.style.opacity = '0';
      })
    );

    // enemy:died — decrementar contador de enemigos
    this.unsubscribers.push(
      this.eventBus.on('enemy:died', () => {
        if (this.waveManager) {
          const remaining = this.waveManager.getRemainingEnemies();
          this.enemyCounter.textContent = `${remaining} enemigos`;
        }
      })
    );
  }

  // ---------------------------------------------------------------
  // PRIVATE: Actualizaciones
  // ---------------------------------------------------------------

  private updatePlayerHP(
    _playerId: string,
    character: MeleeCharacter | AdcCharacter | null,
    fillEl: HTMLElement,
    textEl: HTMLElement
  ): void {
    if (!character) return;
    const hp = character.getEffectiveStat('hp');
    const maxHp = character.getEffectiveStat('maxHp');
    const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
    fillEl.style.width = `${ratio * 100}%`;
    textEl.textContent = `${Math.ceil(hp)}/${Math.ceil(maxHp)}`;
  }

  private refreshPlayerHP(playerId: string): void {
    if (playerId === 'player1') {
      this.updatePlayerHP(playerId, this.p1Character, this.p1HpFill, this.p1HpText);
    } else if (playerId === 'player2') {
      this.updatePlayerHP(playerId, this.p2Character, this.p2HpFill, this.p2HpText);
    }
  }

  private updateCooldown(
    ability: { getCooldownRatio(): number; isReady(): boolean } | null,
    overlayEl: HTMLElement,
    iconEl: HTMLElement
  ): void {
    if (!ability) {
      overlayEl.style.background = 'none';
      overlayEl.style.opacity = '0';
      return;
    }

    const ratio = ability.getCooldownRatio();
    const ready = ability.isReady();

    if (ready || ratio <= 0) {
      // Habilidad lista — sin overlay
      overlayEl.style.background = 'none';
      overlayEl.style.opacity = '0';
      iconEl.style.opacity = '1';
    } else {
      // Cooldown activo — conic-gradient overlay
      const degrees = ratio * 360;
      overlayEl.style.background = `conic-gradient(
        rgba(0,0,0,0.7) ${degrees}deg,
        transparent ${degrees}deg
      )`;
      overlayEl.style.opacity = '1';
      iconEl.style.opacity = '0.5';
    }
  }

  private updateWaveInfo(): void {
    if (!this.waveManager) return;
    const round = this.waveManager.getCurrentRound();
    this.waveCounter.textContent = `Ronda ${round}`;

    if (this.waveManager.getState() === WaveState.WaveInProgress) {
      const remaining = this.waveManager.getRemainingEnemies();
      this.enemyCounter.textContent = `${remaining} enemigos`;

      // Mostrar timer de ronda activa
      const roundTimer = this.waveManager.getRoundTimer();
      if (roundTimer > 0) {
        const minutes = Math.floor(roundTimer / 60);
        const seconds = Math.floor(roundTimer % 60);
        this.timerCounter.textContent = `⏱ ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        this.timerCounter.style.color = roundTimer <= 15 ? '#ff2222' : roundTimer <= 30 ? '#ffaa00' : '#ff6666';
      } else {
        this.timerCounter.textContent = '';
      }
    } else if (this.waveManager.getState() === WaveState.BetweenRound) {
      this.enemyCounter.textContent = '— entre rondas —';
      this.timerCounter.textContent = '';
    } else {
      this.enemyCounter.textContent = '';
      this.timerCounter.textContent = '';
    }
  }

  private updateMoney(): void {
    if (!this.moneySystem) return;
    const p1Balance = this.moneySystem.getBalance('player1');
    const p2Balance = this.moneySystem.getBalance('player2');
    this.p1Money.textContent = `${p1Balance}g`;
    this.p2Money.textContent = `${p2Balance}g`;
  }

  private updateSingleMoney(playerId: string, balance: number): void {
    if (playerId === 'player1') {
      this.p1Money.textContent = `${balance}g`;
    } else if (playerId === 'player2') {
      this.p2Money.textContent = `${balance}g`;
    }
  }

  /**
   * Actualiza el contador de munición del arquero en el HUD.
   * Muestra "🏹 X/10" normalmente, o "🔄 recargando... 1.5s" durante la recarga.
   */
  private updateAmmo(): void {
    if (!this.p2Character) return;
    const current = this.p2Character.getCurrentAmmo();
    const max = this.p2Character.getMaxAmmo();
    const reloading = this.p2Character.isReloadingNow();
    const reloadTimer = this.p2Character.getReloadTimer();

    if (reloading) {
      this.p2AmmoText.style.display = 'none';
      this.p2ReloadText.style.display = 'inline';
      this.p2ReloadText.textContent = `🔄 recargando... ${reloadTimer.toFixed(1)}s`;
    } else {
      this.p2AmmoText.style.display = 'inline';
      this.p2ReloadText.style.display = 'none';
      this.p2AmmoText.textContent = `🏹 ${current}/${max}`;
    }
  }

  private updateBetweenRoundTimer(): void {
    if (!this.waveManager) return;
    const isBetweenRound = this.waveManager.getState() === WaveState.BetweenRound;

    if (isBetweenRound) {
      const timer = Math.ceil(this.waveManager.getBetweenRoundTimer());
      this.betweenRoundTimer.textContent = `${timer}`;
      this.betweenRoundTimer.style.opacity = '1';
    } else {
      this.betweenRoundTimer.style.opacity = '0';
    }
  }
}
