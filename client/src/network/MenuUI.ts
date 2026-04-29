/**
 * MenuUI: Interfaz de usuario del menú principal.
 * Maneja el DOM del menú de conexión, creación/unión de salas,
 * selección de personaje y lobby.
 */
import { ConnectionManager, ConnectionStatus, CharacterType, RoomData } from './ConnectionManager';

export interface MenuCallbacks {
  onLocalPlay?: () => void;
}

export class MenuUI {
  private overlay: HTMLElement;
  private connectionManager: ConnectionManager;
  private callbacks: MenuCallbacks;
  private currentRoomCode: string | null = null;
  private myPlayerId: string | null = null;
  private myCharacter: CharacterType | null = null;

  // Elementos del DOM
  private statusDot!: HTMLElement;
  private statusText!: HTMLElement;
  private tabs!: NodeListOf<HTMLElement>;
  private panels!: NodeListOf<HTMLElement>;
  private createBtn!: HTMLButtonElement;
  private joinBtn!: HTMLButtonElement;
  private localBtn!: HTMLButtonElement;
  private codeInput!: HTMLInputElement;
  private nameInputs!: NodeListOf<HTMLInputElement>;
  private errorEl!: HTMLElement;
  private lobbySection!: HTMLElement;
  private mainMenuSection!: HTMLElement;
  private roomCodeDisplay!: HTMLElement;
  private playerListEl!: HTMLElement;
  private waitingText!: HTMLElement;
  private characterSelectEl!: HTMLElement;
  private startBtn!: HTMLButtonElement;
  private readyCheckEl!: HTMLElement;

  constructor(connectionManager: ConnectionManager, callbacks: MenuCallbacks = {}) {
    this.connectionManager = connectionManager;
    this.callbacks = callbacks;
    this.overlay = this.createOverlay();
    document.body.appendChild(this.overlay);
    this.cacheElements();
    this.setupEventListeners();
  }

  // ============================================================
  // Creación del DOM del menú
  // ============================================================

  private createOverlay(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.id = 'menu-overlay';
    overlay.innerHTML = `
      <div class="menu-container">
        <h1 class="menu-title">Rogue Arena</h1>
        <p class="menu-subtitle">⚔️ Cooperativo 2 jugadores</p>

        <div class="connection-status">
          <span class="connection-dot disconnected" id="conn-dot"></span>
          <span id="conn-text">Desconectado</span>
        </div>

        <!-- MODO LOCAL -->
        <button class="menu-btn local-btn" id="btn-local">🎮 Jugar Local</button>

        <div class="menu-divider"><span>o</span></div>

        <!-- MENÚ PRINCIPAL -->
        <div id="main-menu">
          <div class="menu-tabs">
            <button class="menu-tab active" data-tab="create">Crear Sala</button>
            <button class="menu-tab" data-tab="join">Unirse</button>
          </div>

          <div class="menu-panel active" id="panel-create">
            <input type="text" class="menu-input" id="input-name-create"
                   placeholder="Tu nombre" maxlength="16" value="Jugador 1">
            <button class="menu-btn primary" id="btn-create">🎮 Crear Sala</button>
          </div>

          <div class="menu-panel" id="panel-join">
            <input type="text" class="menu-input" id="input-name-join"
                   placeholder="Tu nombre" maxlength="16" value="Jugador 2">
            <input type="text" class="menu-input code-input" id="input-code"
                   placeholder="CÓDIGO" maxlength="6"
                   style="margin-top: 8px;">
            <button class="menu-btn primary" id="btn-join">🚪 Unirse a Sala</button>
          </div>

          <div class="menu-error" id="menu-error"></div>
        </div>

        <!-- LOBBY (después de crear/unirse) -->
        <div id="lobby-section" style="display: none;">
          <div class="room-code-display">
            <div class="code-label">Código de sala</div>
            <div class="code-value" id="room-code-display">------</div>
          </div>

          <div class="lobby-info">
            <strong>Jugadores:</strong>
            <ul class="player-list" id="player-list"></ul>
            <div class="waiting-text" id="waiting-text">Esperando jugadores...</div>
          </div>

          <div class="character-select" id="character-select">
            <div class="character-card" data-character="melee">
              <div class="char-icon">⚔️</div>
              <div class="char-name">Melee</div>
              <div class="char-desc">Guerrero cuerpo a cuerpo</div>
            </div>
            <div class="character-card" data-character="adc">
              <div class="char-icon">🏹</div>
              <div class="char-name">ADC</div>
              <div class="char-desc">Arquero a distancia</div>
            </div>
          </div>

          <button class="menu-btn secondary" id="btn-start" disabled>
            ⏳ Esperando selección...
          </button>

          <div class="ready-check" id="ready-check" style="display: none;">
            <div class="ready-text">✅ ¡Ambos listos! Iniciando...</div>
          </div>

          <button class="menu-btn secondary" id="btn-leave" style="margin-top: 8px;">
            🚪 Abandonar Sala
          </button>
        </div>
      </div>
    `;
    return overlay;
  }

  private cacheElements(): void {
    this.statusDot = document.getElementById('conn-dot')!;
    this.statusText = document.getElementById('conn-text')!;
    this.tabs = this.overlay.querySelectorAll('.menu-tab') as NodeListOf<HTMLElement>;
    this.panels = this.overlay.querySelectorAll('.menu-panel') as NodeListOf<HTMLElement>;
    this.createBtn = document.getElementById('btn-create') as HTMLButtonElement;
    this.joinBtn = document.getElementById('btn-join') as HTMLButtonElement;
    this.localBtn = document.getElementById('btn-local') as HTMLButtonElement;
    this.codeInput = document.getElementById('input-code') as HTMLInputElement;
    this.nameInputs = this.overlay.querySelectorAll('.menu-input[placeholder*="nombre"]') as NodeListOf<HTMLInputElement>;
    this.errorEl = document.getElementById('menu-error')!;
    this.lobbySection = document.getElementById('lobby-section')!;
    this.mainMenuSection = document.getElementById('main-menu')!;
    this.roomCodeDisplay = document.getElementById('room-code-display')!;
    this.playerListEl = document.getElementById('player-list')!;
    this.waitingText = document.getElementById('waiting-text')!;
    this.characterSelectEl = document.getElementById('character-select')!;
    this.startBtn = document.getElementById('btn-start') as HTMLButtonElement;
    this.readyCheckEl = document.getElementById('ready-check')!;
  }

  // ============================================================
  // Event listeners
  // ============================================================

  private setupEventListeners(): void {
    // Pestañas
    this.tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.panels.forEach(p => p.classList.remove('active'));
        const panelId = `panel-${tab.dataset.tab}`;
        document.getElementById(panelId)?.classList.add('active');
        this.hideError();
      });
    });

    // Jugar Local
    this.localBtn.addEventListener('click', () => {
      this.hideMenu();
      this.callbacks.onLocalPlay?.();
    });

    // Crear sala
    this.createBtn.addEventListener('click', () => this.handleCreateRoom());
    this.createBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleCreateRoom();
    });

    // Unirse a sala
    this.joinBtn.addEventListener('click', () => this.handleJoinRoom());
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleJoinRoom();
    });
    // Auto-mayúsculas para el código
    this.codeInput.addEventListener('input', () => {
      this.codeInput.value = this.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });

    // Selección de personaje
    const charCards = this.characterSelectEl.querySelectorAll('.character-card');
    charCards.forEach(card => {
      const el = card as HTMLElement;
      el.addEventListener('click', () => {
        const character = el.dataset.character as CharacterType;
        this.handleSelectCharacter(character, charCards);
      });
    });

    // Iniciar partida
    this.startBtn.addEventListener('click', () => this.handleStartGame());

    // Abandonar sala
    document.getElementById('btn-leave')?.addEventListener('click', () => {
      this.connectionManager.leaveRoom();
      this.backToMainMenu();
    });
  }

  // ============================================================
  // Handlers
  // ============================================================

  private async handleCreateRoom(): Promise<void> {
    const name = this.getNameInput('create') || 'Jugador';
    this.createBtn.disabled = true;
    this.createBtn.textContent = '⏳ Creando...';
    this.hideError();

    const result = await this.connectionManager.createRoom(name);
    if (result.success && result.code) {
      this.currentRoomCode = result.code;
      this.myPlayerId = this.connectionManager.getSocketId();
      this.showLobby(result.code);
    } else {
      this.showError(result.error || 'Error al crear sala');
    }
    this.createBtn.disabled = false;
    this.createBtn.textContent = '🎮 Crear Sala';
  }

  private async handleJoinRoom(): Promise<void> {
    const code = this.codeInput.value.trim();
    if (!code || code.length !== 6) {
      this.showError('Ingresa un código de 6 caracteres');
      return;
    }
    const name = this.getNameInput('join') || 'Jugador';
    this.joinBtn.disabled = true;
    this.joinBtn.textContent = '⏳ Uniéndose...';
    this.hideError();

    const result = await this.connectionManager.joinRoom(code, name);
    if (result.success) {
      this.currentRoomCode = code;
      this.myPlayerId = this.connectionManager.getSocketId();
      this.showLobby(code);
    } else {
      this.showError(result.error || 'Error al unirse');
    }
    this.joinBtn.disabled = false;
    this.joinBtn.textContent = '🚪 Unirse a Sala';
  }

  private async handleSelectCharacter(character: CharacterType, cards: NodeListOf<Element>): Promise<void> {
    if (this.myCharacter === character) return;

    const result = await this.connectionManager.selectCharacter(character);
    if (result.success) {
      this.myCharacter = character;
      cards.forEach(c => c.classList.remove('selected'));
      cards.forEach(c => {
        const el = c as HTMLElement;
        if (el.dataset.character === character) {
          el.classList.add('selected');
        }
      });
    }
  }

  private async handleStartGame(): Promise<void> {
    this.startBtn.disabled = true;
    this.startBtn.textContent = '⏳ Iniciando...';
    const result = await this.connectionManager.startGame();
    if (!result.success) {
      this.showError(result.error || 'Error al iniciar');
      this.startBtn.disabled = false;
      this.startBtn.textContent = '▶️ Iniciar Partida';
    }
  }

  // ============================================================
  // UI updates
  // ============================================================

  updateConnectionStatus(status: ConnectionStatus): void {
    this.statusDot.className = 'connection-dot';
    if (status === 'connected') {
      this.statusDot.classList.add('connected');
      this.statusText.textContent = 'Conectado';
      this.createBtn.disabled = false;
      this.joinBtn.disabled = false;
    } else if (status === 'connecting') {
      this.statusDot.classList.add('connecting');
      this.statusText.textContent = 'Conectando...';
      this.createBtn.disabled = true;
      this.joinBtn.disabled = true;
    } else {
      this.statusDot.classList.add('disconnected');
      this.statusText.textContent = 'Desconectado';
      this.createBtn.disabled = true;
      this.joinBtn.disabled = true;
    }
  }

  updatePlayers(players: RoomData['players']): void {
    this.playerListEl.innerHTML = '';
    players.forEach(p => {
      const li = document.createElement('li');
      const isMe = p.id === this.myPlayerId;
      li.innerHTML = `
        <span class="player-name">${p.name} ${isMe ? '(tú)' : ''}</span>
        <span class="player-character">${p.character ? this.getCharLabel(p.character) : '🔲 Sin selección'}</span>
      `;
      this.playerListEl.appendChild(li);
    });

    // Actualizar waiting text
    if (players.length < 2) {
      this.waitingText.style.display = 'block';
      this.waitingText.textContent = 'Esperando al segundo jugador...';
      this.startBtn.disabled = true;
      this.startBtn.textContent = '⏳ Esperando jugador...';
    } else {
      this.waitingText.style.display = 'none';
      // Verificar si ambos tienen personaje
      const allSelected = players.every(p => p.character !== null);
      if (allSelected && this.myCharacter) {
        this.startBtn.disabled = false;
        this.startBtn.textContent = '▶️ Iniciar Partida';
      } else {
        this.startBtn.disabled = true;
        this.startBtn.textContent = '⏳ Seleccionen personaje...';
      }
    }
  }

  showReadyCheck(): void {
    this.readyCheckEl.style.display = 'block';
    this.startBtn.disabled = true;
    this.startBtn.textContent = '✅ Listo';
  }

  private showLobby(code: string): void {
    this.mainMenuSection.style.display = 'none';
    this.lobbySection.style.display = 'block';
    this.roomCodeDisplay.textContent = code;
    this.myCharacter = null;
    this.readyCheckEl.style.display = 'none';

    // Reset character selection
    const cards = this.characterSelectEl.querySelectorAll('.character-card');
    cards.forEach(c => c.classList.remove('selected'));
  }

  backToMainMenu(): void {
    this.mainMenuSection.style.display = 'block';
    this.lobbySection.style.display = 'none';
    this.currentRoomCode = null;
    this.myPlayerId = null;
    this.myCharacter = null;
    this.hideError();
  }

  hideMenu(): void {
    this.overlay.classList.add('hidden');
  }

  showMenu(): void {
    this.overlay.classList.remove('hidden');
    this.mainMenuSection.style.display = 'block';
    this.lobbySection.style.display = 'none';
  }

  // ============================================================
  // Helpers
  // ============================================================

  private getNameInput(panel: 'create' | 'join'): string {
    const input = document.getElementById(`input-name-${panel}`) as HTMLInputElement;
    return input?.value.trim() || '';
  }

  private showError(msg: string): void {
    this.errorEl.textContent = msg;
    this.errorEl.classList.add('visible');
  }

  private hideError(): void {
    this.errorEl.textContent = '';
    this.errorEl.classList.remove('visible');
  }

  private getCharLabel(character: string): string {
    switch (character) {
      case 'melee': return '⚔️ Melee';
      case 'adc': return '🏹 ADC';
      default: return character;
    }
  }
}
