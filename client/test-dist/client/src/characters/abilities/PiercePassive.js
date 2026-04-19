"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PiercePassive = void 0;
/**
 * Habilidad pasiva "Perforación" para el Tirador (AdcCharacter).
 *
 * Mecánica:
 * - Contador de proyectiles disparados
 * - Al 5to proyectil: el siguiente tiene flag pierce = true
 * - El sistema de proyectiles de M5 leerá esta flag
 * - El proyectil con pierce atraviesa enemigos
 */
class PiercePassive {
    constructor(eventBus, playerId) {
        this.projectileCount = 0;
        this.nextProjectilePierces = false;
        // Para feedback visual (placeholder)
        this.visualEffectActive = false;
        this.eventBus = eventBus;
        this.playerId = playerId;
        this.setupEventListeners();
    }
    /**
     * Configura los listeners de eventos para esta habilidad.
     */
    setupEventListeners() {
        // Escuchar eventos de disparo de proyectiles
        this.eventBus.on('projectile:shot', this.handleProjectileShot.bind(this));
        // Escuchar eventos de creación de proyectiles para aplicar flag pierce
        this.eventBus.on('projectile:creating', this.handleProjectileCreating.bind(this));
    }
    /**
     * Maneja el disparo de un proyectil.
     */
    handleProjectileShot(data) {
        // Solo procesar si el jugador es el que disparó
        if (data.playerId !== this.playerId)
            return;
        this.projectileCount++;
        console.log(`[PiercePassive] ${this.playerId} projectile count: ${this.projectileCount}/5`);
        // Al llegar a 5 proyectiles, activar pierce para el siguiente
        if (this.projectileCount >= 5) {
            this.activatePierce();
            this.projectileCount = 0; // Resetear contador
        }
    }
    /**
     * Maneja la creación de un proyectil para aplicar flag pierce si está activo.
     */
    handleProjectileCreating(data) {
        if (data.playerId !== this.playerId)
            return;
        // Si el siguiente proyectil debe perforar, aplicar la flag
        if (this.nextProjectilePierces) {
            console.log(`[PiercePassive] ${this.playerId} aplicando pierce al proyectil`);
            // Modificar los datos del proyectil para incluir flag pierce
            data.pierce = true;
            data.pierceCount = 1; // Número de enemigos que puede atravesar
            // Consumir el pierce
            this.nextProjectilePierces = false;
            this.updateVisualEffect(false);
            // Emitir evento para notificar que se aplicó pierce
            this.eventBus.emit('projectile:pierce:applied', {
                playerId: this.playerId,
                projectileId: data.projectileId
            });
        }
    }
    /**
     * Activa el efecto pierce para el próximo proyectil.
     */
    activatePierce() {
        this.nextProjectilePierces = true;
        console.log(`[PiercePassive] ${this.playerId} PIERCE ACTIVADO! El próximo proyectil atravesará enemigos.`);
        // Activar efecto visual
        this.updateVisualEffect(true);
        // Emitir evento para UI/HUD
        this.eventBus.emit('player:pierce:ready', {
            playerId: this.playerId,
            ready: true
        });
    }
    /**
     * Actualiza el efecto visual del pierce (placeholder).
     */
    updateVisualEffect(active) {
        this.visualEffectActive = active;
        // En una implementación real, esto activaría/desactivaría un efecto en el arma o personaje
        if (active) {
            console.log(`[PiercePassive] Efecto visual activado para ${this.playerId}`);
            // this.applyPierceEffect();
        }
        else {
            console.log(`[PiercePassive] Efecto visual desactivado para ${this.playerId}`);
            // this.removePierceEffect();
        }
    }
    /**
     * Notifica que se ha disparado un proyectil (método alternativo si no hay evento).
     */
    notifyProjectileShot() {
        this.projectileCount++;
        console.log(`[PiercePassive] ${this.playerId} projectile count (notify): ${this.projectileCount}/5`);
        if (this.projectileCount >= 5) {
            this.activatePierce();
            this.projectileCount = 0;
        }
    }
    /**
     * Verifica si el próximo proyectil debe tener pierce.
     * @returns true si el próximo proyectil perfora
     */
    shouldNextProjectilePierce() {
        return this.nextProjectilePierces;
    }
    /**
     * Consume el efecto pierce si está activo.
     * @returns true si se consumió el efecto
     */
    consumePierce() {
        if (this.nextProjectilePierces) {
            this.nextProjectilePierces = false;
            this.updateVisualEffect(false);
            return true;
        }
        return false;
    }
    /**
     * Obtiene el estado actual del pierce.
     */
    getPierceState() {
        return {
            projectileCount: this.projectileCount,
            nextProjectilePierces: this.nextProjectilePierces
        };
    }
    /**
     * Reinicia el estado de la habilidad (ej. al morir o respawnear).
     */
    reset() {
        this.projectileCount = 0;
        this.nextProjectilePierces = false;
        this.updateVisualEffect(false);
        console.log(`[PiercePassive] ${this.playerId} estado reiniciado`);
    }
    /**
     * Limpia los listeners de eventos al destruir la instancia.
     */
    dispose() {
        this.eventBus.off('projectile:shot', this.handleProjectileShot.bind(this));
        this.eventBus.off('projectile:creating', this.handleProjectileCreating.bind(this));
    }
}
exports.PiercePassive = PiercePassive;
