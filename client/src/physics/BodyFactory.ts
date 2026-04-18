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
    isPlayer: boolean = true
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
    return world.createBody({
      type: 'kinematic',
      position: pos,
      collider: colliderDesc,
      lockRotations: true,
      gravityScale: 0,
      linearDamping: 5.0, // ← ahora SÍ llega al cuerpo real
      collisionGroup: group,
      collisionMask: mask,
    });
  }

  /**
   * Crea un cuerpo para un enemigo.
   * Similar al character body pero con cápsula más pequeña según el tipo.
   *
   * @param world Instancia de PhysicsWorld
   * @param pos Posición inicial
   * @param enemyType Tipo de enemigo que determina tamaño
   * @returns Handle del cuerpo creado
   */
  static createEnemyBody(
    world: PhysicsWorld,
    pos: THREE.Vector3,
    enemyType: 'small' | 'medium' | 'large' = 'medium'
  ): RigidBodyHandle {
    // Determinar tamaño según tipo
    let radius: number;
    let halfHeight: number;
    switch (enemyType) {
      case 'small':
        radius = 0.2;
        halfHeight = 0.3;
        break;
      case 'large':
        radius = 0.4;
        halfHeight = 0.7;
        break;
      case 'medium':
      default:
        radius = 0.3;
        halfHeight = 0.5;
        break;
    }

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
    bodyDesc.setTranslation(pos.x, pos.y, pos.z);
    bodyDesc.lockRotations();
    bodyDesc.setGravityScale(0);

    const colliderDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius);
    const groups = makeCollisionGroups(Groups.ENEMY, Masks.ENEMY);
    colliderDesc.setCollisionGroups(groups);

    return world.createBody({
      type: 'kinematic',
      position: pos,
      collider: colliderDesc,
      lockRotations: true,
      gravityScale: 0,
      collisionGroup: Groups.ENEMY,
      collisionMask: Masks.ENEMY,
    });
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
    const bodyDesc = RAPIER.RigidBodyDesc.fixed();
    bodyDesc.setTranslation(pos.x, pos.y, pos.z);

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
