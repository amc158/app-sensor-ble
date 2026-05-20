import { Injectable, signal, NgZone, effect } from '@angular/core';
import { BleClient, numbersToDataView } from '@capacitor-community/bluetooth-le';
import { BleConnectionService } from './ble-connection.service';

// --- NUEVA INTERFAZ PARA TU RED DE SENSORES ---
export interface DatosRed {
  presion: number;
  temp1: number;
  hum1: number;
  ec1: number;
  nitrogeno: number;
  fosforo: number;
  potasio: number;
}

@Injectable({
  providedIn: 'root',
})
export class SensorDataService {
  private readonly CHAR_UUID = '21436587-2143-6587-2143-658721436587';

  // --- SEÑALES ACTUALIZADAS PARA OBJETOS COMPLETOS ---
  public lecturas = signal<DatosRed[]>([]);
  public datosSpiffs = signal<DatosRed[]>([]);
  public isDownloading = signal<boolean>(false);

  constructor(
    private connection: BleConnectionService,
    private ngZone: NgZone
  ) {
    effect(() => {
      if (!this.connection.isConnected()) {
        this.lecturas.set([]);
        this.datosSpiffs.set([]);
        this.isDownloading.set(false);
      }
    }, { allowSignalWrites: true });
  }

  async iniciarSuscripcionSensor() {
    if (!this.connection.isConnected()) return;

    try {
      await BleClient.startNotifications(
        this.connection.deviceId(),
        this.connection.SERVICE_UUID,
        this.CHAR_UUID,
        (value) => {
          // El primer float SIEMPRE es la presión o el marcador de fin
          const presion = value.getFloat32(0, true);
          
          this.ngZone.run(() => {
            if (presion <= -9990.0) { 
              this.isDownloading.set(false);
              return;
            }

            // Inicializamos el objeto de datos
            let nuevoDato: DatosRed = {
              presion: presion,
              temp1: 0, hum1: 0, ec1: 0,
              nitrogeno: 0, fosforo: 0, potasio: 0
            };

            // Si el paquete trae los 28 bytes (Modo Vivo con Pulpo RS485)
            if (value.byteLength >= 28) {
              nuevoDato.temp1 = value.getFloat32(4, true);
              nuevoDato.hum1 = value.getFloat32(8, true);
              nuevoDato.ec1 = value.getFloat32(12, true);
              nuevoDato.nitrogeno = value.getFloat32(16, true);
              nuevoDato.fosforo = value.getFloat32(20, true);
              nuevoDato.potasio = value.getFloat32(24, true);
            }

            if (this.isDownloading()) {
              this.datosSpiffs.update((arr) => [...arr, nuevoDato]);
            } else {
              // Guardamos el dato actual y mantenemos los últimos 5 para el historial
              this.lecturas.update((arr) => [nuevoDato, ...arr].slice(0, 5));
            }
          });
        }
      );
    } catch (error) {
      console.error('Error en la suscripción del sensor:', error);
    }
  }

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