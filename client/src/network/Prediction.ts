/**
 * Prediction.ts — Client-Side Prediction con Server Reconciliation.
 *
 * Arquitectura:
 * 1. El cliente aplica inputs LOCALMENTE en el mismo frame que los envía al servidor.
 * 2. Guarda un historial de inputs con su seq number y posición predicha.
 * 3. Al recibir un snapshot del servidor:
 *    a. Compara la posición del servidor con la posición predicha para ese seq.
 *    b. Si la diferencia es < threshold, acepta la predicción (no hace nada).
 *    c. Si la diferencia es > threshold, corrige con lerp suave.
 *    d. Limpia el historial de inputs más viejos que el último seq ACK del servidor.
 * 4. Re-aplica los inputs no confirmados sobre la posición corregida del servidor.
 */
import * as THREE from 'three';
import type { SnapshotPlayer } from '@rogue-arena/shared';

// ================================================================
// Constantes
// ================================================================

/** Umbral de diferencia para considerar que la predicción fue correcta (metros) */
const PREDICTION_THRESHOLD = 0.1;

/** Factor de interpolación para corrección suave (0-1) */
const RECONCILIATION_LERP = 0.15;

/** Tamaño máximo del historial de inputs (seguridad) */
const MAX_INPUT_HISTORY = 120; // 2 segundos a 60fps

// ================================================================
// Tipos
// ================================================================

export interface StoredInput {
  /** Sequence number único para este input */
  seq: number;
  /** Dirección de movimiento normalizada */
  moveDir: THREE.Vector2;
  /** Timestamp local (para depuración) */
  timestamp: number;
  /** Posición predicha después de aplicar este input */
  predictedPosition: THREE.Vector3;
}

export interface PredictionConfig {
  /** Umbral para corrección (default: 0.1m) */
  threshold?: number;
  /** Factor de lerp para reconciliación (default: 0.15) */
  lerpFactor?: number;
}

// ================================================================
// Prediction class
// ================================================================

export class Prediction {
  /** Historial de inputs enviados al servidor */
  private inputHistory: StoredInput[] = [];
  /** Último seq number asignado */
  private currentSeq = 0;
  /** Último seq confirmado por el servidor */
  private lastAckedSeq = 0;
  /** Configuración */
  private threshold: number;
  private lerpFactor: number;

  constructor(config?: PredictionConfig) {
    this.threshold = config?.threshold ?? PREDICTION_THRESHOLD;
    this.lerpFactor = config?.lerpFactor ?? RECONCILIATION_LERP;
  }

  // ============================================================
  // API pública
  // ============================================================

  /**
   * Genera un nuevo seq number para el próximo input a enviar.
   */
  nextSeq(): number {
    this.currentSeq++;
    return this.currentSeq;
  }

  /**
   * Obtiene el seq actual (sin incrementar).
   */
  getCurrentSeq(): number {
    return this.currentSeq;
  }

  /**
   * Almacena un input en el historial después de aplicarlo localmente.
   * @param seq - Sequence number del input
   * @param moveDir - Dirección de movimiento
   * @param predictedPos - Posición predicha después de aplicar el input
   */
  storeInput(seq: number, moveDir: THREE.Vector2, predictedPos: THREE.Vector3): void {
    this.inputHistory.push({
      seq,
      moveDir: moveDir.clone(),
      timestamp: Date.now(),
      predictedPosition: predictedPos.clone(),
    });

    // Limitar tamaño del historial (seguridad)
    if (this.inputHistory.length > MAX_INPUT_HISTORY) {
      this.inputHistory.splice(0, this.inputHistory.length - MAX_INPUT_HISTORY);
    }
  }

  /**
   * Procesa un snapshot del servidor y devuelve la posición corregida.
   * Implementa Server Reconciliation:
   * 1. Encuentra el input en el historial que corresponde al último seq ACK
   * 2. Compara la posición del servidor con la predicha
   * 3. Si hay diferencia > threshold, calcula posición corregida con lerp
   * 4. Re-aplica los inputs no confirmados sobre la posición corregida
   * 5. Limpia el historial
   *
   * @param serverPlayer - Datos del jugador desde el snapshot del servidor
   * @param currentPosition - Posición actual del personaje local
   * @returns Posición corregida (o null si no hay corrección necesaria)
   */
  reconcile(
    serverPlayer: SnapshotPlayer,
    currentPosition: THREE.Vector3
  ): THREE.Vector3 | null {
    const { lastProcessedSeq } = serverPlayer;

    // Si no hay historial o el servidor no ha procesado nada, no hay corrección
    if (this.inputHistory.length === 0 || lastProcessedSeq <= 0) {
      this.cleanup(lastProcessedSeq);
      return null;
    }

    // Buscar el input en el historial que corresponde al último seq ACK
    const ackedInput = this.findInputBySeq(lastProcessedSeq);

    if (!ackedInput) {
      // El seq del servidor es más viejo que nuestro historial
      // Esto puede pasar si limpiamos muy agresivamente
      this.cleanup(lastProcessedSeq);
      return null;
    }

    // Comparar posición del servidor con la posición predicha para ese input
    const serverPos = new THREE.Vector3(
      serverPlayer.position.x,
      serverPlayer.position.y,
      serverPlayer.position.z
    );
    const predictedPos = ackedInput.predictedPosition;
    const diff = serverPos.distanceTo(predictedPos);

    let correctedPosition: THREE.Vector3;

    if (diff > this.threshold) {
      // La predicción fue incorrecta → corregir con lerp suave
      correctedPosition = currentPosition.clone().lerp(serverPos, this.lerpFactor);
      console.log(
        `[Prediction] Corrección: diff=${diff.toFixed(3)}m, ` +
        `server=(${serverPos.x.toFixed(2)}, ${serverPos.z.toFixed(2)}), ` +
        `predicted=(${predictedPos.x.toFixed(2)}, ${predictedPos.z.toFixed(2)})`
      );
    } else {
      // Predicción correcta → mantener posición actual (sin corrección)
      correctedPosition = currentPosition.clone();
    }

    // Limpiar inputs más viejos que el último ACK
    this.cleanup(lastProcessedSeq);

    // Re-aplicar inputs no confirmados sobre la posición corregida
    // (esto permite que el movimiento continúe suave después de una corrección)
    const unprocessedInputs = this.getUnprocessedInputs(lastProcessedSeq);
    if (unprocessedInputs.length > 0) {
      // Nota: La re-aplicación de inputs se maneja externamente en el game loop
      // porque requiere acceso al personaje y su lógica de movimiento.
      // Aquí solo devolvemos la posición base corregida.
      console.log(`[Prediction] ${unprocessedInputs.length} inputs sin confirmar después de corrección`);
    }

    return correctedPosition;
  }

  /**
   * Obtiene los inputs no confirmados (más nuevos que lastProcessedSeq).
   */
  getUnprocessedInputs(afterSeq: number): StoredInput[] {
    return this.inputHistory.filter(input => input.seq > afterSeq);
  }

  /**
   * Limpia el historial de inputs más viejos o iguales al seq dado.
   */
  cleanup(upToSeq: number): void {
    if (upToSeq > this.lastAckedSeq) {
      this.lastAckedSeq = upToSeq;
    }
    this.inputHistory = this.inputHistory.filter(input => input.seq > upToSeq);
  }

  /**
   * Resetea completamente el sistema de predicción.
   */
  reset(): void {
    this.inputHistory = [];
    this.currentSeq = 0;
    this.lastAckedSeq = 0;
  }

  /**
   * Obtiene el tamaño actual del historial (para depuración).
   */
  getHistorySize(): number {
    return this.inputHistory.length;
  }

  /**
   * Obtiene el último seq confirmado por el servidor.
   */
  getLastAckedSeq(): number {
    return this.lastAckedSeq;
  }

  // ============================================================
  // Privado
  // ============================================================

  /**
   * Busca un input en el historial por su sequence number.
   */
  private findInputBySeq(seq: number): StoredInput | undefined {
    // Búsqueda inversa (más eficiente, los seq más nuevos están al final)
    for (let i = this.inputHistory.length - 1; i >= 0; i--) {
      if (this.inputHistory[i].seq === seq) {
        return this.inputHistory[i];
      }
    }
    return undefined;
  }
}
