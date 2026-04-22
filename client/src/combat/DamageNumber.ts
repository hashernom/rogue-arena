import * as THREE from 'three';

export interface DamageNumberOptions {
  /** Color del texto en hexadecimal (ej: 0xff5555) */
  color?: number;
  /** Tamaño de fuente (por defecto 32) */
  fontSize?: number;
  /** Duración total de la animación en segundos (por defecto 0.8) */
  duration?: number;
  /** Velocidad de ascenso (unidades por segundo) */
  riseSpeed?: number;
  /** Desviación horizontal aleatoria */
  horizontalDrift?: number;
}

/**
 * Número de daño flotante 3D que asciende y se desvanece.
 * Usa THREE.Sprite con CanvasTexture para renderizar el texto.
 */
export class DamageNumber {
  private sprite: THREE.Sprite;
  private startTime: number;
  private duration: number;
  private riseSpeed: number;
  private horizontalDrift: number;
  private initialPosition: THREE.Vector3;
  private driftDirection: THREE.Vector3;

  constructor(
    damage: number,
    position: THREE.Vector3,
    options: DamageNumberOptions = {}
  ) {
    const {
      color = 0xffffff,
      fontSize = 32,
      duration = 0.8,
      riseSpeed = 2,
      horizontalDrift = 0.5,
    } = options;

    this.duration = duration;
    this.riseSpeed = riseSpeed;
    this.horizontalDrift = horizontalDrift;
    this.startTime = performance.now() / 1000; // Convertir a segundos
    this.initialPosition = position.clone();

    // Crear canvas para renderizar el texto
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('No se pudo obtener contexto 2D');
    }

    // Configurar canvas
    const padding = 10;
    const text = Math.round(damage).toString();
    context.font = `bold ${fontSize}px Arial`;
    const textWidth = context.measureText(text).width;
    const textHeight = fontSize;

    canvas.width = textWidth + padding * 2;
    canvas.height = textHeight + padding * 2;

    // Fondo transparente
    context.clearRect(0, 0, canvas.width, canvas.height);

    // Dibujar texto
    context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    context.font = `bold ${fontSize}px Arial`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);

    // Crear textura desde canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    // Crear material de sprite
    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 1.0,
      depthTest: false,
    });

    // Crear sprite
    this.sprite = new THREE.Sprite(spriteMaterial);
    this.sprite.position.copy(position);
    
    // Escalar sprite según tamaño del texto
    const scale = 0.01; // Ajuste para que el texto sea legible en unidades 3D
    this.sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);

    // Dirección de deriva aleatoria
    this.driftDirection = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      0,
      (Math.random() - 0.5) * 2
    ).normalize();

    // Asegurar que el sprite siempre mire a la cámara (se hará en update)
  }

  /**
   * Obtiene el sprite Three.js para añadirlo a la escena.
   */
  getSprite(): THREE.Sprite {
    return this.sprite;
  }

  /**
   * Actualiza la animación del número de daño.
   * @param currentTime Tiempo actual en segundos
   * @returns true si la animación ha terminado y el sprite debe ser eliminado
   */
  update(currentTime: number): boolean {
    const elapsed = currentTime - this.startTime;
    if (elapsed > this.duration) {
      return true; // Animación terminada
    }

    // Calcular progreso normalizado (0 a 1)
    const progress = elapsed / this.duration;

    // Opacidad: comienza en 1, termina en 0
    const opacity = 1 - progress;
    (this.sprite.material as THREE.SpriteMaterial).opacity = opacity;

    // Posición: ascenso + deriva
    const rise = this.riseSpeed * elapsed;
    const drift = this.horizontalDrift * elapsed;
    
    const newPosition = this.initialPosition.clone();
    newPosition.y += rise;
    newPosition.add(this.driftDirection.clone().multiplyScalar(drift));
    
    this.sprite.position.copy(newPosition);

    return false; // Animación aún en curso
  }

  /**
   * Libera recursos (textura, material).
   */
  dispose(): void {
    const material = this.sprite.material as THREE.SpriteMaterial;
    if (material.map) {
      material.map.dispose();
    }
    material.dispose();
  }
}

/**
 * Sistema manager para múltiples números de daño.
 * Maneja la creación, actualización y eliminación automática.
 */
export class DamageNumberSystem {
  private damageNumbers: DamageNumber[] = [];
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Crea un nuevo número de daño y lo añade a la escena.
   * @param damage Cantidad de daño a mostrar
   * @param position Posición 3D donde aparecerá
   * @param options Opciones de visualización
   */
  createDamageNumber(
    damage: number,
    position: THREE.Vector3,
    options: DamageNumberOptions = {}
  ): void {
    const damageNumber = new DamageNumber(damage, position, options);
    this.scene.add(damageNumber.getSprite());
    this.damageNumbers.push(damageNumber);
  }

  /**
   * Actualiza todos los números de daño activos.
   * Debe llamarse en cada frame del game loop.
   * @param deltaTime Tiempo transcurrido desde el último frame (en segundos)
   */
  update(deltaTime: number): void {
    const currentTime = performance.now() / 1000;
    const toRemove: number[] = [];

    for (let i = 0; i < this.damageNumbers.length; i++) {
      const damageNumber = this.damageNumbers[i];
      const finished = damageNumber.update(currentTime);
      if (finished) {
        // Marcar para eliminación
        toRemove.push(i);
      }
    }

    // Eliminar en orden inverso para preservar índices
    for (let i = toRemove.length - 1; i >= 0; i--) {
      const index = toRemove[i];
      const damageNumber = this.damageNumbers[index];
      this.scene.remove(damageNumber.getSprite());
      damageNumber.dispose();
      this.damageNumbers.splice(index, 1);
    }
  }

  /**
   * Elimina todos los números de daño activos.
   */
  clearAll(): void {
    for (const damageNumber of this.damageNumbers) {
      this.scene.remove(damageNumber.getSprite());
      damageNumber.dispose();
    }
    this.damageNumbers = [];
  }

  /**
   * Obtiene la cantidad de números de daño activos.
   */
  getCount(): number {
    return this.damageNumbers.length;
  }
}