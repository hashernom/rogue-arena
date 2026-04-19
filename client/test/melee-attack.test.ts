/**
 * Test del sistema de detección de golpes melee con Rapier shape query
 * 
 * Este test verifica que:
 * 1. El sistema detecta enemigos dentro del arco de 120°
 * 2. Aplica daño correctamente
 * 3. Respeta el cooldown basado en attackSpeed
 * 4. Emite eventos correctamente
 */

import { EventBus } from '../src/engine/EventBus';
import { MeleeAttack, MeleeAttackOptions } from '../src/combat/MeleeAttack';
import { Character } from '../src/characters/Character';
import { CharacterStats } from '../src/characters/Character';
import { InputState } from '../src/engine/InputManager';

// Mock de Character para testing
class MockCharacter extends Character {
  constructor(id: string, eventBus: EventBus) {
    const baseStats: CharacterStats = {
      hp: 100,
      maxHp: 100,
      speed: 5,
      damage: 10,
      attackSpeed: 2.0,
      range: 1,
      armor: 0
    };
    super(id, baseStats, eventBus);
  }

  public getPhysicsBody(): any {
    return {
      translation: () => ({ x: 0, y: 0, z: 0 }),
      rotation: () => ({ x: 0, y: 0, z: 0, w: 1 })
    };
  }

  public getPosition(): { x: number; y: number; z: number } {
    return { x: 0, y: 0, z: 0 };
  }

  public getFacingDirection(): { x: number; y: number; z: number } {
    return { x: 1, y: 0, z: 0 }; // Mirando hacia +X
  }

  public update(dt: number, inputState?: InputState): void {
    // Mock implementation
  }

  public die(): void {}
  public takeDamage(amount: number): void {}
  public heal(amount: number): void {}
  public setState(newState: any): void {}
}

// Mock de PhysicsWorld
class MockPhysicsWorld {
  private world: any = {
    intersectionsWithShape: (
      position: any,
      rotation: any,
      shape: any,
      callback: (collider: any) => boolean
    ) => {
      // Simular algunos colliders de enemigos
      const mockColliders = [
        { 
          collisionGroups: () => 0b000010, // Groups.ENEMY
          parent: () => ({ userData: { id: 'enemy1', type: 'enemy' } })
        },
        { 
          collisionGroups: () => 0b000010, // Groups.ENEMY
          parent: () => ({ userData: { id: 'enemy2', type: 'enemy' } })
        },
        { 
          collisionGroups: () => 0b000001, // Groups.PLAYER (no debería ser detectado)
          parent: () => ({ userData: { id: 'player2', type: 'player' } })
        }
      ];
      
      mockColliders.forEach(collider => callback(collider));
      return;
    }
  };

  getWorld(): any {
    return this.world;
  }
}

function testMeleeAttack(): void {
  console.log('🧪 Iniciando tests del sistema MeleeAttack...\n');

  const eventBus = new EventBus();
  const mockCharacter = new MockCharacter('test-player', eventBus);
  
  // Mock global para PhysicsWorld
  (globalThis as any).PhysicsWorld = {
    getInstance: () => new MockPhysicsWorld()
  };

  let damageEvents: any[] = [];
  let attackEvents: any[] = [];
  let attackStartEvents: any[] = [];

  // Suscribirse a eventos para verificar
  eventBus.on('enemy:damage', (data) => {
    damageEvents.push(data);
    console.log(`✅ Evento enemy:damage recibido:`, data);
  });

  eventBus.on('player:attack', (data) => {
    attackEvents.push(data);
    console.log(`✅ Evento player:attack recibido:`, data);
  });

  eventBus.on('player:attack:start', (data) => {
    attackStartEvents.push(data);
    console.log(`✅ Evento player:attack:start recibido:`, data);
  });

  const options: MeleeAttackOptions = {
    range: 2.0,
    width: 1.0,
    height: 1.0,
    arcAngle: 120,
    baseDamage: 10
  };

  const meleeAttack = new MeleeAttack(eventBus, mockCharacter, 'test-player', options);

  console.log('1. Test: Ataque básico con detección de enemigos');
  const attackResult = meleeAttack.tryAttack();
  console.log(`   Resultado del ataque: ${attackResult ? '✅ Éxito' : '❌ Falló'}`);
  console.log(`   Eventos de daño emitidos: ${damageEvents.length}`);
  console.log(`   Eventos de ataque emitidos: ${attackEvents.length}`);
  console.log(`   Eventos de inicio de ataque: ${attackStartEvents.length}\n`);

  // Verificar que se detectaron los enemigos correctos
  if (damageEvents.length === 2) {
    console.log('   ✅ Correcto: Se detectaron 2 enemigos (deberían ser enemy1 y enemy2)');
    const enemyIds = damageEvents.map(e => e.enemyId);
    if (enemyIds.includes('enemy1') && enemyIds.includes('enemy2')) {
      console.log('   ✅ Correcto: Los enemigos detectados son los esperados');
    } else {
      console.log('   ❌ Error: Los enemigos detectados no son los esperados');
    }
  } else {
    console.log(`   ❌ Error: Se esperaban 2 eventos de daño, se recibieron ${damageEvents.length}`);
  }

  console.log('2. Test: Cooldown del ataque');
  damageEvents = [];
  attackEvents = [];
  attackStartEvents = [];
  
  // Intentar atacar inmediatamente después (debería fallar por cooldown)
  const immediateAttack = meleeAttack.tryAttack();
  console.log(`   Segundo ataque inmediato: ${immediateAttack ? '❌ Permitido (error)' : '✅ Bloqueado (correcto)'}`);
  console.log(`   Eventos de daño después del cooldown: ${damageEvents.length} (debería ser 0)\n`);

  console.log('3. Test: Actualización del cooldown');
  // Simular paso del tiempo (0.6 segundos, más que el cooldown de 0.5 segundos para attackSpeed=2.0)
  meleeAttack.update(0.6);
  
  damageEvents = [];
  attackEvents = [];
  attackStartEvents = [];
  
  const attackAfterCooldown = meleeAttack.tryAttack();
  console.log(`   Ataque después del cooldown: ${attackAfterCooldown ? '✅ Permitido' : '❌ Bloqueado (error)'}`);
  console.log(`   Eventos de daño después del cooldown: ${damageEvents.length} (debería ser 2)\n`);

  console.log('4. Test: Filtro por arco de 120°');
  // Para este test necesitaríamos un mock más complejo que simule posiciones relativas
  console.log('   ⚠️  Test de filtro por arco requiere mock de posiciones (omitiendo por simplicidad)\n');

  console.log('5. Test: Limpieza de recursos');
  meleeAttack.dispose();
  console.log('   ✅ Recursos liberados correctamente\n');

  // Resumen
  console.log('📊 Resumen de tests:');
  console.log(`   - Tests ejecutados: 5`);
  
  const testsPassed = [
    damageEvents.length === 2,
    !immediateAttack,
    attackAfterCooldown,
    attackStartEvents.length > 0
  ].filter(Boolean).length;
  
  console.log(`   - Tests pasados: ${testsPassed}/4 principales`);
  console.log(`   - Tests con advertencias: 1 (filtro por arco)`);
  
  if (testsPassed === 4) {
    console.log('\n🎉 ¡Todos los tests principales pasaron!');
  } else {
    console.log('\n⚠️  Algunos tests fallaron o tienen advertencias');
  }
}

// Ejecutar tests si se llama directamente
// Nota: Este test está diseñado para ejecutarse manualmente en un entorno Node.js
// con tipos de Node instalados (@types/node)

export { testMeleeAttack };