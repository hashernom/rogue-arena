import './style.css';
import * as THREE from 'three';
import { GameLoop } from './engine/GameLoop';
import { SceneManager } from './engine/SceneManager';
import { CameraController } from './engine/CameraController';
import { AssetLoader } from './engine/AssetLoader';
import { InputManager } from './engine/InputManager';
import { PhysicsWorld, type RigidBodyHandle } from './physics/PhysicsWorld';
import { DebugRenderer } from './physics/DebugRenderer';
import { EventBus } from './engine/EventBus';
import { MeleeCharacter } from './characters/MeleeCharacter';
import { AdcCharacter } from './characters/AdcCharacter';
import { EnemyPool } from './enemies/EnemyPool';
import { Enemy, EnemyType, SKELETON_MINION_STATS } from './enemies/Enemy';
import { DamagePipeline } from './combat/DamagePipeline';
import { DamageNumberSystem } from './combat/DamageNumber';
import RAPIER from '@dimforge/rapier3d-compat';

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

// Crear InputManager para controles desacoplados
const inputManager = new InputManager();

// Referencias disponibles si se necesitan en el futuro
// const scene = sceneManager.getScene();
// const camera = sceneManager.getCamera();
// const renderer = sceneManager.getRenderer();

// Crear EventBus para comunicación entre sistemas
const eventBus = new EventBus();

// Crear cubos para los jugadores (solo Player 2 como cubo, Player 1 será MeleeCharacter)
const geometry = new THREE.BoxGeometry(1, 1, 1);

// Cubo del Player 2 (rojo) - mantenemos cubo para demostración
const materialP2 = new THREE.MeshPhongMaterial({
  color: 0xff4444,
  shininess: 100,
});
const cubeP2 = new THREE.Mesh(geometry, materialP2);
cubeP2.castShadow = true;
cubeP2.receiveShadow = true;
cubeP2.position.set(3, 0, 0); // Posición inicial separada
sceneManager.add(cubeP2);

// MeleeCharacter (Player 1) - se creará después de inicializar física
let meleeCharacter: MeleeCharacter | null = null;
// AdcCharacter (Player 2) - reemplazará el cubo rojo
let adcCharacter: AdcCharacter | null = null;
// Pool de enemigos para gestión eficiente de instancias
let enemyPool: EnemyPool | null = null;
// Enemigos de prueba (fila para testing de piercing)
let testEnemies: Enemy[] = [];
// Pipeline centralizado de daño (compartido entre todos los sistemas)
let damagePipeline: DamagePipeline | null = null;
// Sistema de números de daño flotantes
let damageNumberSystem: DamageNumberSystem | null = null;

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

// Variable global para PhysicsWorld (accesible desde HMR si es necesario)
let physicsWorld: PhysicsWorld | null = null;

// DebugRenderer para visualizar colliders (solo en desarrollo)
let debugRenderer: DebugRenderer | null = null;

// Handles de cuerpos físicos
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let player1BodyHandle: RigidBodyHandle | null = null;
let player2BodyHandle: RigidBodyHandle | null = null;
let planeBodyHandle: RigidBodyHandle | null = null;

// Función asíncrona que inicializa Rapier3D WASM y luego inicia el juego
async function initGameWithPhysics(): Promise<void> {
  try {
    console.log('🔄 Inicializando Rapier3D WASM...');
    physicsWorld = await PhysicsWorld.init();
    console.log('✅ Rapier3D WASM cargado y PhysicsWorld listo');

    // Crear cuerpos físicos para los jugadores y el plano
    if (physicsWorld) {
      // Plano estático (suelo) - tamaño enorme para evitar bordes invisibles
      const planeCollider = RAPIER.ColliderDesc.cuboid(200, 0.1, 200); // half-extents (400x0.2x400)
      planeBodyHandle = physicsWorld.createBody({
        type: 'static',
        position: new THREE.Vector3(plane.position.x, plane.position.y, plane.position.z),
        rotation: new THREE.Euler(plane.rotation.x, plane.rotation.y, plane.rotation.z),
        collider: planeCollider,
      });

      // Jugador 1: MeleeCharacter (Caballero)
      meleeCharacter = new MeleeCharacter(
        'player1',
        eventBus,
        sceneManager,
        assetLoader,
        physicsWorld
      );
      // Crear cuerpo físico para el caballero en posición inicial (-3, 0, 0)
      meleeCharacter.createPhysicsBody(new THREE.Vector3(-3, 0, 0));
      player1BodyHandle = meleeCharacter.getPhysicsBody() ?? null;

      // Jugador 2: AdcCharacter (Arquero) - reemplaza el cubo rojo
      adcCharacter = new AdcCharacter(
        'player2',
        eventBus,
        sceneManager,
        assetLoader,
        physicsWorld
      );
      // Crear cuerpo físico para el arquero en posición inicial (3, 0, 0)
      adcCharacter.createPhysicsBody(new THREE.Vector3(3, 0, 0));
      player2BodyHandle = adcCharacter.getPhysicsBody() ?? null;

      // Remover el cubo rojo de la escena
      sceneManager.remove(cubeP2);

      // Sincronizar mesh del plano con cuerpo físico
      physicsWorld.syncToThree(plane, planeBodyHandle);

      // Crear DebugRenderer para visualizar colliders (solo en desarrollo)
      if (import.meta.env.DEV) {
        const scene = sceneManager.getScene();
        const rapierWorld = physicsWorld.getWorld();
        debugRenderer = new DebugRenderer(scene, rapierWorld);
        console.log('🔧 DebugRenderer inicializado (F1 para toggle)');
      }

      console.log('📦 Cuerpos físicos creados y sincronizados (damping aplicado)');

      // Inicializar pipeline centralizado de daño y sistema de números flotantes
      damagePipeline = new DamagePipeline(eventBus);
      const scene = sceneManager.getScene();
      damageNumberSystem = new DamageNumberSystem(scene);
      damagePipeline.setDamageNumberSystem(damageNumberSystem);
      console.log('💥 DamagePipeline y DamageNumberSystem inicializados');

      // Compartir el pipeline con todos los sistemas de combate
      if (meleeCharacter) {
        meleeCharacter.setDamagePipeline(damagePipeline);
      }
      if (adcCharacter) {
        adcCharacter.setDamagePipeline(damagePipeline);
      }
      console.log('🔗 DamagePipeline compartido con MeleeCharacter y AdcCharacter');

      // Inicializar EnemyPool para gestión eficiente de instancias de enemigos
      enemyPool = new EnemyPool(eventBus, sceneManager, physicsWorld);
      
      // Registrar tipo de enemigo skeleton minion
      enemyPool.registerEnemyType({
        type: EnemyType.SkeletonMinion,
        stats: SKELETON_MINION_STATS,
        initialCount: 5,
        maxSize: 20
      });
      console.log('🧟 EnemyPool inicializado con tipo skeleton minion');

      // Crear enemigos en formación escalonada (sin superposición)
      // Primera fila (3 enemigos)
      testEnemies = await Enemy.createEnemyRow(
        3,            // 3 enemigos
        -3,           // startX
        5,            // startZ
        3,            // spacing
        eventBus,
        sceneManager,
        physicsWorld
      );
      // Segunda fila (2 enemigos, escalonados)
      const secondRow = await Enemy.createEnemyRow(
        2,            // 2 enemigos
        -1.5,         // startX (centrado entre los de la primera fila)
        8,            // startZ (más atrás)
        3,            // spacing
        eventBus,
        sceneManager,
        physicsWorld
      );
      testEnemies.push(...secondRow);
      console.log(`🧪 Creados ${testEnemies.length} enemigos en formación escalonada`);
    }
  } catch (error) {
    console.error('❌ Error al inicializar Rapier3D:', error);
    // Continuar sin física (modo degradado)
    console.warn('⚠️ Continuando sin física (modo degradado)');
  }

  // Crear Game Loop con Fixed Timestep
  const gameLoop = new GameLoop();

  // Fixed Update: física a 60Hz
  let meleeDebugKeyPressed = false; // Para debounce de tecla 'M'
  
  gameLoop.setFixedUpdate((dt: number) => {
    // Actualizar estado de input (una vez por tick)
    inputManager.update();

    // Obtener estados de ambos jugadores
    const p1State = inputManager.getState(1);
    const p2State = inputManager.getState(2);

    // Actualizar MeleeCharacter (Player 1) con input
    if (meleeCharacter) {
      meleeCharacter.update(dt, p1State);
    }

    // Actualizar AdcCharacter (Player 2) con input
    if (adcCharacter) {
      adcCharacter.update(dt, p2State);
    }

    // Construir array de jugadores para IA de enemigos
    const players: any[] = [];
    if (meleeCharacter) players.push(meleeCharacter);
    if (adcCharacter) players.push(adcCharacter);

    // Actualizar enemigos del pool
    if (enemyPool) {
      enemyPool.update(dt, players);
    }

    // Actualizar enemigos de prueba (fila de testing) - incluir AI para animaciones
    testEnemies.forEach(enemy => {
      enemy.update(dt);
      enemy.updateAI(dt, players);
    });

    // Actualizar números de daño flotantes
    if (damageNumberSystem) {
      damageNumberSystem.update(dt);
    }

    // Rotación básica (solo para visualización) - mantener independiente de física
    // cubeP2 ya no existe, se eliminó

    // Avanzar simulación física
    if (physicsWorld) {
      physicsWorld.stepAll(dt);
    }

    // Sincronizar modelos DESPUÉS del step (mismo frame que el debug)
    if (meleeCharacter) meleeCharacter.syncToPhysics();
    if (adcCharacter) adcCharacter.syncToPhysics();

    // Actualizar DebugRenderer para visualizar colliders
    if (debugRenderer) {
      debugRenderer.update();
    }

    // Mostrar estado de input en modo desarrollo
    if (import.meta.env.DEV) {
      displayInputState(p1State, 1);
      displayInputState(p2State, 2);

      // Toggle debug mesh del ataque melee con tecla 'M'
      if (inputManager.isKeyPressed('KeyM')) {
        // Solo activar una vez por presión (debounce simple)
        if (!meleeDebugKeyPressed) {
          meleeDebugKeyPressed = true;
          
          if (meleeCharacter) {
            const meleeAttack = meleeCharacter.getMeleeAttack();
            if (meleeAttack) {
              const newState = meleeAttack.toggleDebugVisible();
              console.log(`🔧 Debug mesh del ataque melee: ${newState ? 'ACTIVADO' : 'DESACTIVADO'}`);
            }
          }
        }
      } else {
        meleeDebugKeyPressed = false;
      }
    }
  });

  // Render: usar SceneManager para renderizar
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  gameLoop.setRender((_alpha: number) => {
    // _alpha no se usa porque SceneManager.render() no necesita interpolación
    sceneManager.render();

    // Mostrar FPS en modo desarrollo
    if (import.meta.env.DEV) {
      displayFps(gameLoop.fps);
    }
  });

  // Iniciar Game Loop
  gameLoop.start();
  console.log('🎮 Game Loop iniciado con física integrada');

  // Exponer physicsWorld y debugRenderer globalmente para depuración (solo desarrollo)
  if (import.meta.env.DEV) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).physicsWorld = physicsWorld;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).debugRenderer = debugRenderer;
  }
}

// Llamar a la inicialización asíncrona (ignoramos la promesa intencionalmente)
void initGameWithPhysics();

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
function displayInputState(
  state: import('./engine/InputManager').InputState,
  playerId: number
): void {
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

  // Función para cambiar color del cubo (para probar HMR) - afecta solo al Player 2
  window.changeCubeColor = (color: number) => {
    cubeColor = color;
    if (cubeP2.material instanceof THREE.MeshPhongMaterial) {
      cubeP2.material.color.setHex(color);
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
