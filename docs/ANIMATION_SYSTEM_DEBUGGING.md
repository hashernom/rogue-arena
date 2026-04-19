# Documentación: Debugging del Sistema de Animaciones - Conflicto AnimationController vs Sistema Legacy

## Resumen Ejecutivo

**Fecha**: 19 de abril de 2026  
**Proyecto**: Rogue Arena - Sistema de Animaciones  
**Archivo afectado**: [`rogue-arena/client/src/characters/MeleeCharacter.ts`](rogue-arena/client/src/characters/MeleeCharacter.ts)  
**Síntoma**: Personaje en T-pose, pérdida de animaciones idle, walk y attack  
**Resolución**: Eliminación de conflicto entre dos sistemas de animación concurrentes

---

## 1. Contexto del Problema

### 1.1 Estado Inicial
El proyecto Rogue Arena implementa personajes 3D con animaciones GLTF usando Three.js. Existían dos sistemas de animación:

1. **Sistema Legacy**: Implementado en `AdcCharacter.ts` y originalmente en `MeleeCharacter.ts`
   - Usa `THREE.AnimationMixer` aplicado al `innerMesh` (skeleton)
   - Método `playAnimation()` con crossfade manual
   - Mapeo simple de clips por nombre

2. **Sistema AnimationController**: Nueva clase [`AnimationController.ts`](rogue-arena/client/src/characters/AnimationController.ts)
   - Diseñado para abstraer la lógica de animación
   - Implementa `syncWithCharacterState()` para transiciones automáticas
   - Crea su propio `THREE.AnimationMixer`

### 1.2 Cambio Problemático
En un intento de mejorar el sistema de animaciones, se integró `AnimationController` en `MeleeCharacter.ts`:

```typescript
// En loadModel():
this.animationController = new AnimationController(this.model, allClips);
this.animationController.syncWithCharacterState('idle', false, false);

// En update():
this.updateAnimations(dt); // Que llamaba a animationController.syncWithCharacterState()
```

### 1.3 Síntomas Reportados
1. **T-pose persistente**: Personaje en pose por defecto sin animaciones aplicadas
2. **Pérdida de animación idle**: No se reproducía animación de reposo
3. **Pérdida de animación walk**: Movimiento sin animación correspondiente
4. **Pérdida de animación attack**: Ataque sin animación visual

---

## 2. Análisis de Causa Raíz

### 2.1 Arquitectura de Three.js para Animaciones
```typescript
// Jerarquía correcta:
Container (THREE.Group)
└── InnerMesh (THREE.SkinnedMesh con skeleton)
    └── Bones (jerarquía de huesos para animación)

// AnimationMixer debe aplicarse al objeto que contiene el skeleton
const mixer = new THREE.AnimationMixer(innerMesh); // ✅ CORRECTO
```

### 2.2 Conflicto Identificado
**Problema 1**: Dos AnimationMixers compitiendo
```typescript
// En MeleeCharacter.loadModel():
this.mixer = new THREE.AnimationMixer(this.innerMesh); // Sistema legacy
this.animationController = new AnimationController(this.model, allClips);
// AnimationController internamente crea: new THREE.AnimationMixer(this.model)
```

**Problema 2**: Objetos destino incorrectos
- `AnimationController.mixer` → opera en `this.model` (contenedor Group)
- `MeleeCharacter.mixer` → opera en `this.innerMesh` (skeleton)

**Problema 3**: Animaciones procedurales inefectivas
```typescript
// En AnimationController.createProceduralClips():
const idleClip = new THREE.AnimationClip('idle', 2, [
  new THREE.VectorKeyframeTrack('.position[y]', [0, 1, 2], [0, 0.05, 0]),
]);
```
Estas animaciones solo afectan propiedades básicas del contenedor, no los bones del skeleton.

### 2.3 Consecuencia
- **Sistema Legacy**: Intenta animar el skeleton pero es ignorado por `updateAnimations()`
- **AnimationController**: Anima el contenedor pero no afecta el skeleton
- **Resultado**: Skeleton queda en T-pose (estado por defecto sin animaciones)

---

## 3. Metodología de Debugging

### 3.1 Análisis de Flujo de Datos
1. **Revisión de logs de consola**: Verificación de llamadas a `updateAnimations()`
2. **Comparación con AdcCharacter**: Análisis de implementación funcional
3. **Inspección de jerarquía de objetos**: Verificación de mixer y skeleton

### 3.2 Herramientas Utilizadas
- **Chrome DevTools**: Inspección de objetos Three.js
- **VSCode Debugger**: Puntos de interrupción en métodos críticos
- **Console.log estratégico**: Trazado de flujo de ejecución

### 3.3 Preguntas Clave para Diagnóstico
1. ¿Dónde se crea el AnimationMixer?
2. ¿Qué objeto recibe el mixer?
3. ¿Qué clips de animación están disponibles?
4. ¿Qué sistema controla la reproducción final?

---

## 4. Solución Implementada

### 4.1 Decisión Arquitectónica
**Opción A**: Refactorizar AnimationController para usar el mixer existente  
**Opción B**: Eliminar AnimationController y restaurar sistema legacy  
**Decisión**: Opción B (por simplicidad y compatibilidad)

### 4.2 Cambios Específicos en [`MeleeCharacter.ts`](rogue-arena/client/src/characters/MeleeCharacter.ts)

#### 4.2.1 En `loadModel()`:
```diff
- // Crear AnimationController con los clips cargados
- this.animationController = new AnimationController(this.model, allClips);
- console.log(`[MeleeCharacter ${this.id}] AnimationController creado con ${allClips.length} clips`);
- 
- // Iniciamos con animación idle a través del AnimationController
- this.animationController.syncWithCharacterState('idle', false, false);
+ // Iniciamos con animación idle
+ this.playAnimation('Idle');
```

#### 4.2.2 En `update()`:
```diff
- // Actualizar animaciones basadas en el estado actual
- this.updateAnimations(dt);
+ // Actualizar animaciones basadas en el estado actual (sistema legacy)
+ if (this.state === CharacterState.Moving) {
+   this.playAnimation('Run');
+ } else if (this.state === CharacterState.Idle) {
+   this.playAnimation('Idle');
+ }
+ // Nota: El estado Attacking se maneja en el método attack()
```

#### 4.2.3 En `attack()`:
```diff
  // Usar el sistema MeleeAttack para detección de golpes
  if (this.meleeAttack && this.meleeAttack.tryAttack()) {
    this.setState(CharacterState.Attacking);
    
+   // Reproducir animación de ataque
+   this.playAnimation('Attack');
+   
    // Fail-safe: Destrabar al personaje en 1200ms
    setTimeout(() => {
      if (this.state === CharacterState.Attacking) {
        this.setState(CharacterState.Idle);
+       this.playAnimation('Idle');
      }
    }, 1200);
  }
```

#### 4.2.4 Eliminación de `updateAnimations()`:
```typescript
// Método completo eliminado
private updateAnimations(dt: number): void {
  // Código removido que dependía de animationController
}
```

#### 4.2.5 En `createFallbackModel()`:
```diff
- // Crear AnimationController con animaciones procedurales
- this.animationController = new AnimationController(this.model, []);
- console.log(`[MeleeCharacter ${this.id}] AnimationController de fallback creado`);
+ // Iniciar con animación idle
+ this.playAnimation('Idle');
```

### 4.3 Mantenimiento de Funcionalidad Existente
- **Debug mesh toggle** (tecla 'M'): Conservado
- **Sistema de ataque melee**: Funcional
- **Integración con eventos**: Preservada
- **Carga de modelos GLTF**: Sin cambios

---

## 5. Prácticas Recomendadas para Implementación de Animaciones

### 5.1 Principio de Single Source of Truth
```typescript
// ❌ EVITAR: Múltiples mixers
const mixer1 = new THREE.AnimationMixer(model);
const mixer2 = new THREE.AnimationMixer(innerMesh);

// ✅ PREFERIR: Un solo mixer por skeleton
const mixer = new THREE.AnimationMixer(skinnedMesh);
```

### 5.2 Validación de Jerarquía de Objetos
```typescript
function validateAnimationTarget(object: THREE.Object3D): boolean {
  const isSkinnedMesh = (object as THREE.SkinnedMesh).isSkinnedMesh;
  const hasSkeleton = (object as THREE.SkinnedMesh).skeleton !== undefined;
  return isSkinnedMesh && hasSkeleton;
}
```

### 5.3 Patrón de Controlador de Animaciones (Revisado)
```typescript
class SafeAnimationController {
  private mixer: THREE.AnimationMixer;
  private targetMesh: THREE.SkinnedMesh;
  
  constructor(targetMesh: THREE.SkinnedMesh, clips: THREE.AnimationClip[]) {
    // Validar que el target sea un SkinnedMesh
    if (!targetMesh.isSkinnedMesh) {
      throw new Error('AnimationController requiere un SkinnedMesh como target');
    }
    
    this.targetMesh = targetMesh;
    this.mixer = new THREE.AnimationMixer(targetMesh);
    // ... inicialización de clips
  }
}
```

### 5.4 Estrategia de Migración Gradual
1. **Fase 1**: Mantener sistema existente funcional
2. **Fase 2**: Crear nuevo sistema en paralelo
3. **Fase 3**: Validar con tests A/B
4. **Fase 4**: Migrar gradualmente
5. **Fase 5**: Deprecar sistema antiguo

---

## 6. Casos de Uso y Lecciones Aprendidas

### 6.1 Caso de Uso: Integración de Nuevos Sistemas
**Situación**: Queremos agregar `AnimationController` a un código base existente  
**Solución**:
1. Crear branch de feature
2. Implementar en un personaje de prueba
3. Validar con tests visuales
4. Comparar rendimiento
5. Documentar cambios

### 6.2 Caso de Uso: Debugging de T-pose
**Síntoma**: Personaje en pose por defecto  
**Checklist de diagnóstico**:
- [ ] ¿El mixer está creado?
- [ ] ¿El mixer tiene el target correcto?
- [ ] ¿Hay clips de animación disponibles?
- [ ] ¿Se está llamando a `mixer.update(dt)`?
- [ ] ¿Hay acciones reproduciéndose?

### 6.3 Lecciones Clave
1. **No asumir compatibilidad**: Nuevos sistemas deben validarse con la arquitectura existente
2. **Mantener retrocompatibilidad**: Cambios deben ser incrementales
3. **Validar jerarquía de objetos**: Three.js requiere targets específicos para animaciones
4. **Usar logging estratégico**: Console.log en puntos críticos ayuda al diagnóstico
5. **Comparar con referencia**: `AdcCharacter.ts` servía como implementación de referencia

---

## 7. Métricas de Validación

### 7.1 Validación Post-Corrección
| Métrica | Estado Pre-Corrección | Estado Post-Corrección |
|---------|----------------------|-----------------------|
| Animación Idle | ❌ No funcionaba | ✅ Funciona |
| Animación Walk | ❌ No funcionaba | ✅ Funciona |
| Animación Attack | ❌ No funcionaba | ✅ Funciona |
| T-pose | ✅ Presente | ❌ Eliminada |
| Performance | ⚠️ 2 mixers | ✅ 1 mixer |
| Código mantenible | ❌ Complejo | ✅ Simple |

### 7.2 Impacto en Performance
- **Reducción de mixers**: 2 → 1 (50% reducción)
- **Simplificación de update loop**: Llamadas directas vs sincronización automática
- **Memoria**: Eliminación de instancias duplicadas de AnimationController

---

## 8. Conclusión y Recomendaciones

### 8.1 Conclusión
El problema fue un **conflicto arquitectónico** entre dos sistemas de animación que operaban en diferentes niveles de la jerarquía de objetos Three.js. La solución fue **simplificar** volviendo al sistema probado y funcional.

### 8.2 Recomendaciones para el Futuro
1. **Documentar dependencias de arquitectura**: Especificar qué objetos pueden recibir animaciones
2. **Crear tests de integración**: Validar que nuevos sistemas funcionen con la jerarquía existente
3. **Establecer patrón de referencia**: Usar `AdcCharacter.ts` como implementación de referencia
4. **Implementar validación en runtime**: Chequear que AnimationMixer reciba SkinnedMesh

### 8.3 Archivos Relacionados
- [`rogue-arena/client/src/characters/MeleeCharacter.ts`](rogue-arena/client/src/characters/MeleeCharacter.ts) - Implementación corregida
- [`rogue-arena/client/src/characters/AdcCharacter.ts`](rogue-arena/client/src/characters/AdcCharacter.ts) - Implementación de referencia
- [`rogue-arena/client/src/characters/AnimationController.ts`](rogue-arena/client/src/characters/AnimationController.ts) - Sistema alternativo
- [`rogue-arena/docs/TROUBLESHOOTING_CHARACTERS.md`](rogue-arena/docs/TROUBLESHOOTING_CHARACTERS.md) - Guía de troubleshooting

---

**Documentación creada por**: Sistema de Documentación Técnica  
**Última actualización**: 19 de abril de 2026  
**Estado**: ✅ Resuelto - Sistema de animaciones funcional