import { Injectable, signal, NgZone, effect } from '@angular/core';
import { BleClient, numbersToDataView } from '@capacitor-community/bluetooth-le';
import { BleConnectionService } from './ble-connection.service';

/**
 * SERVICIO DE DATOS DEL SENSOR
 * Gestiona las suscripciones (presión en vivo), descargas SPIFFS y comandos 0-3.
 */
@Injectable({
  providedIn: 'root',
})
export class SensorDataService {
  // Buzón estándar: Se usa para leer el sensor de presión y enviar comandos básicos.
  private readonly CHAR_UUID = '21436587-2143-6587-2143-658721436587';

  // --- SEÑALES REACTIVAS DE DATOS ---
  public lecturas = signal<number[]>([]);
  public datosSpiffs = signal<number[]>([]);
  public isDownloading = signal<boolean>(false);

  constructor(
    private connection: BleConnectionService,
    private ngZone: NgZone
  ) {
    // MAGIA REACTIVA: Limpiamos los datos automáticamente si el BLE se desconecta
    effect(() => {
      if (!this.connection.isConnected()) {
        this.lecturas.set([]);
        this.datosSpiffs.set([]);
        this.isDownloading.set(false);
      }
    }, { allowSignalWrites: true });
  }

  // Se suscribe para escuchar lo que el ESP32 mande por el canal estándar.
  async iniciarSuscripcionSensor() {
    if (!this.connection.isConnected()) return;

    try {
      await BleClient.startNotifications(
        this.connection.deviceId(),
        this.connection.SERVICE_UUID,
        this.CHAR_UUID,
        (value) => {
          // Extrae 4 bytes como un Float (Little-Endian = true)
          const presion = value.getFloat32(0, true);
          this.ngZone.run(() => {
            if (presion <= -9990.0) { // Marcador de fin de descarga
              this.isDownloading.set(false);
              return;
            }
            if (this.isDownloading()) {
              this.datosSpiffs.update((arr) => [...arr, presion]);
            } else {
              this.lecturas.update((arr) => [presion, ...arr].slice(0, 10));
            }
          });
        }
      );
    } catch (error) {
      console.error('Error en la suscripción del sensor:', error);
    }
  }

  // --- ENVÍO DE COMANDOS DE CONTROL ---
  // Convierte un número a binario y lo lanza.
  async enviarComando(cmd: number) {
    if (!this.connection.isConnected()) return;
    try {
      await BleClient.writeWithoutResponse(
        this.connection.deviceId(),
        this.connection.SERVICE_UUID,
        this.CHAR_UUID,
        numbersToDataView([cmd]),
      );
    } catch (error) {
      console.error('Fallo comando:', error);
    }
  }
}