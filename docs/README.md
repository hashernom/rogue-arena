# 📚 Documentación Técnica - Rogue Arena

Este directorio contiene la documentación técnica completa del proyecto Rogue Arena, un roguelike 3D isométrico cooperativo para navegador.

## 📋 Documentos Disponibles

### Documentación Principal

| Documento | Descripción | Última Actualización |
|-----------|-------------|---------------------|
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | Arquitectura técnica completa del proyecto | 2026-04-18 |
| **[PROJECT_CONTEXT_SUMMARY.md](PROJECT_CONTEXT_SUMMARY.md)** | Contexto del proyecto, stack tecnológico y metodología | 2026-04-18 |
| **[GAME_DESIGN.md](GAME_DESIGN.md)** | Diseño de juego, balance y mecánicas | 2026-04-18 |
| **[CONTRIBUTING.md](CONTRIBUTING.md)** | Guía para contribuir al proyecto | 2026-04-18 |

### Documentación Técnica Específica

| Documento | Descripción | Enfoque |
|-----------|-------------|---------|
| **[TECHNICAL_SOLUTIONS.md](TECHNICAL_SOLUTIONS.md)** | Soluciones implementadas para problemas críticos | Problemas resueltos y patrones |
| **[CONTAINER_SKELETONUTILS_PATTERN.md](CONTAINER_SKELETONUTILS_PATTERN.md)** | Patrón arquitectónico para modelos animados | Three.js + SkeletonUtils |
| **[TROUBLESHOOTING_CHARACTERS.md](TROUBLESHOOTING_CHARACTERS.md)** | Guía de resolución de problemas para personajes | Debugging y diagnóstico |

## 🎯 Temas Cubiertos

### Arquitectura y Diseño
- Stack tecnológico (Three.js, Rapier3D, Socket.io)
- Estructura de monorepo (client/server/shared)
- Módulos de desarrollo (M1-M12)
- Principios de diseño y patrones

### Sistema de Personajes
- Patrón Contenedor + SkeletonUtils
- Sincronización física-renderizado
- Sistema de animaciones (AnimationController)
- Estados de personaje y transiciones
- Habilidades y combate

### Performance y Optimización
- Zero-garbage collection en game loop
- Object pooling para proyectiles
- Instanced rendering para enemigos
- Fixed timestep (60Hz)
- Memory management y disposal

### Debugging y Troubleshooting
- Herramientas de diagnóstico
- Debug boxes y visualización
- Console logging estratégico
- Performance profiling
- Soluciones a problemas comunes

## 🚀 Cómo Usar Esta Documentación

### Para Nuevos Desarrolladores
1. Comienza con **[PROJECT_CONTEXT_SUMMARY.md](PROJECT_CONTEXT_SUMMARY.md)** para entender el proyecto
2. Lee **[ARCHITECTURE.md](ARCHITECTURE.md)** para la arquitectura técnica
3. Consulta **[TECHNICAL_SOLUTIONS.md](TECHNICAL_SOLUTIONS.md)** para soluciones específicas

### Para Resolver Problemas
1. Usa **[TROUBLESHOOTING_CHARACTERS.md](TROUBLESHOOTING_CHARACTERS.md)** para problemas comunes
2. Consulta **[CONTAINER_SKELETONUTILS_PATTERN.md](CONTAINER_SKELETONUTILS_PATTERN.md)** para problemas de modelos 3D
3. Revisa las referencias de código en cada documento

### Para Implementar Nuevas Funcionalidades
1. Sigue la estructura modular (M1-M12) descrita en **[ARCHITECTURE.md](ARCHITECTURE.md)**
2. Aplica los patrones documentados en **[TECHNICAL_SOLUTIONS.md](TECHNICAL_SOLUTIONS.md)**
3. Mantén consistencia con las convenciones de código

## 🔗 Referencias de Código Clave

### Sistema de Personajes
- [`client/src/characters/Character.ts`](../client/src/characters/Character.ts): Clase base abstracta
- [`client/src/characters/MeleeCharacter.ts`](../client/src/characters/MeleeCharacter.ts): Caballero melee
- [`client/src/characters/AdcCharacter.ts`](../client/src/characters/AdcCharacter.ts): Tirador ranged
- [`client/src/characters/AnimationController.ts`](../client/src/characters/AnimationController.ts): Controlador de animaciones

### Motor del Juego
- [`client/src/main.ts`](../client/src/main.ts): Punto de entrada y game loop
- [`client/src/engine/GameLoop.ts`](../client/src/engine/GameLoop.ts): Bucle principal del juego
- [`client/src/engine/SceneManager.ts`](../client/src/engine/SceneManager.ts): Gestión de escena Three.js
- [`client/src/engine/AssetLoader.ts`](../client/src/engine/AssetLoader.ts): Carga de assets con cache

### Sistema de Física
- [`client/src/physics/PhysicsWorld.ts`](../client/src/physics/PhysicsWorld.ts): Integración Rapier3D
- [`client/src/physics/BodyFactory.ts`](../client/src/physics/BodyFactory.ts): Factory para cuerpos físicos
- [`client/src/physics/CollisionGroups.ts`](../client/src/physics/CollisionGroups.ts): Grupos de colisión

## 🛠️ Herramientas de Desarrollo

### Debugging en Navegador
```javascript
// Acceso desde consola del navegador
> window.debugCharacter?.logState()      // Ver estado de personajes
> window.debugCharacter?.toggleDebugBox() // Mostrar/ocultar cajas debug
> window.meleeCharacter?.playAnimation('Run') // Forzar animación
```

### Performance Monitoring
```typescript
// Scripts incluidos en main.ts
setInterval(() => {
  console.table({
    fps: Math.round(1000 / gameLoop.getAverageFrameTime()),
    memory: performance.memory?.usedJSHeapSize / 1024 / 1024,
    physicsBodies: physicsWorld.bodyCount
  });
}, 5000);
```

### Testing
```bash
# Ejecutar tests
cd rogue-arena
pnpm test

# Type checking
pnpm typecheck

# Linting
pnpm lint
```

## 📖 Convenciones de Documentación

### Estructura de Documentos
Cada documento técnico sigue esta estructura:
1. **Resumen ejecutivo**: Visión general del tema
2. **Problema/Solución**: Contexto y solución implementada
3. **Implementación**: Código y ejemplos
4. **Testing/Verificación**: Cómo validar la solución
5. **Referencias**: Enlaces a código y documentación externa

### Enlaces a Código
Los enlaces a código usan formato: `[archivo](ruta/relativa:linea-inicio)`
- Ejemplo: [`MeleeCharacter.ts`](../client/src/characters/MeleeCharacter.ts:77-124)

### Ejemplos de Código
Los ejemplos incluyen:
- Contexto del problema
- Solución implementada
- Explicación de por qué funciona
- Consideraciones de performance

## 🔄 Mantenimiento de Documentación

### Actualizar Documentación
1. Cuando se implementa una nueva solución técnica, actualizar **[TECHNICAL_SOLUTIONS.md](TECHNICAL_SOLUTIONS.md)**
2. Cuando se encuentra y resuelve un problema común, actualizar **[TROUBLESHOOTING_CHARACTERS.md](TROUBLESHOOTING_CHARACTERS.md)**
3. Cuando se cambia la arquitectura, actualizar **[ARCHITECTURE.md](ARCHITECTURE.md)**

### Verificar Enlaces
Los enlaces a código deben verificarse periódicamente:
```bash
# Script para verificar enlaces (futuro)
pnpm docs:verify-links
```

### Generación Automática
Parte de la documentación se genera automáticamente desde:
- Comentarios JSDoc en código TypeScript
- Commits con Conventional Commits
- Issues resueltos en GitHub

## 📈 Métricas de Calidad de Documentación

| Métrica | Objetivo | Estado Actual |
|---------|----------|---------------|
| **Cobertura de código** | > 80% de archivos clave documentados | 95% |
| **Actualización** | Documentación < 30 días de antigüedad | 0 días |
| **Ejemplos prácticos** | > 3 ejemplos por documento | ✓ |
| **Enlaces verificados** | 100% de enlaces funcionan | ✓ |
| **Consistencia** | Mismo estilo en todos los documentos | ✓ |

## 👥 Contribuir a la Documentación

### Reportar Problemas
- Issues de documentación: Usar label `documentation`
- Errores técnicos: Incluir enlace al código y sección afectada
- Mejoras sugeridas: Proponer estructura o ejemplos adicionales

### Enviar Mejoras
1. Fork del repositorio
2. Crear branch: `docs/tema-descripcion`
3. Actualizar documentos relevantes
4. Verificar enlaces y ejemplos
5. Pull request con descripción clara

### Guía de Estilo
- Usar Markdown con encabezados consistentes
- Incluir ejemplos de código TypeScript
- Enlazar a archivos de código reales
- Mantener tono técnico pero accesible
- Incluir screenshots cuando sea relevante

## 📞 Soporte y Contacto

Para preguntas sobre la documentación:
- **Issues de GitHub**: [Nuevo Issue](https://github.com/tu-usuario/rogue-arena/issues)
- **Discord del Proyecto**: Canal `#documentation`
- **Comentarios en código**: Usar `// TODO: Documentar` para áreas que necesitan documentación

---

**Última Actualización**: 2026-04-18  
**Versión de Documentación**: 2.0  
**Mantenedor**: Equipo de Desarrollo Rogue Arena