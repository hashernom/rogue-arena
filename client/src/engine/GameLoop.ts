/**
 * Game Loop con Fixed Timestep
 *
 * Implementa el patrón Fixed Timestep para garantizar simulación de física determinista
 * independiente del frame rate del monitor.
 *
 * @example
 * ```typescript
 * const gameLoop = new GameLoop();
 * gameLoop.setFixedUpdate((dt) => {
 *   // Actualizar física a 60Hz
 *   updatePhysics(dt);
 * });
 * gameLoop.setRender((alpha) => {
 *   // Renderizar con interpolación
 *   renderScene(alpha);
 * });
 * gameLoop.start();
 * ```
 */
export class GameLoop {
  /** Timestep fijo para física (60 Hz) */
  private readonly FIXED_DT = 1 / 60;

  /** Acumulador de tiempo para fixed updates */
  private accumulator = 0;

  /** Último timestamp de ejecución */
  private lastTime = 0;

  /** ID del requestAnimationFrame */
  private animationFrameId: number | null = null;

  /** Función de fixed update (física) */
  private fixedUpdateFn: ((dt: number) => void) | null = null;

  /** Función de render */
  private renderFn: ((alpha: number) => void) | null = null;

  /** Tiempo total transcurrido desde el inicio */
  private _totalTime = 0;

  /** Delta time del último frame */
  private _deltaTime = 0;

  /** Contador de FPS para debug */
  private fpsCounter = {
    frames: 0,
    lastFpsUpdate: 0,
    fps: 0,
  };

  /** Estado de ejecución */
  private isRunning = false;

  /**
   * Inicia el game loop
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.lastTime = performance.now();
    this.fpsCounter.lastFpsUpdate = 0; // Inicializar en 0 segundos
    this.tick(this.lastTime);
  }

  /**
   * Detiene el game loop
   */
  stop(): void {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Establece la función de fixed update (física)
   * @param fn Función que recibe delta time fijo (1/60 segundos)
   */
  setFixedUpdate(fn: (dt: number) => void): void {
    this.fixedUpdateFn = fn;
  }

  /**
   * Establece la función de render
   * @param fn Función que recibe alpha de interpolación (0-1)
   */
  setRender(fn: (alpha: number) => void): void {
    this.renderFn = fn;
  }

  /**
   * Obtiene el tiempo total transcurrido en segundos
   */
  get totalTime(): number {
    return this._totalTime;
  }

  /**
   * Obtiene el delta time del último frame en segundos
   */
  get deltaTime(): number {
    return this._deltaTime;
  }

  /**
   * Obtiene los FPS actuales (solo en modo desarrollo)
   */
  get fps(): number {
    return this.fpsCounter.fps;
  }

  /**
   * Loop principal con fixed timestep
   */
  private tick(now: number): void {
    if (!this.isRunning) {
      return;
    }

    // Calcular tiempo transcurrido desde el último frame
    const elapsed = (now - this.lastTime) / 1000; // Convertir a segundos
    this.lastTime = now;
    this._deltaTime = elapsed;
    this._totalTime += elapsed;

    // Actualizar contador de FPS (solo en desarrollo)
    if (import.meta.env.DEV) {
      this.updateFpsCounter(elapsed);
    }

    // Cap de 100ms para evitar "spiral of death" en frames muy lentos
    this.accumulator += Math.min(elapsed, 0.1);

    // Ejecutar fixed updates mientras haya tiempo acumulado
    while (this.accumulator >= this.FIXED_DT) {
      if (this.fixedUpdateFn) {
        this.fixedUpdateFn(this.FIXED_DT);
      }
      this.accumulator -= this.FIXED_DT;
    }

    // Renderizar con interpolación
    if (this.renderFn) {
      const alpha = this.accumulator / this.FIXED_DT;
      this.renderFn(alpha);
    }

    // Solicitar siguiente frame
    this.animationFrameId = requestAnimationFrame(time => this.tick(time));
  }

  /**
   * Actualiza el contador de FPS (solo en modo desarrollo)
   */
  private updateFpsCounter(elapsed: number): void {
    this.fpsCounter.frames++;

    // Actualizar FPS cada segundo
    if (this._totalTime - this.fpsCounter.lastFpsUpdate >= 1) {
      this.fpsCounter.fps = Math.round(
        this.fpsCounter.frames / (this._totalTime - this.fpsCounter.lastFpsUpdate)
      );
      this.fpsCounter.frames = 0;
      this.fpsCounter.lastFpsUpdate = this._totalTime;

      // Log FPS en consola (solo en desarrollo)
      console.log(`🎮 FPS: ${this.fpsCounter.fps}`);
    }
  }

  /**
   * Limpia recursos
   */
  dispose(): void {
    this.stop();
    this.fixedUpdateFn = null;
    this.renderFn = null;
  }
}
