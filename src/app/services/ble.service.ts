import { Injectable, signal, NgZone } from '@angular/core';
// Importamos Capacitor para detectar si estamos en navegador web (Chrome) o en la app nativa compilada.
import { Capacitor } from '@capacitor/core'; 
import {
  BleClient,
  numbersToDataView,
  ConnectionPriority,
} from '@capacitor-community/bluetooth-le';

/**
 * SERVICIO BLUETOOTH LE OPTIMIZADO PARA OTA EXTREMO
 * Este servicio gestiona la conexión con el ESP32, las lecturas en vivo 
 * y la actualización de firmware (OTA) empujando los límites físicos del hardware.
 */
@Injectable({
  providedIn: 'root',
})
export class BleService {
  // UUIDs de comunicación. El Servicio agrupa las características (buzones).
  private readonly SERVICE_UUID = '56781234-5678-1234-5678-123412345678';
  
  // Buzón estándar: Se usa para leer el sensor de presión y enviar comandos básicos.
  private readonly CHAR_UUID = '21436587-2143-6587-2143-658721436587';

  // Buzón OTA: Un canal aislado exclusivamente para inyectar el firmware.
  // Evita que los megabytes de la actualización colisionen con los datos del sensor.
  private readonly OTA_CHAR_UUID = '31436587-2143-6587-2143-658721436587';

  // --- SEÑALES REACTIVAS (SIGNALS) ---
  // Al usar signals, cualquier cambio aquí redibuja automáticamente el HTML 
  // que esté escuchando, sin necesidad de usar observables (RxJS).
  public deviceId = signal<string>('');
  public isConnected = signal<boolean>(false);

  public lecturas = signal<number[]>([]);
  public datosSpiffs = signal<number[]>([]);
  public isDownloading = signal<boolean>(false);

  // Señales exclusivas para controlar la interfaz gráfica del OTA
  public isUpdating = signal<boolean>(false);
  public otaProgress = signal<number>(0);
  public otaTimeSeconds = signal<number>(0);
  private otaTimerInterval: any;

  // Inyectamos NgZone. Obligatorio porque los eventos de Bluetooth nativo ocurren 
  // "fuera" del ecosistema de Angular. NgZone fuerza a Angular a enterarse de los cambios.
  constructor(private ngZone: NgZone) {}

  // Inicializa el motor de Capacitor Bluetooth LE pidiendo permisos al OS.
  async init() {
    try {
      await BleClient.initialize();
    } catch (e) {
      console.error('Error init:', e);
    }
  }

  // --- PROCESO DE CONEXIÓN ---
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
      // Si el ESP32 se apaga o se aleja, limpia toda la interfaz gráfica.
      await BleClient.connect(device.deviceId, (id) => {
        this.ngZone.run(() => {
          this.isConnected.set(false);
          this.lecturas.set([]);
          this.datosSpiffs.set([]);
          this.isDownloading.set(false);
          this.isUpdating.set(false);
          this.otaProgress.set(0);
          clearInterval(this.otaTimerInterval);
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

      // Se suscribe para escuchar lo que el ESP32 mande por el canal estándar.
      await BleClient.startNotifications(
        device.deviceId,
        this.SERVICE_UUID,
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
        },
      );
    } catch (error) {
      console.error('Error:', error);
    }
  }

  // --- ENVÍO DE COMANDOS DE CONTROL ---
  // Convierte un número (ej. 4 = OTA Start, 5 = OTA End) a binario y lo lanza.
  // Usa writeWithoutResponse porque no necesitamos perder tiempo esperando acuse de recibo.
  async enviarComando(cmd: number) {
    if (!this.isConnected()) return;
    try {
      await BleClient.writeWithoutResponse(
        this.deviceId(),
        this.SERVICE_UUID,
        this.CHAR_UUID,
        numbersToDataView([cmd]),
      );
    } catch (error) {
      console.error('Fallo comando:', error);
    }
  }

  // =====================================================================
  // --- FUNCIÓN OTA MAESTRA: VELOCIDAD EXTREMA Y SINCRONIZACIÓN PERFECTA ---
  // =====================================================================
  async enviarOTA(firmware: ArrayBuffer) {
    if (!this.isConnected()) return;

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
      await this.enviarComando(4); 
      
      // ESPERA DE SEGURIDAD: El ESP32 tarda unos milisegundos en borrar la partición Flash vieja.
      // Si lanzamos datos ahora, se perderían. Le damos medio segundo de ventaja.
      await new Promise(r => setTimeout(r, 500)); 

      // --- OPTIMIZACIÓN VITAL 2: MEGA PAQUETES (490 bytes) ---
      // El límite estándar BLE es 244. Pero gracias a que en el ESP32 activamos el 
      // Data Length Extension (DLE 251) y forzamos el MTU a 512, podemos mandar el DOBLE.
      // Esto reduce las llamadas al puente JS-Nativo de 4300 a solo ~2040.
      const CHUNK_SIZE = 490; 
      const view = new Uint8Array(firmware);
      const totalChunks = Math.ceil(view.length / CHUNK_SIZE);

      // Detectamos el entorno de ejecución:
      // Si es web (Chrome) será true. Si es la App nativa (APK/IPA) será false.
      const isWeb = !Capacitor.isNativePlatform();

      for (let i = 0; i < totalChunks; i++) {
        // Cortamos la porción exacta de 490 bytes
        const chunk = view.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const dataView = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);

        // Envío "Dispara y Olvida". El 'await' aquí es obligatorio para no desordenar 
        // los paquetes al mandarlos al SO. Un desorden corrompería el Checksum del ESP32.
        await BleClient.writeWithoutResponse(
          this.deviceId(),
          this.SERVICE_UUID,
          this.OTA_CHAR_UUID,
          dataView,
        );

        // --- BIFURCACIÓN DE COMPORTAMIENTO MULTIPLATAFORMA ---
        if (isWeb) {
          // [ MODO WEB / CHROME ]
          // Chrome tiene la mala costumbre de tragarse todos los paquetes en su RAM al instante
          // y terminar el bucle en 5s, mientras transmite físicamente en la sombra durante 30s.
          // Para evitar que la barra te mienta:
          // Cada 20 paquetes hacemos un "read()" (Ping Físico). 
          // Al pedir una lectura, forzamos al navegador a vaciar su cola de RAM, enviarla por 
          // la antena, y esperar en silencio hasta que el ESP32 conteste. 
          // Esto es un Marcapasos Natural. Cero pausas falsas, 100% tiempo de antena real.
          if (i > 0 && i % 20 === 0) {
            try {
              await BleClient.read(this.deviceId(), this.SERVICE_UUID, this.CHAR_UUID);
            } catch (e) {} // Ignoramos errores del ping, solo queremos que bloquee.
          }
          
          // En Web, actualizamos la UI cada 20 bloques para un progreso fluido a ritmo del ping.
          if (i % 20 === 0 || i === totalChunks - 1) {
            const progress = Math.round(((i + 1) / totalChunks) * 100);
            this.ngZone.run(() => this.otaProgress.set(progress));
          }
        } else {
          // [ MODO MÓVIL NATIVO (ANDROID/iOS) ]
          // En nativo no hay mentiras: el OS frena el bucle de forma natural si la cola
          // del chip Bluetooth se llena. Quitamos todos los frenos (sin read).
          // El móvil escupe 1MB entero a velocidad de caída libre.
          
          // Actualizamos la UI solo 10 veces en TODO el proceso.
          // Dibujar la pantalla paraliza la CPU milisegundos valiosos. Al dibujar menos,
          // Android dedica el 100% del rendimiento a empujar Bluetooth, logrando el récord de 32s.
          if (i % Math.floor(totalChunks / 10) === 0 || i === totalChunks - 1) {
            const progress = Math.round(((i + 1) / totalChunks) * 100);
            this.ngZone.run(() => this.otaProgress.set(progress));
          }
        }
      }

      // Fin del bucle. Esperamos 200ms para asegurar que el último byte viajó por el aire.
      await new Promise(r => setTimeout(r, 200)); 
      
      // Enviamos comando 5. El ESP32 cierra el OTA, verifica el SHA-256 Checksum y reinicia.
      await this.enviarComando(5); 
      
      // Marcamos el éxito total.
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

  // --- DESCONEXIÓN MANUAL ---
  // Cierra el enlace físico y limpia toda la interfaz y las memorias de la sesión anterior.
  async desconectar() {
    try {
      await BleClient.disconnect(this.deviceId());
      this.ngZone.run(() => {
        this.isConnected.set(false);
        this.deviceId.set('');
        this.lecturas.set([]);
        this.datosSpiffs.set([]);
        this.isUpdating.set(false);
        clearInterval(this.otaTimerInterval);
      });
    } catch (error) {}
  }
}