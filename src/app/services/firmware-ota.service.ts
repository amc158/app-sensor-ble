import { Injectable, signal, NgZone, effect } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { BleClient, numbersToDataView } from '@capacitor-community/bluetooth-le';
import { BleConnectionService } from './ble-connection.service';
import { KeepAwake } from '@capacitor-community/keep-awake';

/**
 * UTILERÍA: WATCHDOG
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
  // UUIDs cortos (alias)
  private readonly CHAR_FIRMWARE_UUID = '2a32'; 
  private readonly CHAR_FINISH_UUID = '2a33';   

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
    if (this.otaTimerInterval) clearInterval(this.otaTimerInterval);
  }

  async enviarOTA(firmware: ArrayBuffer, filename: string = "waveshare_firmware.bin") {
    if (!this.connection.isConnected()) return;

    const validacion = new Uint8Array(firmware);
    
    if (validacion.length < 100) {
      alert('🔒 Error: El archivo es demasiado pequeño.');
      return; 
    }

    // --- PREPARAR UUIDS EXPANDIDOS (128 bits) ---
    // Expandimos una sola vez al inicio para no sobrecargar el bucle
    const serviceUuid = this.connection.expandUuid(this.connection.SERVICE_UUID);
    const charFirmwareUuid = this.connection.expandUuid(this.CHAR_FIRMWARE_UUID);
    const charFinishUuid = this.connection.expandUuid(this.CHAR_FINISH_UUID);

    let isBluetoothEnabled = true;
    await BleClient.startEnabledNotifications((enabled) => {
      isBluetoothEnabled = enabled;
    });

    this.ngZone.run(() => {
      this.isUpdating.set(true);
      this.otaProgress.set(0);
      this.otaTimeSeconds.set(0);
    });

    this.otaTimerInterval = setInterval(() => {
      this.ngZone.run(() => this.otaTimeSeconds.update((s) => s + 1));
    }, 1000);

    try {
      if (Capacitor.isNativePlatform()) {
        await KeepAwake.keepAwake();
      }

      // --- PASO 1: ENVIAR JSON DE METADATOS ---
      const metadata = {
        filename: filename,
        expected_size: validacion.length
      };
      
      const metadataStr = JSON.stringify(metadata);
      const encoder = new TextEncoder();
      const metadataBytes = encoder.encode(metadataStr);

      await withTimeout(
        BleClient.write(
          this.connection.deviceId(),
          serviceUuid,        // ✅ Aplicado UUID expandido
          charFirmwareUuid,   // ✅ Aplicado UUID expandido
          new DataView(metadataBytes.buffer)
        ),
        3000,
        'WATCHDOG: No se pudo enviar el JSON de metadatos.'
      );

      await new Promise(r => setTimeout(r, 500)); 

      // --- PASO 2: ENVIAR EL ARCHIVO ---
      const CHUNK_SIZE = 490; 
      const totalChunks = Math.ceil(validacion.length / CHUNK_SIZE);

      for (let i = 0; i < totalChunks; i++) {
        if (!isBluetoothEnabled) throw new Error('BLUETOOTH_APAGADO_MANUAL');

        const chunk = validacion.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const dataView = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);

        await withTimeout(
          BleClient.writeWithoutResponse(
            this.connection.deviceId(),
            serviceUuid,       // ✅ Aplicado UUID expandido
            charFirmwareUuid,  // ✅ Aplicado UUID expandido
            dataView,
          ),
          3000,
          'WATCHDOG: Error de comunicación en el envío.'
        );

        // --- MARCAPASOS UNIVERSAL ---
        if (i > 0 && i % 20 === 0) {
          try {
            await withTimeout(
              BleClient.read(this.connection.deviceId(), serviceUuid, charFirmwareUuid), // ✅ Aplicado
              3000,
              'WATCHDOG: El ping de sincronización ha fallado.'
            );
          } catch (e) {} 
        }
        
        if (i % 20 === 0 || i === totalChunks - 1) {
          const progress = Math.round(((i + 1) / totalChunks) * 100);
          this.ngZone.run(() => this.otaProgress.set(progress));
        }
      }

      await new Promise(r => setTimeout(r, 1000)); // Aumenta de 200ms a 1000ms

// --- PASO 3: SEÑAL DE FINALIZACIÓN ---
      await withTimeout(
        BleClient.write(
          this.connection.deviceId(),
          serviceUuid,
          charFinishUuid, 
          numbersToDataView([1])
        ),
        5000, // 5 segundos es suficiente ahora que el ESP32 no bloquea
        'El dispositivo no confirmó el cierre de la transferencia.'
      );
      
      this.ngZone.run(() => this.otaProgress.set(100));
      alert('✅ ¡Transferencia completada! El dispositivo se está reiniciando.');
      
      this.ngZone.run(() => this.otaProgress.set(100));
      alert('✅ Archivo subido con éxito.');

    } catch (error: any) {
      console.error('Error Crítico OTA:', error);
      this.ngZone.run(() => {
        this.isUpdating.set(false);
        this.otaProgress.set(0);
      });

      if (error.message === 'BLUETOOTH_APAGADO_MANUAL') {
        alert('❌ Error: El Bluetooth se apagó.');
      } else if (error.message.includes('WATCHDOG')) {
        alert(`⏱️ ${error.message}`);
      } else {
        alert('🔒 ERROR: Se interrumpió la transferencia.');
      }
      
    } finally {
      this.ngZone.run(() => {
        this.isUpdating.set(false);
        if (this.otaTimerInterval) clearInterval(this.otaTimerInterval);
      });

      if (Capacitor.isNativePlatform()) {
        KeepAwake.allowSleep().catch(() => {});
      }
      BleClient.stopEnabledNotifications().catch(() => {});
    }
  }
}