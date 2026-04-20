import * as THREE from 'three';
import { Character, type CharacterStats, CharacterState } from '../characters/Character';
import type { PhysicsWorld, RigidBodyHandle } from '../physics/PhysicsWorld';
import { EventBus } from '../engine/EventBus';
import { SceneManager } from '../engine/SceneManager';
import { BodyFactory } from '../physics/BodyFactory';

/**
 * Enemigo de prueba minimalista para testing de colisiones y hitboxes.
 * Representa un enemigo básico con forma de cubo rojo, sin animaciones ni IA compleja.
 * Diseñado específicamente para probar el sistema de piercing del ADC.
 */
export class TestEnemy extends Character {
  /** Modelo visual del enemigo (cubo rojo) */
  private model: THREE.Mesh | null = null;
  /** Referencia al SceneManager para agregar/remover el modelo */
  private sceneManager: SceneManager;
  /** Color del enemigo (rojo por defecto) */
  private color: number;
  /** Tamaño del cubo */
  private size: number;

  /** Stats base del enemigo de prueba */
  static readonly BASE_STATS: CharacterStats = {
    hp: 50,
    maxHp: 50,
    speed: 0, // No se mueve
    damage: 0, // No ataca
    attackSpeed: 0,
    range: 0,
    armor: 5,
  };

  /**
   * Crea un nuevo enemigo de prueba
   * @param id - Identificador único del enemigo
   * @param eventBus - Bus de eventos para comunicación
   * @param sceneManager - Manager de escena para agregar el modelo
   * @param physicsWorld - Mundo físico opcional para colisiones
   * @param physicsBody - Cuerpo físico opcional (si ya existe)
   * @param color - Color del cubo (default: rojo)
   * @param size - Tamaño del cubo (default: 1)
   */
  constructor(
    id: string,
    eventBus: EventBus,
    sceneManager: SceneManager,
    physicsWorld?: PhysicsWorld,
    physicsBody?: RigidBodyHandle,
    color: number = 0xff0000,
    size: number = 1.0
  ) {
    super(id, TestEnemy.BASE_STATS, eventBus, physicsWorld, physicsBody);
    this.sceneManager = sceneManager;
    this.color = color;
    this.size = size;

    // Crear modelo visual inmediatamente
    this.createModel();

    // Crear cuerpo físico si se proporcionó physicsWorld
    if (physicsWorld && !physicsBody) {
      this.createPhysicsBody();
    }
  }

  /**
   * Crea el modelo visual del enemigo (cubo rojo minimalista)
   */
  private createModel(): void {
    const geometry = new THREE.BoxGeometry(this.size, this.size, this.size);
    const material = new THREE.MeshPhongMaterial({
      color: this.color,
      shininess: 30,
    });

    // Clonar el material para que cada enemigo tenga su propia instancia
    // Esto permite cambiar el color individualmente sin afectar a otros enemigos
    const clonedMaterial = material.clone();
    
    this.model = new THREE.Mesh(geometry, clonedMaterial);
    this.model.castShadow = true;
    this.model.receiveShadow = true;
    this.model.name = `TestEnemy_${this.id}`;

    // Posicionar el modelo si ya tenemos posición física
    if (this.physicsBody && this.physicsWorld) {
      this.syncModelWithPhysics();
    }

    this.sceneManager.add(this.model);
    console.log(`[TestEnemy ${this.id}] Modelo creado con material clonado`);
  }

  /**
   * Crea un cuerpo físico para el enemigo
   */
  private createPhysicsBody(): void {
    if (!this.physicsWorld || !this.model) return;

    try {
      // Crear cuerpo físico usando BodyFactory.createEnemyBody
      // Pasamos tanto ID como referencia a la entidad (this) para acceso directo
      const bodyHandle = BodyFactory.createEnemyBody(
        this.physicsWorld,
        new THREE.Vector3(this.model.position.x, this.model.position.y, this.model.position.z),
        'medium', // Tamaño medio para testing
        this.id,  // Pasar ID para userData
        this      // Pasar referencia a la entidad para acceso directo
      );

      this.physicsBody = bodyHandle;

      console.log(`[TestEnemy ${this.id}] Cuerpo físico creado con userData.id y userData.entity`);
    } catch (error) {
      console.error(`[TestEnemy ${this.id}] Error creando cuerpo físico:`, error);
    }
  }

  /**
   * Sincroniza el modelo visual con la posición física
   */
  private syncModelWithPhysics(): void {
    if (!this.model || !this.physicsBody || !this.physicsWorld) return;

    const body = this.physicsWorld.getBody(this.physicsBody);
    if (!body) return;

    const pos = body.translation();
    this.model.position.set(pos.x, pos.y, pos.z);
  }

  /**
   * Actualiza el enemigo (sincroniza posición visual con física)
   * @param dt - Delta time en segundos
   */
  update(dt: number): void {
    // Sincronizar modelo con física si existe
    if (this.model && this.physicsBody && this.physicsWorld) {
      this.syncModelWithPhysics();
    }

    // No llamar a super.update() porque es abstracto en Character
    // La lógica de estado se maneja en takeDamage() y otros métodos
  }

  /**
   * Aplica daño al enemigo y cambia color para feedback visual
   * @param amount - Cantidad de daño a aplicar
   */
  takeDamage(amount: number): void {
    // Aplicar daño usando la lógica del padre
    super.takeDamage(amount);

    // Feedback visual: cambiar color temporalmente a blanco
    if (this.model) {
      const material = this.model.material as THREE.MeshPhongMaterial;
      const originalColor = material.color.getHex();

      // Cambiar a blanco
      material.color.setHex(0xffffff);

      // Restaurar color después de 100ms
      setTimeout(() => {
        if (this.model) {
          (this.model.material as THREE.MeshPhongMaterial).color.setHex(originalColor);
        }
      }, 100);
    }

    // Emitir evento de daño recibido (usando el evento definido en GameEvents)
    const currentHp = this.statsSystem.getStat('hp');
    const position = this.model ? this.model.position : new THREE.Vector3(0, 0, 0);
    
    this.eventBus.emit('enemy:damage', {
      enemyId: this.id,
      damage: amount,
      attackerId: 'player', // Para testing, usar 'player' como atacante
      position: { x: position.x, y: position.y, z: position.z } as THREE.Vector3,
    });

    // Si el enemigo muere, emitir evento de muerte
    if (!this.isAlive()) {
      this.eventBus.emit('enemy:died', {
        enemyId: this.id,
        position: { x: position.x, y: position.y, z: position.z } as THREE.Vector3,
        reward: 0, // Sin recompensa para testing
      });

      // Opcional: remover modelo después de morir
      setTimeout(() => {
        this.dispose();
      }, 1000);
    }
  }

  /**
   * Establece la posición del enemigo
   * @param x - Coordenada X
   * @param y - Coordenada Y
   * @param z - Coordenada Z
   */
  setPosition(x: number, y: number, z: number): void {
    // Actualizar modelo visual
    if (this.model) {
      this.model.position.set(x, y, z);
    }

    // Actualizar cuerpo físico si existe
    if (this.physicsBody && this.physicsWorld) {
      const body = this.physicsWorld.getBody(this.physicsBody);
      if (body) {
        body.setTranslation({ x, y, z }, true);
      }
    }
  }

  /**
   * Obtiene la posición actual del enemigo
   * @returns Posición como THREE.Vector3 o null si no hay modelo
   */
  getPosition(): THREE.Vector3 | null {
    if (!this.model) return null;
    return this.model.position.clone();
  }

  /**
   * Libera recursos del enemigo
   */
  dispose(): void {
    // Remover modelo de la escena
    if (this.model) {
      this.sceneManager.remove(this.model);
      
      // Liberar geometría y material
      this.model.geometry.dispose();
      if (Array.isArray(this.model.material)) {
        this.model.material.forEach(m => m.dispose());
      } else {
        this.model.material.dispose();
      }
      
      this.model = null;
    }

    // Remover cuerpo físico
    if (this.physicsBody && this.physicsWorld) {
      this.physicsWorld.removeBody(this.physicsBody);
      this.physicsBody = undefined;
    }

    console.log(`[TestEnemy ${this.id}] Recursos liberados`);
  }

  /**
   * Método estático para crear una fila de enemigos para testing de piercing
   * @param count - Número de enemigos en la fila
   * @param startX - Posición X inicial
   * @param startZ - Posición Z inicial
   * @param spacing - Espaciado entre enemigos
   * @param eventBus - Bus de eventos
   * @param sceneManager - Manager de escena
   * @param physicsWorld - Mundo físico
   * @returns Array de enemigos creados
   */
  static createEnemyRow(
    count: number,
    startX: number,
    startZ: number,
    spacing: number,
    eventBus: EventBus,
    sceneManager: SceneManager,
    physicsWorld: PhysicsWorld
  ): TestEnemy[] {
    const enemies: TestEnemy[] = [];
    
    // Colores diferentes para cada enemigo (para distinguirlos)
    const colors = [0xff0000, 0xff5500, 0xffaa00]; // Rojo, naranja, amarillo

    for (let i = 0; i < count; i++) {
      const enemyId = `test_enemy_${i + 1}`;
      const color = colors[i % colors.length];
      
      const enemy = new TestEnemy(
        enemyId,
        eventBus,
        sceneManager,
        physicsWorld,
        undefined, // No body handle (se creará automáticamente)
        color,
        1.0 // Tamaño estándar
      );

      // Posicionar en fila
      const x = startX + (i * spacing);
      enemy.setPosition(x, 0, startZ); // Y=0.5 para que el cubo esté sobre el plano

      enemies.push(enemy);
      console.log(`[TestEnemy] Creado enemigo ${enemyId} en (${x}, 0.5, ${startZ})`);
    }

    return enemies;
  }
}