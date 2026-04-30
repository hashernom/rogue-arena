import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Groups, Masks, makeCollisionGroups } from './CollisionGroups';
import { PhysicsWorld, RigidBodyHandle } from './PhysicsWorld';

/**
 * Factory para crear cuerpos físicos preconfigurados para cada tipo de entidad del juego.
 *
 * Criterios de diseño:
 * - Los personajes no caen por efecto de la gravedad (gravityScale = 0)
 * - Los proyectiles con CCD no atraviesan muros a alta velocidad
 * - Las cápsulas de los personajes no se quedan pegadas en las esquinas de los muros
 * - Los bodies Fixed no consumen CPU en el physics step
 */
export class BodyFactory {
  /**
   * Crea un cuerpo para un personaje jugador o NPC.
   * - RigidBody tipo KinematicPositionBased (controlado por código, no por física)
   * - Collider: Cápsula (radio 0.3m, halfHeight 0.5m)
   * - Lock rotación en X y Z (solo rota en Y)
   * - Sin gravedad (gravityScale = 0)
   * - Grupo de colisión: PLAYER o ENEMY según corresponda
   */
  static createCharacterBody(
    world: PhysicsWorld,
    pos: THREE.Vector3,
    isPlayer: boolean = true,
    entity?: any
  ): RigidBodyHandle {
    const group = isPlayer ? Groups.PLAYER : Groups.ENEMY;
    const mask = isPlayer ? Masks.PLAYER : Masks.ENEMY;

    // Crear collider de cápsula
    const radius = 0.3;
    const halfHeight = 0.5;
    const colliderDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius);

    // Configurar grupos de colisión
    const groups = makeCollisionGroups(group, mask);
    colliderDesc.setCollisionGroups(groups);

    // Crear el cuerpo en el mundo físico
    // Para jugadores: Dynamic con alta masa para colisionar con paredes/obstáculos (estáticos).
    // Rapier3D NO colisiona kinematic vs static, por eso cambiamos a dynamic.
    return world.createBody({
      type: isPlayer ? 'dynamic' : 'kinematic',
      position: pos,
      collider: colliderDesc,
      lockRotations: true,
      gravityScale: 0,
      linearDamping: 5.0,
      ccdEnabled: true, // CCD para evitar que el player atraviese paredes
      additionalMass: isPlayer ? 10000 : 0,
      collisionGroup: group,
      collisionMask: mask,
      canSleep: isPlayer ? false : undefined, // Los jugadores NO deben dormirse
      userData: {
        type: isPlayer ? 'player' : 'enemy',
        ...(entity ? { entity } : {}),
      },
    });
  }

  /**
   * Crea un cuerpo para un enemigo.
   * - RigidBody tipo Dynamic con masa extremadamente alta (10000)
   * - Los cuerpos cinemáticos NO colisionan entre sí en Rapier3D,
   *   por lo que los enemigos DEBEN ser dinámicos para colisionar con el player (también cinemático).
   * - La masa alta evita que el enemigo sea empujado por el jugador.
   * - El movimiento se controla con setLinvel() tanto para AI como para knockback.
   * - Collider: Cápsula según tipo de enemigo
   *
   * @param world Instancia de PhysicsWorld
   * @param pos Posición inicial
   * @param enemyType Tipo de enemigo que determina tamaño
   * @returns Handle del cuerpo creado
   */
  static createEnemyBody(
    world: PhysicsWorld,
    pos: THREE.Vector3,
    enemyType: 'small' | 'medium' | 'large' = 'medium',
    id?: string,
    entity?: any
  ): RigidBodyHandle {
    // Determinar tamaño según tipo
    let radius: number;
    let halfHeight: number;
    let colliderOffsetY: number;
    switch (enemyType) {
      case 'small':
        radius = 0.45;
        halfHeight = 0.4;
        colliderOffsetY = 0.5;
        break;
      case 'large':
        radius = 0.65;
        halfHeight = 0.9;
        colliderOffsetY = 0.9;
        break;
      case 'medium':
      default:
        radius = 0.55;
        halfHeight = 0.65;
        colliderOffsetY = 0.7;
        break;
    }

    // Usar Dynamic con masa extremadamente alta para que:
    // 1. Colisione con el player (cinemático) - los cinemáticos NO colisionan entre sí
    // 2. No sea empujado por el player (masa 10000 vs masa por defecto del player)
    // 3. setLinvel() funcione para AI y knockback

    const colliderDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius);
    colliderDesc.setTranslation(0, colliderOffsetY, 0); // Subir collider a la altura del torso
    colliderDesc.setFriction(10.0); // Alta fricción para sensación de peso sólido
    const groups = makeCollisionGroups(Groups.ENEMY, Masks.ENEMY);
    colliderDesc.setCollisionGroups(groups);

    // Almacenar tipo, ID y referencia a la entidad para acceso directo
    const userData: Record<string, any> = {
      type: 'enemy',
      ...(id ? { id } : {}),
      ...(entity ? { entity } : {}),
    };

    const bodyHandle = world.createBody({
      type: 'dynamic',
      position: pos,
      collider: colliderDesc,
      lockRotations: true,
      gravityScale: 0,
      linearDamping: 10.0, // Alto damping para que el momentum de colisión se disipe instantáneamente
      ccdEnabled: true,
      additionalMass: 10000, // Masa extremadamente alta para evitar ser empujado
      collisionGroup: Groups.ENEMY,
      collisionMask: Masks.ENEMY,
      userData: Object.keys(userData).length > 0 ? userData : undefined,
    });

    return bodyHandle;
  }

  /**
   * Crea un cuerpo para un proyectil.
   * - RigidBody tipo Dynamic con velocidad inicial
   * - Collider: Esfera (radio 0.1m)
   * - ccd: true (Continuous Collision Detection para proyectiles rápidos)
   * - Gravedad opcional (por defecto 0 para proyectiles en top-down)
   *
   * @param world Instancia de PhysicsWorld
   * @param pos Posición inicial
   * @param velocity Velocidad inicial (vector 3D)
   * @param gravityScale Escala de gravedad (0 para sin gravedad)
   * @returns Handle del cuerpo creado
   */
  static createProjectileBody(
    world: PhysicsWorld,
    pos: THREE.Vector3,
    velocity: THREE.Vector3,
    gravityScale: number = 0
  ): RigidBodyHandle {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic();
    bodyDesc.setTranslation(pos.x, pos.y, pos.z);
    bodyDesc.setLinvel(velocity.x, velocity.y, velocity.z);
    bodyDesc.setGravityScale(gravityScale);

    // Habilitar CCD (Continuous Collision Detection)
    bodyDesc.setCcdEnabled(true);

    const radius = 0.1;
    const colliderDesc = RAPIER.ColliderDesc.ball(radius);
    const groups = makeCollisionGroups(Groups.PROJECTILE, Masks.PROJECTILE);
    colliderDesc.setCollisionGroups(groups);

    return world.createBody({
      type: 'dynamic',
      position: pos,
      collider: colliderDesc,
      gravityScale,
      collisionGroup: Groups.PROJECTILE,
      collisionMask: Masks.PROJECTILE,
    });
  }

  /**
   * Crea un cuerpo para un muro o obstáculo estático.
   * - RigidBody tipo Fixed (no se mueve)
   * - Collider: Cuboid con dimensiones personalizadas
   * - No consume CPU en el physics step (es estático)
   *
   * @param world Instancia de PhysicsWorld
   * @param pos Posición del centro del muro
   * @param size Dimensiones del cuboide (ancho, alto, profundidad)
   * @returns Handle del cuerpo creado
   */
  static createWallBody(
    world: PhysicsWorld,
    pos: THREE.Vector3,
    size: THREE.Vector3
  ): RigidBodyHandle {
    const halfExtents = new THREE.Vector3(size.x / 2, size.y / 2, size.z / 2);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z);
    const groups = makeCollisionGroups(Groups.WALL, Masks.WALL);
    colliderDesc.setCollisionGroups(groups);

    return world.createBody({
      type: 'static',
      position: pos,
      collider: colliderDesc,
      collisionGroup: Groups.WALL,
      collisionMask: Masks.WALL,
    });
  }

  /**
   * Crea un cuerpo físico estático para un obstáculo (columna, caja, etc.).
   * Usa un grupo de colisión separado (OBSTACLE) para que los raycasts del ADC
   * no confundan obstáculos con paredes de arena.
   *
   * @param world Instancia de PhysicsWorld
   * @param pos Posición del centro del obstáculo
   * @param size Dimensiones del cuboide (ancho, alto, profundidad)
   * @returns Handle del cuerpo creado
   */
  static createObstacleBody(
    world: PhysicsWorld,
    pos: THREE.Vector3,
    size: THREE.Vector3
  ): RigidBodyHandle {
    const halfExtents = new THREE.Vector3(size.x / 2, size.y / 2, size.z / 2);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z);
    const groups = makeCollisionGroups(Groups.OBSTACLE, Masks.OBSTACLE);
    colliderDesc.setCollisionGroups(groups);

    return world.createBody({
      type: 'static',
      position: pos,
      collider: colliderDesc,
      collisionGroup: Groups.OBSTACLE,
      collisionMask: Masks.OBSTACLE,
    });
  }

  /**
   * Crea un cuerpo físico estático para el suelo de la arena.
   * El suelo es un cuboide delgado que evita que los personajes caigan.
   * @param world Mundo físico
   * @param pos Posición del centro del suelo
   * @param size Tamaño del suelo (ancho, alto, profundidad)
   */
  static createFloorBody(
    world: PhysicsWorld,
    pos: THREE.Vector3,
    size: THREE.Vector3
  ): RigidBodyHandle {
    const halfExtents = new THREE.Vector3(size.x / 2, size.y / 2, size.z / 2);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z);
    const groups = makeCollisionGroups(Groups.WALL, Masks.WALL);
    colliderDesc.setCollisionGroups(groups);

    return world.createBody({
      type: 'static',
      position: pos,
      collider: colliderDesc,
      collisionGroup: Groups.WALL,
      collisionMask: Masks.WALL,
    });
  }
}
