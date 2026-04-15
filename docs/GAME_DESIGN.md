# 🎮 Rogue Arena — Game Design Document (GDD)

## Core Loop

```
[Lobby + char select] ──→ [Ronda N inicia]
        ↑                        ↓
  [Tienda 15s]        [Eliminar todos los enemigos]
        ↑                        ↓
  [Comprar ítems] ←── [Between-round: reward de monedas]
```

## Arena
- Tamaño: 30×30 metros
- Límites: muros invisibles con colliders físicos
- Obstáculos: 8–12 bloques low poly generados al iniciar partida
- Spawn enemigos: 8 puntos distribuidos en los bordes
- Spawn jugadores: centro-izquierda (Caballero) y centro-derecha (Tirador)

## Cámara Isométrica
- `THREE.OrthographicCamera` rotada 45° en Y + 35° de elevación
- Zoom fijo — el frustum cubre la arena completa
- Ajuste de frustum al ratio de pantalla del navegador

## Ítems Pool — MVP

| Ítem | Efecto | Precio |
|------|--------|--------|
| Poción HP | +30 HP inmediato | 15 |
| Escudo de Cuero | +5 armadura | 20 |
| Guantelete | +8 daño | 25 |
| Botas Rápidas | +0.5 m/s | 20 |
| Amuleto Vital | +25 HP máximo | 30 |
| Daga Rápida | +0.3 vel. ataque | 35 |
| Pergamino de Fuerza | +15 daño | 40 |
| Capa del Viento | +1.0 m/s | 45 |
| Elixir Doble | ×2 drop próxima ronda | 50 |

## Condición Game Over
- Ambos jugadores en HP = 0 simultáneamente
- Pantalla final: rondas sobrevividas, kills totales, daño infligido total

## Boss Wave (cada 5 rondas)
- Un mini-boss (HP ×5 del enemigo Tanque, daño ×2)
- Oleada reducida de básicos simultánea
- Boss mechanic: carga hacia el jugador con más HP