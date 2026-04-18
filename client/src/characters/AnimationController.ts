import * as THREE from 'three';

/**
 * Clips de animación disponibles.
 */
export type AnimClip = 'idle' | 'walk' | 'attack' | 'death';

/**
 * Controlador de animaciones GLTF que transiciona suavemente entre clips.
 * Usa THREE.AnimationMixer para reproducir clips GLTF con crossfade.
 */
export class AnimationController {
  private mixer: THREE.AnimationMixer;
  private clips: Map<AnimClip, THREE.AnimationClip>;
  private actions: Map<AnimClip, THREE.AnimationAction>;
  private currentClip: AnimClip | null = null;
  private currentAction: THREE.AnimationAction | null = null;
  private model: THREE.Group;

  /**
   * Crea un AnimationController para un modelo GLTF.
   * @param model - Grupo 3D que contiene las animaciones.
   * @param animationClips - Array de clips de animación extraídos del GLTF.
   */
  constructor(model: THREE.Group, animationClips: THREE.AnimationClip[]) {
    this.model = model;
    this.mixer = new THREE.AnimationMixer(model);
    this.clips = new Map();
    this.actions = new Map();

    // Mapear clips por nombre (asumiendo nombres estándar)
    this.mapClips(animationClips);

    // Crear acciones para cada clip
    this.createActions();
  }

  /**
   * Mapea los clips de animación por nombre.
   * Asume que los clips tienen nombres como 'Idle', 'Walk', 'Attack', 'Death'.
   */
  private mapClips(animationClips: THREE.AnimationClip[]): void {
    const nameMapping: Record<string, AnimClip> = {
      idle: 'idle',
      walk: 'walk',
      run: 'walk',
      attack: 'attack',
      death: 'death',
      // Variantes comunes
      idle_combat: 'idle',
      walk_forward: 'walk',
      attack_melee: 'attack',
      die: 'death',
    };

    for (const clip of animationClips) {
      const lowerName = clip.name.toLowerCase();
      let matchedClip: AnimClip | undefined;

      // Buscar coincidencia exacta o parcial
      for (const [key, value] of Object.entries(nameMapping)) {
        if (lowerName.includes(key)) {
          matchedClip = value;
          break;
        }
      }

      if (matchedClip && !this.clips.has(matchedClip)) {
        this.clips.set(matchedClip, clip);
      }
    }

    // Si no se encontraron clips, crear animaciones procedurales básicas
    if (this.clips.size === 0) {
      console.warn('No se encontraron clips de animación GLTF, creando animaciones procedurales');
      this.createProceduralClips();
    }
  }

  /**
   * Crea animaciones procedurales básicas como fallback.
   */
  private createProceduralClips(): void {
    // Animación idle: ligero movimiento de respiración
    const idleClip = new THREE.AnimationClip('idle', 2, [
      new THREE.VectorKeyframeTrack('.position[y]', [0, 1, 2], [0, 0.05, 0]),
    ]);
    this.clips.set('idle', idleClip);

    // Animación walk: movimiento cíclico en Y
    const walkClip = new THREE.AnimationClip('walk', 0.5, [
      new THREE.VectorKeyframeTrack('.position[y]', [0, 0.25, 0.5], [0, 0.1, 0]),
    ]);
    this.clips.set('walk', walkClip);

    // Animación attack: escala en Y
    const attackClip = new THREE.AnimationClip('attack', 0.3, [
      new THREE.VectorKeyframeTrack('.scale[y]', [0, 0.15, 0.3], [1, 1.2, 1]),
    ]);
    this.clips.set('attack', attackClip);

    // Animación death: rotación y caída
    const deathClip = new THREE.AnimationClip('death', 1, [
      new THREE.VectorKeyframeTrack('.rotation[x]', [0, 1], [0, Math.PI / 2]),
      new THREE.VectorKeyframeTrack('.position[y]', [0, 1], [0, -1]),
    ]);
    this.clips.set('death', deathClip);
  }

  /**
   * Crea acciones para cada clip configurado.
   */
  private createActions(): void {
    for (const [clipName, clip] of this.clips.entries()) {
      const action = this.mixer.clipAction(clip);
      action.clampWhenFinished = true;
      action.loop = clipName === 'death' ? THREE.LoopOnce : THREE.LoopRepeat;

      // Configurar tiempos para animaciones no loop
      if (clipName === 'attack' || clipName === 'death') {
        action.loop = THREE.LoopOnce;
        action.clampWhenFinished = true;
      }

      this.actions.set(clipName, action);
    }
  }

  /**
   * Reproduce un clip con transición suave.
   * @param clip - Nombre del clip a reproducir.
   * @param crossFadeDuration - Duración del crossfade en segundos (default: 0.2).
   * @returns True si el clip se pudo reproducir.
   */
  play(clip: AnimClip, crossFadeDuration: number = 0.2): boolean {
    if (this.currentClip === clip) {
      // Ya está reproduciendo este clip, no reiniciar
      return true;
    }

    const action = this.actions.get(clip);
    if (!action) {
      console.warn(`Clip de animación no encontrado: ${clip}`);
      return false;
    }

    // Si hay una acción actual, hacer crossfade
    if (this.currentAction && crossFadeDuration > 0) {
      this.currentAction.crossFadeTo(action, crossFadeDuration, false);
    } else {
      // Detener todas las acciones y empezar la nueva
      this.mixer.stopAllAction();
      action.play();
    }

    this.currentClip = clip;
    this.currentAction = action;
    return true;
  }

  /**
   * Reproduce un clip una sola vez y ejecuta un callback al finalizar.
   * @param clip - Nombre del clip a reproducir.
   * @param onEnd - Callback opcional que se ejecuta al terminar la animación.
   * @param crossFadeDuration - Duración del crossfade en segundos.
   * @returns True si el clip se pudo reproducir.
   */
  playOnce(clip: AnimClip, onEnd?: () => void, crossFadeDuration: number = 0.2): boolean {
    const action = this.actions.get(clip);
    if (!action) {
      console.warn(`Clip de animación no encontrado: ${clip}`);
      return false;
    }

    // Configurar para reproducir una sola vez
    action.loop = THREE.LoopOnce;
    action.clampWhenFinished = true;
    action.reset();

    // Configurar evento de finalización
    if (onEnd) {
      const mixer = this.mixer;
      const handleComplete = () => {
        mixer.removeEventListener('finished', handleComplete);
        onEnd();
      };
      this.mixer.addEventListener('finished', handleComplete);
    }

    // Hacer crossfade desde la acción actual
    if (this.currentAction && crossFadeDuration > 0) {
      this.currentAction.crossFadeTo(action, crossFadeDuration, false);
    } else {
      this.mixer.stopAllAction();
      action.play();
    }

    this.currentClip = clip;
    this.currentAction = action;
    return true;
  }

  /**
   * Actualiza el mixer con el tiempo delta.
   * Debe llamarse en cada frame de render (no en fixed update).
   * @param deltaTime - Tiempo transcurrido desde el último frame en segundos.
   */
  update(deltaTime: number): void {
    this.mixer.update(deltaTime);
  }

  /**
   * Detiene todas las animaciones.
   */
  stopAll(): void {
    this.mixer.stopAllAction();
    this.currentClip = null;
    this.currentAction = null;
  }

  /**
   * Obtiene el clip actualmente activo.
   */
  getCurrentClip(): AnimClip | null {
    return this.currentClip;
  }

  /**
   * Verifica si una animación está actualmente reproduciéndose.
   */
  isPlaying(clip?: AnimClip): boolean {
    if (clip) {
      return this.currentClip === clip;
    }
    return this.currentClip !== null;
  }

  /**
   * Sincroniza el estado del personaje con la animación correspondiente.
   * @param state - Estado del personaje.
   * @param isAttacking - Indica si está atacando.
   * @param isDead - Indica si está muerto.
   */
  syncWithCharacterState(
    state: string,
    isAttacking: boolean = false,
    isDead: boolean = false
  ): void {
    if (isDead) {
      this.playOnce('death');
      return;
    }

    if (isAttacking) {
      this.playOnce('attack', () => {
        // Al terminar el ataque, volver al estado actual
        this.syncWithCharacterState(state, false, false);
      });
      return;
    }

    switch (state) {
      case 'moving':
        this.play('walk');
        break;
      case 'idle':
      default:
        this.play('idle');
        break;
    }
  }
}