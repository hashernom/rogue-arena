import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

/**
 * Renderizador de debug para visualizar colliders de Rapier como wireframes en Three.js.
 * Solo se compila en modo desarrollo (import.meta.env.DEV).
 *
 * Características:
 * - Wireframes que se alinean con los meshes 3D de Three.js
 * - Colores por tipo de body:
 *   - Verde: colliders activos
 *   - Rojo: colliders en sleep
 *   - Amarillo: sensors
 * - Toggle rápido con F1 durante el juego
 * - Activación/desactivación con ?debug=true en la URL
 * - No impacta FPS cuando está desactivado
 * - Tree-shaking en producción (código no incluido)
 */
export class DebugRenderer {
  private enabled = false;
  private lineSegments: THREE.LineSegments | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.LineBasicMaterial | null = null;
  private scene: THREE.Scene | null = null;
  private world: RAPIER.World | null = null;

  /**
   * Inicializa el renderizador de debug.
   * @param scene Escena Three.js donde se agregarán los wireframes
   * @param world Mundo Rapier del cual obtener los datos de debug
   */
  constructor(scene: THREE.Scene, world: RAPIER.World) {
    // Solo inicializar en modo desarrollo
    if (!import.meta.env.DEV) {
      console.warn('DebugRenderer solo está disponible en modo desarrollo.');
      return;
    }

    this.scene = scene;
    this.world = world;

    // Verificar parámetro de URL ?debug=true
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('debug') === 'true') {
      this.enabled = true;
    }

    // Configurar listener para tecla F1 (solo en desarrollo)
    window.addEventListener('keydown', event => {
      if (event.code === 'F1') {
        event.preventDefault();
        this.toggle();
      }
    });

    this.initGeometry();
    this.updateVisibility();
  }

  /**
   * Inicializa la geometría y material para los wireframes.
   */
  private initGeometry(): void {
    if (!this.scene) return;

    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      linewidth: 1,
      transparent: true,
      opacity: 0.8,
    });

    this.lineSegments = new THREE.LineSegments(this.geometry, this.material);
    this.lineSegments.frustumCulled = false;
    this.scene.add(this.lineSegments);
  }

  /**
   * Alterna la visibilidad de los wireframes.
   */
  toggle(): void {
    if (!import.meta.env.DEV) return;

    this.enabled = !this.enabled;
    this.updateVisibility();
    console.log(`DebugRenderer ${this.enabled ? 'activado' : 'desactivado'}`);
  }

  /**
   * Actualiza la visibilidad de los wireframes en la escena.
   */
  private updateVisibility(): void {
    if (!this.lineSegments) return;
    this.lineSegments.visible = this.enabled;
  }

  /**
   * Actualiza los datos de debug desde Rapier y los aplica a la geometría.
   * Debe llamarse en cada frame después del step de física.
   */
  update(): void {
    // Solo procesar si está habilitado y en modo desarrollo
    if (!this.enabled || !import.meta.env.DEV || !this.world || !this.geometry) {
      return;
    }

    try {
      // Obtener datos de debug de Rapier
      const debugBuffers = this.world.debugRender();
      const vertices = debugBuffers.vertices;
      const colors = debugBuffers.colors;

      // Si no hay datos, limpiar geometría
      if (vertices.length === 0) {
        this.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
        this.geometry.setAttribute('color', new THREE.Float32BufferAttribute([], 4));
        return;
      }

      // Actualizar atributos de geometría
      const positionAttribute = new THREE.Float32BufferAttribute(vertices, 3);
      const colorAttribute = new THREE.Float32BufferAttribute(colors, 4);

      this.geometry.setAttribute('position', positionAttribute);
      this.geometry.setAttribute('color', colorAttribute);

      // Calcular bounding sphere para frustum culling
      this.geometry.computeBoundingSphere();
    } catch (error) {
      console.error('Error actualizando DebugRenderer:', error);
    }
  }

  /**
   * Libera recursos de Three.js.
   */
  dispose(): void {
    if (this.lineSegments && this.scene) {
      this.scene.remove(this.lineSegments);
    }
    if (this.geometry) {
      this.geometry.dispose();
    }
    if (this.material) {
      this.material.dispose();
    }
    this.lineSegments = null;
    this.geometry = null;
    this.material = null;
  }

  /**
   * Verifica si el debug está activado.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Activa/desactiva el debug manualmente.
   */
  setEnabled(enabled: boolean): void {
    if (!import.meta.env.DEV) return;
    this.enabled = enabled;
    this.updateVisibility();
  }
}

/**
 * Función de conveniencia para crear un DebugRenderer condicionalmente.
 * En producción, retorna un objeto dummy que no hace nada (tree-shaking).
 */
export function createDebugRenderer(scene: THREE.Scene, world: RAPIER.World): DebugRenderer | null {
  if (!import.meta.env.DEV) {
    return null;
  }
  return new DebugRenderer(scene, world);
}
