import * as THREE from 'three';
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

/**
 * Cargador de assets centralizado con cache y soporte para instancing.
 * Evita cargar el mismo modelo múltiples veces y permite clonación eficiente.
 */
export class AssetLoader {
  private cache: Map<string, GLTF>;
  private gltfLoader: GLTFLoader;
  private dracoLoader: DRACOLoader;
  private loadingPromises: Map<string, Promise<GLTF>>;

  constructor() {
    this.cache = new Map();
    this.loadingPromises = new Map();

    // Configurar GLTFLoader con DRACOLoader para modelos comprimidos
    this.gltfLoader = new GLTFLoader();
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    this.gltfLoader.setDRACOLoader(this.dracoLoader);
  }

  /**
   * Carga un modelo GLTF desde una URL.
   * Si ya está en cache, retorna el cache; si ya está cargando, retorna la misma promesa.
   * @param url - URL del modelo GLTF.
   * @returns Promesa que resuelve al GLTF cargado.
   */
  public async load(url: string): Promise<GLTF> {
    // Verificar cache
    if (this.cache.has(url)) {
      return this.cache.get(url)!;
    }

    // Verificar si ya está cargando
    if (this.loadingPromises.has(url)) {
      return this.loadingPromises.get(url)!;
    }

    // Iniciar carga
    const promise = new Promise<GLTF>((resolve, reject) => {
      this.gltfLoader.load(
        url,
        gltf => {
          this.cache.set(url, gltf);
          this.loadingPromises.delete(url);
          resolve(gltf);
        },
        progress => {
          // Opcional: emitir eventos de progreso
          console.debug(
            `Loading ${url}: ${((progress.loaded / progress.total) * 100).toFixed(1)}%`
          );
        },
        error => {
          this.loadingPromises.delete(url);
          reject(this.createError(url, error));
        }
      );
    });

    this.loadingPromises.set(url, promise);
    return promise;
  }

  /**
   * Carga múltiples modelos en paralelo.
   * @param urls - Array de URLs.
   * @returns Promesa que resuelve a un array de GLTFs en el mismo orden.
   */
  public async loadAll(urls: string[]): Promise<GLTF[]> {
    const promises = urls.map(url => this.load(url));
    return Promise.all(promises);
  }

  /**
   * Clona la escena de un GLTF para instancing.
   * Crea una copia independiente que puede ser transformada sin afectar al original.
   * @param gltf - Modelo GLTF cargado.
   * @returns Grupo clonado (THREE.Group).
   */
  public clone(gltf: GLTF): THREE.Group {
    // Usar scene.clone(true) para deep clone completo (funciona para modelos estáticos y skinned)
    // SkeletonUtils.clone() puede producir grupos vacíos en modelos sin skinning
    const clonedScene = gltf.scene.clone(true) as THREE.Group;
    // Clonar materiales y geometrías para evitar compartir referencias
    clonedScene.traverse(child => {
      if (child instanceof THREE.Mesh) {
        if (child.material) {
          child.material = child.material.clone();
        }
        if (child.geometry) {
          child.geometry = child.geometry.clone();
        }
      }
    });
    return clonedScene;
  }

  /**
   * Precarga assets sin bloquear el hilo principal.
   * Los assets se almacenan en cache para uso futuro.
   * @param urls - URLs a precargar.
   */
  public preload(urls: string[]): void {
    urls.forEach(url => {
      if (!this.cache.has(url) && !this.loadingPromises.has(url)) {
        // Iniciar carga en segundo plano, ignoramos el resultado
        this.load(url).catch(error => {
          console.warn(`Preload failed for ${url}:`, error.message);
        });
      }
    });
  }

  /**
   * Obtiene un modelo del cache (si existe).
   * @param url - URL del modelo.
   * @returns GLTF o undefined si no está en cache.
   */
  public getFromCache(url: string): GLTF | undefined {
    return this.cache.get(url);
  }

  /**
   * Limpia el cache y libera recursos.
   */
  public dispose(): void {
    this.cache.forEach(gltf => {
      gltf.scene.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else if (child.material) {
            child.material.dispose();
          }
        }
      });
    });
    this.cache.clear();
    this.loadingPromises.clear();
    this.dracoLoader.dispose();
  }

  /**
   * Crea un error descriptivo para fallos de carga.
   */
  private createError(url: string, originalError: unknown): Error {
    const message = originalError instanceof Error ? originalError.message : String(originalError);
    return new Error(`Failed to load asset "${url}": ${message}`);
  }

  /**
   * Crea un objeto de fallback (cubo rojo) para reemplazar un modelo que falló.
   */
  public createFallback(): THREE.Group {
    const group = new THREE.Group();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const cube = new THREE.Mesh(geometry, material);
    group.add(cube);
    return group;
  }
}
