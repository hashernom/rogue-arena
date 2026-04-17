# 🎮 Rogue Arena

> Roguelike 3D isométrico para navegador — 2 jugadores, multijugador online en tiempo real

[![CI](https://github.com/hashernom/rogue-arena/actions/workflows/ci.yml/badge.svg)](https://github.com/hashernom/rogue-arena/actions)

## 🎯 Concepto

Dos jugadores cooperan online para sobrevivir oleadas de enemigos en una arena 3D isométrica.
Cada jugador elige un arquetipo (**Caballero** melee o **Tirador** ranged) y mejora su personaje
entre rondas con dinero obtenido de los enemigos eliminados.

## ⚡ Stack Tecnológico

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Renderizado | Three.js | ^0.168 |
| Física | Rapier3D WASM | ^0.12 |
| Multiplayer | Socket.io | ^4 |
| Bundler | Vite + TypeScript | ^5 / ^5 |
| Audio | Web Audio API | nativa |
| Modelos | GLTF 2.0 Low Poly | — |
| Packages | pnpm workspaces | ^9 |

## 🚀 Setup rápido

```bash
# Requisitos: Node.js 20+ y pnpm 9+
pnpm install

# Desarrollo (cliente + servidor en paralelo)
pnpm dev

# Build producción
pnpm build
```

## 📁 Estructura del Monorepo

```
rogue-arena/
├── client/     # Frontend — Three.js + Vite
├── server/     # Backend — Node.js + Socket.io
├── shared/     # Tipos TypeScript compartidos
└── docs/       # Documentación técnica
```

## 📖 Documentación

- [🏗️ Arquitectura Técnica](docs/ARCHITECTURE.md)
- [🎮 Game Design Document](docs/GAME_DESIGN.md)
- [🤝 Guía de Contribución](docs/CONTRIBUTING.md)

## 👥 Equipo

| Dev | Rol |
|-----|-----|
| [@hashernom](https://github.com/hashernom) | Tech Lead / Full Stack |

---

*CI Pipeline activa — Última ejecución: [Ver estado](https://github.com/hashernom/rogue-arena/actions)*