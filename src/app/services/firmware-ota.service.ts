import { Injectable, signal, NgZone, effect } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { BleClient, numbersToDataView } from '@capacitor-community/bluetooth-le';
import { BleConnectionService } from './ble-connection.service';

/**
 * SERVICIO OTA EXTREMO
 * Gestiona la actualización de firmware empujando los límites físicos del hardware.
 */
@Injectable({
  providedIn: 'root',
})
export class FirmwareOtaService {
  // Buzón estándar para enviar los comandos de inicio/fin OTA (4 y 5)
  private readonly CHAR_UUID = '21436587-2143-6587-2143-658721436587';
  
  // Buzón OTA: Un canal aislado exclusivamente para inyectar el firmware.
  private readonly OTA_CHAR_UUID = '31436587-2143-6587-2143-658721436587';

  // --- SEÑALES EXCLUSIVAS PARA LA INTERFAZ GRÁFICA DEL OTA ---
  public isUpdating = signal<boolean>(false);
  public otaProgress = signal<number>(0);
  public otaTimeSeconds = signal<number>(0);
  private otaTimerInterval: any;

  constructor(
    private connection: BleConnectionService,
    private ngZone: NgZone
  ) {
    // MAGIA REACTIVA: Si se corta la conexión (cable desconectado, alejamiento), abortamos la UI
    effect(() => {
      if (!this.connection.isConnected()) {
        this.isUpdating.set(false);
        this.otaProgress.set(0);
        clearInterval(this.otaTimerInterval);
      }
    }, { allowSignalWrites: true });
  }

  // Método privado para enviar comandos 4 y 5 sin depender del SensorDataService
  private async enviarComandoOta(cmd: number) {
    if (!this.connection.isConnected()) return;
    await BleClient.writeWithoutResponse(
      this.connection.deviceId(),
      this.connection.SERVICE_UUID,
      this.CHAR_UUID,
      numbersToDataView([cmd])
    );
  }

  // =====================================================================
  // --- FUNCIÓN OTA MAESTRA: VELOCIDAD EXTREMA Y SINCRONIZACIÓN PERFECTA ---
  // =====================================================================
  async enviarOTA(firmware: ArrayBuffer) {
    if (!this.connection.isConnected()) return;

    // Preparamos la UI (Crono a 0, barra a 0)
    this.ngZone.run(() => {
      this.isUpdating.set(true);
      this.otaProgress.set(0);
      this.otaTimeSeconds.set(0);
    });

    // Arrancamos el cronómetro de la pantalla
    this.otaTimerInterval = setInterval(() => {
      this.ngZone.run(() => this.otaTimeSeconds.update((s) => s + 1));
    }, 1000);

    try {
      // 1. Damos la orden de inicio al ESP32
      await this.enviarComandoOta(4); 
      
      // ESPERA DE SEGURIDAD: El ESP32 tarda unos milisegundos en borrar la partición Flash vieja.
      await new Promise(r => setTimeout(r, 500)); 

      // --- OPTIMIZACIÓN VITAL 2: MEGA PAQUETES (490 bytes) ---
      const CHUNK_SIZE = 490; 
      const view = new Uint8Array(firmware);
      const totalChunks = Math.ceil(view.length / CHUNK_SIZE);

      // Detectamos el entorno de ejecución (Web o Nativo)
      const isWeb = !Capacitor.isNativePlatform();

      for (let i = 0; i < totalChunks; i++) {
        const chunk = view.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const dataView = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);

        // Envío "Dispara y Olvida".
        await BleClient.writeWithoutResponse(
          this.connection.deviceId(),
          this.connection.SERVICE_UUID,
          this.OTA_CHAR_UUID,
          dataView,
        );

        // --- BIFURCACIÓN DE COMPORTAMIENTO MULTIPLATAFORMA ---
        if (isWeb) {
          // [ MODO WEB / CHROME ]: Marcapasos Natural mediante Ping de hardware
          if (i > 0 && i % 20 === 0) {
            try {
              await BleClient.read(this.connection.deviceId(), this.connection.SERVICE_UUID, this.CHAR_UUID);
            } catch (e) {} 
          }
          
          if (i % 20 === 0 || i === totalChunks - 1) {
            const progress = Math.round(((i + 1) / totalChunks) * 100);
            this.ngZone.run(() => this.otaProgress.set(progress));
          }
        } else {
          // [ MODO MÓVIL NATIVO (ANDROID/iOS) ]: Velocidad de caída libre (32s)
          if (i % Math.floor(totalChunks / 10) === 0 || i === totalChunks - 1) {
            const progress = Math.round(((i + 1) / totalChunks) * 100);
            this.ngZone.run(() => this.otaProgress.set(progress));
          }
        }
      }

      // Fin del bucle. Esperamos 200ms para asegurar el envío aéreo final.
      await new Promise(r => setTimeout(r, 200)); 
      
      // Enviamos comando 5 (Fin OTA y reinicio)
      await this.enviarComandoOta(5); 
      
      // Marcamos el éxito total
      this.ngZone.run(() => this.otaProgress.set(100));

    } catch (error) {
      console.error('Error OTA:', error);
      alert('Fallo en la actualización. Asegúrate de estar cerca del dispositivo.');
    } finally {
      // Limpieza post-actualización
      this.ngZone.run(() => {
        this.isUpdating.set(false);
        clearInterval(this.otaTimerInterval);
      });
    }
  }
}