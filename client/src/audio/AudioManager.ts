/**
 * Sistema centralizado de audio para Rogue Arena.
 *
 * - AudioContext lazy: no se crea hasta el primer gesto del usuario (autoplay policy).
 * - Cache de AudioBuffers en Map<string, AudioBuffer>: los sonidos no se recargan.
 * - Volumen maestro que afecta a todas las reproducciones simultáneamente.
 * - Fallback sintético: si un archivo no se encuentra, se genera un sonido procedural.
 * - Zero-garbage en play(): las únicas allocaciones son los nodos Web Audio API,
 *   que son gestionados por el motor de audio del navegador, no por el GC de JS.
 */

import { SoundId } from './soundIds';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface PlayOptions {
  /** Volumen relativo (0-1). Por defecto 1. */
  volume?: number;
  /** Factor de pitch (playbackRate). 1 = tono original, >1 = más agudo. */
  pitch?: number;
  /** Si el sonido se repite en bucle. */
  loop?: boolean;
}

export interface SoundSource {
  id: SoundId;
  /** Ruta relativa a /public, ej: '/audio/hit.wav' */
  url: string;
}

// ---------------------------------------------------------------------------
// Configuración de sonidos del juego
// ---------------------------------------------------------------------------

const SOUND_SOURCES: SoundSource[] = [
  { id: 'hit_melee' as SoundId, url: '/audio/hit_melee.wav' },
  { id: 'shoot_arrow' as SoundId, url: '/audio/shoot_arrow.wav' },
  { id: 'hit_projectile' as SoundId, url: '/audio/hit_projectile.wav' },
  { id: 'enemy_hit' as SoundId, url: '/audio/enemy_hit.wav' },
  { id: 'enemy_death' as SoundId, url: '/audio/enemy_death.wav' },
  { id: 'boss_death' as SoundId, url: '/audio/boss_death.wav' },
  { id: 'player_hit' as SoundId, url: '/audio/player_hit.wav' },
  { id: 'player_death' as SoundId, url: '/audio/player_death.wav' },
  { id: 'wave_start' as SoundId, url: '/audio/wave_start.wav' },
  { id: 'wave_complete' as SoundId, url: '/audio/wave_complete.wav' },
  { id: 'purchase' as SoundId, url: '/audio/purchase.wav' },
  { id: 'coin_pickup' as SoundId, url: '/audio/coin_pickup.wav' },
  { id: 'ability_use' as SoundId, url: '/audio/ability_use.wav' },
  { id: 'ability_ready' as SoundId, url: '/audio/ability_ready.wav' },
  { id: 'ui_click' as SoundId, url: '/audio/ui_click.wav' },
  { id: 'ui_hover' as SoundId, url: '/audio/ui_hover.wav' },
];

// ---------------------------------------------------------------------------
// AudioManager
// ---------------------------------------------------------------------------

export class AudioManager {
  private static instance: AudioManager | null = null;

  /** AudioContext; se crea bajo demanda en init(). */
  private ctx: AudioContext | null = null;
  /** Nodo de ganancia maestro. */
  private masterGain: GainNode | null = null;
  /** Cache de buffers decodificados. */
  private buffers = new Map<SoundId, AudioBuffer>();
  /** Flag de inicialización. */
  private initialized = false;

  // -----------------------------------------------------------------------
  // Singleton
  // -----------------------------------------------------------------------

  private constructor() {
    // Se inicializa via init()
  }

  static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  // -----------------------------------------------------------------------
  // Inicialización lazy — llamar en el primer click/touch del usuario
  // -----------------------------------------------------------------------

  /**
   * Inicializa el AudioContext. Es seguro llamarlo múltiples veces.
   * Debe invocarse dentro de un handler de interacción del usuario
   * (click, keydown, touchstart) para evitar la autoplay policy del navegador.
   */
  init(): void {
    if (this.initialized) return;

    try {
      this.ctx = new AudioContext();

      // Cadena: masterGain → destination
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.5; // volumen maestro por defecto 50%
      this.masterGain.connect(this.ctx.destination);

      this.initialized = true;
      console.log('[AudioManager] AudioContext inicializado');
    } catch (err) {
      console.warn('[AudioManager] Error al crear AudioContext:', err);
    }
  }

  /** Retorna true si el AudioContext está listo. */
  isReady(): boolean {
    return this.initialized && this.ctx !== null && this.ctx.state !== 'closed';
  }

  /** Fuerza el resume del contexto si está en suspended. */
  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch((err) =>
        console.warn('[AudioManager] resume falló:', err),
      );
    }
  }

  /** Libera el AudioContext. */
  dispose(): void {
    if (this.ctx) {
      this.ctx.close().catch(() => {});
    }
    this.ctx = null;
    this.masterGain = null;
    this.buffers.clear();
    this.initialized = false;
    AudioManager.instance = null;
  }

  // -----------------------------------------------------------------------
  // Carga de sonidos
  // -----------------------------------------------------------------------

  /**
   * Carga y decodifica un único archivo de sonido.
   * Si el buffer ya está en caché, no hace nada.
   */
  async loadSound(id: SoundId, url: string): Promise<void> {
    if (this.buffers.has(id)) return; // ya cacheado
    if (!this.ctx) {
      console.warn(
        `[AudioManager] AudioContext no inicializado, no se puede cargar "${id}"`,
      );
      return;
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${url}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      this.buffers.set(id, audioBuffer);
      console.log(`[AudioManager] Cargado: ${id} (${url})`);
    } catch (err) {
      console.warn(
        `[AudioManager] No se pudo cargar "${id}" desde ${url}, usando fallback sintético:`,
        err,
      );
      // Fallback: generar un buffer sintético para que play() no falle
      const synth = this.generateSynthBuffer(id);
      if (synth) {
        this.buffers.set(id, synth);
      }
    }
  }

  /**
   * Precarga todos los sonidos definidos en SOUND_SOURCES.
   * Ideal para llamar al inicio del juego, antes de la primera ronda.
   */
  async preloadAll(): Promise<void> {
    if (!this.initialized) {
      console.warn('[AudioManager] No inicializado, no se puede precargar');
      return;
    }

    const loaders = SOUND_SOURCES.map((s) => this.loadSound(s.id, s.url));
    await Promise.allSettled(loaders);
    const loaded = this.buffers.size;
    const total = SOUND_SOURCES.length;
    console.log(
      `[AudioManager] Precarga completa: ${loaded}/${total} sonidos disponibles`,
    );
  }

  // -----------------------------------------------------------------------
  // Reproducción
  // -----------------------------------------------------------------------

  /**
   * Reproduce un sonido por su ID.
   * Si el buffer no está cargado, intenta cargarlo bajo demanda (lazy load).
   * Si no hay AudioContext, el play se ignora silenciosamente.
   */
  play(id: SoundId, options?: PlayOptions): void {
    if (!this.isReady()) return;

    const buffer = this.buffers.get(id);
    if (!buffer) {
      // Lazy load asíncrono — intentar cargar ahora, reproducir después
      const src = SOUND_SOURCES.find((s) => s.id === id);
      if (src) {
        this.loadSound(id, src.url).then(() => {
          // Reintentar reproducir una vez cargado
          this.playImmediate(id, options);
        });
      }
      return;
    }

    this.playImmediate(id, options, buffer);
  }

  /**
   * Reproduce sin verificación de caché (llamada interna).
   * Crea AudioBufferSourceNode + GainNode y los conecta a la cadena.
   */
  private playImmediate(
    id: SoundId,
    options?: PlayOptions,
    buffer?: AudioBuffer,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;

    const buf = buffer ?? this.buffers.get(id);
    if (!buf) return;

    const source = ctx.createBufferSource();
    source.buffer = buf;

    // Pitch
    source.playbackRate.value = options?.pitch ?? 1;

    // Volumen individual
    const gainNode = ctx.createGain();
    gainNode.gain.value = options?.volume ?? 1;

    source.loop = options?.loop ?? false;

    // Conexión: source → gainNode → masterGain → destination
    source.connect(gainNode);
    gainNode.connect(this.masterGain);

    source.start(0);

    // Auto-limpieza: desconectar nodos cuando termine
    source.onended = () => {
      source.disconnect();
      gainNode.disconnect();
    };
  }

  // -----------------------------------------------------------------------
  // Volumen maestro
  // -----------------------------------------------------------------------

  /** Ajusta el volumen maestro (0-1). */
  setMasterVolume(volume: number): void {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  /** Retorna el volumen maestro actual (0-1). */
  getMasterVolume(): number {
    return this.masterGain?.gain.value ?? 0.5;
  }

  // -----------------------------------------------------------------------
  // Sonidos sintéticos de fallback
  // -----------------------------------------------------------------------

  /**
   * Genera un AudioBuffer sintético simple para un ID dado.
   * Útil cuando el archivo de audio real no está disponible.
   */
  private generateSynthBuffer(id: SoundId): AudioBuffer | null {
    const ctx = this.ctx;
    if (!ctx) return null;

    const sampleRate = ctx.sampleRate;

    switch (id) {
      case 'hit_melee':
        return this.createNoiseBuffer(ctx, 0.15, 0.3);
      case 'shoot_arrow':
        return this.createToneSweep(ctx, 800, 300, 0.12);
      case 'hit_projectile':
        return this.createNoiseBuffer(ctx, 0.1, 0.2);
      case 'enemy_hit':
        return this.createNoiseBuffer(ctx, 0.12, 0.25);
      case 'enemy_death':
        return this.createToneSweep(ctx, 400, 80, 0.4);
      case 'boss_death':
        return this.createToneSweep(ctx, 300, 40, 0.6);
      case 'player_hit':
        return this.createTone(ctx, 180, 0.15);
      case 'player_death':
        return this.createToneSweep(ctx, 500, 60, 0.5);
      case 'wave_start':
        return this.createToneSweep(ctx, 200, 800, 0.35);
      case 'wave_complete':
        return this.createToneSweep(ctx, 400, 1000, 0.4);
      case 'purchase':
        return this.createToneSweep(ctx, 600, 1200, 0.2);
      case 'coin_pickup':
        return this.createToneSweep(ctx, 1000, 1600, 0.1);
      case 'ability_use':
        return this.createToneSweep(ctx, 300, 700, 0.25);
      case 'ability_ready':
        return this.createTone(ctx, 880, 0.15);
      case 'ui_click':
        return this.createNoiseBuffer(ctx, 0.04, 0.1);
      case 'ui_hover':
        return this.createTone(ctx, 440, 0.06);
      default:
        return null;
    }
  }

  /** Buffer de ruido blanco. */
  private createNoiseBuffer(
    ctx: AudioContext,
    duration: number,
    fadeOut: number,
  ): AudioBuffer {
    const length = Math.floor(sampleRateToLength(ctx, duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const t = i / ctx.sampleRate;
      const env = t < duration - fadeOut ? 1 : (duration - t) / fadeOut;
      data[i] = (Math.random() * 2 - 1) * env;
    }
    return buffer;
  }

  /** Buffer con una onda sinusoidal simple. */
  private createTone(
    ctx: AudioContext,
    freq: number,
    duration: number,
  ): AudioBuffer {
    const length = Math.floor(sampleRateToLength(ctx, duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const t = i / ctx.sampleRate;
      const env = 1 - t / duration; // fade-out lineal
      data[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.3;
    }
    return buffer;
  }

  /** Buffer con barrido sinusoidal (freq inicial → final). */
  private createToneSweep(
    ctx: AudioContext,
    freqStart: number,
    freqEnd: number,
    duration: number,
  ): AudioBuffer {
    const length = Math.floor(sampleRateToLength(ctx, duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const t = i / ctx.sampleRate;
      const progress = t / duration;
      const freq = freqStart + (freqEnd - freqStart) * progress;
      const env = 1 - progress; // fade-out
      data[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.3;
    }
    return buffer;
  }

  // -----------------------------------------------------------------------
  // Estado
  // -----------------------------------------------------------------------

  /** Retorna el número de buffers cacheados. */
  getLoadedCount(): number {
    return this.buffers.size;
  }

  /** Retorna la lista de definiciones de sonido. */
  static getSoundSources(): readonly SoundSource[] {
    return SOUND_SOURCES;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sampleRateToLength(ctx: AudioContext, duration: number): number {
  return ctx.sampleRate * duration;
}
