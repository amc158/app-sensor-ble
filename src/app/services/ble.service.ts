import { Injectable, signal, NgZone } from '@angular/core';
import { BleClient, numbersToDataView } from '@capacitor-community/bluetooth-le';

@Injectable({
  providedIn: 'root'
})
export class BleService {
  private readonly SERVICE_UUID = '56781234-5678-1234-5678-123412345678';
  private readonly CHAR_UUID    = '21436587-2143-6587-2143-658721436587';
  
  public deviceId = signal<string>('');
  public isConnected = signal<boolean>(false);
  
  public lecturas = signal<number[]>([]);
  public datosSpiffs = signal<number[]>([]);
  public isDownloading = signal<boolean>(false);

  constructor(private ngZone: NgZone) { } // <-- NgZone insertado aquí

  async init() {
    try { await BleClient.initialize(); } catch (e) { console.error('Error init:', e); }
  }

  async conectarESP32() {
    try {
      await BleClient.initialize();
      const device = await BleClient.requestDevice({
        acceptAllDevices: true,
        optionalServices: [this.SERVICE_UUID] 
      } as any); 
      
      await BleClient.connect(device.deviceId, (id) => {
        this.ngZone.run(() => {
          this.isConnected.set(false);
          this.lecturas.set([]);
          this.datosSpiffs.set([]);
          this.isDownloading.set(false);
        });
      });

      this.ngZone.run(() => {
        this.deviceId.set(device.deviceId);
        this.isConnected.set(true);
      });

      await BleClient.startNotifications(
        device.deviceId,
        this.SERVICE_UUID,
        this.CHAR_UUID,
        (value) => {
          const presion = value.getFloat32(0, true); 
          
          // ¡CRÍTICO! Wrap con ngZone para que Android refresque el HTML al instante
          this.ngZone.run(() => {
            if (presion <= -9990.0) {
              this.isDownloading.set(false);
              return;
            }

            if (this.isDownloading()) {
              this.datosSpiffs.update(arr => [...arr, presion]);
            } else {
              this.lecturas.update(arr => [presion, ...arr].slice(0, 10));
            }
          });
        }
      );
    } catch (error) { console.error('Error:', error); }
  }

  async enviarComando(cmd: number) {
    if (!this.isConnected()) return;
    try {
      await BleClient.writeWithoutResponse(
        this.deviceId(), 
        this.SERVICE_UUID, 
        this.CHAR_UUID, 
        numbersToDataView([cmd])
      );
    } catch (error) { console.error('Fallo comando:', error); }
  }

  async desconectar() {
    try {
      await BleClient.disconnect(this.deviceId());
      this.ngZone.run(() => {
        this.isConnected.set(false);
        this.deviceId.set('');
        this.lecturas.set([]);
        this.datosSpiffs.set([]);
      });
    } catch (error) {}
  }  
}