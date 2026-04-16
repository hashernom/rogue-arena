import './style.css';
import * as THREE from 'three';

// Configuración básica de Three.js
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 5;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);

// Agregar canvas al DOM
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = '';
app.appendChild(renderer.domElement);

// Crear un cubo giratorio
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshPhongMaterial({
  color: 0x00ff88,
  shininess: 100,
});
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

// Luz
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 5, 5);
scene.add(directionalLight);

// Variables para HMR
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let cubeColor = 0x00ff88; // Usada en changeCubeColor
let rotationSpeed = 0.01;

// Función de animación
function animate() {
  requestAnimationFrame(animate);

  cube.rotation.x += rotationSpeed;
  cube.rotation.y += rotationSpeed * 0.7;

  renderer.render(scene, camera);
}

// Manejo de redimensionamiento
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Iniciar animación
animate();

// Exportar para HMR
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    console.log('HMR: Three.js scene updated');
  });

  // Función para cambiar color del cubo (para probar HMR)
  window.changeCubeColor = (color: number) => {
    cubeColor = color;
    if (cube.material instanceof THREE.MeshPhongMaterial) {
      cube.material.color.setHex(color);
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

console.log('✅ Three.js scene initialized');
console.log('🎮 Rogue Arena Client - Vite + Three.js');
console.log('🔄 HMR ready - Try: changeCubeColor(0xff0000) in console');
