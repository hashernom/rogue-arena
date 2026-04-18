# 🛠️ Soluciones Técnicas - Sistema de Personajes y Animaciones

## 📋 Resumen Ejecutivo

Este documento documenta las soluciones técnicas implementadas para resolver los problemas críticos de sincronización física, animaciones y movimiento en el sistema de personajes de Rogue Arena. Se detalla el **Patrón Contenedor + SkeletonUtils**, las correcciones de sincronización física y el sistema de animaciones optimizado.

## 🎯 Problemas Identificados y Soluciones

### Problema 1: Desincronización entre Física y Renderizado
**Síntoma**: Los personajes se movían pero sus modelos 3D no seguían correctamente la posición física.

**Causa Raíz**: La sincronización `syncToThree()` se llamaba en el orden incorrecto dentro del game loop.

**Solución**: Reordenar el flujo en [`main.ts`](rogue-arena/client/src/main.ts:162-202):
```typescript
// ORDEN CORRECTO:
1. physicsWorld.stepAll(dt);      // Actualizar física
2. character.syncToPhysics();     // Sincronizar modelos DESPUÉS de física
3. physicsWorld.syncAll();        // Sincronizar otros objetos
```

### Problema 2: Animaciones que se Reseteaban Cada Frame
**Síntoma**: Las animaciones parpadeaban o no se reproducían continuamente.

**Causa Raíz**: El método `playAnimation()` se llamaba cada frame sin verificar si ya estaba reproduciendo la misma animación.

**Solución**: Implementar guard clause en [`MeleeCharacter.ts`](rogue-arena/client/src/characters/MeleeCharacter.ts:132-150) y [`AdcCharacter.ts`](rogue-arena/client/src/characters/AdcCharacter.ts:139-153):
```typescript
private playAnimation(name: string): void {
  // Guard clause: no hacer nada si ya está reproduciendo esta animación
  if (this.currentAnimationName === name) return;
  
  // Resto de la lógica de animación...
  this.currentAnimationName = name;
}
```

### Problema 3: Movimiento Sin Freno (Sliding)
**Síntoma**: Los personajes continuaban deslizándose después de soltar los controles.

**Causa Raíz**: Falta de damping (amortiguación) en los cuerpos físicos de Rapier3D.

**Solución**: Agregar `linearDamping` al sistema de física:
1. Extender la interfaz `BodyOptions` en [`PhysicsWorld.ts`](rogue-arena/client/src/physics/PhysicsWorld.ts:14-35):
   ```typescript
   export interface BodyOptions {
     // ... otras propiedades
     linearDamping?: number;  // Nuevo: amortiguación lineal
   }
   ```

2. Aplicar damping en `createBody()`:
   ```typescript
   const body = world.createBody(bodyDesc);
   if (options.linearDamping !== undefined) {
     body.setLinearDamping(options.linearDamping);
   }
   ```

3. Configurar damping en [`BodyFactory.ts`](rogue-arena/client/src/physics/BodyFactory.ts:24-52):
   ```typescript
   static createCharacterBody(position: THREE.Vector3, world: RAPIER.World): RigidBodyHandle {
     return world.createBody(
       RAPIER.RigidBodyDesc.dynamic()
         .setTranslation(position.x, position.y, position.z)
         .setLinearDamping(5.0)  // ← Damping crítico para freno
     );
   }
   ```

### Problema 4: Skeleton Cloning Incorrecto
**Síntoma**: Modelos 3D con animaciones compartían esqueletos, causando animaciones en espejo entre instancias.

**Causa Raíz**: Uso de `modelGltf.scene.clone()` que no clona profundamente los esqueletos de `SkinnedMesh`.

**Solución**: Implementar **Patrón Contenedor + SkeletonUtils**.

## 🏗️ Patrón Contenedor + SkeletonUtils

### Arquitectura del Patrón

```
THREE.Group (container)
    └── THREE.Object3D (innerMesh - clonado con SkeletonUtils)
        └── THREE.SkinnedMesh (con skeleton independiente)
        └── THREE.Bone hierarchy
```

### Implementación en [`loadModel()`](rogue-arena/client/src/characters/MeleeCharacter.ts:77-124)

```typescript
private async loadModel(): Promise<void> {
  try {
    // 1. IMPORTACIÓN CORRECTA (evita error "has no exported member")
    import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
    import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

    // 2. CLONACIÓN PROFUNDA CON SKELETONUTILS
    this.innerMesh = SkeletonUtils.clone(modelGltf.scene);
    
    // 3. DESACTIVAR FRUSTUM CULLING PARA SKINNEDMESH
    this.innerMesh.traverse((child) => {
      if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
        child.frustumCulled = false; // Evita desaparición al moverse
      }
    });

    // 4. JERARQUÍA CONTENEDOR -> MALLA
    this.model = new THREE.Group();
    this.innerMesh.position.set(0, 0, 0);
    this.model.add(this.innerMesh);
    this.sceneManager.add(this.model);

    // 5. ANIMATION MIXER CONECTADO A INNERMESH (NO AL CONTENEDOR)
    this.mixer = new THREE.AnimationMixer(this.innerMesh);
    
    // 6. CONFIGURAR ANIMACIONES
    const allClips = [...modelGltf.animations, ...movementGltf.animations];
    allClips.forEach((clip) => {
      const action = this.mixer!.clipAction(clip);
      this.actions[clip.name] = action;
    });

    // 7. INICIAR ANIMACIÓN POR DEFECTO
    this.playAnimation('Idle');
  } catch (error) {
    console.error('Error cargando modelo:', error);
    this.createFallbackModel();
  }
}
```

### Reglas Críticas del Patrón

1. **Importación con `* as`**: Siempre usar `import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'`
2. **Tipado explícito de GLTF**: Usar `import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'`
3. **Clonación profunda**: `SkeletonUtils.clone(modelGltf.scene)` en lugar de `modelGltf.scene.clone()`
4. **Frustum culling desactivado**: Para todos los `SkinnedMesh` para evitar desaparición
5. **Mixer conectado a innerMesh**: El `AnimationMixer` debe recibir `this.innerMesh`, no `this.model`
6. **Separación contenedor/malla**: El contenedor maneja posición física, la malla maneja animaciones

## 🔄 Sistema de Sincronización Física

### Flujo de Sincronización Optimizado

```typescript
// En cada fixed update (60Hz)
export class MeleeCharacter extends Character {
  // ...
  
  /**
   * Sincroniza el modelo 3D con la posición física.
   * DEBE llamarse DESPUÉS de physicsWorld.stepAll()
   */
  public syncToPhysics(): void {
    const bodyPos = this.getBodyPosition();
    if (!bodyPos || !this.model) return;
    
    // Sincronizar posición del CONTENEDOR (no del innerMesh)
    this.model.position.copy(bodyPos);
    
    // La rotación se maneja separadamente
    this.updateModelRotation(0); // dt no necesario para sync
  }
  
  /**
   * Obtiene la posición actual del cuerpo físico.
   * Usa physicsWorld.getBody() para acceder al Rapier body.
   */
  private getBodyPosition(): THREE.Vector3 | null {
    if (!this.physicsWorld || this.bodyHandle === null) return null;
    
    const body = this.physicsWorld.getWorld().getRigidBody(this.bodyHandle);
    if (!body) return null;
    
    const translation = body.translation();
    return new THREE.Vector3(translation.x, translation.y, translation.z);
  }
}
```

### Timing Crítico en Game Loop

```typescript
// main.ts - Fixed update loop
gameLoop.setFixedUpdate((dt: number) => {
  // 1. Procesar inputs y actualizar personajes
  inputManager.update();
  meleeCharacter.update(dt, inputManager.getState(1));
  adcCharacter.update(dt, inputManager.getState(2));
  
  // 2. PASO DE FÍSICA (primero)
  physicsWorld.stepAll(dt);
  
  // 3. SINCRONIZACIÓN DE PERSONAJES (después de física)
  meleeCharacter.syncToPhysics();
  adcCharacter.syncToPhysics();
  
  // 4. Sincronización de otros objetos
  physicsWorld.syncAll();
  
  // 5. Actualizar animaciones
  meleeCharacter.updateAnimations(dt);
  adcCharacter.updateAnimations(dt);
});
```

## 🎨 Sistema de Animaciones

### Arquitectura de AnimationController

El [`AnimationController`](rogue-arena/client/src/characters/AnimationController.ts) proporciona una capa de abstracción sobre THREE.AnimationMixer con:

1. **Mapeo automático de clips**: Convierte nombres de animaciones GLTF a clips tipados
2. **Crossfade suave**: Transiciones entre animaciones sin saltos
3. **Sincronización con estados**: Conecta `CharacterState` con animaciones apropiadas
4. **Play once support**: Animaciones que se reproducen una vez con callback

### Integración con Character States

```typescript
// En MeleeCharacter.updateAnimations()
private updateAnimations(dt: number): void {
  if (this.mixer) {
    this.mixer.update(dt);
  }
  
  // Sincronizar animación con estado actual
  if (this.animationController) {
    this.animationController.syncWithCharacterState(
      this.state,
      this.isMoving,
      this.isAttacking
    );
  }
}
```

### Estados de Animación Mapeados

| CharacterState | Animación | Notas |
|----------------|-----------|-------|
| `Idle` | `idle` | Animación de reposo |
| `Moving` | `walk`/`run` | Basado en velocidad |
| `Attacking` | `attack` | Animación de ataque (play once) |
| `Dead` | `death` | Animación de muerte (play once) |
| `UsingAbility` | `attack` o especial | Depende de la habilidad |

## 🐛 Debugging y Visualización

### Caja de Debug Magenta

Para visualizar el contenedor y verificar la sincronización, se agregó una caja de debug:

```typescript
// En loadModel(), después de crear el contenedor
const debugBox = new THREE.BoxHelper(this.model, 0xff00ff); // Magenta
debugBox.name = 'debug-container';
this.sceneManager.add(debugBox);
```

**Propósito**:
- Visualizar el bounding box del contenedor
- Verificar que el contenedor sigue la posición física
- Debuggear problemas de escala y rotación

### Console Logging Estratégico

```typescript
// En syncToPhysics() para debugging
console.log('Sync:', {
  bodyPos: bodyPos?.toArray(),
  modelPos: this.model?.position.toArray(),
  delta: bodyPos?.distanceTo(this.model?.position || new THREE.Vector3())
});
```

## 📊 Métricas de Performance

### Optimizaciones Implementadas

1. **Zero-garbage en game loop**: Reutilización de objetos `THREE.Vector3`
2. **Object pooling para proyectiles**: Pre-instanciación y reciclaje
3. **Frustum culling selectivo**: Desactivado solo para `SkinnedMesh`, activado para otros
4. **Cache de assets**: `AssetLoader` con cache LRU para modelos GLTF
5. **Fixed timestep**: Física a 60Hz independiente del framerate

### Monitoring Recomendado

```typescript
// En main.ts - render loop
let frameCount = 0;
let lastFpsUpdate = 0;

gameLoop.setRender((alpha: number) => {
  frameCount++;
  const now = performance.now();
  
  if (now - lastFpsUpdate > 1000) {
    const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
    displayFps(fps);
    frameCount = 0;
    lastFpsUpdate = now;
    
    // Alertar si FPS < 50
    if (fps < 50) console.warn(`Low FPS: ${fps}`);
  }
});
```

## 🔧 Troubleshooting Común

### Problema: "SkeletonUtils has no exported member"
**Solución**: Cambiar import a:
```typescript
// INCORRECTO: import { SkeletonUtils } from 'three/examples/jsm/utils/SkeletonUtils.js';
// CORRECTO:
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
```

### Problema: Animaciones en espejo entre personajes
**Solución**: Verificar que se usa `SkeletonUtils.clone()` no `.clone()`

### Problema: Modelo desaparece al moverse
**Solución**: Asegurar `child.frustumCulled = false` para `SkinnedMesh`

### Problema: Movimiento con sliding
**Solución**: Verificar que `linearDamping: 5.0` está configurado en `BodyFactory`

### Problema: Desincronización física
**Solución**: Verificar orden en game loop: `stepAll()` → `syncToPhysics()` → `syncAll()`

## 🚀 Próximas Mejoras

### Planeadas
1. **InstancedMesh para enemigos**: Reducir draw calls con rendering por instancias
2. **LOD (Level of Detail)**: Modelos de menor poligonaje a distancia
3. **Animation blending tree**: Mezcla avanzada de animaciones
4. **Network prediction**: Client-side prediction para multiplayer

### En Investigación
1. **WebGPU migration**: Migración futura de Three.js a WebGPU
2. **WASM multithreading**: Rapier3D con workers para física en paralelo
3. **Procedural animations**: Animaciones dinámicas basadas en física

---

## 📚 Referencias

- [Three.js Documentation](https://threejs.org/docs/)
- [Rapier3D Documentation](https://rapier.rs/docs/)
- [GLTF 2.0 Specification](https://www.khronos.org/gltf/)
- [Game Loop Patterns](https://gameprogrammingpatterns.com/game-loop.html)

## 👥 Autores

- **Equipo de Desarrollo Rogue Arena**
- **Documentación Técnica**: Generado automáticamente basado en commits y soluciones implementadas
- **Última Actualización**: 2026-04-18

## 📄 Licencia

Esta documentación es parte del proyecto Rogue Arena y está sujeta a los mismos términos de licencia que el código fuente.