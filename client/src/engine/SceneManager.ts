import * as THREE from 'three';

/**
 * Gestor central de la escena Three.js con renderer optimizado y configuración low poly.
 * Maneja la creación de la escena, renderer, iluminación y eventos de ventana.
 */
export class SceneManager {
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private ambientLight: THREE.AmbientLight;
  private directionalLight: THREE.DirectionalLight;

  /**
   * Crea una instancia de SceneManager.
   * @param canvas - Elemento canvas donde se renderizará la escena.
   * @param camera - Cámara perspectiva (opcional). Si no se proporciona, se crea una por defecto.
   */
  constructor(canvas: HTMLCanvasElement, camera?: THREE.PerspectiveCamera) {
    this.scene = this.createScene();
    this.renderer = this.createRenderer(canvas);
    this.camera = camera ?? this.createDefaultCamera();
    this.ambientLight = this.createAmbientLight();
    this.directionalLight = this.createDirectionalLight();

    this.setupLights();
    this.setupEventListeners();
  }

  /**
   * Crea la escena principal con fog suave para profundidad visual.
   */
  private createScene(): THREE.Scene {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x87ceeb, 10, 50); // Color cielo, near, far
    scene.background = new THREE.Color(0x87ceeb); // Fondo azul cielo
    return scene;
  }

  /**
   * Crea y configura el WebGLRenderer optimizado.
   */
  private createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });

    // Configuración de sombras
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Cap a 2x para performance

    // Tamaño inicial
    this.updateRendererSize(renderer);

    return renderer;
  }

  /**
   * Crea una cámara perspectiva por defecto.
   */
  private createDefaultCamera(): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera(
      75, // FOV
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(5, 5, 5);
    camera.lookAt(0, 0, 0);
    return camera;
  }

  /**
   * Crea luz ambiental para iluminación base.
   */
  private createAmbientLight(): THREE.AmbientLight {
    return new THREE.AmbientLight(0x404060, 0.6); // Color azulado, intensidad baja
  }

  /**
   * Crea luz direccional con sombras habilitadas.
   */
  private createDirectionalLight(): THREE.DirectionalLight {
    const light = new THREE.DirectionalLight(0xffffff, 1.2);
    light.position.set(10, 20, 10); // Posición isométrica
    light.castShadow = true;

    // Configuración de sombras
    light.shadow.mapSize.width = 2048;
    light.shadow.mapSize.height = 2048;
    light.shadow.camera.near = 0.5;
    light.shadow.camera.far = 50;
    light.shadow.camera.left = -20;
    light.shadow.camera.right = 20;
    light.shadow.camera.top = 20;
    light.shadow.camera.bottom = -20;

    return light;
  }

  /**
   * Añade las luces a la escena.
   */
  private setupLights(): void {
    this.scene.add(this.ambientLight);
    this.scene.add(this.directionalLight);
  }

  /**
   * Configura listeners para eventos de ventana (resize).
   */
  private setupEventListeners(): void {
    window.addEventListener('resize', () => this.handleResize());
  }

  /**
   * Maneja el redimensionado de la ventana.
   */
  private handleResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.updateRendererSize(this.renderer);
  }

  /**
   * Actualiza el tamaño del renderer según las dimensiones de la ventana.
   */
  private updateRendererSize(renderer: THREE.WebGLRenderer): void {
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /**
   * Renderiza la escena.
   */
  public render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Obtiene la escena Three.js.
   */
  public getScene(): THREE.Scene {
    return this.scene;
  }

  /**
   * Obtiene el renderer WebGL.
   */
  public getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  /**
   * Obtiene la cámara.
   */
  public getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  /**
   * Añade un objeto a la escena.
   */
  public add(object: THREE.Object3D): void {
    this.scene.add(object);
  }

  /**
   * Elimina un objeto de la escena.
   */
  public remove(object: THREE.Object3D): void {
    this.scene.remove(object);
  }

  /**
   * Limpia recursos y elimina listeners.
   */
  public dispose(): void {
    window.removeEventListener('resize', () => this.handleResize());
    this.renderer.dispose();
    // Nota: THREE.Scene no tiene método dispose, pero los objetos hijos deben ser eliminados manualmente.
  }
}