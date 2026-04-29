/**
 * Script de prueba para el sistema de salas (room system).
 * Simula dos clientes conectándose, creando sala, uniéndose,
 * seleccionando personajes e iniciando partida.
 *
 * Uso: npx tsx server/src/test-room-system.ts
 */
import { io as ioc, Socket } from 'socket.io-client';
import { SocketEvents } from '@rogue-arena/shared';

const SERVER_URL = 'http://localhost:3001';

// Colores para consola
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(prefix: string, msg: string, color = colors.reset) {
  console.log(`${color}[${prefix}]${colors.reset} ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log(`\n${colors.cyan}═══════════════════════════════════════${colors.reset}`);
  console.log(`${colors.cyan}  PRUEBAS DEL SISTEMA DE SALAS (2P)${colors.reset}`);
  console.log(`${colors.cyan}═══════════════════════════════════════${colors.reset}\n`);

  // ============================================================
  // Test 1: Conexión básica
  // ============================================================
  console.log(`\n${colors.yellow}── Test 1: Conexión básica ──${colors.reset}\n`);

  const p1: Socket = ioc(SERVER_URL);
  const p2: Socket = ioc(SERVER_URL);

  await new Promise<void>((resolve) => {
    p1.on('connect', () => {
      log('P1', `Conectado: ${p1.id}`, colors.green);
      resolve();
    });
  });

  await new Promise<void>((resolve) => {
    p2.on('connect', () => {
      log('P2', `Conectado: ${p2.id}`, colors.green);
      resolve();
    });
  });

  await sleep(500);

  // ============================================================
  // Test 2: Crear sala
  // ============================================================
  console.log(`\n${colors.yellow}── Test 2: Crear sala ──${colors.reset}\n`);

  const roomCode = await new Promise<string>((resolve, reject) => {
    p1.emit('room:create', { playerName: 'Jugador1' }, (res: any) => {
      if (res.success) {
        log('P1', `Sala creada con código: ${colors.cyan}${res.code}${colors.reset}`, colors.green);
        resolve(res.code);
      } else {
        log('P1', `Error al crear sala: ${res.error}`, colors.red);
        reject(res.error);
      }
    });
  });

  await sleep(500);

  // ============================================================
  // Test 3: Unirse a sala
  // ============================================================
  console.log(`\n${colors.yellow}── Test 3: Unirse a sala por código ──${colors.reset}\n`);

  await new Promise<void>((resolve, reject) => {
    p2.emit('room:join', { code: roomCode, playerName: 'Jugador2' }, (res: any) => {
      if (res.success) {
        log('P2', `Se unió a sala ${roomCode}`, colors.green);
        resolve();
      } else {
        log('P2', `Error al unirse: ${res.error}`, colors.red);
        reject(res.error);
      }
    });
  });

  await sleep(500);

  // ============================================================
  // Test 4: Verificar room:ready
  // ============================================================
  console.log(`\n${colors.yellow}── Test 4: room:ready con 2 jugadores ──${colors.reset}\n`);

  await new Promise<void>((resolve) => {
    p1.on('room:ready', (data: any) => {
      log('P1', `room:ready recibido - ${data.message}`, colors.cyan);
      log('P1', `Jugadores: ${data.players.map((p: any) => p.name).join(', ')}`, colors.blue);
      resolve();
    });
  });

  await sleep(300);

  // ============================================================
  // Test 5: Selección de personajes
  // ============================================================
  console.log(`\n${colors.yellow}── Test 5: Selección de personajes ──${colors.reset}\n`);

  // P1 escucha la selección de P2
  p1.on('player:characterSelected', (data: any) => {
    log('P1', `${data.playerId} seleccionó: ${data.character}`, colors.blue);
  });

  // P2 escucha la selección de P1
  p2.on('player:characterSelected', (data: any) => {
    log('P2', `${data.playerId} seleccionó: ${data.character}`, colors.blue);
  });

  // P1 selecciona melee
  await new Promise<void>((resolve) => {
    p1.emit('player:selectCharacter', { character: 'melee' }, (res: any) => {
      log('P1', `Seleccionó melee: ${res.success ? '✅' : '❌'}`, colors.green);
      resolve();
    });
  });

  await sleep(300);

  // P2 selecciona adc
  await new Promise<void>((resolve) => {
    p2.emit('player:selectCharacter', { character: 'adc' }, (res: any) => {
      log('P2', `Seleccionó adc: ${res.success ? '✅' : '❌'}`, colors.green);
      resolve();
    });
  });

  await sleep(500);

  // ============================================================
  // Test 6: room:charactersReady
  // ============================================================
  console.log(`\n${colors.yellow}── Test 6: Ambos personajes listos ──${colors.reset}\n`);

  await new Promise<void>((resolve) => {
    p1.on('room:charactersReady', (data: any) => {
      log('P1', `charactersReady: ${data.message}`, colors.cyan);
      resolve();
    });
  });

  await sleep(500);

  // ============================================================
  // Test 7: Iniciar partida
  // ============================================================
  console.log(`\n${colors.yellow}── Test 7: Iniciar partida ──${colors.reset}\n`);

  await new Promise<void>((resolve) => {
    p1.emit('game:start', (res: any) => {
      if (res.success) {
        log('P1', `Partida iniciada ✅`, colors.green);
        resolve();
      } else {
        log('P1', `Error al iniciar: ${res.error}`, colors.red);
        resolve();
      }
    });
  });

  await sleep(1000);

  // ============================================================
  // Test 8: Verificar game:started y snapshot
  // ============================================================
  console.log(`\n${colors.yellow}── Test 8: Eventos de juego ──${colors.reset}\n`);

  await new Promise<void>((resolve) => {
    p1.on('game:started', (data: any) => {
      log('P1', `game:started - código: ${data.code}`, colors.cyan);
      resolve();
    });
  });

  await sleep(500);

  // Verificar snapshot del GameState
  p1.on(SocketEvents.GAME_STATE, (data: any) => {
    log('P1', `Snapshot recibido - wave: ${data.wave.round}, enemigos: ${data.enemies.length}`, colors.blue);
  });

  await sleep(2000);

  // ============================================================
  // Test 9: Probar validaciones
  // ============================================================
  console.log(`\n${colors.yellow}── Test 9: Validaciones ──${colors.reset}\n`);

  // Intentar unirse a sala inexistente
  await new Promise<void>((resolve) => {
    const p3: Socket = ioc(SERVER_URL);
    p3.on('connect', () => {
      p3.emit('room:join', { code: 'ZZZZZZ', playerName: 'Tester' }, (res: any) => {
        log('TEST', `Unirse a sala inexistente: ${res.success ? '❌ debería fallar' : '✅ ' + res.error}`, 
            res.success ? colors.red : colors.green);
        p3.close();
        resolve();
      });
    });
  });

  await sleep(300);

  // Intentar unirse a sala llena (P1 y P2 ya están)
  await new Promise<void>((resolve) => {
    const p4: Socket = ioc(SERVER_URL);
    p4.on('connect', () => {
      p4.emit('room:join', { code: roomCode, playerName: 'Intruso' }, (res: any) => {
        log('TEST', `Unirse a sala llena: ${res.success ? '❌ debería fallar' : '✅ ' + res.error}`,
            res.success ? colors.red : colors.green);
        p4.close();
        resolve();
      });
    });
  });

  await sleep(1000);

  // ============================================================
  // Test 10: Desconexión de P1
  // ============================================================
  console.log(`\n${colors.yellow}── Test 10: Desconexión de P1 en lobby ──${colors.reset}\n`);

  // Crear nueva sala para probar desconexión
  const roomCode2 = await new Promise<string>((resolve) => {
    p1.emit('room:create', { playerName: 'Host' }, (res: any) => {
      if (res.success) {
        log('TEST', `Nueva sala creada: ${res.code}`, colors.blue);
        resolve(res.code);
      }
    });
  });

  await sleep(300);

  // P2 se une
  await new Promise<void>((resolve) => {
    p2.emit('room:join', { code: roomCode2, playerName: 'Guest' }, (res: any) => {
      log('TEST', `P2 unido: ${res.success}`, colors.blue);
      resolve();
    });
  });

  await sleep(300);

  // P2 escucha room:closed
  await new Promise<void>((resolve) => {
    p2.on('room:closed', (data: any) => {
      log('P2', `room:closed - razón: "${data.reason}" ✅`, colors.green);
      resolve();
    });

    // P1 se desconecta (simula cierre de pestaña)
    log('TEST', 'P1 desconectándose...', colors.yellow);
    p1.close();
  });

  await sleep(1000);

  // ============================================================
  // Resultados
  // ============================================================
  console.log(`\n${colors.cyan}═══════════════════════════════════════${colors.reset}`);
  console.log(`${colors.green}  ✅ TODAS LAS PRUEBAS COMPLETADAS${colors.reset}`);
  console.log(`${colors.cyan}═══════════════════════════════════════${colors.reset}\n`);

  // Limpiar
  p2.close();
  process.exit(0);
}

runTests().catch(err => {
  console.error('Error en pruebas:', err);
  process.exit(1);
});
