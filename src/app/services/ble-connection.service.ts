import { Injectable, signal, NgZone } from '@angular/core';
import { BleClient } from '@capacitor-community/bluetooth-le';

/**
 * SERVICIO DE CONEXIÓN BLUETOOTH
 * Gestiona exclusivamente el enlace físico con el ESP32, permisos y estado de conexión.
 */
@Injectable({
  providedIn: 'root',
})
export class BleConnectionService {
  // UUID público para que los otros servicios puedan leerlo
  public readonly SERVICE_UUID = '56781234-5678-1234-5678-123412345678';

  // --- SEÑALES REACTIVAS DE CONEXIÓN ---
  public deviceId = signal<string>('');
  public isConnected = signal<boolean>(false);

  constructor(private ngZone: NgZone) {}

  // Inicializa el motor de Capacitor Bluetooth LE pidiendo permisos al OS.
  async init() {
    try {
      await BleClient.initialize();
    } catch (e) {
      console.error('Error init:', e);
    }
  }

  // --- PROCESO DE CONEXIÓN FÍSICA ---
  async conectarESP32() {
    try {
      await BleClient.initialize();
      
      // Abre el popup nativo del SO para escanear dispositivos. 
      // Filtra para mostrar solo los que emiten nuestro SERVICE_UUID.
      const device = await BleClient.requestDevice({
        acceptAllDevices: true,
        optionalServices: [this.SERVICE_UUID],
      } as any);

      // Conecta y establece un callback de desconexión.
      await BleClient.connect(device.deviceId, (id) => {
        this.ngZone.run(() => {
          this.isConnected.set(false);
          this.deviceId.set('');
        });
      });

      // --- OPTIMIZACIÓN VITAL 1: PRIORIDAD ALTA ---
      // Le exige a Android/iOS que no ahorre batería y dedique la máxima 
      // frecuencia de radio posible a esta conexión. Baja la latencia al mínimo físico.
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

  // --- DESCONEXIÓN MANUAL ---
  // Cierra el enlace físico. Los otros servicios lo detectarán automáticamente vía effect().
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
}