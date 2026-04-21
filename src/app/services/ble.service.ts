import { Injectable, signal, NgZone } from '@angular/core';
import { BleClient, numbersToDataView } from '@capacitor-community/bluetooth-le';

@Injectable({
  providedIn: 'root'
})
export class BleService {
  private readonly SERVICE_UUID = '56781234-5678-1234-5678-123412345678';
  private readonly CHAR_UUID    = '21436587-2143-6587-2143-658721436587';
  
  // Nuevas variables para el OTA
  private readonly OTA_CHAR_UUID = '31436587-2143-6587-2143-658721436587'; 
  
  public deviceId = signal<string>('');
  public isConnected = signal<boolean>(false);
  
  public lecturas = signal<number[]>([]);
  public datosSpiffs = signal<number[]>([]);
  public isDownloading = signal<boolean>(false);
  
  public otaProgress = signal<number>(0);
  public isUpdating = signal<boolean>(false);
  
  // Variables para el temporizador
  public otaTimeSeconds = signal<number>(0);
  private otaTimerInterval: any;

  constructor(private ngZone: NgZone) { }

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
          this.isUpdating.set(false);
          
          // --- ESTAS TRES LÍNEAS SON LA CLAVE ---
          this.otaProgress.set(0);         
          this.otaTimeSeconds.set(0);      
          clearInterval(this.otaTimerInterval); 
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

  async enviarOTA(firmware: ArrayBuffer) {
    if (!this.isConnected()) return;
    
    this.ngZone.run(() => {
      this.isUpdating.set(true);
      this.otaProgress.set(0);
      this.otaTimeSeconds.set(0); // Reiniciar el reloj
      
      // Iniciar el temporizador
      this.otaTimerInterval = setInterval(() => {
        this.otaTimeSeconds.update(s => s + 1);
      }, 1000);
    });

    try {
      await this.enviarComando(4); 
      await new Promise(r => setTimeout(r, 500)); 

      const CHUNK_SIZE = 244; 
      const view = new Uint8Array(firmware);
      const totalChunks = Math.ceil(view.length / CHUNK_SIZE);

      for (let i = 0; i < totalChunks; i++) {
        const chunk = view.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        
        await BleClient.writeWithoutResponse(
          this.deviceId(),
          this.SERVICE_UUID,
          this.OTA_CHAR_UUID, 
          numbersToDataView(Array.from(chunk))
        );

        if (i % 16 === 0) {
          await new Promise(r => setTimeout(r, 15)); 
        }

        if (i % 50 === 0 || i === totalChunks - 1) {
          this.ngZone.run(() => this.otaProgress.set(Math.round(((i + 1) / totalChunks) * 100)));
        }
      }

      await this.enviarComando(5);

    } catch (error) {
      console.error('Error en OTA:', error);
      alert('Fallo en la actualización OTA');
    } finally {
      this.ngZone.run(() => {
        this.isUpdating.set(false);
        clearInterval(this.otaTimerInterval); // Detener el reloj al terminar
      });
    }
  }

  async desconectar() {
    try {
      await BleClient.disconnect(this.deviceId());
      this.ngZone.run(() => {
        this.isConnected.set(false);
        this.deviceId.set('');
        this.lecturas.set([]);
        this.datosSpiffs.set([]);
        this.isUpdating.set(false);
        this.otaProgress.set(0);
        clearInterval(this.otaTimerInterval);
      });
    } catch (error) {}
  }  
}