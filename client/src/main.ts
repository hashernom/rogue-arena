import './style.css';
import * as THREE from 'three';
import { GameLoop } from './engine/GameLoop';
import { SceneManager } from './engine/SceneManager';
import { CameraController } from './engine/CameraController';
import { AssetLoader } from './engine/AssetLoader';
import { InputManager } from './engine/InputManager';

// Obtener elemento canvas existente o crear uno nuevo
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = '';
const canvas = document.createElement('canvas');
canvas.id = 'three-canvas';
app.appendChild(canvas);

// Crear SceneManager (maneja escena, renderer, cámara, luces, sombras)
const sceneManager = new SceneManager(canvas);

// Crear CameraController con cámara isométrica ortográfica
const cameraController = new CameraController(20); // frustumSize = 20 (arena 30x30 cabe)
sceneManager.setCamera(cameraController.getCamera());

// Crear AssetLoader para gestión centralizada de modelos
const assetLoader = new AssetLoader();

// Precargar assets críticos antes del primer tick (ejemplo: modelo de prueba)
// Usamos un modelo público de Three.js para demostración.
// Si falla, el loader manejará el error y podemos usar un fallback.
const demoModelUrl = 'https://threejs.org/examples/models/gltf/Duck/glTF/Duck.gltf';
assetLoader.preload([demoModelUrl]);

// Crear InputManager para controles desacoplados
const inputManager = new InputManager();

// Referencias disponibles si se necesitan en el futuro
// const scene = sceneManager.getScene();
// const camera = sceneManager.getCamera();
// const renderer = sceneManager.getRenderer();

// Crear cubos para los jugadores
const geometry = new THREE.BoxGeometry(1, 1, 1);

// Cubo del Player 1 (verde)
const materialP1 = new THREE.MeshPhongMaterial({
  color: 0x00ff88,
  shininess: 100,
});
const cubeP1 = new THREE.Mesh(geometry, materialP1);
cubeP1.castShadow = true;
cubeP1.receiveShadow = true;
cubeP1.position.set(-3, 0, 0); // Posición inicial separada
sceneManager.add(cubeP1);

// Cubo del Player 2 (rojo)
const materialP2 = new THREE.MeshPhongMaterial({
  color: 0xff4444,
  shininess: 100,
});
const cubeP2 = new THREE.Mesh(geometry, materialP2);
cubeP2.castShadow = true;
cubeP2.receiveShadow = true;
cubeP2.position.set(3, 0, 0); // Posición inicial separada
sceneManager.add(cubeP2);

// Crear un plano para proyectar sombras
const planeGeometry = new THREE.PlaneGeometry(30, 30); // Arena 30x30 metros
const planeMaterial = new THREE.MeshPhongMaterial({ color: 0x333333, shininess: 30 });
const plane = new THREE.Mesh(planeGeometry, planeMaterial);
plane.rotation.x = -Math.PI / 2;
plane.position.y = -2;
plane.receiveShadow = true;
sceneManager.add(plane);

// Variables para HMR
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let cubeColor = 0x00ff88; // Usada en changeCubeColor (solo afecta P1)
let rotationSpeed = 0.01;

// Crear Game Loop con Fixed Timestep
const gameLoop = new GameLoop();

// Fixed Update: física a 60Hz
gameLoop.setFixedUpdate((dt: number) => {
  // Actualizar estado de input (una vez por tick)
  inputManager.update();

  // Obtener estados de ambos jugadores
  const p1State = inputManager.getState(1);
  const p2State = inputManager.getState(2);

  // Mover Player 1 (WASD) - invertir eje Z para que W sea "adelante" (negativo)
  cubeP1.position.x += p1State.moveDir.x * dt * 5;
  cubeP1.position.z -= p1State.moveDir.y * dt * 5; // Negativo para que W mueva hacia adelante

  // Mover Player 2 (Flechas) - misma lógica
  cubeP2.position.x += p2State.moveDir.x * dt * 5;
  cubeP2.position.z -= p2State.moveDir.y * dt * 5;

  // Rotación básica (solo para visualización)
  cubeP1.rotation.x += rotationSpeed * dt * 60;
  cubeP1.rotation.y += rotationSpeed * 0.7 * dt * 60;
  cubeP2.rotation.x += rotationSpeed * dt * 60;
  cubeP2.rotation.y += rotationSpeed * 0.7 * dt * 60;

  // Mostrar estado de input en modo desarrollo
  if (import.meta.env.DEV) {
    displayInputState(p1State, 1);
    displayInputState(p2State, 2);
  }
});

// Render: usar SceneManager para renderizar
gameLoop.setRender((_alpha: number) => {
  sceneManager.render();
  
  // Mostrar FPS en modo desarrollo
  if (import.meta.env.DEV) {
    displayFps(gameLoop.fps);
  }
});

// Iniciar Game Loop
gameLoop.start();

// Manejo de redimensionado: actualizar CameraController y SceneManager
window.addEventListener('resize', () => {
  cameraController.handleResize();
  // SceneManager ya actualiza el renderer internamente
});

// Función para mostrar FPS en pantalla (solo desarrollo)
function displayFps(fps: number): void {
  let fpsElement = document.getElementById('fps-counter');
  if (!fpsElement) {
    fpsElement = document.createElement('div');
    fpsElement.id = 'fps-counter';
    fpsElement.style.position = 'fixed';
    fpsElement.style.top = '10px';
    fpsElement.style.right = '10px';
    fpsElement.style.color = '#00ff88';
    fpsElement.style.fontFamily = 'monospace';
    fpsElement.style.fontSize = '14px';
    fpsElement.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    fpsElement.style.padding = '5px 10px';
    fpsElement.style.borderRadius = '5px';
    fpsElement.style.zIndex = '1000';
    document.body.appendChild(fpsElement);
  }
  fpsElement.textContent = `FPS: ${fps}`;
}

// Función para mostrar estado de input (solo desarrollo)
function displayInputState(state: import('./engine/InputManager').InputState, playerId: number): void {
  const elementId = `input-state-p${playerId}`;
  let inputElement = document.getElementById(elementId);
  if (!inputElement) {
    inputElement = document.createElement('div');
    inputElement.id = elementId;
    inputElement.style.position = 'fixed';
    inputElement.style.right = '10px';
    inputElement.style.color = playerId === 1 ? '#ffaa00' : '#44aaff';
    inputElement.style.fontFamily = 'monospace';
    inputElement.style.fontSize = '12px';
    inputElement.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    inputElement.style.padding = '5px 10px';
    inputElement.style.borderRadius = '5px';
    inputElement.style.zIndex = '1000';
    // Posición vertical: P1 arriba, P2 abajo
    inputElement.style.top = playerId === 1 ? '40px' : '70px';
    document.body.appendChild(inputElement);
  }
  const dir = state.moveDir;
  inputElement.textContent = `P${playerId}: dir(${dir.x.toFixed(2)}, ${dir.y.toFixed(2)}) A:${state.attacking ? 'Y' : 'N'} Q:${state.abilityQ ? 'Y' : 'N'} E:${state.abilityE ? 'Y' : 'N'}`;
}

// Exportar para HMR
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    console.log('HMR: Three.js scene updated');
  });

  // Función para cambiar color del cubo (para probar HMR) - afecta solo al Player 1
  window.changeCubeColor = (color: number) => {
    cubeColor = color;
    if (cubeP1.material instanceof THREE.MeshPhongMaterial) {
      cubeP1.material.color.setHex(color);
    }
  };

  window.changeRotationSpeed = (speed: number) => {
    rotationSpeed = speed;
  };
}

// Tipos globales para HMR
declare global {
  interface Window {
    changeCubeColor: (color: number) => void;
    changeRotationSpeed: (speed: number) => void;
  }
}

console.log('✅ Three.js scene initialized with SceneManager');
console.log('🎮 Rogue Arena Client - Vite + Three.js');
console.log('🔄 HMR ready - Try: changeCubeColor(0xff0000) in console');
console.log('🌄 SceneManager active: shadows enabled, low‑poly fog, optimized renderer');
console.log('📐 CameraController active: isometric OrthographicCamera (frustumSize=20)');
