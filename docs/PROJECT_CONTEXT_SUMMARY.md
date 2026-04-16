# 🎮 Rogue Arena - Contexto del Proyecto

## 📋 **Resumen Ejecutivo**

**Rogue Arena** es un roguelike 3D isométrico para navegador con multijugador online en tiempo real para 2 jugadores. Dos jugadores cooperan para sobrevivir oleadas de enemigos en una arena 3D, eligiendo entre arquetipos **Caballero** (melee) o **Tirador** (ranged), mejorando sus personajes entre rondas con dinero obtenido de enemigos eliminados.

## 🏗️ **Stack Tecnológico**

| Capa | Tecnología | Propósito |
|------|-----------|-----------|
| **Renderizado** | Three.js v0.168+ | Gráficos 3D WebGL |
| **Física** | Rapier3D WASM v0.12+ | Simulación física determinista |
| **Multiplayer** | Socket.io v4+ | Comunicación real-time |
| **Frontend** | Vite + TypeScript | Bundling y desarrollo |
| **Backend** | Node.js + Express | Servidor de juego |
| **Monorepo** | pnpm workspaces v9+ | Gestión de paquetes |
| **Audio** | Web Audio API | Sonido 3D espacial |
| **Modelos** | GLTF 2.0 Low Poly | Assets 3D optimizados |

## 📊 **Metodología de Desarrollo**

### **Estructura Modular (M1-M12)**
El proyecto está dividido en **12 módulos secuenciales**, cada uno con 4-6 issues específicos:

1. **M1 - Project Setup** - Infraestructura base (monorepo, CI, tooling)
2. **M2 - Core Engine** - Game loop, renderer, cámara, asset loader
3. **M3 - Physics & Collision** - Integración Rapier3D, hitboxes
4. **M4 - Characters** - Sistema base, arquetipos, stats, animaciones
5. **M5 - Combat System** - Detección de hits, daño, proyectiles
6. **M6 - Enemy System** - IA básica, 4 tipos de enemigos
7. **M7 - Wave System** - Oleadas progresivas, spawn patterns
8. **M8 - Progression & Economy** - Dinero, items, tienda, upgrades
9. **M9 - Multiplayer** - Socket.io, sync, predicción cliente
10. **M10 - UI & HUD** - Interfaz, HUD, lobby, tienda
11. **M11 - Audio** - Sistema de sonido 3D espacial
12. **M12 - Map & Environment** - Arena, obstáculos, decoraciones

### **Sistema de Issues (61 total)**
Cada issue sigue un formato estandarizado:
- **Objetivo**: Descripción clara del resultado esperado
- **Pasos de implementación**: Lista numerada de tareas técnicas
- **Criterios de aceptación**: Checklist verificable
- **Labels**: `module:*`, `priority:*`, `type:*`, `status:*`

### **Prioridades**
- **Critical**: Bloqueante para continuar desarrollo
- **High**: Alta prioridad funcional
- **Medium**: Mejoras importantes
- **Low**: Nice-to-have

## 🏗️ **Arquitectura Técnica**

### **Monorepo Structure**
```
rogue-arena/
├── client/          # Frontend - Three.js + Vite
├── server/          # Backend - Node.js + Socket.io
├── shared/          # Tipos TypeScript compartidos
├── docs/            # Documentación
└── .github/         # CI/CD workflows
```

### **Principios de Diseño**
1. **Desacoplamiento**: Sistemas comunican vía EventBus tipado
2. **Fixed Timestep**: Game loop a 60Hz independiente del framerate
3. **Caching**: Asset loader con cache para modelos GLTF
4. **Instancing**: Reutilización de assets para performance
5. **Type Safety**: TypeScript estricto en todo el código
6. **WASM First**: Rapier3D compilado a WebAssembly

### **Patrones Clave**
- **Singleton**: SceneManager, AssetLoader, InputManager
- **Observer**: EventBus para comunicación entre sistemas
- **Factory**: Creación de enemigos y personajes
- **State**: Máquinas de estado para IA y game flow
- **Component**: Entidades del juego (futura extensión a ECS)

## 🔄 **Flujo de Desarrollo**

### **Git Workflow**
- **main**: Releases estables
- **develop**: Integración continua
- **feature/***: Nuevas funcionalidades por módulo
- **hotfix/***: Correcciones urgentes

### **CI/CD Pipeline**
```yaml
name: CI
on: [push, pull_request]
jobs:
  lint-build:
    steps:
      - pnpm install --frozen-lockfile
      - pnpm lint
      - pnpm typecheck
      - pnpm build
```

### **Convenciones de Commit**
- `feat(MX):` Nueva funcionalidad del módulo X
- `fix(MX):` Corrección de bug en módulo X
- `chore(MX):` Configuración/tooling del módulo X
- `docs(MX):` Documentación del módulo X
- `refactor(MX):` Refactorización en módulo X

## 🚀 **Escalabilidad y Performance**

### **Optimizaciones Planeadas**
1. **Frustum Culling**: Renderizado solo de objetos visibles
2. **Instanced Meshes**: Múltiples enemigos con misma malla
3. **Texture Atlas**: Spritesheets para UI y efectos
4. **Object Pooling**: Reutilización de proyectiles y partículas
5. **Level of Detail (LOD)**: Modelos simplificados a distancia
6. **WebWorker**: Cálculos de física en thread separado

### **Targets de Performance**
- **60 FPS** en hardware modesto (GTX 1050 equivalente)
- **< 100ms** latency de red para multiplayer
- **< 5MB** de assets iniciales (compresión GLTF)
- **< 2s** tiempo de carga inicial

## 🎮 **Game Design Core**

### **Loop de Juego**
1. **Lobby**: Selección de arquetipo (Caballero/Tirador)
2. **Wave Start**: Spawn de enemigos con patrones progresivos
3. **Combat**: Supervivencia cooperativa, uso de habilidades
4. **Wave End**: Recolección de dinero, reparación
5. **Shop Phase**: Compra de upgrades entre rondas
6. **Repeat**: Hasta derrota o victoria (boss cada 5 rondas)

### **Sistemas de Progresión**
- **Dinero**: Drop de enemigos, usado en tienda
- **Items**: 3 niveles (común, raro, épico) con efectos pasivos
- **Upgrades**: Mejoras de stats (daño, velocidad, vida)
- **Habilidades**: Activas (Q/E) con cooldowns

### **Balance**
- **Escalado exponencial**: Enemigos 15% más fuertes por ronda
- **Curva de dificultad**: Boss cada 5 rondas con mecánicas únicas
- **Economía controlada**: Precios escalan con poder del jugador

## 🔧 **Herramientas y Configuración**

### **Dev Environment**
- **Editor**: VS Code con extensiones ESLint/Prettier
- **Package Manager**: pnpm con workspaces
- **Hot Reload**: Vite HMR para desarrollo rápido
- **Debug**: Three.js devtools, Rapier debug renderer

### **Quality Gates**
- **ESLint**: Reglas TypeScript estrictas
- **Prettier**: Formato consistente
- **TypeScript**: Strict mode, no implicit any
- **Tests**: Unit tests para lógica core (planeado)

## 📈 **Roadmap y Milestones**

### **Fase 1: Foundation (M1-M3)**
- ✅ M1: Monorepo, CI, tooling
- ✅ M2: Game loop, renderer, assets
- 🔄 M3: Física, colisiones

### **Fase 2: Gameplay Core (M4-M7)**
- Personajes, combate, enemigos, oleadas

### **Fase 3: Polish & Multiplayer (M8-M10)**
- Progresión, UI, multiplayer sync

### **Fase 4: Final Polish (M11-M12)**
- Audio, ambiente, optimizaciones

## 🎯 **Puntos Clave para Asistentes IA**

### **Contexto Técnico Esencial**
1. **Monorepo con pnpm**: Usar `pnpm --filter` para comandos específicos
2. **TypeScript estricto**: Configuración en `tsconfig.base.json`
3. **Three.js + Rapier**: Integración WASM ya configurada en Vite
4. **Socket.io events**: Tipos definidos en `@rogue-arena/shared`

### **Decisiones de Diseño**
- **Cámara isométrica**: OrthographicCamera, no Perspective
- **Fixed timestep**: Física a 60Hz, render interpolado
- **Low poly art style**: Modelos simples, colores planos
- **Co-op focus**: 2 jugadores, no PvP

### **Constraints Técnicos**
- **Browser target**: Chrome 90+, Firefox 88+, Safari 14+
- **Network**: WebSocket para real-time, fallback a polling
- **Assets**: GLTF comprimido con Draco, textures PNG
- **Mobile**: Touch controls opcionales (no prioridad)

### **Extension Points**
- **ECS Architecture**: Preparado para migración futura
- **Modding Support**: JSON configs para waves/items
- **Spectator Mode**: Observadores en partidas (post-launch)
- **Additional Characters**: Más arquetipos (Mago, Sanador)

## 📚 **Recursos y Referencias**

### **Documentación Interna**
- `docs/ARCHITECTURE.md` - Stack técnico detallado
- `docs/GAME_DESIGN.md` - Mecánicas y balance
- `docs/CONTRIBUTING.md` - Guía de contribución

### **Enlaces Externos**
- **Three.js Docs**: https://threejs.org/docs/
- **Rapier3D**: https://rapier.rs/docs/
- **Socket.io**: https://socket.io/docs/v4/
- **Vite**: https://vitejs.dev/guide/

---

**Última actualización**: 2026-04-16  
**Estado**: Fase 1 en progreso (M1 completado, M2 en desarrollo)  
**Repositorio**: https://github.com/hashernom/rogue-arena  
**Issues**: 61 issues creados, asignados a 12 milestones  
**Kanban**: https://github.com/users/hashernom/projects/2