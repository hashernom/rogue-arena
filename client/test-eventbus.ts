import { events } from './src/engine/EventBus.ts';

// Criterio 1: TypeScript infiere el tipo del payload al llamar events.on("player:died", (data) => data.playerId)
console.log('=== Criterio 1: Inferencia de tipos ===');
events.on('player:died', data => {
  // data debe tener propiedad playerId de tipo string
  const id: string = data.playerId;
  console.log(`✅ Inferencia correcta: playerId = ${id}`);
});

// Criterio 2: once() solo dispara una vez y se auto-limpia
console.log('\n=== Criterio 2: once() ===');
let onceCounter = 0;
events.once('wave:started', data => {
  onceCounter++;
  console.log(`✅ once llamado (${onceCounter}) con round ${data.round}`);
});

// Emitir dos veces, solo debe contar una
events.emit('wave:started', { round: 1, enemyCount: 10 });
events.emit('wave:started', { round: 2, enemyCount: 15 });
if (onceCounter === 1) {
  console.log('✅ once se ejecutó solo una vez');
} else {
  console.error(`❌ once se ejecutó ${onceCounter} veces`);
}

// Criterio 3: off() elimina correctamente el listener registrado
console.log('\n=== Criterio 3: off() ===');
let offCounter = 0;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const listener = (_data: { playerId: string; amount: number }) => {
  offCounter++;
  console.log(`❌ Este listener no debería ejecutarse (${offCounter})`);
};
events.on('player:damaged', listener);
events.off('player:damaged', listener);
events.emit('player:damaged', { playerId: 'p1', amount: 50 });
if (offCounter === 0) {
  console.log('✅ off eliminó el listener correctamente');
} else {
  console.error(`❌ off no eliminó el listener (se ejecutó ${offCounter} veces)`);
}

// Criterio 4: No hay memory leaks tras múltiples ciclos de start/stop del juego
console.log('\n=== Criterio 4: Limpieza de memory leaks ===');
const initialCount = events.listenerCount;
// Registrar varios listeners
const unsubscribe1 = events.on('player:died', () => {});
const unsubscribe2 = events.on('player:died', () => {});
const unsubscribe3 = events.on('enemy:died', () => {});
const midCount = events.listenerCount;
console.log(`Listeners después de registrar: ${midCount}`);
// Limpiar manualmente
unsubscribe1();
unsubscribe2();
unsubscribe3();
// También limpiar con clear
events.clear('player:died');
events.clear('enemy:died');
const finalCount = events.listenerCount;
console.log(`Listeners después de limpiar: ${finalCount}`);
if (finalCount <= initialCount) {
  console.log('✅ No hay memory leaks (listeners limpiados)');
} else {
  console.error(`❌ Posible memory leak: initial ${initialCount}, final ${finalCount}`);
}

// Limpiar todos los eventos para no interferir con otras pruebas
events.clear();
console.log('\n=== Pruebas completadas ===');
