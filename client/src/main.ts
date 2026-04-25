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
import { Enemy, EnemyType } from './enemies/Enemy';
import { ENEMY_BASIC_STATS } from './enemies/EnemyBasic';
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
// Pipeline centralizado de daño (compartido entre todos los sistemas)
let damagePipeline: DamagePipeline | null = null;
// Sistema de números de daño flotantes
let damageNumberSystem: DamageNumberSystem | null = null;
// HP bars para jugadores (sprites flotantes)
let playerHpBars: Map<string, THREE.Sprite> = new Map();

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

      // ================================================================
      // SISTEMA DE HP BAR PARA JUGADORES
      // ================================================================
      // Crear sprites de HP bar para cada jugador
      const playerHpBars: Map<string, THREE.Sprite> = new Map();

      function createPlayerHpBar(playerId: string): THREE.Sprite {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 16;
        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          depthTest: false,
          depthWrite: false,
        });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(1.2, 0.15, 1);
        sprite.visible = false;
        sprite.renderOrder = 999;
        scene.add(sprite);
        return sprite;
      }

      function updatePlayerHpBar(sprite: THREE.Sprite, ratio: number, position: THREE.Vector3): void {
        const spriteMaterial = sprite.material as THREE.SpriteMaterial;
        const texture = spriteMaterial.map as THREE.CanvasTexture;
        const canvas = texture.image as HTMLCanvasElement;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Fondo negro
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Barra de HP (verde -> amarillo -> rojo según ratio)
        const hue = Math.max(0, ratio * 120);
        ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
        ctx.fillRect(1, 1, (canvas.width - 2) * ratio, canvas.height - 2);

        // Borde blanco
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, canvas.width, canvas.height);

        texture.needsUpdate = true;

        // Posicionar sobre el jugador
        sprite.position.copy(position);
        sprite.position.y += 2.2;
      }

      // Crear HP bars para ambos jugadores
      const hpBarP1 = createPlayerHpBar('player1');
      const hpBarP2 = createPlayerHpBar('player2');
      playerHpBars.set('player1', hpBarP1);
      playerHpBars.set('player2', hpBarP2);

      // Suscribirse a eventos de daño a jugadores para mostrar HP bar y damage numbers
      eventBus.on('player:damaged', (data: { playerId: string; amount: number }) => {
        // Mostrar damage number flotante
        if (damageNumberSystem) {
          let playerPos: THREE.Vector3 | null = null;
          if (data.playerId === 'player1' && meleeCharacter) {
            playerPos = meleeCharacter.getPosition();
          } else if (data.playerId === 'player2' && adcCharacter) {
            playerPos = adcCharacter.getPosition();
          }

          if (playerPos) {
            damageNumberSystem.createDamageNumber(
              Math.round(data.amount),
              playerPos.clone().add(new THREE.Vector3(0, 1.5, 0)),
              { color: 0xff4444, fontSize: 24 }
            );
          }
        }

        // Mostrar/actualizar HP bar
        const hpBar = playerHpBars.get(data.playerId);
        if (hpBar) {
          let character = data.playerId === 'player1' ? meleeCharacter : adcCharacter;
          if (character) {
            const currentHp = character.getEffectiveStat('hp');
            const maxHp = character.getEffectiveStat('maxHp');
            const ratio = Math.max(0, currentHp / maxHp);
            const pos = character.getPosition();
            if (pos) {
              updatePlayerHpBar(hpBar, ratio, pos);
              hpBar.visible = true;

              // Ocultar después de 3 segundos
              setTimeout(() => {
                hpBar.visible = false;
              }, 3000);
            }
          }
        }
      });

      // Actualizar posición de HP bars en cada frame (en fixed update)
      // Esto se hace en el game loop más abajo
      console.log('🩸 Sistema de HP bar y damage numbers para jugadores inicializado');

      // Precargar modelo compartido del esqueleto antes de crear instancias de EnemyBasic
      await Enemy.ensureModelLoaded();
      console.log('✅ Modelo compartido de esqueleto precargado');

      // Inicializar EnemyPool para gestión eficiente de instancias de enemigos
      enemyPool = new EnemyPool(eventBus, sceneManager, physicsWorld);
      
      // Registrar tipo de enemigo básico (seek melee) — único tipo de enemigo en gameplay
      // IMPORTANTE: Registrar DESPUÉS de createEnemyRow para garantizar que
      // el modelo compartido del esqueleto ya esté cargado (carga síncrona via getSharedModelScene)
      enemyPool.registerEnemyType({
        type: EnemyType.Basic,
        stats: ENEMY_BASIC_STATS,
        initialCount: 5,
        maxSize: 30
      });
      console.log('🔴 EnemyPool inicializado con tipo basic');

      // Spawnear EnemyBasic via pool para testing (esqueletos rojos con seek AI)
      const basicPositions = [
        new THREE.Vector3(5, 0, 5),
        new THREE.Vector3(7, 0, 6),
        new THREE.Vector3(6, 0, 8),
        new THREE.Vector3(8, 0, 5),
        new THREE.Vector3(4, 0, 7),
      ];
      basicPositions.forEach(pos => {
        const enemy = enemyPool!.acquire(EnemyType.Basic, { position: pos });
        if (enemy) {
          console.log(`🔴 EnemyBasic spawneado en (${pos.x}, ${pos.y}, ${pos.z})`);
        }
      });
      console.log(`🔴 Spawneados ${basicPositions.length} EnemyBasic para testing`);
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

    // Actualizar enemigos del pool (EnemyBasic con seek AI)
    if (enemyPool) {
      enemyPool.update(dt, players);
    }

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

    // Actualizar posición de HP bars de jugadores (seguir al personaje)
    if (meleeCharacter) {
      const hpBar = playerHpBars.get('player1');
      if (hpBar && hpBar.visible) {
        const pos = meleeCharacter.getPosition();
        if (pos) {
          hpBar.position.copy(pos);
          hpBar.position.y += 2.2;
        }
      }
    }
    if (adcCharacter) {
      const hpBar = playerHpBars.get('player2');
      if (hpBar && hpBar.visible) {
        const pos = adcCharacter.getPosition();
        if (pos) {
          hpBar.position.copy(pos);
          hpBar.position.y += 2.2;
        }
      }
    }

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
