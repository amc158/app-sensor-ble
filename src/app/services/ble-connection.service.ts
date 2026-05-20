import { Injectable, signal, NgZone } from '@angular/core';
import { BleClient } from '@capacitor-community/bluetooth-le';

@Injectable({
  providedIn: 'root',
})
export class BleConnectionService {
  // ✅ Formatos cortos (alias) para facilitar la lectura
  public readonly SERVICE_UUID = '180d';
  public readonly OTA_CHARACTERISTIC_UUID = '2a32';

  public deviceId = signal<string>('');
  public isConnected = signal<boolean>(false);

  constructor(private ngZone: NgZone) {}

  async init() {
    try {
      await BleClient.initialize();
    } catch (e) {
      console.error('Error init:', e);
    }
  }

  async conectarESP32() {
    try {
      await BleClient.initialize();
      
      // ELIMINA CUALQUIER FILTRO DE NOMBRE TEMPORALMENTE
      const device = await BleClient.requestDevice({
        acceptAllDevices: true, // Esto mostrará HASTA LA TV DEL VECINO
      } as any);

      await BleClient.connect(device.deviceId, (id) => {
        this.ngZone.run(() => {
          this.isConnected.set(false);
          this.deviceId.set('');
        });
      });

      try {
        await BleClient.requestConnectionPriority(device.deviceId, 'high' as any);
      } catch (e) {
        console.warn('Prioridad alta no soportada por el SO');
      }

      this.ngZone.run(() => {
        this.deviceId.set(device.deviceId);
        this.isConnected.set(true);
      });

    } catch (error) {
      console.error('Error de conexión:', error);
      throw error;
    }
  }

  async desconectar() {
    try {
      if (this.deviceId()) {
        await BleClient.disconnect(this.deviceId());
      }
      this.ngZone.run(() => {
        this.isConnected.set(false);
        this.deviceId.set('');
      });
    } catch (error) {
      console.error('Error al desconectar', error);
    }
  }

  /**
   * ✅ TRADUCTOR AUTOMÁTICO
   * Mantenlo como 'public' para que tu servicio de OTA 
   * pueda hacer: this.bleConn.expandUuid('2a32')
   */
  public expandUuid(uuid: string): string {
    if (uuid.length === 36) {
      return uuid.toLowerCase();
    }
    const shortUuid = uuid.padStart(4, '0').toLowerCase();
    return `0000${shortUuid}-0000-1000-8000-00805f9b34fb`;
  }
}