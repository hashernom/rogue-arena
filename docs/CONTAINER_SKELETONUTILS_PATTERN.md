# 🏗️ Patrón Contenedor + SkeletonUtils - Guía de Implementación

## 📖 Introducción

Este documento describe el **Patrón Contenedor + SkeletonUtils**, una solución arquitectónica para manejar modelos 3D animados con esqueletos (SkinnedMesh) en Three.js, especialmente en el contexto de juegos con múltiples instancias de personajes.

## 🎯 Problema que Resuelve

Cuando se tienen múltiples instancias de un mismo modelo animado (ej: 2 jugadores, muchos enemigos), se presentan estos problemas:

1. **Animaciones en espejo**: Todas las instancias comparten el mismo esqueleto
2. **Frustum culling incorrecto**: Modelos desaparecen al moverse fuera del view frustum
3. **Root motion conflicts**: Las animaciones mueven la posición global del modelo
4. **Sincronización física compleja**: Difícil separar posición física de posición visual

## 🏗️ Arquitectura del Patrón

### Diagrama Conceptual

```
┌─────────────────────────────────────────────┐
│           THREE.Group (container)           │
│  • Maneja posición física                   │
│  • Referencia para sincronización           │
│  • Padre de la malla animada                │
└─────────────────────┬───────────────────────┘
                      │
          ┌───────────▼─────────────┐
          │   THREE.Object3D         │
          │   (innerMesh)            │
          │  • Clonado con           │
          │    SkeletonUtils.clone() │
          │  • Contiene SkinnedMesh  │
          │    con skeleton único    │
          └───────────┬──────────────┘
                      │
          ┌───────────▼─────────────┐
          │   THREE.SkinnedMesh      │
          │  • skeleton independiente│
          │  • frustumCulled = false │
          │  • Animaciones propias   │
          └──────────────────────────┘
```

### Componentes Clave

| Componente | Propósito | Ejemplo |
|------------|-----------|---------|
| **Container** | `THREE.Group` que sigue la posición física | `this.model = new THREE.Group()` |
| **InnerMesh** | Malla clonada con `SkeletonUtils.clone()` | `this.innerMesh = SkeletonUtils.clone(scene)` |
| **SkinnedMesh** | Malla con esqueleto para animaciones | `child.isSkinnedMesh === true` |
| **AnimationMixer** | Conectado al `innerMesh`, no al container | `new THREE.AnimationMixer(this.innerMesh)` |

## 🚀 Implementación Paso a Paso

### Paso 1: Imports Correctos

```typescript
// CORRECTO - Usar import * as para SkeletonUtils
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

// CORRECTO - Tipado explícito para GLTF
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

// INCORRECTO - Esto fallará en Three.js r168+
// import { SkeletonUtils } from 'three/examples/jsm/utils/SkeletonUtils.js';
```

### Paso 2: Función `loadModel()` - Implementación Completa

```typescript
private async loadModel(): Promise<void> {
  try {
    // 1. Cargar assets GLTF
    const assets = await Promise.all([
      this.assetLoader.load('/models/Knight.glb'),
      this.assetLoader.load('/models/Rig_Medium_MovementBasic.glb')
    ]);
    
    const modelGltf = assets[0] as GLTF;
    const movementGltf = assets[1] as GLTF;

    // 2. CLONACIÓN PROFUNDA CON SKELETONUTILS (CRÍTICO)
    this.innerMesh = SkeletonUtils.clone(modelGltf.scene);
    
    // 3. CONFIGURAR FRUSTUM CULLING PARA SKINNEDMESH
    this.innerMesh.traverse((child) => {
      if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
        // Desactivar frustum culling para evitar desaparición
        child.frustumCulled = false;
        
        // Opcional: Configurar sombras
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    // 4. CREAR CONTENEDOR Y JERARQUÍA
    this.model = new THREE.Group();
    this.innerMesh.position.set(0, 0, 0);  // Posición relativa al contenedor
    this.model.add(this.innerMesh);
    
    // 5. AGREGAR AL ESCENARIO
    this.sceneManager.add(this.model);

    // 6. CONFIGURAR ANIMATION MIXER (CONECTADO A INNERMESH)
    this.mixer = new THREE.AnimationMixer(this.innerMesh);

    // 7. MAPEAR CLIPS DE ANIMACIÓN
    const allClips = [...modelGltf.animations, ...movementGltf.animations];
    allClips.forEach((clip) => {
      const action = this.mixer!.clipAction(clip);
      this.actions[clip.name] = action;
      
      // Mapear nombres comunes
      const name = clip.name.toLowerCase();
      if (name.includes('idle')) this.actions['Idle'] = action;
      if (name.includes('run') || name.includes('walk')) this.actions['Run'] = action;
      if (name.includes('attack')) this.actions['Attack'] = action;
      if (name.includes('death')) this.actions['Death'] = action;
    });

    // 8. INICIAR ANIMACIÓN POR DEFECTO
    this.playAnimation('Idle');

    // 9. DEBUG: Agregar caja visualizadora (opcional)
    this.addDebugBox();

  } catch (error) {
    console.error('Error cargando modelo:', error);
    this.createFallbackModel();
  }
}
```

### Paso 3: Método `playAnimation()` con Guard Clause

```typescript
private currentAnimationName: string | null = null;

private playAnimation(name: string): void {
  // GUARD CLAUSE: Evitar resetear la misma animación
  if (this.currentAnimationName === name) return;
  
  const action = this.actions[name];
  if (!action) {
    console.warn(`Animación "${name}" no encontrada`);
    return;
  }
  
  // Detener animación actual si existe
  if (this.currentAction) {
    this.currentAction.fadeOut(0.2);
  }
  
  // Configurar y reproducir nueva animación
  action.reset();
  action.fadeIn(0.2);
  action.play();
  
  // Actualizar referencias
  this.currentAction = action;
  this.currentAnimationName = name;
}
```

### Paso 4: Sincronización Física

```typescript
public syncToPhysics(): void {
  // Obtener posición del cuerpo físico
  const bodyPos = this.getBodyPosition();
  if (!bodyPos || !this.model) return;
  
  // Sincronizar CONTENEDOR (no innerMesh)
  this.model.position.copy(bodyPos);
  
  // La rotación se maneja separadamente
  this.updateModelRotation(0);
}

private getBodyPosition(): THREE.Vector3 | null {
  if (!this.physicsWorld || this.bodyHandle === null) return null;
  
  const body = this.physicsWorld.getWorld().getRigidBody(this.bodyHandle);
  if (!body) return null;
  
  const translation = body.translation();
  return new THREE.Vector3(translation.x, translation.y, translation.z);
}
```

### Paso 5: Debug Visualization

```typescript
private addDebugBox(): void {
  if (!this.model) return;
  
  // Caja magenta para visualizar el contenedor
  const debugBox = new THREE.BoxHelper(this.model, 0xff00ff);
  debugBox.name = 'debug-container';
  
  // Ajustar tamaño para visualización clara
  const boxSize = 1.5;
  debugBox.scale.set(boxSize, 2, boxSize);
  debugBox.position.y = 1;  // Elevar para ver mejor
  
  this.sceneManager.add(debugBox);
  this.debugBox = debugBox;  // Guardar referencia para remover después
}
```

## 🔍 Por Qué Este Patrón Funciona

### 1. Separación de Responsabilidades

| Responsabilidad | Componente | Razón |
|----------------|------------|-------|
| **Posición física** | Container (`THREE.Group`) | Fácil sincronización con Rapier3D |
| **Animaciones** | InnerMesh (`THREE.Object3D`) | Esqueleto independiente por instancia |
| **Renderizado** | SkinnedMesh | Optimizado con frustum culling controlado |

### 2. Clonación Profunda vs Superficial

```typescript
// INCORRECTO - Clonación superficial
this.innerMesh = modelGltf.scene.clone();
// Problema: Comparte skeleton con el original

// CORRECTO - Clonación profunda con SkeletonUtils
this.innerMesh = SkeletonUtils.clone(modelGltf.scene);
// Ventaja: Skeleton independiente para cada instancia
```

### 3. Frustum Culling Controlado

Los `SkinnedMesh` tienen problemas con el frustum culling por defecto porque sus bounding boxes no se actualizan dinámicamente con las animaciones. Desactivarlo evita que desaparezcan incorrectamente.

```typescript
child.frustumCulled = false;  // Para SkinnedMesh
// child.frustumCulled = true;  // Para Mesh estáticos (opcional)
```

## 🧪 Testing del Patrón

### Test 1: Verificar Skeleton Independiente

```typescript
// Crear dos instancias del mismo modelo
const char1 = new MeleeCharacter();
const char2 = new MeleeCharacter();

await char1.loadModel();
await char2.loadModel();

// Verificar que tienen skeletons diferentes
console.log('Same skeleton?', 
  char1.innerMesh?.getObjectByProperty('isSkinnedMesh', true)?.skeleton ===
  char2.innerMesh?.getObjectByProperty('isSkinnedMesh', true)?.skeleton
); // Debe ser false
```

### Test 2: Verificar Sincronización

```typescript
// Mover personaje físicamente
physicsWorld.applyForce(char1.bodyHandle, { x: 10, y: 0, z: 0 });

// Ejecutar game loop
physicsWorld.stepAll(1/60);
char1.syncToPhysics();

// Verificar que container sigue la física
const bodyPos = char1.getBodyPosition();
const modelPos = char1.model?.position;
console.log('Sync delta:', bodyPos?.distanceTo(modelPos || new THREE.Vector3()));
// Debe ser cercano a 0
```

### Test 3: Verificar Animaciones Independientes

```typescript
// Reproducir animaciones diferentes en cada instancia
char1.playAnimation('Idle');
char2.playAnimation('Run');

// Verificar que no están en espejo
console.log('Same animation?', 
  char1.currentAnimationName === char2.currentAnimationName
); // Debe ser false
```

## 🐛 Troubleshooting Específico

### Error: "SkeletonUtils has no exported member"

**Síntoma**: Error de TypeScript al compilar.

**Solución**: Cambiar import a namespace import:
```typescript
// ANTES:
import { SkeletonUtils } from 'three/examples/jsm/utils/SkeletonUtils.js';

// DESPUÉS:
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
```

### Problema: Modelo no se renderiza

**Síntoma**: El modelo es invisible pero existe en la escena.

**Solución**: Verificar frustum culling:
```typescript
// En loadModel(), después de SkeletonUtils.clone()
this.innerMesh.traverse((child) => {
  console.log(child.type, child.name, (child as THREE.SkinnedMesh).isSkinnedMesh);
  
  if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
    child.frustumCulled = false;  // ← ESTA LÍNEA ES CRÍTICA
  }
});
```

### Problema: Animaciones lentas o con lag

**Síntoma**: Las animaciones se reproducen más lento que el juego.

**Solución**: Verificar que `mixer.update(dt)` se llama en cada frame:
```typescript
update(dt: number): void {
  // Actualizar animaciones
  if (this.mixer) {
    this.mixer.update(dt);  // ← NO OLVIDAR ESTO
  }
}
```

### Problema: Memory leaks con múltiples instancias

**Síntoma**: El uso de memoria aumenta con cada personaje creado.

**Solución**: Implementar proper disposal:
```typescript
dispose(): void {
  if (this.mixer) {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.innerMesh!);
  }
  
  if (this.model) {
    this.sceneManager.remove(this.model);
    this.model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }
}
```

## 📊 Consideraciones de Performance

### Ventajas

1. **Animaciones independientes**: Cada instancia tiene su propio skeleton
2. **Sincronización simple**: El container facilita seguir la física
3. **Memory controlado**: SkeletonUtils.clone() es eficiente
4. **Renderizado optimizado**: Frustum culling controlado

### Desventajas

1. **Memory overhead**: Cada instancia tiene su propio skeleton en memoria
2. **Clonación costosa**: `SkeletonUtils.clone()` es más pesado que `.clone()`
3. **Setup complejo**: Más código de configuración inicial

### Optimizaciones Recomendadas

1. **Object pooling**: Reutilizar instancias de personajes cuando sea posible
2. **Lazy loading**: Cargar modelos solo cuando sean necesarios
3. **Texture sharing**: Compartir texturas entre instancias
4. **Geometry sharing**: Compartir geometrías estáticas cuando sea posible

## 🔄 Integración con Otros Sistemas

### Con Physics (Rapier3D)

```typescript
createPhysicsBody(position: THREE.Vector3): void {
  this.bodyHandle = BodyFactory.createCharacterBody(position, this.physicsWorld.getWorld());
  
  // Configurar damping para freno realista
  const body = this.physicsWorld.getWorld().getRigidBody(this.bodyHandle);
  body?.setLinearDamping(5.0);
}
```

### Con AnimationController

```typescript
// En el constructor o loadModel()
if (this.innerMesh) {
  this.animationController = new AnimationController(
    this.innerMesh as THREE.Group,
    allClips
  );
}
```

### Con Network Sync (Multiplayer)

```typescript
// Para interpolación de posición
public interpolatePosition(targetPos: THREE.Vector3, alpha: number): void {
  if (!this.model) return;
  
  this.model.position.lerp(targetPos, alpha);
  
  // Solo interpolar el container, no el innerMesh
  // Las animaciones se manejan localmente
}
```

## 📚 Ejemplos de Uso en el Proyecto

### MeleeCharacter

Ver [`MeleeCharacter.ts`](rogue-arena/client/src/characters/MeleeCharacter.ts:77-124) para implementación completa.

### AdcCharacter

Ver [`AdcCharacter.ts`](rogue-arena/client/src/characters/AdcCharacter.ts:78-132) para implementación similar.

### Enemy Classes (Futuro)

```typescript
// Ejemplo para enemigos básicos
export class EnemyBasic {
  private model: THREE.Group | null = null;
  private innerMesh: THREE.Object3D | null = null;
  
  async loadModel(): Promise<void> {
    const gltf = await assetLoader.load('/models/Enemy.glb');
    this.innerMesh = SkeletonUtils.clone(gltf.scene);
    
    // Configuración similar a personajes...
  }
}
```

## 🚀 Extensión del Patrón

### Para Múltiples LODs (Level of Detail)

```typescript
private lods: Record<string, THREE.Object3D> = {};

async loadModelWithLOD(): Promise<void> {
  const [highRes, mediumRes, lowRes] = await Promise.all([
    this.assetLoader.load('/models/Knight_high.glb'),
    this.assetLoader.load('/models/Knight_medium.glb'),
    this.assetLoader.load('/models/Knight_low.glb')
  ]);
  
  this.lods.high = SkeletonUtils.clone(highRes.scene);
  this.lods.medium = SkeletonUtils.clone(mediumRes.scene);
  this.lods.low = SkeletonUtils.clone(lowRes.scene);
  
  // Configurar visibilidad basada en distancia
  this.setupLODSwitching();
}
```

### Para Instanced Rendering

```typescript
// Para muchos enemigos del mismo tipo
export class EnemyManager {
  private instancedMesh: THREE.InstancedMesh | null = null;
  private enemyMatrices: THREE.Matrix4[] = [];
  
  setupInstancedRendering(baseModel: GLTF, count: number): void {
    const mesh = baseModel.scene.getObjectByProperty('isSkinnedMesh', true);
    if