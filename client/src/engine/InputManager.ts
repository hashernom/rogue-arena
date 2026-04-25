import * as THREE from 'three';

/**
 * Estado de input para un jugador en un frame.
 */
export type InputState = {
  moveDir: THREE.Vector2; // dirección de movimiento normalizada (magnitude ≤ 1)
  attacking: boolean;
  abilityQ: boolean;
  abilityE: boolean;
  mouseNDC: THREE.Vector2; // posición del mouse en coordenadas normalizadas de dispositivo
};

/**
 * Sistema de input desacoplado que normaliza teclado y gamepad.
 * Captura el estado una vez por frame y lo expone a través de getState.
 */
export class InputManager {
  private static readonly KEY_MAP = {
    // Player 1 (WASD + Space/Q/E)
    p1_up: 'KeyW',
    p1_down: 'KeyS',
    p1_left: 'KeyA',
    p1_right: 'KeyD',
    p1_attack: 'Mouse0',
    p1_abilityQ: 'KeyQ',
    p1_abilityE: 'KeyE',

    // Player 2 (Arrow keys + RShift/P/[)
    p2_up: 'ArrowUp',
    p2_down: 'ArrowDown',
    p2_left: 'ArrowLeft',
    p2_right: 'ArrowRight',
    p2_attack: 'KeyJ',
    p2_abilityQ: 'KeyP',
    p2_abilityE: 'BracketLeft',

    // Ready-up keys (entre rondas)
    p1_ready: 'KeyR',
    p2_ready: 'Slash',

    // Debug keys (solo en modo desarrollo)
    debug_toggle_melee: 'KeyM',
  } as const;

  /** Tipo de todas las teclas de juego posibles */
  private static readonly GAME_KEYS = Object.values(InputManager.KEY_MAP) as readonly string[];

  private keys: Set<string>;
  private previousKeys: Set<string>;
  private gamepads: Gamepad[] = [];
  private states: {
    1: InputState;
    2: InputState;
  };
  /** Posición del mouse en coordenadas normalizadas de dispositivo (NDC) */
  public mouseNDC: THREE.Vector2 = new THREE.Vector2();

  constructor() {
    this.keys = new Set();
    this.previousKeys = new Set();
    this.states = {
      1: this.createEmptyState(),
      2: this.createEmptyState(),
    };

    this.setupEventListeners();
    this.setupGamepadPolling();
  }

  /**
   * Crea un estado de input vacío.
   */
  private createEmptyState(): InputState {
    return {
      moveDir: new THREE.Vector2(0, 0),
      attacking: false,
      abilityQ: false,
      abilityE: false,
      mouseNDC: new THREE.Vector2(0, 0),
    };
  }

  /**
   * Configura listeners de teclado y eventos de foco.
   */
  private setupEventListeners(): void {
    window.addEventListener('keydown', e => {
      if (this.isGameKey(e.code)) {
        e.preventDefault();
      }
      this.keys.add(e.code);
    });

    window.addEventListener('keyup', e => {
      if (this.isGameKey(e.code)) {
        e.preventDefault();
      }
      this.keys.delete(e.code);
    });

    // Captura estricta para el clic izquierdo
    window.addEventListener('mousedown', e => {
      if (e.button === 0) this.keys.add('Mouse0');
    });

    window.addEventListener('mouseup', e => {
      if (e.button === 0) this.keys.delete('Mouse0');
    });

    // Rastrear posición del mouse en NDC (Normalized Device Coordinates)
    window.addEventListener('mousemove', (event) => {
      // Buscar el canvas activo del juego
      const canvas = document.querySelector('canvas');
      
      if (canvas) {
        // Obtenemos las dimensiones y posición real del canvas en la pantalla
        const rect = canvas.getBoundingClientRect();
        
        // Calculamos la posición del ratón relativa AL CANVAS, no a la ventana
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        // Normalizamos a NDC (-1 a +1)
        this.mouseNDC.x = (x / rect.width) * 2 - 1;
        this.mouseNDC.y = -(y / rect.height) * 2 + 1;
      } else {
        // Fallback si por alguna razón el canvas no está en el DOM
        this.mouseNDC.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouseNDC.y = -(event.clientY / window.innerHeight) * 2 + 1;
      }
    });

    // Resetear todos los inputs al perder foco
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.states[1] = this.createEmptyState();
      this.states[2] = this.createEmptyState();
    });
  }

  /**
   * Determina si una tecla es usada por el juego y debe prevenir el comportamiento por defecto.
   */
  private isGameKey(code: string): boolean {
    return InputManager.GAME_KEYS.includes(code);
  }

  /**
   * Inicia el polling de gamepads (opcional).
   */
  private setupGamepadPolling(): void {
    window.addEventListener('gamepadconnected', e => {
      console.log(`Gamepad connected: ${e.gamepad.id}`);
      this.gamepads[e.gamepad.index] = e.gamepad;
    });

    window.addEventListener('gamepaddisconnected', e => {
      console.log(`Gamepad disconnected: ${e.gamepad.id}`);
      delete this.gamepads[e.gamepad.index];
    });
  }

  /**
   * Actualiza el estado de input para ambos jugadores.
   * Debe llamarse UNA VEZ por tick del game loop.
   * Guarda el snapshot de teclas del frame anterior para detección de flanco.
   */
  public update(): void {
    // Guardar snapshot del frame anterior para isKeyJustPressed
    this.previousKeys = new Set(this.keys);
    this.updateFromKeyboard();
    this.updateFromGamepads();
  }

  /**
   * Actualiza el estado a partir del teclado.
   */
  private updateFromKeyboard(): void {
    const { p1_up, p1_down, p1_left, p1_right, p1_attack, p1_abilityQ, p1_abilityE } =
      InputManager.KEY_MAP;
    const { p2_up, p2_down, p2_left, p2_right, p2_attack, p2_abilityQ, p2_abilityE } =
      InputManager.KEY_MAP;

    // Player 1
    const p1MoveX = (this.keys.has(p1_right) ? 1 : 0) - (this.keys.has(p1_left) ? 1 : 0);
    const p1MoveY = (this.keys.has(p1_up) ? 1 : 0) - (this.keys.has(p1_down) ? 1 : 0);
    const p1MoveDir = new THREE.Vector2(p1MoveX, p1MoveY).normalize();

    this.states[1].moveDir.copy(p1MoveDir);
    this.states[1].attacking = this.keys.has(p1_attack);
    this.states[1].abilityQ = this.keys.has(p1_abilityQ);
    this.states[1].abilityE = this.keys.has(p1_abilityE);

    // Player 2
    const p2MoveX = (this.keys.has(p2_right) ? 1 : 0) - (this.keys.has(p2_left) ? 1 : 0);
    const p2MoveY = (this.keys.has(p2_up) ? 1 : 0) - (this.keys.has(p2_down) ? 1 : 0);
    const p2MoveDir = new THREE.Vector2(p2MoveX, p2MoveY).normalize();

    this.states[2].moveDir.copy(p2MoveDir);
    this.states[2].attacking = this.keys.has(p2_attack);
    this.states[2].abilityQ = this.keys.has(p2_abilityQ);
    this.states[2].abilityE = this.keys.has(p2_abilityE);
  }

  /**
   * Actualiza el estado a partir de gamepads (opcional).
   * Asigna gamepad[0] a P1, gamepad[1] a P2.
   */
  private updateFromGamepads(): void {
    const gamepads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
    this.gamepads = gamepads.filter((g): g is Gamepad => g !== null);

    if (this.gamepads.length > 0) {
      this.updateGamepadState(1, this.gamepads[0]);
    }
    if (this.gamepads.length > 1) {
      this.updateGamepadState(2, this.gamepads[1]);
    }
  }

  /**
   * Actualiza el estado de un jugador desde un gamepad.
   */
  private updateGamepadState(playerId: 1 | 2, gamepad: Gamepad): void {
    if (!gamepad) return;

    // Ejes izquierdos (0: horizontal, 1: vertical)
    const axisX = gamepad.axes[0];
    const axisY = gamepad.axes[1];
    const moveDir = new THREE.Vector2(axisX, -axisY); // Invertir Y porque up es negativo

    // Normalizar si la magnitud > 1 (joystick circular)
    if (moveDir.length() > 1) moveDir.normalize();

    // Botones: asumimos botón 0 (A) para attack, 1 (B) para abilityQ, 2 (X) para abilityE
    const attacking = gamepad.buttons[0]?.pressed || false;
    const abilityQ = gamepad.buttons[1]?.pressed || false;
    const abilityE = gamepad.buttons[2]?.pressed || false;

    // Mezclar con teclado (si hay gamepad, sobrescribe)
    this.states[playerId].moveDir.copy(moveDir);
    this.states[playerId].attacking = attacking || this.states[playerId].attacking;
    this.states[playerId].abilityQ = abilityQ || this.states[playerId].abilityQ;
    this.states[playerId].abilityE = abilityE || this.states[playerId].abilityE;
  }

  /**
   * Obtiene el estado de input para un jugador en el frame actual.
   */
  public getState(playerId: 1 | 2): InputState {
    const state = this.states[playerId];
    // Incluir mouseNDC actualizado (compartido entre ambos jugadores)
    state.mouseNDC = this.mouseNDC.clone();
    return state;
  }

  /**
   * Resetea todos los estados a cero (útil para pausa o reinicio).
   */
  public reset(): void {
    this.states[1] = this.createEmptyState();
    this.states[2] = this.createEmptyState();
  }

  /**
   * Verifica si una tecla específica está presionada.
   * Útil para teclas de debug que no están mapeadas a jugadores.
   * @param keyCode Código de la tecla (ej: 'KeyM')
   * @returns true si la tecla está presionada
   */
  public isKeyPressed(keyCode: string): boolean {
    return this.keys.has(keyCode);
  }

  /**
   * Verifica si una tecla fue presionada en este frame (flanco de subida).
   * Útil para acciones que deben ejecutarse una sola vez por presión.
   * @param keyCode Código de la tecla (ej: 'KeyR')
   * @returns true si la tecla se presionó en este frame
   */
  public isKeyJustPressed(keyCode: string): boolean {
    return this.keys.has(keyCode) && !this.previousKeys.has(keyCode);
  }

  /**
   * Libera recursos y elimina listeners.
   */
  public dispose(): void {
    window.removeEventListener('keydown', () => {});
    window.removeEventListener('keyup', () => {});
    window.removeEventListener('blur', () => {});
    // Nota: Los listeners de gamepad no se pueden remover fácilmente, pero es aceptable.
  }
}
