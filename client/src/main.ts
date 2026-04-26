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
import { Character } from './characters/Character';
import { MeleeCharacter } from './characters/MeleeCharacter';
import { AdcCharacter } from './characters/AdcCharacter';
import { EnemyPool } from './enemies/EnemyPool';
import { Enemy, EnemyType } from './enemies/Enemy';
import { ENEMY_BASIC_STATS } from './enemies/EnemyBasic';
import { ENEMY_FAST_STATS } from './enemies/EnemyFast';
import { ENEMY_TANK_STATS, ensureWarriorModelLoaded } from './enemies/EnemyTank';
import { ENEMY_RANGED_STATS, ensureMageModelLoaded } from './enemies/EnemyRanged';
import { MINIBOSS_STATS, ensureMiniBossModelLoaded } from './enemies/MiniBoss';
import { DamagePipeline } from './combat/DamagePipeline';
import { DamageNumberSystem } from './combat/DamageNumber';
import { ProjectilePool } from './combat/ProjectilePool';
import RAPIER from '@dimforge/rapier3d-compat';
import { WaveManager, WaveState } from './waves/WaveManager';
import { Spawner } from './waves/Spawner';
import { MoneySystem } from './progression/MoneySystem';
import { Shop } from './progression/Shop';
import { UpgradeApplier } from './progression/UpgradeApplier';
import { PassiveEffects } from './progression/PassiveEffects';
import type { ItemsCatalog, ItemDefinition } from '../../shared/src/types/Items';

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
// Pool de proyectiles para enemigos a distancia
let enemyProjectilePool: ProjectilePool | null = null;
// Pipeline centralizado de daño (compartido entre todos los sistemas)
let damagePipeline: DamagePipeline | null = null;
// Sistema de números de daño flotantes
let damageNumberSystem: DamageNumberSystem | null = null;
// Gestor de oleadas
let waveManager: WaveManager | null = null;
// Sistema de economía individual por jugador
let moneySystem: MoneySystem | null = null;
// Catálogo de ítems cargado desde JSON
let itemCatalog: ItemsCatalog | null = null;
// Tienda entre rondas
let shop: Shop | null = null;
// Aplicador de efectos de ítems
let upgradeApplier: UpgradeApplier | null = null;
// Efectos reactivos de ítems (onKill, onHit, onLowHP)
let passiveEffects: PassiveEffects | null = null;
// Spawner visual con indicadores en el suelo
let spawner: Spawner | null = null;
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
    // Cargar catálogo de ítems desde JSON (declarativo, extensible sin modificar código)
    try {
      const response = await fetch('/assets/items.json');
      itemCatalog = await response.json() as ItemsCatalog;
      console.log(`📦 Catálogo de ítems cargado: ${itemCatalog.items.length} ítems definidos`);
    } catch (itemError) {
      console.warn('⚠️ No se pudo cargar items.json, catálogo vacío:', itemError);
      itemCatalog = { items: [] };
    }

    console.log('🔄 Inicializando Rapier3D WASM...');
    physicsWorld = await PhysicsWorld.init();
    console.log('✅ Rapier3D WASM cargado y PhysicsWorld listo');

    // Crear cuerpos físicos para los jugadores y el plano
    if (physicsWorld) {
      // Plano estático (suelo) - cuboide delgado SIN rotación para evitar
      // que el collider invada el espacio de juego (y=0).
      // El mesh de Three.js tiene rotation.x = -PI/2 para verse horizontal,
      // pero el collider de Rapier debe estar alineado a ejes para no atrapar
      // a los enemigos dinámicos dentro de él.
      const planeCollider = RAPIER.ColliderDesc.cuboid(200, 0.01, 200); // half-extents delgado
      planeBodyHandle = physicsWorld.createBody({
        type: 'static',
        position: new THREE.Vector3(plane.position.x, plane.position.y, plane.position.z),
        // Sin rotación — el collider queda como cuboide delgado horizontal en y=-2
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
// NOTA: No sincronizamos el mesh del plano con Rapier porque:
// 1. El collider no tiene rotación (cuboide alineado a ejes)
// 2. El mesh tiene rotation.x = -PI/2 para verse horizontal
// 3. syncToThree sobrescribiría la rotación visual del mesh
// 4. Al ser static, su posición nunca cambia

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

      // Precargar modelo compartido del esqueleto Minion antes de crear instancias de EnemyBasic
      await Enemy.ensureModelLoaded();
      console.log('✅ Modelo compartido de esqueleto Minion precargado');

      // Precargar modelo del Warrior para EnemyTank
      await ensureWarriorModelLoaded();
      console.log('✅ Modelo Warrior precargado para EnemyTank');

      // Precargar modelo del Mage para EnemyRanged
      await ensureMageModelLoaded();
      console.log('✅ Modelo Mage precargado para EnemyRanged');

      // Precargar modelo del Warrior para MiniBoss
      await ensureMiniBossModelLoaded();
      console.log('✅ Modelo Warrior precargado para MiniBoss');

      // Crear pool de proyectiles para enemigos a distancia
      enemyProjectilePool = new ProjectilePool(physicsWorld, scene, eventBus, 30);
      // Compartir el pipeline de daño con los proyectiles del pool
      if (damagePipeline) {
        enemyProjectilePool.setDamagePipeline(damagePipeline);
      }
      console.log('🎯 ProjectilePool para enemigos creado con 30 proyectiles');

      // Inicializar EnemyPool para gestión eficiente de instancias de enemigos
      enemyPool = new EnemyPool(eventBus, sceneManager, physicsWorld, enemyProjectilePool);
      
      // Registrar tipo de enemigo básico (seek melee)
      enemyPool.registerEnemyType({
        type: EnemyType.Basic,
        stats: ENEMY_BASIC_STATS,
        initialCount: 5,
        maxSize: 30
      });
      console.log('🔴 EnemyPool inicializado con tipo basic');

      // Registrar tipo de enemigo veloz (flanqueador, prioriza ADC)
      enemyPool.registerEnemyType({
        type: EnemyType.Fast,
        stats: ENEMY_FAST_STATS,
        initialCount: 3,
        maxSize: 20
      });
      console.log('🔵 EnemyPool inicializado con tipo fast');

      // Registrar tipo de enemigo tanque (alta vida, lento, mucho daño, inmune a knockback)
      enemyPool.registerEnemyType({
        type: EnemyType.Tank,
        stats: ENEMY_TANK_STATS,
        initialCount: 2,
        maxSize: 10
      });
      console.log('🟤 EnemyPool inicializado con tipo tank');

      // Registrar tipo de enemigo a distancia (kiting AI, proyectiles)
      enemyPool.registerEnemyType({
        type: EnemyType.Ranged,
        stats: ENEMY_RANGED_STATS,
        initialCount: 3,
        maxSize: 15
      });
      console.log('🔴 EnemyPool inicializado con tipo ranged');

      // Registrar tipo de enemigo mini-boss (jefe de oleadas especiales)
      enemyPool.registerEnemyType({
        type: EnemyType.MiniBoss,
        stats: MINIBOSS_STATS,
        initialCount: 1,
        maxSize: 3
      });
      console.log('🟣 EnemyPool inicializado con tipo mini_boss');

      // ================================================================
      // SISTEMA DE ECONOMÍA (MoneySystem)
      // ================================================================
      // Crear sistema de dinero individual por jugador
      // Se suscribe automáticamente a enemy:died para recompensas por kills
      moneySystem = new MoneySystem(eventBus);
      console.log('💰 MoneySystem inicializado (economía individual por jugador)');

      // ================================================================
      // SISTEMA DE TIENDA (Shop + UpgradeApplier + PassiveEffects)
      // ================================================================
      // Crear sistema de efectos reactivos de ítems (onKill, onHit, onLowHP)
      passiveEffects = new PassiveEffects(eventBus);
      console.log('⚡ PassiveEffects inicializado (efectos reactivos de ítems)');

      // Crear aplicador de efectos de ítems
      upgradeApplier = new UpgradeApplier();

      // Crear tienda entre rondas si hay catálogo de ítems
      if (itemCatalog && itemCatalog.items.length > 0) {
        shop = new Shop(moneySystem, upgradeApplier, passiveEffects, itemCatalog, eventBus);
        console.log(`🏪 Shop inicializado con ${itemCatalog.items.length} ítems en catálogo`);
      } else {
        console.warn('⚠️ No se pudo inicializar la tienda: catálogo de ítems vacío');
      }

      // ================================================================
      // SISTEMA DE OLEADAS (WaveManager + Spawner)
      // ================================================================
      // Crear Spawner visual con indicadores en el suelo
      spawner = new Spawner(sceneManager, enemyPool);

      // Crear WaveManager que orquesta el progreso de rondas
      waveManager = new WaveManager(eventBus, spawner);

      // Vincular MoneySystem al WaveManager para recompensas de ronda
      waveManager.setMoneySystem(moneySystem);

      // Pasar referencias de los personajes al WaveManager para curación entre rondas
      const playerCharacters: Character[] = [];
      if (meleeCharacter) playerCharacters.push(meleeCharacter);
      if (adcCharacter) playerCharacters.push(adcCharacter);
      waveManager.setPlayers(playerCharacters);
      console.log('👥 Personajes vinculados al WaveManager para curación entre rondas');

      // Vincular personajes al MoneySystem para verificar efectos como doubleDropNextWave
      moneySystem.setPlayers(playerCharacters);
      console.log('👥 Personajes vinculados al MoneySystem para efectos de ítems');

      // Suscribirse a enemy:died para notificar al WaveManager
      eventBus.on('enemy:died', () => {
        waveManager?.onEnemyDied();
      });

      // ================================================================
      // EVENTOS DE LA TIENDA
      // ================================================================
      // Cuando se abre la tienda, generar ofertas para ambos jugadores
      eventBus.on('shop:opened', () => {
        if (!shop || !waveManager) return;

        const round = waveManager.getCurrentRound();

        // Generar ofertas independientes para cada jugador
        const p1Offer = shop.generateOffer('player1', round);
        const p2Offer = shop.generateOffer('player2', round);

        console.log(
          `🏪 Tienda abierta (ronda ${round}): P1 ve ${p1Offer.length} ítems, P2 ve ${p2Offer.length} ítems`
        );
      });

      // Cuando se cierra la tienda (nueva ronda), limpiar ofertas no compradas
      eventBus.on('shop:closed', () => {
        if (!shop) return;
        shop.clearOffers();
        console.log('🏪 Tienda cerrada — ofertas no compradas descartadas');
      });

      // ================================================================
      // LIMPIEZA DE EFECTOS REACTIVOS EN GAME OVER
      // ================================================================
      // Cuando un jugador muere, limpiar todos los efectos reactivos
      // para evitar memory leaks en la próxima partida
      eventBus.on('player:died', () => {
        if (passiveEffects) {
          passiveEffects.unregisterAll();
          console.log('🧹 Efectos reactivos limpiados por muerte de jugador');
        }
      });

      // Iniciar el juego con oleadas (ronda 1 automáticamente)
      waveManager.startGame();
      console.log('🌊 WaveManager + Spawner iniciados con sistema de oleadas');
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

    // Actualizar WaveManager (timers entre rondas)
    if (waveManager) {
      waveManager.update(dt);
    }

    // Manejar ready-up entre rondas
    // isKeyJustPressed ya es flanco de subida (solo true 1 frame)
    if (waveManager && waveManager.getState() === WaveState.BetweenRound) {
      // Player 1: tecla R
      if (inputManager.isKeyJustPressed('KeyR')) {
        waveManager.setPlayerReady(0);
        console.log('[Ready] Player 1 listo');
      }

      // Player 2: tecla /
      if (inputManager.isKeyJustPressed('Slash')) {
        waveManager.setPlayerReady(1);
        console.log('[Ready] Player 2 listo');
      }

      // ================================================================
      // COMPRA EN LA TIENDA
      // ================================================================
      // Player 1: teclas 1, 2, 3 para comprar ítems de su oferta
      if (inputManager.isKeyJustPressed('Digit1')) {
        executePurchase('player1', 0);
      }
      if (inputManager.isKeyJustPressed('Digit2')) {
        executePurchase('player1', 1);
      }
      if (inputManager.isKeyJustPressed('Digit3')) {
        executePurchase('player1', 2);
      }

      // Player 2: teclas J, K, L (evita F1-F3 que el navegador intercepta)
      if (inputManager.isKeyJustPressed('KeyJ')) {
        executePurchase('player2', 0);
      }
      if (inputManager.isKeyJustPressed('KeyK')) {
        executePurchase('player2', 1);
      }
      if (inputManager.isKeyJustPressed('KeyL')) {
        executePurchase('player2', 2);
      }
    }

    // Actualizar Spawner (indicadores visuales, animaciones de spawn)
    if (spawner) {
      spawner.update(dt);
    }

    // Actualizar números de daño flotantes
    if (damageNumberSystem) {
      damageNumberSystem.update(dt);
    }

    // Avanzar simulación física PRIMERO
    // Los proyectiles necesitan que stepAll() se ejecute antes para que
    // sus cuerpos dinámicos tengan posiciones actualizadas al hacer
    // las overlap queries de detección de colisiones.
    if (physicsWorld) {
      physicsWorld.stepAll(dt);
    }

    // Actualizar proyectiles enemigos DESPUÉS del step físico
    // para que las overlap queries usen posiciones actualizadas.
    // También pasar los players como targets para distance check directo.
    if (enemyProjectilePool) {
      enemyProjectilePool.update(dt, players.map(p => ({
        entity: p,
        getPosition: () => p.getPosition(),
      })));
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

    // Actualizar barra superior de monedas (siempre visible)
    updateTopBar();

    // Mostrar HUD de entre-roundas (timer + ready-up + tienda)
    if (waveManager) {
      displayBetweenRoundHud(waveManager);
    }

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

// =================================================================
// SISTEMA DE NOTIFICACIONES TOAST
// =================================================================

// Contenedor global de notificaciones (se crea una vez)
let notificationContainer: HTMLDivElement | null = null;

/**
 * Muestra una notificación toast animada en la pantalla.
 * Crea un contenedor persistente para evitar problemas de stacking context.
 * @param message - Mensaje a mostrar
 * @param type - Tipo de notificación (success, error, info)
 */
function showNotification(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
  // Crear contenedor si no existe
  if (!notificationContainer) {
    notificationContainer = document.createElement('div');
    notificationContainer.id = 'notification-container';
    Object.assign(notificationContainer.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      bottom: '0',
      pointerEvents: 'none',
      zIndex: '2147483647', // max z-index posible
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'flex-start',
      paddingTop: '80px',
    });
    document.body.appendChild(notificationContainer);
  }

  const colors = {
    success: { bg: 'rgba(0, 200, 83, 0.95)', border: '#00c853', icon: '✓' },
    error: { bg: 'rgba(255, 68, 68, 0.95)', border: '#ff4444', icon: '✗' },
    info: { bg: 'rgba(68, 170, 255, 0.95)', border: '#44aaff', icon: 'ℹ' },
  };
  const c = colors[type];

  const toast = document.createElement('div');
  toast.textContent = `${c.icon} ${message}`;
  Object.assign(toast.style, {
    background: c.bg,
    color: '#fff',
    fontFamily: 'monospace',
    fontSize: '15px',
    fontWeight: 'bold',
    padding: '12px 28px',
    borderRadius: '10px',
    border: `2px solid ${c.border}`,
    boxShadow: '0 6px 30px rgba(0,0,0,0.7)',
    opacity: '0',
    transform: 'translateY(-30px) scale(0.9)',
    transition: 'opacity 0.25s ease, transform 0.25s ease',
    whiteSpace: 'nowrap',
    textShadow: '0 1px 3px rgba(0,0,0,0.5)',
  });

  notificationContainer.appendChild(toast);

  // Animar entrada
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0) scale(1)';
  });

  // Remover después de 2.5s
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-30px) scale(0.9)';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// =================================================================
// BARRA SUPERIOR DE ESTADO (MONEDAS PERMANENTES)
// =================================================================

/**
 * Crea o actualiza la barra superior con los contadores de monedas de cada jugador.
 */
function updateTopBar(): void {
  let topBar = document.getElementById('top-status-bar');
  if (!topBar) {
    topBar = document.createElement('div');
    topBar.id = 'top-status-bar';
    Object.assign(topBar.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      height: '44px',
      background: 'linear-gradient(180deg, rgba(10,10,10,0.95) 0%, rgba(10,10,10,0.8) 100%)',
      borderBottom: '1px solid rgba(255,170,0,0.2)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '0 24px',
      zIndex: '2000',
      fontFamily: 'monospace',
      fontSize: '14px',
      backdropFilter: 'blur(8px)',
      boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
    });
    topBar.innerHTML = `
      <div id="topbar-p1" style="display:flex;align-items:center;gap:8px;color:#ffaa00;">
        <span style="font-weight:bold;">P1</span>
        <span id="coin-p1" style="color:#ffd700;">0</span>
        <span style="color:#ffd700;font-size:12px;">g</span>
      </div>
      <div style="display:flex;align-items:center;gap:16px;">
        <span id="topbar-round" style="color:#888;font-size:12px;">RONDA 0</span>
      </div>
      <div id="topbar-p2" style="display:flex;align-items:center;gap:8px;color:#44aaff;">
        <span style="font-weight:bold;">P2</span>
        <span id="coin-p2" style="color:#ffd700;">0</span>
        <span style="color:#ffd700;font-size:12px;">g</span>
      </div>
    `;
    document.body.appendChild(topBar);
  }

  // Actualizar valores
  const p1Balance = moneySystem?.getBalance('player1') ?? 0;
  const p2Balance = moneySystem?.getBalance('player2') ?? 0;
  const p1El = document.getElementById('coin-p1');
  const p2El = document.getElementById('coin-p2');
  const roundEl = document.getElementById('topbar-round');

  if (p1El) p1El.textContent = String(p1Balance);
  if (p2El) p2El.textContent = String(p2Balance);
  if (roundEl && waveManager) {
    roundEl.textContent = `RONDA ${waveManager.getCurrentRound()}`;
  }
}

// =================================================================
// FUNCIÓN GLOBAL DE COMPRA (usada por teclas y click en cards del shop)
// =================================================================
function executePurchase(playerId: string, itemIndex: number): void {
  if (!shop) {
    console.log(`[Shop] shop es null, no se puede comprar`);
    showNotification(`Tienda no disponible`, 'error');
    return;
  }
  const items = shop.getOfferItems(playerId);
  console.log(`[Shop] ${playerId} intenta comprar item[${itemIndex}], items disponibles: ${items.length}`);
  if (items.length <= itemIndex) {
    console.log(`[Shop] ${playerId} no hay item en índice ${itemIndex}`);
    showNotification(`No hay oferta disponible`, 'error');
    return;
  }
  const character = playerId === 'player1' ? meleeCharacter : adcCharacter;
  if (!character) {
    console.log(`[Shop] ${playerId} character es null`);
    showNotification(`Personaje no disponible`, 'error');
    return;
  }
  const result = shop.purchase(playerId, items[itemIndex].id, character);
  console.log(`[Shop] ${playerId} compra: ${result.message} (success=${result.success})`);
  if (result.success) {
    showNotification(`${playerId === 'player1' ? 'P1' : 'P2'}: ${result.message}`, 'success');
    // Marcar visualmente la card como comprada
    const card = document.querySelector(
      `.shop-item-card[data-player="${playerId}"][data-index="${itemIndex}"]`
    ) as HTMLElement | null;
    if (card) {
      card.style.opacity = '0.3';
      card.style.borderColor = '#00c853';
      card.style.background = 'rgba(0,200,83,0.08)';
      card.style.cursor = 'default';
      card.style.pointerEvents = 'none';
      // Mostrar "COMPRADO" dentro de la card
      const boughtBadge = document.createElement('div');
      boughtBadge.textContent = '✓ COMPRADO';
      Object.assign(boughtBadge.style, {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        color: '#00c853',
        fontSize: '13px',
        fontWeight: 'bold',
        textShadow: '0 0 10px rgba(0,200,83,0.5)',
        letterSpacing: '1px',
      });
      card.style.position = 'relative';
      card.appendChild(boughtBadge);
    }
    // Actualizar top bar inmediatamente
    updateTopBar();
  } else {
    showNotification(`${playerId === 'player1' ? 'P1' : 'P2'}: ${result.message}`, 'error');
  }
}

// Exponer globalmente para onclick en HTML del shop
window.buyItem = executePurchase;

// =================================================================
// HUD DE ENTRE RONDAS (REDISEÑADO)
// =================================================================

/**
 * Renderiza las tarjetas de ítems de la tienda para un jugador.
 */
function renderShopItems(playerId: string, label: string, items: ItemDefinition[], balance: number): string {
  if (items.length === 0) {
    return `
      <div class="shop-panel-empty" style="
        min-width:260px; padding:16px; text-align:center;
        background:rgba(255,255,255,0.03); border-radius:10px;
        border:1px dashed rgba(255,255,255,0.1);
      ">
        <div style="font-size:13px;color:#666;margin-bottom:4px;">${label}</div>
        <div style="font-size:11px;color:#444;">— sin oferta —</div>
      </div>`;
  }

  const keyHints: Record<string, string[]> = {
    'player1': ['1', '2', '3'],
    'player2': ['J', 'K', 'L'],
  };
  const keys = keyHints[playerId] || ['?', '?', '?'];

  let html = `
    <div class="shop-panel" style="
      min-width:260px; flex:1;
      background:linear-gradient(180deg, rgba(20,20,30,0.9) 0%, rgba(10,10,18,0.95) 100%);
      border-radius:12px; padding:16px;
      border:1px solid rgba(255,170,0,0.15);
      box-shadow:0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05);
    ">
      <div style="
        display:flex; justify-content:space-between; align-items:center;
        margin-bottom:12px; padding-bottom:8px;
        border-bottom:1px solid rgba(255,255,255,0.06);
      ">
        <span style="font-size:13px;font-weight:bold;color:${playerId === 'player1' ? '#ffaa00' : '#44aaff'};text-transform:uppercase;letter-spacing:1px;">
          ${label}
        </span>
        <span style="font-size:13px;color:#ffd700;">
          🪙 ${balance}
        </span>
      </div>`;

  items.forEach((item, index) => {
    const canAfford = balance >= item.price;
    const itemColor = playerId === 'player1' ? '#ffaa00' : '#44aaff';
    html += `
      <div class="shop-item-card" data-player="${playerId}" data-index="${index}" data-can-afford="${canAfford}" style="
        display:flex; flex-direction:column; gap:4px;
        padding:10px 12px; margin-bottom:8px;
        background:${canAfford ? 'rgba(255,255,255,0.04)' : 'rgba(255,68,68,0.04)'};
        border-radius:8px;
        border:1px solid ${canAfford ? 'rgba(255,255,255,0.08)' : 'rgba(255,68,68,0.1)'};
        opacity:${canAfford ? 1 : 0.45};
        cursor:${canAfford ? 'pointer' : 'not-allowed'};
        transition:all 0.2s ease;
        position:relative;
        overflow:hidden;
      "
      onclick="window.buyItem('${playerId}', ${index})"
      onmouseenter="this.style.borderColor='${canAfford ? itemColor : 'rgba(255,68,68,0.2)'}';this.style.background='${canAfford ? 'rgba(255,255,255,0.08)' : 'rgba(255,68,68,0.06)'}';this.style.transform='${canAfford ? 'translateX(4px)' : 'none'}'"
      onmouseleave="this.style.borderColor='${canAfford ? 'rgba(255,255,255,0.08)' : 'rgba(255,68,68,0.1)'}';this.style.background='${canAfford ? 'rgba(255,255,255,0.04)' : 'rgba(255,68,68,0.04)'}';this.style.transform='none'"
      >
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:14px;font-weight:bold;color:#fff;">${item.name}</span>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:13px;color:#ffd700;font-weight:bold;">${item.price}g</span>
            <span style="
              font-size:10px;font-weight:bold;
              background:${canAfford ? 'rgba(255,170,0,0.15)' : 'rgba(255,68,68,0.2)'};
              color:${canAfford ? '#ffaa00' : '#ff4444'};
              padding:2px 6px; border-radius:4px;
            ">[${keys[index]}]</span>
          </div>
        </div>
        <div style="font-size:11px;color:#999;line-height:1.4;">${item.description}</div>
      </div>`;
  });

  html += `</div>`;
  return html;
}

/**
 * Crea el elemento HUD de entre rondas una sola vez con estructura estática.
 * Los valores dinámicos se actualizan por ID sin reemplazar el DOM.
 */
function createBetweenRoundHud(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'between-round-hud';
  Object.assign(el.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    bottom: '0',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    visibility: 'hidden',
    opacity: '0',
    transition: 'opacity 0.25s ease',
    zIndex: '1500',
    background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.7) 100%)',
    backdropFilter: 'blur(4px)',
    fontFamily: 'monospace',
  });

  // Estructura HTML estática con IDs para actualización dinámica
  el.innerHTML = `
    <div id="hud-panel" style="
      max-width:820px; width:90%; max-height:90vh; overflow-y:auto;
      background:linear-gradient(180deg, rgba(15,15,25,0.97) 0%, rgba(8,8,16,0.98) 100%);
      border-radius:16px; padding:28px 32px;
      border:1px solid rgba(255,170,0,0.2);
      box-shadow:0 20px 60px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06);
    ">
      <div style="text-align:center; margin-bottom:20px;">
        <div style="font-size:12px; color:#888; text-transform:uppercase; letter-spacing:2px; margin-bottom:4px;">
          Preparando ronda
        </div>
        <div id="hud-round" style="font-size:42px; font-weight:bold; color:#ffaa00; line-height:1; margin-bottom:4px;">0</div>
        <div id="hud-timer" style="font-size:28px; color:#fff; margin-bottom:12px; font-weight:300;">0<span style="font-size:16px;color:#888;">s</span></div>
        <div style="display:flex; justify-content:center; gap:24px; font-size:13px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="color:#ffaa00;font-weight:bold;">P1</span>
            <span id="hud-ready-p1" onclick="window.setPlayerReady(0)" style="cursor:pointer;color:#ff6644;background:rgba(255,68,68,0.1);padding:2px 8px;border-radius:4px;font-size:11px;">[R]</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="color:#44aaff;font-weight:bold;">P2</span>
            <span id="hud-ready-p2" onclick="window.setPlayerReady(1)" style="cursor:pointer;color:#ff6644;background:rgba(255,68,68,0.1);padding:2px 8px;border-radius:4px;font-size:11px;">[/]</span>
          </div>
        </div>
      </div>

      <div id="hud-shop-container" style="display:flex; gap:16px; justify-content:center; flex-wrap:wrap;">
        <!-- Se rellena dinámicamente solo cuando cambia la oferta -->
      </div>

      <div style="text-align:center; margin-top:16px; font-size:11px; color:#555;">
        Presiona <span style="color:#888;">[R]</span> (P1) o <span style="color:#888;">[/]</span> (P2) cuando estés listo
      </div>
    </div>
  `;

  document.body.appendChild(el);
  return el;
}

// Cache de la última oferta para evitar re-renderizar el shop si no cambió
let lastShopOffer: string = '';

/**
 * Actualiza solo los valores dinámicos del HUD sin reemplazar el DOM completo.
 */
function displayBetweenRoundHud(wm: WaveManager): void {
  const hudElement = document.getElementById('between-round-hud') ?? createBetweenRoundHud();
  const isBetweenRound = wm.getState() === WaveState.BetweenRound;

  if (isBetweenRound) {
    hudElement.style.visibility = 'visible';
    hudElement.style.opacity = '1';

    // Actualizar solo texto del timer y ronda (operaciones baratas)
    const timer = Math.ceil(wm.getBetweenRoundTimer());
    const roundEl = document.getElementById('hud-round');
    const timerEl = document.getElementById('hud-timer');
    if (roundEl) roundEl.textContent = String(wm.getCurrentRound() + 1);
    if (timerEl) timerEl.innerHTML = `${timer}<span style="font-size:16px;color:#888;">s</span>`;

    // Actualizar estado de ready
    const readyState = wm.getReadyState();
    const p1ReadyEl = document.getElementById('hud-ready-p1');
    const p2ReadyEl = document.getElementById('hud-ready-p2');
    if (p1ReadyEl) {
      p1ReadyEl.textContent = readyState.player1Ready ? '✓ LISTO' : '[R]';
      p1ReadyEl.style.color = readyState.player1Ready ? '#00c853' : '#ff6644';
      p1ReadyEl.style.background = readyState.player1Ready ? 'transparent' : 'rgba(255,68,68,0.1)';
    }
    if (p2ReadyEl) {
      p2ReadyEl.textContent = readyState.player2Ready ? '✓ LISTO' : '[/]';
      p2ReadyEl.style.color = readyState.player2Ready ? '#00c853' : '#ff6644';
      p2ReadyEl.style.background = readyState.player2Ready ? 'transparent' : 'rgba(255,68,68,0.1)';
    }

    // Actualizar shop solo si la oferta cambió (para preservar badges de "COMPRADO")
    const p1Items = shop?.getOfferItems('player1') ?? [];
    const p2Items = shop?.getOfferItems('player2') ?? [];
    const p1Balance = moneySystem?.getBalance('player1') ?? 0;
    const p2Balance = moneySystem?.getBalance('player2') ?? 0;
    const offerKey = JSON.stringify({ p1: p1Items.map(i => i.id), p2: p2Items.map(i => i.id), p1b: p1Balance, p2b: p2Balance });

    if (offerKey !== lastShopOffer) {
      lastShopOffer = offerKey;
      const container = document.getElementById('hud-shop-container');
      if (container) {
        container.innerHTML =
          renderShopItems('player1', 'P1 — Tienda', p1Items, p1Balance) +
          renderShopItems('player2', 'P2 — Tienda', p2Items, p2Balance);
      }
    }
  } else {
    hudElement.style.visibility = 'hidden';
    hudElement.style.opacity = '0';
  }
}

// =================================================================
// INYECTAR KEYFRAMES DE ANIMACIÓN
// =================================================================

(function injectHudStyles(): void {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes hudFadeIn {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }
    @keyframes coinPulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.15); }
    }
    .coin-updated {
      animation: coinPulse 0.3s ease;
    }
  `;
  document.head.appendChild(style);
})();

// =================================================================
// FUNCIONES DE DEBUG (SIN CAMBIOS)
// =================================================================

// Función para mostrar FPS en pantalla (solo desarrollo)
function displayFps(fps: number): void {
  let fpsElement = document.getElementById('fps-counter');
  if (!fpsElement) {
    fpsElement = document.createElement('div');
    fpsElement.id = 'fps-counter';
    Object.assign(fpsElement.style, {
      position: 'fixed',
      top: '52px',
      right: '10px',
      color: '#00ff88',
      fontFamily: 'monospace',
      fontSize: '12px',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      padding: '4px 8px',
      borderRadius: '4px',
      zIndex: '1000',
    });
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
    Object.assign(inputElement.style, {
      position: 'fixed',
      right: '10px',
      color: playerId === 1 ? '#ffaa00' : '#44aaff',
      fontFamily: 'monospace',
      fontSize: '11px',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      padding: '4px 8px',
      borderRadius: '4px',
      zIndex: '1000',
    });
    inputElement.style.top = playerId === 1 ? '70px' : '90px';
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

  window.setPlayerReady = (playerIndex: number) => {
    if (waveManager && waveManager.getState() === WaveState.BetweenRound) {
      waveManager.setPlayerReady(playerIndex);
      console.log(`[Ready] Player ${playerIndex + 1} listo (click)`);
    }
  };
}

// Tipos globales para HMR y funciones del juego
declare global {
  interface Window {
    changeCubeColor: (color: number) => void;
    changeRotationSpeed: (speed: number) => void;
    buyItem: (playerId: string, itemIndex: number) => void;
    setPlayerReady: (playerIndex: number) => void;
  }
}

console.log('✅ Three.js scene initialized with SceneManager');
console.log('🎮 Rogue Arena Client - Vite + Three.js');
console.log('🔄 HMR ready - Try: changeCubeColor(0xff0000) in console');
console.log('🌄 SceneManager active: shadows enabled, low‑poly fog, optimized renderer');
console.log('📐 CameraController active: isometric OrthographicCamera (frustumSize=20)');
