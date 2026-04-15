# 🤝 Guía de Contribución — Rogue Arena

## Modelo de Branches

| Branch | Uso | Protegido |
|--------|-----|-----------|
| `main` | Producción estable | Sí — requiere PR + 1 review |
| `develop` | Integración de features | Sí — requiere PR |
| `feature/M{n}-descripcion` | Nueva feature por módulo | No |
| `fix/descripcion` | Corrección de bug | No |

## Flujo de Trabajo

1. Crear branch desde `develop`:  
   `git checkout -b feature/M4-melee-character develop`
2. Implementar cambios
3. Commits con formato Conventional Commits
4. Push + abrir PR hacia `develop`
5. Code review (mínimo 1 approval)
6. Merge al aprobar — **nunca hacer self-merge en `main`**

## Formato de Commits (Conventional Commits)

```
feat(M4): add MeleeCharacter base class with stats
fix(M3): correct rapier collider scaling factor
docs(M1): update architecture with networking diagram
refactor(M2): extract SceneManager from main.ts
chore: update pnpm lock file
perf(M9): reduce state snapshot payload size
```

## Código de los Issues

Cada issue tiene prefijo `[M{módulo}-{número}]`:
- `[M1-01]` = Módulo 1, issue 01
- `[M4-03]` = Módulo 4, issue 03

Al trabajar un issue, referenciarlo en el commit:
```
feat(M4): add ADCCharacter projectile logic

Closes #23
```

## Revisión de Código
- Resolver todos los comentarios antes del merge
- No aprobar código que no hayas leído completamente
- Si hay dudas sobre arquitectura, discutirlas antes de implementar