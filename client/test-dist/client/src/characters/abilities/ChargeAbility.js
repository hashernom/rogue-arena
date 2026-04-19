"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChargeAbility = void 0;
const THREE = require("three");
/**
 * Habilidad activa "Carga" para el Caballero (MeleeCharacter).
 *
 * Mecánica:
 * - Dash: durante 0.3s la velocidad del personaje es ×4 en la dirección de movimiento actual
 * - Aplica daño a todos los enemigos tocados durante el dash
 * - Cooldown: 6 segundos con indicador visual en HUD
 * - Feedback visual: efecto de partículas/aura durante el dash
 */
class ChargeAbility {
    constructor(eventBus, character, playerId) {
        // Estado del dash
        this.isDashing = false;
        this.dashTimer = 0;
        this.dashDuration = 0.3; // segundos
        this.dashSpeedMultiplier = 4;
        // Cooldown
        this.cooldownTimer = 0;
        this.cooldownDuration = 6; // segundos
        this.isOnCooldown = false;
        // Dirección del dash (se guarda al inicio)
        this.dashDirection = new THREE.Vector3();
        // Enemigos ya dañados durante este dash (para evitar daño múltiple)
        this.damagedEnemies = new Set();
        // Para feedback visual (placeholder)
        this.visualEffectActive = false;
        this.eventBus = eventBus;
        this.character = character;
        this.playerId = playerId;
        this.setupEventListeners();
    }
    /**
     * Configura los listeners de eventos para esta habilidad.
     */
    setupEventListeners() {
        // Escuchar eventos de tecla Q (o botón de habilidad)
        // Esto se manejará desde el InputManager, pero por ahora usamos un evento personalizado
        this.eventBus.on('player:abilityQ', this.handleAbilityActivation.bind(this));
        // Escuchar eventos de colisión con enemigos durante el dash
        this.eventBus.on('physics:collision', this.handleCollision.bind(this));
    }
    /**
     * Maneja la activación de la habilidad (cuando el jugador presiona Q).
     */
    handleAbilityActivation(data) {
        // Verificar que sea el jugador correcto
        if (data.playerId !== this.playerId)
            return;
        // Verificar cooldown
        if (this.isOnCooldown) {
            console.log(`[ChargeAbility] ${this.playerId} - Habilidad en cooldown (${this.cooldownTimer.toFixed(1)}s restantes)`);
            return;
        }
        // Activar dash
        this.activateDash();
    }
    /**
     * Activa el dash.
     */
    activateDash() {
        if (this.isDashing)
            return;
        console.log(`[ChargeAbility] ${this.playerId} - ¡Carga activada!`);
        // Iniciar estado de dash
        this.isDashing = true;
        this.dashTimer = 0;
        this.damagedEnemies.clear();
        // Obtener dirección actual de movimiento del personaje
        // Asumimos que el character tiene una propiedad moveDirection
        const characterAny = this.character;
        if (characterAny.moveDirection) {
            this.dashDirection.copy(characterAny.moveDirection).normalize();
        }
        else {
            // Si no hay dirección de movimiento, usar la dirección hacia adelante del modelo
            this.dashDirection.set(0, 0, 1);
        }
        // Aplicar multiplicador de velocidad temporal
        // Esto se manejará en el update del dash
        // Iniciar cooldown
        this.isOnCooldown = true;
        this.cooldownTimer = this.cooldownDuration;
        // Emitir evento para feedback visual
        this.eventBus.emit('ability:charge:activated', {
            playerId: this.playerId,
            position: this.getCharacterPosition(),
            direction: this.dashDirection.toArray()
        });
        // Feedback visual (placeholder)
        this.activateVisualEffect();
    }
    /**
     * Obtiene la posición actual del personaje.
     */
    getCharacterPosition() {
        const characterAny = this.character;
        if (characterAny.model) {
            return [
                characterAny.model.position.x,
                characterAny.model.position.y,
                characterAny.model.position.z
            ];
        }
        return [0, 0, 0];
    }
    /**
     * Actualiza el estado del dash y cooldown.
     * Debe llamarse en cada frame desde el game loop.
     */
    update(dt) {
        // Actualizar cooldown
        if (this.isOnCooldown) {
            this.cooldownTimer -= dt;
            if (this.cooldownTimer <= 0) {
                this.isOnCooldown = false;
                this.cooldownTimer = 0;
                console.log(`[ChargeAbility] ${this.playerId} - Habilidad lista`);
            }
        }
        // Actualizar dash
        if (this.isDashing) {
            this.dashTimer += dt;
            // Aplicar movimiento de dash
            this.applyDashMovement(dt);
            // Verificar si el dash ha terminado
            if (this.dashTimer >= this.dashDuration) {
                this.endDash();
            }
        }
    }
    /**
     * Aplica el movimiento del dash.
     */
    applyDashMovement(dt) {
        // Calcular velocidad base del personaje
        const baseSpeed = this.character.getEffectiveStat('speed');
        const dashSpeed = baseSpeed * this.dashSpeedMultiplier;
        // Calcular desplazamiento
        const displacement = this.dashDirection.clone().multiplyScalar(dashSpeed * dt);
        // Aplicar desplazamiento al personaje
        // Necesitamos acceder al modelo o cuerpo físico del personaje
        const characterAny = this.character;
        if (characterAny.model) {
            characterAny.model.position.add(displacement);
        }
        // También actualizar la posición del cuerpo físico si existe
        if (characterAny.physicsBody && characterAny.physicsWorld) {
            // Esto sería más complejo - por ahora solo movemos el modelo
            // En una implementación real, moveríamos el cuerpo físico de Rapier
        }
        // Emitir evento de posición para efectos visuales
        this.eventBus.emit('ability:charge:position', {
            playerId: this.playerId,
            position: this.getCharacterPosition()
        });
    }
    /**
     * Maneja colisiones durante el dash.
     */
    handleCollision(data) {
        if (!this.isDashing)
            return;
        // Verificar si la colisión involucra a este jugador
        if (data.entityA !== this.playerId && data.entityB !== this.playerId)
            return;
        // Determinar cuál es el enemigo
        const enemyId = data.entityA === this.playerId ? data.entityB : data.entityA;
        // Verificar que sea un enemigo (no otro jugador)
        if (enemyId.startsWith('enemy')) {
            // Evitar daño múltiple al mismo enemigo
            if (this.damagedEnemies.has(enemyId))
                return;
            // Aplicar daño
            this.applyDamageToEnemy(enemyId);
            this.damagedEnemies.add(enemyId);
        }
    }
    /**
     * Aplica daño a un enemigo.
     */
    applyDamageToEnemy(enemyId) {
        const baseDamage = this.character.getEffectiveStat('damage');
        const chargeDamage = baseDamage * 1.5; // Daño bonus por carga
        console.log(`[ChargeAbility] ${this.playerId} - Daño a enemigo ${enemyId}: ${chargeDamage}`);
        // Emitir evento de daño
        this.eventBus.emit('enemy:damage', {
            enemyId,
            damage: chargeDamage,
            source: 'charge',
            playerId: this.playerId
        });
        // Feedback visual de impacto
        this.eventBus.emit('ability:charge:impact', {
            playerId: this.playerId,
            enemyId,
            damage: chargeDamage
        });
    }
    /**
     * Finaliza el dash.
     */
    endDash() {
        console.log(`[ChargeAbility] ${this.playerId} - Dash finalizado`);
        this.isDashing = false;
        this.dashTimer = 0;
        this.damagedEnemies.clear();
        // Desactivar efecto visual
        this.deactivateVisualEffect();
        // Emitir evento de finalización
        this.eventBus.emit('ability:charge:ended', {
            playerId: this.playerId
        });
    }
    /**
     * Activa el efecto visual del dash (placeholder).
     */
    activateVisualEffect() {
        this.visualEffectActive = true;
        console.log(`[ChargeAbility] ${this.playerId} - Efecto visual activado (aura/partículas)`);
        // En una implementación real, aquí se crearían partículas o se modificarían materiales
    }
    /**
     * Desactiva el efecto visual del dash (placeholder).
     */
    deactivateVisualEffect() {
        this.visualEffectActive = false;
        console.log(`[ChargeAbility] ${this.playerId} - Efecto visual desactivado`);
    }
    /**
     * Método para activar la habilidad manualmente (desde el InputManager).
     */
    activate() {
        this.handleAbilityActivation({ playerId: this.playerId });
    }
    /**
     * Verifica si la habilidad está en cooldown.
     */
    isAbilityReady() {
        return !this.isOnCooldown;
    }
    /**
     * Obtiene el tiempo restante de cooldown.
     */
    getCooldownRemaining() {
        return this.cooldownTimer;
    }
    /**
     * Obtiene el porcentaje de cooldown (0-1).
     */
    getCooldownPercent() {
        return this.cooldownTimer / this.cooldownDuration;
    }
    /**
     * Verifica si el personaje está en dash.
     */
    isDashingActive() {
        return this.isDashing;
    }
    /**
     * Limpia recursos (para cuando el personaje muere o se destruye).
     */
    dispose() {
        // Limpiar listeners
        this.eventBus.off('player:abilityQ', this.handleAbilityActivation.bind(this));
        this.eventBus.off('physics:collision', this.handleCollision.bind(this));
        if (this.isDashing) {
            this.endDash();
        }
    }
}
exports.ChargeAbility = ChargeAbility;
