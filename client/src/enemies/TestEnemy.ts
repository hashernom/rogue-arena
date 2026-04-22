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
  /** Timeout para restaurar color después del hit flash */
  private flashTimeoutId: number | null = null;
  /** Indica si la animación de muerte está en progreso */
  private isDying: boolean = false;
  /** Referencia al tiempo de inicio de la animación de muerte */
  private deathAnimationStart: number = 0;
  /** Duración de la animación de muerte en ms */
  private readonly DEATH_ANIMATION_DURATION = 300;
  /** Partículas generadas durante la muerte */
  private deathParticles: THREE.Mesh[] = [];
  /** Barra de HP flotante */
  private hpBar: THREE.Sprite | null = null;
  /** Indica si la barra de HP debe ser visible */
  private hpBarVisible: boolean = false;
  /** Timeout para ocultar la barra de HP después de un tiempo */
  private hpBarHideTimeoutId: number | null = null;

  /** Stats base del enemigo de prueba */
  static readonly BASE_STATS: CharacterStats = {
    hp: 40,
    maxHp: 40,
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
    size: number = 1.0,
    knockbackResistance: number = 0.0
  ) {
    super(id, TestEnemy.BASE_STATS, eventBus, physicsWorld, physicsBody);
    this.sceneManager = sceneManager;
    this.color = color;
    this.size = size;

    // Establecer resistencia al knockback
    this.setKnockbackResistance(knockbackResistance);

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

    // Manejar animación de muerte si está en progreso
    if (this.isDying) {
      this.updateDeathAnimation();
    }

    // Actualizar barra de HP si está visible
    if (this.hpBarVisible && this.hpBar) {
      this.updateHpBar();
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

    // Feedback visual: hit flash rojo
    if (this.model) {
      const material = this.model.material as THREE.MeshPhongMaterial;
      const originalColor = material.color.getHex();

      // Cancelar flash anterior si existe
      if (this.flashTimeoutId !== null) {
        clearTimeout(this.flashTimeoutId);
        this.flashTimeoutId = null;
      }

      // Cambiar a rojo (0xff0000)
      material.color.setHex(0xff0000);

      // Restaurar color después de 100ms
      this.flashTimeoutId = setTimeout(() => {
        if (this.model) {
          (this.model.material as THREE.MeshPhongMaterial).color.setHex(originalColor);
        }
        this.flashTimeoutId = null;
      }, 100) as unknown as number;
    }

    // Mostrar barra de HP flotante
    this.showHpBar();

    // Emitir evento de daño recibido (usando el evento definido en GameEvents)
    const currentHp = this.statsSystem.getStat('hp');
    const position = this.model ? this.model.position : new THREE.Vector3(0, 0, 0);
    
    this.eventBus.emit('enemy:damage', {
      enemyId: this.id,
      damage: amount,
      attackerId: 'player', // Para testing, usar 'player' como atacante
      position: { x: position.x, y: position.y, z: position.z } as THREE.Vector3,
    });

    // Si el enemigo muere, emitir evento de muerte con killerId
    if (!this.isAlive()) {
      (this.eventBus as any).emit('enemy:died', {
        enemyId: this.id,
        killerId: 'player', // Por defecto, asumir que el jugador mató
        position: { x: position.x, y: position.y, z: position.z } as THREE.Vector3,
        reward: 0, // Sin recompensa para testing
      });

      // Iniciar animación de muerte (escalado a cero + partículas)
      this.startDeathAnimation();
    }
  }

  /**
   * Inicia la animación de muerte del enemigo
   */
  private startDeathAnimation(): void {
    if (this.isDying) return;

    this.isDying = true;
    this.deathAnimationStart = Date.now();

    // Crear partículas de muerte
    this.createDeathParticles();

    console.log(`[TestEnemy ${this.id}] Iniciando animación de muerte`);
  }

  /**
   * Actualiza la animación de muerte (escalado progresivo)
   */
  private updateDeathAnimation(): void {
    const elapsed = Date.now() - this.deathAnimationStart;
    const progress = Math.min(elapsed / this.DEATH_ANIMATION_DURATION, 1);

    // Escalar modelo a cero
    if (this.model) {
      const scale = 1 - progress;
      this.model.scale.set(scale, scale, scale);
    }

    // Mover partículas hacia arriba
    this.deathParticles.forEach(particle => {
      particle.position.y += 0.01;
      particle.rotation.x += 0.05;
      particle.rotation.y += 0.05;
    });

    // Si la animación ha terminado, limpiar
    if (progress >= 1) {
      this.isDying = false;
      this.dispose();
    }
  }

  /**
   * Crea partículas para el efecto de muerte
   */
  private createDeathParticles(): void {
    if (!this.model || !this.sceneManager) return;

    const particleCount = 5;
    const position = this.model.position.clone();

    for (let i = 0; i < particleCount; i++) {
      const geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
      const material = new THREE.MeshPhongMaterial({ color: 0xff0000 });
      const particle = new THREE.Mesh(geometry, material);

      // Posición aleatoria alrededor del enemigo
      particle.position.copy(position);
      particle.position.x += (Math.random() - 0.5) * 0.5;
      particle.position.y += Math.random() * 0.5;
      particle.position.z += (Math.random() - 0.5) * 0.5;

      this.sceneManager.add(particle);
      this.deathParticles.push(particle);
    }
  }

  /**
   * Crea la barra de HP flotante (sprite con canvas)
   */
  private createHpBar(): void {
    if (this.hpBar || !this.sceneManager) return;

    // Crear canvas 2D
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 8;
    const context = canvas.getContext('2d');
    if (!context) return;

    // Dibujar fondo negro
    context.fillStyle = '#000000';
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Dibujar barra verde
    context.fillStyle = '#00ff00';
    context.fillRect(1, 1, canvas.width - 2, canvas.height - 2);

    // Crear textura desde canvas
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(material);

    // Escalar y posicionar
    sprite.scale.set(0.5, 0.1, 1);
    sprite.position.set(0, this.size * 0.8, 0); // Encima del enemigo
    sprite.visible = false;

    this.sceneManager.add(sprite);
    this.hpBar = sprite;
  }

  /**
   * Actualiza la barra de HP con el porcentaje actual
   */
  private updateHpBar(): void {
    if (!this.hpBar || !this.model) return;

    // Posicionar encima del enemigo
    this.hpBar.position.copy(this.model.position);
    this.hpBar.position.y += this.size * 0.8;

    // Calcular porcentaje de HP
    const currentHp = this.statsSystem.getStat('hp');
    const maxHp = this.statsSystem.getStat('maxHp');
    const hpPercent = Math.max(0, currentHp / maxHp);

    // Actualizar textura del canvas
    const spriteMaterial = this.hpBar.material as THREE.SpriteMaterial;
    const texture = spriteMaterial.map as THREE.CanvasTexture;
    const canvas = texture.image as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) return;

    // Limpiar canvas
    context.clearRect(0, 0, canvas.width, canvas.height);

    // Dibujar fondo negro
    context.fillStyle = '#000000';
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Dibujar barra de salud (verde para HP alto, rojo para HP bajo)
    const barWidth = (canvas.width - 2) * hpPercent;
    const hue = hpPercent * 120; // 0 = rojo, 120 = verde
    context.fillStyle = `hsl(${hue}, 100%, 50%)`;
    context.fillRect(1, 1, barWidth, canvas.height - 2);

    // Marcar textura como necesitada de actualización
    texture.needsUpdate = true;
  }

  /**
   * Muestra la barra de HP por un tiempo determinado
   */
  private showHpBar(): void {
    // Crear barra si no existe
    if (!this.hpBar) {
      this.createHpBar();
    }

    if (!this.hpBar) return;

    // Mostrar barra
    this.hpBarVisible = true;
    this.hpBar.visible = true;
    this.updateHpBar();

    // Cancelar timeout anterior
    if (this.hpBarHideTimeoutId !== null) {
      clearTimeout(this.hpBarHideTimeoutId);
    }

    // Ocultar después de 3 segundos
    this.hpBarHideTimeoutId = setTimeout(() => {
      if (this.hpBar) {
        this.hpBar.visible = false;
      }
      this.hpBarVisible = false;
      this.hpBarHideTimeoutId = null;
    }, 3000) as unknown as number;
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
    // Cancelar timeout de flash si existe
    if (this.flashTimeoutId !== null) {
      clearTimeout(this.flashTimeoutId);
      this.flashTimeoutId = null;
    }

    // Limpiar partículas de muerte
    this.deathParticles.forEach(particle => {
      this.sceneManager.remove(particle);
      particle.geometry.dispose();
      (particle.material as THREE.Material).dispose();
    });
    this.deathParticles = [];

    // Cancelar timeout de barra de HP si existe
    if (this.hpBarHideTimeoutId !== null) {
      clearTimeout(this.hpBarHideTimeoutId);
      this.hpBarHideTimeoutId = null;
    }

    // Remover barra de HP
    if (this.hpBar) {
      this.sceneManager.remove(this.hpBar);
      const material = this.hpBar.material as THREE.SpriteMaterial;
      material.map?.dispose();
      material.dispose();
      this.hpBar = null;
    }

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