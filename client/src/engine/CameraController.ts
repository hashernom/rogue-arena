import * as THREE from 'three';

/**
 * Controlador de cámara isométrica fija con OrthographicCamera.
 * Mantiene una perspectiva isométrica (45°) y ajusta el frustum dinámicamente al aspect ratio.
 */
export class CameraController {
  private camera: THREE.OrthographicCamera;
  private frustumSize: number;
  private near: number;
  private far: number;

  /**
   * Crea una instancia de CameraController.
   * @param frustumSize - Tamaño vertical del frustum en unidades de mundo (default: 20).
   * @param near - Plano near (default: 0.1).
   * @param far - Plano far (default: 1000).
   */
  constructor(frustumSize = 20, near = 0.1, far = 1000) {
    this.frustumSize = frustumSize;
    this.near = near;
    this.far = far;

    // Crear cámara con frustum inicial
    this.camera = this.createCamera();

    // Posicionar en ángulo isométrico (45°)
    this.setIsometricPosition(15, 15, 15);
  }

  /**
   * Crea la OrthographicCamera con el frustum calculado según el aspect ratio actual.
   */
  private createCamera(): THREE.OrthographicCamera {
    const aspect = window.innerWidth / window.innerHeight;
    const halfWidth = (this.frustumSize * aspect) / 2;
    const halfHeight = this.frustumSize / 2;

    const camera = new THREE.OrthographicCamera(
      -halfWidth, // left
      halfWidth,  // right
      halfHeight, // top
      -halfHeight, // bottom
      this.near,
      this.far
    );

    return camera;
  }

  /**
   * Posiciona la cámara en ángulo isométrico (45° en XZ, elevación en Y).
   * @param x - Coordenada X (default: 15).
   * @param y - Coordenada Y (default: 15).
   * @param z - Coordenada Z (default: 15).
   */
  public setIsometricPosition(x = 15, y = 15, z = 15): void {
    this.camera.position.set(x, y, z);
    this.camera.lookAt(0, 0, 0);
    this.camera.up.set(0, 1, 0); // Eje Y hacia arriba en mundo isométrico
  }

  /**
   * Actualiza el frustum de la cámara según el nuevo aspect ratio (ej. en resize).
   */
  public updateFrustum(): void {
    const aspect = window.innerWidth / window.innerHeight;
    const halfWidth = (this.frustumSize * aspect) / 2;
    const halfHeight = this.frustumSize / 2;

    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Centra la cámara entre dos posiciones de jugadores (para futuro uso en M9).
   * @param p1Pos - Vector3 de posición del jugador 1.
   * @param p2Pos - Vector3 de posición del jugador 2.
   */
  public followPlayers(p1Pos: THREE.Vector3, p2Pos: THREE.Vector3): void {
    // Punto medio entre los dos jugadores
    const center = new THREE.Vector3().addVectors(p1Pos, p2Pos).multiplyScalar(0.5);

    // Mantener la misma altura y distancia isométrica
    const offset = new THREE.Vector3(15, 15, 15);
    this.camera.position.copy(center).add(offset);
    this.camera.lookAt(center);
  }

  /**
   * Obtiene la instancia de la cámara.
   */
  public getCamera(): THREE.OrthographicCamera {
    return this.camera;
  }

  /**
   * Cambia el tamaño del frustum (unidades verticales visibles).
   * @param size - Nuevo tamaño del frustum.
   */
  public setFrustumSize(size: number): void {
    this.frustumSize = size;
    this.updateFrustum();
  }

  /**
   * Maneja el redimensionado de ventana (debe ser llamado desde el listener de resize).
   */
  public handleResize(): void {
    this.updateFrustum();
  }

  /**
   * Libera recursos (si fuera necesario).
   */
  public dispose(): void {
    // Nada que liberar actualmente
  }
}