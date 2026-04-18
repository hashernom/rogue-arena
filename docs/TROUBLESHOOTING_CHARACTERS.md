# 🔧 Troubleshooting - Sistema de Personajes y Animaciones

## 📋 Introducción

Esta guía cubre los problemas más comunes encontrados durante el desarrollo del sistema de personajes de Rogue Arena, con soluciones paso a paso y herramientas de diagnóstico.

## 🚨 Problemas Críticos y Soluciones Inmediatas

### Problema 1: Personaje no se mueve pero el modelo sí

**Síntomas**:
- El modelo 3D se mueve pero la posición física no cambia
- No hay colisiones con el personaje
- El personaje "flota" sobre el suelo

**Diagnóstico rápido**:
```typescript
// En la consola del navegador
> window.meleeCharacter?.getBodyPosition()
// Debe devolver un Vector3 con posición
> window.physicsWorld?.getWorld()?.getRigidBody(handle)?.translation()
// Debe coincidir con la posición del modelo
```

**Soluciones**:

1. **Verificar creación del cuerpo físico**:
   ```typescript
   // En createPhysicsBody()
   console.log('Creating body at:', position);
   this.bodyHandle = BodyFactory.createCharacterBody(position, world);
   console.log('Body handle:', this.bodyHandle);
   ```

2. **Verificar que syncToPhysics() se llama**:
   ```typescript
   // Agregar logging
   public syncToPhysics(): void {
     console.log('syncToPhysics called');
     const bodyPos = this.getBodyPosition();
     console.log('Body pos:', bodyPos);
     // ... resto del código
   }
   ```

3. **Verificar orden en game loop**:
   ```typescript
   // EN main.ts - El orden debe ser:
   // 1. physicsWorld.stepAll(dt)
   // 2. character.syncToPhysics()  ← DESPUÉS de stepAll
   // 3. physicsWorld.syncAll()
   ```

### Problema 2: Animaciones parpadeantes o que se resetean

**Síntomas**:
- La animación se reinicia constantemente
- Transiciones bruscas entre animaciones
- El personaje "tiembla" en animación idle

**Diagnóstico**:
```typescript
// Agregar en playAnimation()
console.log('playAnimation called:', name, 'current:', this.currentAnimationName);
```

**Soluciones**:

1. **Implementar guard clause**:
   ```typescript
   private playAnimation(name: string): void {
     // EVITAR resetear la misma animación
     if (this.currentAnimationName === name) {
       console.log('Already playing', name);
       return;
     }
     // ... resto del código
   }
   ```

2. **Verificar llamadas repetidas**:
   ```typescript
   // En update() o updateAnimations()
   console.trace('Animation update called');
   // Verificar que no se llama múltiples veces por frame
   ```

3. **Configurar crossfade adecuado**:
   ```typescript
   // Transición suave entre animaciones
   if (this.currentAction) {
     this.currentAction.fadeOut(0.2);  // 0.2 segundos de fade out
   }
   action.fadeIn(0.2);  // 0.2 segundos de fade in
   ```

### Problema 3: Movimiento con sliding (sin freno)

**Síntomas**:
- El personaje continúa deslizándose después de soltar controles
- Movimiento "flotante" o poco realista
- Dificultad para controlar posición exacta

**Diagnóstico**:
```typescript
// Verificar damping configurado
> window.physicsWorld?.getWorld()?.getRigidBody(handle)?.linearDamping()
// Debe devolver 5.0 o similar
```

**Soluciones**:

1. **Configurar linearDamping en BodyFactory**:
   ```typescript
   // En BodyFactory.createCharacterBody()
   return world.createBody(
     RAPIER.RigidBodyDesc.dynamic()
       .setTranslation(position.x, position.y, position.z)
       .setLinearDamping(5.0)  // ← VALOR CRÍTICO
   );
   ```

2. **Ajustar damping dinámicamente**:
   ```typescript
   // Cuando el personaje está quieto
   if (inputState.moveDir.length() === 0) {
     body.setLinearDamping(10.0);  // Más damping cuando quieto
   } else {
     body.setLinearDamping(5.0);   // Menos damping cuando se mueve
   }
   ```

3. **Verificar que no hay fuerzas residuales**:
   ```typescript
   // En moveBody(), limpiar fuerzas anteriores
   body.resetForces(true);
   body.resetTorques(true);
   ```

### Problema 4: Modelo invisible o desaparece

**Síntomas**:
- El modelo 3D no se renderiza
- Aparece y desaparece al moverse
- Solo visible desde ciertos ángulos

**Diagnóstico**:
```typescript
// Verificar en consola
> const model = window.meleeCharacter?.model
> model?.visible  // Debe ser true
> model?.children.length  // Debe ser > 0
```

**Soluciones**:

1. **Desactivar frustum culling para SkinnedMesh**:
   ```typescript
   this.innerMesh.traverse((child) => {
     if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
       child.frustumCulled = false;  // ← LÍNEA CRÍTICA
     }
   });
   ```

2. **Verificar escala y posición**:
   ```typescript
   console.log('Model scale:', this.model?.scale);
   console.log('Model position:', this.model?.position);
   console.log('InnerMesh position:', this.innerMesh?.position);
   ```

3. **Verificar materiales y texturas**:
   ```typescript
   this.innerMesh.traverse((child) => {
     if (child instanceof THREE.Mesh) {
       console.log('Mesh:', child.name, 'material:', child.material);
       console.log('Visible:', child.visible);
     }
   });
   ```

## 🔍 Herramientas de Diagnóstico

### Debug Box (Caja Magenta)

Para visualizar problemas de posición y escala:

```typescript
private addDebugBox(): void {
  if (!this.model) return;
  
  const debugBox = new THREE.BoxHelper(this.model, 0xff00ff); // Magenta
  debugBox.name = 'debug-container';
  
  // Ajustar para mejor visualización
  const boxSize = 1.5;
  debugBox.scale.set(boxSize, 2, boxSize);
  debugBox.position.y = 1;
  
  this.sceneManager.add(debugBox);
  this.debugBox = debugBox;
}
```

**Uso**:
- Magenta = Contenedor (posición física)
- Si la caja no sigue al modelo = Problema de sincronización
- Si la caja es muy grande/pequeña = Problema de escala

### Console Logging Estratégico

```typescript
// En syncToPhysics() para debugging
public syncToPhysics(): void {
  const bodyPos = this.getBodyPosition();
  const modelPos = this.model?.position;
  
  if (bodyPos && modelPos) {
    const distance = bodyPos.distanceTo(modelPos);
    if (distance > 0.1) {
      console.warn('Large sync delta:', distance, {
        body: bodyPos.toArray(),
        model: modelPos.toArray()
      });
    }
  }
  // ... resto del código
}
```

### Performance Profiling

```typescript
// Medir FPS y performance
let frameCount = 0;
let lastLog = performance.now();

gameLoop.setRender(() => {
  frameCount++;
  const now = performance.now();
  
  if (now - lastLog > 1000) {
    const fps = Math.round((frameCount * 1000) / (now - lastLog));
    console.log(`FPS: ${fps}, Characters: 2, Physics bodies: ${physicsWorld.bodyCount}`);
    
    // Alertar si bajo FPS
    if (fps < 50) {
      console.warn('Low FPS detected, checking performance...');
      performance.mark('low-fps');
    }
    
    frameCount = 0;
    lastLog = now;
  }
});
```

## 🐛 Errores Comunes de TypeScript/Three.js

### Error: "SkeletonUtils has no exported member"

**Mensaje completo**:
```
Module '"three/examples/jsm/utils/SkeletonUtils"' has no exported member 'SkeletonUtils'.
```

**Causa**: Three.js r168+ cambió la exportación.

**Solución**:
```typescript
// INCORRECTO:
import { SkeletonUtils } from 'three/examples/jsm/utils/SkeletonUtils.js';

// CORRECTO:
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
```

### Error: "Property 'isSkinnedMesh' does not exist"

**Solución**:
```typescript
// Necesita type assertion
if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
  // Ahora TypeScript reconoce la propiedad
}
```

### Error: "GLTFLoader not found"

**Solución**:
```typescript
// Asegurar que GLTFLoader está instalado
// En package.json:
"@types/three": "^0.168.0",
"three": "^0.168.0",

// Y en el código:
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
```

## 🔄 Flujo de Diagnóstico Paso a Paso

### Paso 1: Verificar Carga Básica

1. ¿El modelo se carga sin errores?
   ```typescript
   // En loadModel()
   try {
     const gltf = await this.assetLoader.load('/models/Knight.glb');
     console.log('Model loaded:', gltf);
   } catch (error) {
     console.error('Load failed:', error);
   }
   ```

2. ¿El modelo se agrega a la escena?
   ```typescript
   console.log('Scene children:', this.sceneManager.scene.children.length);
   console.log('Model in scene?', this.sceneManager.scene.children.includes(this.model));
   ```

### Paso 2: Verificar Física

1. ¿Se crea el cuerpo físico?
   ```typescript
   console.log('Body handle:', this.bodyHandle);
   console.log('Body exists?', this.physicsWorld?.getWorld()?.getRigidBody(this.bodyHandle));
   ```

2. ¿El damping está configurado?
   ```typescript
   const body = this.physicsWorld?.getWorld()?.getRigidBody(this.bodyHandle);
   console.log('Linear damping:', body?.linearDamping());
   ```

### Paso 3: Verificar Animaciones

1. ¿Se cargan los clips de animación?
   ```typescript
   console.log('Animation clips:', allClips.length);
   allClips.forEach(clip => console.log(' -', clip.name, clip.duration));
   ```

2. ¿El mixer se crea correctamente?
   ```typescript
   console.log('Mixer created?', !!this.mixer);
   console.log('Mixer root:', this.mixer?.getRoot());
   ```

### Paso 4: Verificar Sincronización

1. ¿syncToPhysics() se llama?
   ```typescript
   // Agregar contador
   private syncCount = 0;
   public syncToPhysics(): void {
     this.syncCount++;
     if (this.syncCount % 60 === 0) {  // Cada segundo a 60Hz
       console.log('Sync called', this.syncCount, 'times');
     }
     // ... resto del código
   }
   ```

2. ¿Las posiciones coinciden?
   ```typescript
   const bodyPos = this.getBodyPosition();
   const modelPos = this.model?.position;
   console.log('Body:', bodyPos?.toArray(), 'Model:', modelPos?.toArray());
   ```

## 📊 Métricas de Salud del Sistema

### Métricas Ideales

| Métrica | Valor Ideal | Alerta | Crítico |
|---------|-------------|---------|---------|
| **FPS** | 60+ | < 50 | < 30 |
| **Sync Delta** | < 0.01m | > 0.1m | > 1.0m |
| **Animation FPS** | 60+ | < 30 | < 15 |
| **Memory** | < 100MB | > 200MB | > 500MB |
| **Load Time** | < 3s | > 5s | > 10s |

### Script de Monitoreo Automático

```typescript
// En main.ts, después de init
setInterval(() => {
  const metrics = {
    fps: Math.round(1000 / gameLoop.getAverageFrameTime()),
    syncDelta: meleeCharacter.getLastSyncDelta(),
    animationTime: meleeCharacter.getAnimationTime(),
    memory: performance.memory ? performance.memory.usedJSHeapSize / 1024 / 1024 : 0
  };
  
  console.table(metrics);
  
  // Alertar problemas
  if (metrics.fps < 50) console.warn('Low FPS:', metrics.fps);
  if (metrics.syncDelta > 0.1) console.warn('High sync delta:', metrics.syncDelta);
  
}, 5000);  // Cada 5 segundos
```

## 🛠️ Utilidades de Debug en Navegador

### Acceso desde Consola

```typescript
// Exponer objetos para debugging
window.debugCharacter = {
  melee: window.meleeCharacter,
  adc: window.adcCharacter,
  physics: window.physicsWorld,
  scene: window.sceneManager?.scene,
  
  // Funciones de utilidad
  logState: function() {
    console.log('Melee:', {
      position: this.melee?.model?.position.toArray(),
      animation: this.melee?.currentAnimationName,
      body: this.melee?.getBodyPosition()?.toArray()
    });
  },
  
  toggleDebugBox: function() {
    const debugBox = this.scene?.getObjectByName('debug-container');
    if (debugBox) {
      debugBox.visible = !debugBox.visible;
      console.log('Debug box visible:', debugBox.visible);
    }
  }
};
```

### Comandos de Consola Útiles

```javascript
// En la consola del navegador
> debugCharacter.logState()  // Ver estado actual
> debugCharacter.toggleDebugBox()  // Mostrar/ocultar caja debug
> window.meleeCharacter.playAnimation('Run')  // Forzar animación
> window.physicsWorld.getWorld().getRigidBody(1)?.setLinvel({x:0,y:0,z:0})  // Detener
```

## 🔧 Correcciones Rápidas (Quick Fixes)

### Si nada se mueve:

1. Verificar que `gameLoop` está corriendo
2. Verificar que `inputManager` está actualizándose
3. Verificar que `physicsWorld.stepAll()` se llama

### Si las animaciones no funcionan:

1. Verificar que `mixer.update(dt)` se llama cada frame
2. Verificar que los clips tienen nombres reconocibles
3. Verificar que `playAnimation()` tiene guard clause

### Si hay sliding:

1. Verificar `linearDamping` en `BodyFactory`
2. Verificar que no se aplican fuerzas residuales
3. Verificar `resetForces()` en `moveBody()`

### Si el modelo desaparece:

1. Verificar `frustumCulled = false` para `SkinnedMesh`
2. Verificar que el modelo está en la escena
3. Verificar escala y posición

## 📚 Recursos Adicionales

### Enlaces de Documentación

- [Three.js SkinnedMesh Documentation](https://threejs.org/docs/#api/en/objects/SkinnedMesh)
- [Rapier3D Damping API](https://rapier.rs/docs/user_guides/javascript/damping)
- [GLTF Animation System](https://github.com/KhronosGroup/glTF-Tutorials/blob/master/gltfTutorial/gltfTutorial_007_Animations.md)

### Herramientas Externas

1. **Three.js Inspector**: Extensión de Chrome para inspeccionar escenas
2. **Rapier Debug Renderer**: Visualización de físicas en tiempo real
3. **Chrome Performance Tab**: Profiling de FPS y memoria
4. **GLTF Viewer Online**: Verificar modelos fuera del juego

---

## 🎯 Resumen de Verificación Final

Antes de considerar el sistema como "funcional", verificar:

- [ ] **Movimiento**: Personaje se mueve con inputs
- [ ] **Física**: Colisiones funcionan, damping aplicado
- [ ] **Animaciones**: Transiciones suaves, sin resetear
- [ ] **Sincronización**: Modelo sigue posición física (< 0.01m delta)
- [ ] **Rendimiento**: 60 FPS estable con 2 personajes
- [ ] **Memory**: No hay leaks al crear/destruir personajes
- [ ] **Error handling**: Fallback model se activa si carga falla

Si todos los checks pasan, el sistema de personajes está listo para producción.