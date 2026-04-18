# 🏗️ Rogue Arena — Arquitectura Técnica

## 1. Stack Tecnológico

| Categoría | Tecnología | Versión | Rol |
|-----------|-----------|---------|-----|
| Renderizado | Three.js | ^0.168.0 | Motor 3D WebGL |
| Física | @dimforge/rapier3d-compat | ^0.12.0 | Simulación WASM + colisiones |
| Bundler | Vite | ^5.x | Build + dev server HMR |
| Lenguaje | TypeScript | ^5.x | Tipado estático (cliente + servidor) |
| Multiplayer client | Socket.io-client | ^4.x | WebSocket cliente |
| Multiplayer server | Node.js + Socket.io | LTS + ^4.x | Servidor autoritativo |
| Modelos 3D | GLTF 2.0 | — | Assets low poly |
| Audio | Web Audio API | nativa | FX espaciales |
| Packages | pnpm workspaces | ^9.x | Monorepo |
| Linting | ESLint + Prettier | ^9.x | Calidad de código |
| CI | GitHub Actions | — | Lint + build en PRs |

---

## 2. Módulos de Desarrollo

| ID | Módulo | Descripción |
|----|--------|-------------|
| **M1** | Project Setup | Scaffold, tooling, CI |
| **M2** | Core Engine | Game loop, Scene, Input, Assets, EventBus |
| **M3** | Physics | Rapier3D, PhysicsWorld, Collision groups |
| **M4** | Characters | Caballero + Tirador, stats, animaciones, habilidades |
| **M5** | Combat | Melee, proyectiles, damage pipeline, knockback |
| **M6** | Enemies | 4 tipos de enemigos, steering AI |
| **M7** | Waves | WaveManager, spawner, escalado, boss waves |
| **M8** | Progression | Economía, shop, upgrades |
| **M9** | Multiplayer | Socket.io server, rooms, state sync, prediction |
| **M10** | UI & HUD | Lobby, HUD, Shop UI, Game Over |
| **M11** | Audio | AudioManager, audio 3D espacial |
| **M12** | Map | Arena, tilemap, props low poly |

---

## 3. Estructura de Carpetas

```
rogue-arena/
├── client/
│   ├── src/
│   │   ├── engine/               # M2
│   │   │   ├── GameLoop.ts
│   │   │   ├── SceneManager.ts
│   │   │   ├── InputManager.ts
│   │   │   ├── AssetLoader.ts
│   │   │   └── EventBus.ts
│   │   ├── physics/              # M3
│   │   │   ├── PhysicsWorld.ts
│   │   │   └── CollisionGroups.ts
│   │   ├── characters/           # M4
│   │   │   ├── Character.ts
│   │   │   ├── MeleeCharacter.ts
│   │   │   └── ADCCharacter.ts
│   │   ├── combat/               # M5
│   │   │   ├── MeleeAttack.ts
│   │   │   ├── Projectile.ts
│   │   │   └── DamagePipeline.ts
│   │   ├── enemies/              # M6
│   │   │   ├── Enemy.ts
│   │   │   ├── EnemyBasic.ts
│   │   │   ├── EnemyFast.ts
│   │   │   ├── EnemyTank.ts
│   │   │   └── EnemyRanged.ts
│   │   ├── waves/                # M7
│   │   │   ├── WaveManager.ts
│   │   │   └── Spawner.ts
│   │   ├── progression/          # M8
│   │   │   ├── MoneySystem.ts
│   │   │   ├── Shop.ts
│   │   │   └── items/
│   │   ├── network/              # M9
│   │   │   ├── SocketClient.ts
│   │   │   ├── StateSync.ts
│   │   │   └── Prediction.ts
│   │   ├── ui/                   # M10
│   │   │   ├── HUD.ts
│   │   │   ├── LobbyScreen.ts
│   │   │   └── ShopScreen.ts
│   │   ├── audio/                # M11
│   │   │   └── AudioManager.ts
│   │   ├── map/                  # M12
│   │   │   ├── Arena.ts
│   │   │   └── TilemapLoader.ts
│   │   ├── types/
│   │   └── main.ts
│   ├── public/
│   │   └── assets/
│   │       ├── models/
│   │       ├── sounds/
│   │       └── maps/
│   ├── index.html
│   ├── vite.config.ts
│   └── tsconfig.json
├── server/
│   ├── src/
│   │   ├── GameServer.ts
│   │   ├── RoomManager.ts
│   │   ├── GameState.ts
│   │   └── index.ts
│   └── tsconfig.json
├── shared/
│   └── types/
│       ├── GameState.ts
│       ├── Player.ts
│       └── Events.ts
├── docs/
├── .github/workflows/ci.yml
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

---

## 4. Arquitectura Multiplayer

```
[Player 1 — Browser]                    [Player 2 — Browser]
  Three.js renderer                       Three.js renderer
  Rapier physics (local predict)          Rapier physics (local predict)
  Socket.io-client                        Socket.io-client
         │        WebSocket                      │
         └─────────────┬────────────────────────┘
                       │
               [Node.js Game Server]
               ├── RoomManager       — Salas co-op (max 2P)
               ├── GameState         — Estado autoritativo
               ├── Rapier server     — Física enemigos
               └── Socket.io server  — 20 ticks/s
```

### Protocolo de eventos

| Dirección | Evento | Payload |
|-----------|--------|---------|
| C → S | `player:input` | `{ dir, attacking, ability, ts }` |
| S → C | `state:snapshot` | `{ players, enemies, projectiles, tick }` |
| C → S | `room:create` | `{ name, character }` |
| C → S | `room:join` | `{ code, name, character }` |
| S → C | `room:ready` | `{ roomCode, players[] }` |
| S → C | `wave:start` | `{ round, enemies[] }` |
| S → C | `wave:end` | `{ reward }` |
| S → C | `game:over` | `{ rounds, kills, damage }` |

### Estrategia de sincronización
- **Tick rate servidor:** 20 Hz (snapshot cada 50ms)
- **Client-side prediction:** El cliente aplica inputs localmente sin esperar ACK
- **Server reconciliation:** El servidor corrige posiciones divergentes cada tick
- **Entity interpolation:** Entidades remotas interpoladas entre snapshots

---

## 5. Personajes

### ⚔️ Caballero (Melee)
| Stat | Valor base | Nota |
|------|-----------|------|
| HP | 150 | Mayor tanqueo |
| Velocidad | 4 m/s | — |
| Daño melee | 25 | Por hit, arco 120° |
| Rango ataque | 1.5 m | — |
| Vel. ataque | 0.8/s | — |
| Armadura | 10 | Reducción de daño |

**Pasiva — Furia:** Cada 3 kills, el siguiente golpe hace ×2 daño  
**Activa Q — Embestida:** Dash frontal + daño en cono (CD: 6s)

### 🏹 Tirador (ADC)
| Stat | Valor base | Nota |
|------|-----------|------|
| HP | 80 | Frágil |
| Velocidad | 5 m/s | Más ágil |
| Daño proyectil | 15 | Por bala |
| Rango ataque | 8 m | Long range |
| Vel. ataque | 2/s | Rápido |
| Armadura | 2 | Muy bajo |

**Pasiva — Perforación:** Cada 5 proyectiles, bala que atraviesa enemigos  
**Activa Q — Salva:** 3 proyectiles en abanico 60° (CD: 4s)

---

## 6. Enemigos

| Tipo | HP | Speed | Daño | Comportamiento |
|------|----|-------|------|----------------|
| Básico | 40 | 2.5 | 8 | Persigue jugador más cercano |
| Rápido | 20 | 5.5 | 5 | Flanquea, prioriza ADC |
| Tanque | 200 | 1.5 | 15 | Lento, inmune a knockback |
| Ranged | 30 | 2.0 | 10 | Mantiene 5m, dispara |

---

## 7. Sistema de Oleadas

```
enemyCount(N)  = 5 + (N × 2)
enemyHP(N)     = baseHP × 1.12^N
enemySpeed(N)  = baseSpeed × 1.03^N
reward(N)      = 20 + (N × 5) monedas

Cada 5 rondas → Boss wave (mini-boss + oleada reducida)
```

---

## 8. Economía

| Evento | Monedas |
|--------|---------|
| Kill básico | 2–4 |
| Kill rápido | 1–2 |
| Kill tanque | 6–10 |
| Kill ranged | 3–5 |
| Ronda completada | 20 + (ronda × 5) |

**Shop entre rondas:** 3 ítems aleatorios del pool, precio 15–50 monedas

---

## 9. Convenciones de Código

| Elemento | Convención | Ejemplo |
|----------|-----------|---------|
| Clases | PascalCase | `WaveManager` |
| Funciones | camelCase | `getClosestEnemy()` |
| Constantes | UPPER_SNAKE_CASE | `MAX_ENEMIES` |
| Eventos | `dominio:accion` | `player:died` |
| Branches | `feature/M{n}-descripcion` | `feature/M4-melee-character` |
| Commits | Conventional Commits | `feat(M4): add MeleeCharacter` |

---

## 10. Documentación Técnica Adicional

Para soluciones técnicas detalladas y guías de implementación, consultar:

| Documento | Propósito | Enlace |
|-----------|-----------|--------|
| **TECHNICAL_SOLUTIONS.md** | Soluciones implementadas para problemas críticos | [`docs/TECHNICAL_SOLUTIONS.md`](docs/TECHNICAL_SOLUTIONS.md) |
| **CONTAINER_SKELETONUTILS_PATTERN.md** | Patrón arquitectónico para modelos animados | [`docs/CONTAINER_SKELETONUTILS_PATTERN.md`](docs/CONTAINER_SKELETONUTILS_PATTERN.md) |
| **TROUBLESHOOTING_CHARACTERS.md** | Guía de resolución de problemas para personajes | [`docs/TROUBLESHOOTING_CHARACTERS.md`](docs/TROUBLESHOOTING_CHARACTERS.md) |
| **PROJECT_CONTEXT_SUMMARY.md** | Contexto completo del proyecto | [`docs/PROJECT_CONTEXT_SUMMARY.md`](docs/PROJECT_CONTEXT_SUMMARY.md) |
| **GAME_DESIGN.md** | Diseño de juego y balance | [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) |

### Temas Cubiertos en Documentación Adicional

1. **Patrón Contenedor + SkeletonUtils**: Solución para modelos 3D animados con esqueletos independientes
2. **Sincronización física-renderizado**: Timing crítico en game loop
3. **Sistema de animaciones**: AnimationController y crossfade
4. **Debugging y profiling**: Herramientas para diagnóstico
5. **Optimización de performance**: Zero-garbage, object pooling, instancing
6. **Troubleshooting común**: Soluciones para problemas frecuentes

### Referencias de Código Clave

- [`client/src/characters/MeleeCharacter.ts`](../client/src/characters/MeleeCharacter.ts): Implementación del patrón contenedor
- [`client/src/characters/AnimationController.ts`](../client/src/characters/AnimationController.ts): Sistema de animaciones
- [`client/src/main.ts`](../client/src/main.ts): Game loop y sincronización
- [`client/src/physics/PhysicsWorld.ts`](../client/src/physics/PhysicsWorld.ts): Sistema de física con damping