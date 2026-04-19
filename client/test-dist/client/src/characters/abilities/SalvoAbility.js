"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SalvoAbility = void 0;
const THREE = require("three");
/**
 * Habilidad activa "Salva" para el Tirador (AdcCharacter).
 *
 * Mecánica:
 * - Dispara 3 proyectiles en un abanico de 60° (20° entre cada proyectil)
 * - Cada proyectil hace daño normal
 * - Cooldown: 4 segundos con indicador visual en HUD
 * - Feedback visual: efecto de partículas/aura durante la salva
 */
class SalvoAbility {
    constructor(eventBus, character, playerId, sceneManager) {
        // Estado de la salva
        this.isSalvoActive = false;
        this.salvoProjectiles = 3;
        this.salvoAngle = 60; // grados totales del abanico
        this.projectilesFired = 0;
        // Cooldown
        this.cooldownTimer = 0;
        this.cooldownDuration = 4; // segundos
        this.isOnCooldown = false;
        // Para feedback visual (placeholder)
        this.visualEffectActive = false;
        this.eventBus = eventBus;
        this.character = character;
        this.playerId = playerId;
        this.sceneManager = sceneManager;
        this.setupEventListeners();
    }
    /**
     * Configura los listeners de eventos para esta habilidad.
     */
    setupEventListeners() {
        // Escuchar eventos de tecla Q (o botón de habilidad)
        this.eventBus.on('player:abilityQ', this.handleAbilityActivation.bind(this));
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
            console.log(`[SalvoAbility] ${this.playerId} - Habilidad en cooldown (${this.cooldownTimer.toFixed(1)}s restantes)`);
            return;
        }
        // Activar salva
        this.activateSalvo();
    }
    /**
     * Activa la salva de proyectiles.
     */
    activateSalvo() {
        if (this.isSalvoActive)
            return;
        console.log(`[SalvoAbility] ${this.playerId} - ¡Salva activada!`);
        // Iniciar estado de salva
        this.isSalvoActive = true;
        this.projectilesFired = 0;
        // Iniciar cooldown
        this.isOnCooldown = true;
        this.cooldownTimer = this.cooldownDuration;
        // Emitir evento para feedback visual
        this.eventBus.emit('ability:salvo:activated', {
            playerId: this.playerId,
            position: this.getCharacterPosition()
        });
        // Feedback visual (placeholder)
        this.activateVisualEffect();
        // Disparar los proyectiles en secuencia rápida
        this.fireSalvoProjectiles();
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
     * Dispara los proyectiles de la salva en abanico.
     */
    fireSalvoProjectiles() {
        const characterAny = this.character;
        if (!characterAny.model)
            return;
        // Obtener dirección frontal del personaje
        const forwardDirection = new THREE.Vector3(0, 0, -1);
        forwardDirection.applyQuaternion(characterAny.model.quaternion);
        // Calcular ángulo entre proyectiles (en radianes)
        const totalAngleRad = THREE.MathUtils.degToRad(this.salvoAngle);
        const angleBetweenProjectiles = totalAngleRad / (this.salvoProjectiles - 1);
        const startAngle = -totalAngleRad / 2; // Empezar desde el extremo izquierdo
        // Crear y disparar cada proyectil
        for (let i = 0; i < this.salvoProjectiles; i++) {
            // Calcular ángulo para este proyectil
            const angle = startAngle + (i * angleBetweenProjectiles);
            // Crear dirección rotada
            const projectileDirection = forwardDirection.clone();
            const rotationAxis = new THREE.Vector3(0, 1, 0); // Rotar alrededor del eje Y
            projectileDirection.applyAxisAngle(rotationAxis, angle);
            // Disparar proyectil con un pequeño retraso para efecto visual
            setTimeout(() => {
                this.createProjectile(projectileDirection);
                this.projectilesFired++;
                // Verificar si todos los proyectiles han sido disparados
                if (this.projectilesFired >= this.salvoProjectiles) {
                    this.endSalvo();
                }
            }, i * 100); // 100ms entre cada proyectil
        }
    }
    /**
     * Crea un proyectil individual.
     */
    createProjectile(direction) {
        const characterAny = this.character;
        if (!characterAny.model || !this.sceneManager)
            return;
        // Crear geometría de proyectil (flecha)
        const geometry = new THREE.ConeGeometry(0.1, 0.5, 8);
        const material = new THREE.MeshStandardMaterial({ color: 0xffaa00 }); // Color naranja para diferenciar
        const projectile = new THREE.Mesh(geometry, material);
        projectile.castShadow = true;
        // Posición inicial: frente del personaje
        const startPosition = characterAny.model.position.clone();
        const offset = direction.clone().multiplyScalar(1.5);
        projectile.position.copy(startPosition).add(offset);
        // Orientar el proyectil en la dirección de disparo
        projectile.lookAt(projectile.position.clone().add(direction));
        projectile.rotateX(Math.PI / 2); // Ajustar orientación para cono
        // Añadir a la escena
        this.sceneManager.add(projectile);
        // Emitir evento de creación de proyectil
        this.eventBus.emit('projectile:created', {
            playerId: this.playerId,
            projectileId: `salvo_${Date.now()}_${Math.random()}`,
            position: [projectile.position.x, projectile.position.y, projectile.position.z],
            direction: [direction.x, direction.y, direction.z],
            damage: this.character.getEffectiveStat('damage'),
            source: 'salvo'
        });
        // Animar el proyectil (movimiento lineal)
        this.animateProjectile(projectile, direction);
    }
    /**
     * Anima el movimiento del proyectil.
     */
    animateProjectile(projectile, direction) {
        const speed = 15; // Velocidad del proyectil
        const maxDistance = 20; // Distancia máxima antes de desaparecer
        let distanceTraveled = 0;
        const startPosition = projectile.position.clone();
        // Función de animación por frame
        const animate = () => {
            if (!projectile.parent)
                return; // Si el proyectil fue removido
            // Mover proyectil
            const moveDistance = speed * 0.016; // Asumiendo 60 FPS
            projectile.position.add(direction.clone().multiplyScalar(moveDistance));
            distanceTraveled = startPosition.distanceTo(projectile.position);
            // Verificar si ha alcanzado la distancia máxima
            if (distanceTraveled >= maxDistance) {
                this.removeProjectile(projectile);
                return;
            }
            // Continuar animación
            requestAnimationFrame(animate);
        };
        // Iniciar animación
        animate();
    }
    /**
     * Remueve un proyectil de la escena.
     */
    removeProjectile(projectile) {
        if (projectile.parent) {
            this.sceneManager.remove(projectile);
            projectile.geometry.dispose();
            projectile.material.dispose();
        }
    }
    /**
     * Actualiza el estado del cooldown.
     * Debe llamarse en cada frame desde el game loop.
     */
    update(dt) {
        // Actualizar cooldown
        if (this.isOnCooldown) {
            this.cooldownTimer -= dt;
            if (this.cooldownTimer <= 0) {
                this.isOnCooldown = false;
                this.cooldownTimer = 0;
                console.log(`[SalvoAbility] ${this.playerId} - Habilidad lista`);
            }
        }
    }
    /**
     * Finaliza la salva.
     */
    endSalvo() {
        console.log(`[SalvoAbility] ${this.playerId} - Salva finalizada`);
        this.isSalvoActive = false;
        this.projectilesFired = 0;
        // Desactivar efecto visual
        this.deactivateVisualEffect();
        // Emitir evento de finalización
        this.eventBus.emit('ability:salvo:ended', {
            playerId: this.playerId
        });
    }
    /**
     * Activa el efecto visual de la salva (placeholder).
     */
    activateVisualEffect() {
        this.visualEffectActive = true;
        console.log(`[SalvoAbility] ${this.playerId} - Efecto visual activado (aura/partículas)`);
        // En una implementación real, aquí se crearían partículas o se modificarían materiales
    }
    /**
     * Desactiva el efecto visual de la salva (placeholder).
     */
    deactivateVisualEffect() {
        this.visualEffectActive = false;
        console.log(`[SalvoAbility] ${this.playerId} - Efecto visual desactivado`);
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
     * Verifica si la salva está activa.
     */
    isSalvoActiveState() {
        return this.isSalvoActive;
    }
    /**
     * Limpia recursos (para cuando el personaje muere o se destruye).
     */
    dispose() {
        // Limpiar listeners
        this.eventBus.off('player:abilityQ', this.handleAbilityActivation.bind(this));
        // Limpiar cualquier proyectil pendiente
        // (En una implementación real, se deberían limpiar todos los proyectiles activos)
    }
}
exports.SalvoAbility = SalvoAbility;
