import { Injectable, signal, NgZone, effect } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { BleClient, numbersToDataView } from '@capacitor-community/bluetooth-le';
import { BleConnectionService } from './ble-connection.service';
import { KeepAwake } from '@capacitor-community/keep-awake'; // <-- Fase 3: Prevenir sueño

/**
 * UTILERÍA: WATCHDOG (PERRO GUARDIÁN)
 * Envuelve una promesa y la aborta si tarda más de 'ms' milisegundos.
 */
const withTimeout = <T>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> => {
  let timeoutId: any;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorMessage)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
};

@Injectable({
  providedIn: 'root',
})
export class FirmwareOtaService {
  private readonly CHAR_UUID = '21436587-2143-6587-2143-658721436587';
  private readonly OTA_CHAR_UUID = '31436587-2143-6587-2143-658721436587';

  public isUpdating = signal<boolean>(false);
  public otaProgress = signal<number>(0);
  public otaTimeSeconds = signal<number>(0);
  private otaTimerInterval: any;

  constructor(
    private connection: BleConnectionService,
    private ngZone: NgZone
  ) {
    effect(() => {
      if (!this.connection.isConnected()) {
        this.abortarOTA();
      }
    }, { allowSignalWrites: true });
  }

  private abortarOTA() {
    this.isUpdating.set(false);
    this.otaProgress.set(0);
    clearInterval(this.otaTimerInterval);
  }

  // Método para enviar comandos con Watchdog de 3 segundos
  private async enviarComandoOta(cmd: number) {
    if (!this.connection.isConnected()) return;
    await withTimeout(
      BleClient.writeWithoutResponse(
        this.connection.deviceId(),
        this.connection.SERVICE_UUID,
        this.CHAR_UUID,
        numbersToDataView([cmd])
      ),
      3000,
      'WATCHDOG: El ESP32 no respondió al comando de control.'
    );
  }

  // =====================================================================
  // --- FUNCIÓN OTA MAESTRA: SEGURIDAD, VELOCIDAD Y ESTABILIDAD ---
  // =====================================================================
  async enviarOTA(firmware: ArrayBuffer) {
    if (!this.connection.isConnected()) return;

    // --- FASE 2: SEGURIDAD (MAGIC BYTE) ---
    const validacion = new Uint8Array(firmware);
    if (validacion.length < 100 || validacion[0] !== 0xE9) {
      alert('🔒 Seguridad: El archivo no es un firmware (.bin) válido de ESP32.');
      return; 
    }

    // --- FASE 3: MONITOR DE ESTADO BLUETOOTH ---
    let isBluetoothEnabled = true;
    await BleClient.startEnabledNotifications((enabled) => {
      isBluetoothEnabled = enabled;
    });

    // Preparar UI
    this.ngZone.run(() => {
      this.isUpdating.set(true);
      this.otaProgress.set(0);
      this.otaTimeSeconds.set(0);
    });

    this.otaTimerInterval = setInterval(() => {
      this.ngZone.run(() => this.otaTimeSeconds.update((s) => s + 1));
    }, 1000);

    try {
      // --- FASE 3: WAKELOCK (Mantener pantalla encendida) ---
      if (Capacitor.isNativePlatform()) {
        await KeepAwake.keepAwake();
      }

      // 1. Inicio OTA
      await this.enviarComandoOta(4); 
      await new Promise(r => setTimeout(r, 500)); 

      const CHUNK_SIZE = 490; 
      const totalChunks = Math.ceil(validacion.length / CHUNK_SIZE);
      const isWeb = !Capacitor.isNativePlatform();

      for (let i = 0; i < totalChunks; i++) {
        // Validación en tiempo real: Si el usuario apaga el BT, abortamos
        if (!isBluetoothEnabled) {
          throw new Error('BLUETOOTH_APAGADO_MANUAL');
        }

        const chunk = validacion.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const dataView = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);

        // Envío del fragmento
        await withTimeout(
          BleClient.writeWithoutResponse(
            this.connection.deviceId(),
            this.connection.SERVICE_UUID,
            this.OTA_CHAR_UUID,
            dataView,
          ),
          3000,
          'WATCHDOG: Error de comunicación en el envío.'
        );

        // --- SOLUCIÓN: MARCAPASOS UNIVERSAL (FLOW CONTROL) ---
        // Cada 20 paquetes (unos 9KB), hacemos una lectura síncrona.
        // Esto frena el bucle JS, obligando al OS del móvil a vaciar su buffer
        // de hardware hacia el ESP32. Adiós a la pérdida de paquetes.
        if (i > 0 && i % 20 === 0) {
          try {
            await withTimeout(
              BleClient.read(this.connection.deviceId(), this.connection.SERVICE_UUID, this.CHAR_UUID),
              3000,
              'WATCHDOG: El ping de sincronización ha fallado.'
            );
          } catch (e) {} 
        }
        
        // Actualización de la barra UI
        if (i % 20 === 0 || i === totalChunks - 1) {
          const progress = Math.round(((i + 1) / totalChunks) * 100);
          this.ngZone.run(() => this.otaProgress.set(progress));
        }
      }

      await new Promise(r => setTimeout(r, 200)); 
      
      // --- FASE 3: WATCHDOG EN VERIFICACIÓN FINAL (5s) ---
      // Damos 5 segundos porque las matemáticas RSA del ESP32 toman tiempo.
      await withTimeout(
        BleClient.write(
          this.connection.deviceId(),
          this.connection.SERVICE_UUID,
          this.CHAR_UUID,
          numbersToDataView([5])
        ),
        5000,
        'WATCHDOG: El ESP32 no respondió tras verificar la firma.'
      );
      
      this.ngZone.run(() => this.otaProgress.set(100));
      alert('✅ Actualización exitosa. El dispositivo se está reiniciando.');

    } catch (error: any) {
      console.error('Error Crítico OTA:', error);
      
      this.ngZone.run(() => {
        this.isUpdating.set(false);
        this.otaProgress.set(0);
      });

      // Mensajes de error deterministas
      if (error.message === 'BLUETOOTH_APAGADO_MANUAL') {
        alert('❌ Error: El Bluetooth se apagó durante el proceso.');
      } else if (error.message.includes('WATCHDOG')) {
        alert(`⏱️ ${error.message} \n\nAsegúrate de estar cerca del dispositivo e inténtalo de nuevo.`);
      } else {
        alert('🔒 ERROR DE SEGURIDAD: Firma inválida o archivo corrupto. El dispositivo rechazó la actualización.');
      }
      
    } finally {
      // --- FASE 3: LIMPIEZA TOTAL ---
      this.ngZone.run(() => {
        this.isUpdating.set(false);
        clearInterval(this.otaTimerInterval);
      });

      // Liberamos el WakeLock (Permitir que la pantalla se apague de nuevo)
      if (Capacitor.isNativePlatform()) {
        KeepAwake.allowSleep().catch(() => {});
      }

      // Detenemos el monitor de Bluetooth
      BleClient.stopEnabledNotifications().catch(() => {});
    }
  }
}