import { Component, OnInit, signal, ViewChild, ElementRef } from '@angular/core';
// Importamos los 3 nuevos servicios
import { BleConnectionService } from './services/ble-connection.service';
import { SensorDataService } from './services/sensor-data.service';
import { FirmwareOtaService } from './services/firmware-ota.service';

@Component({
  selector: 'app-root',
  standalone: false,
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class AppComponent implements OnInit {
  
  isSensorOn = signal<boolean>(false);

  // Convertimos el firmware a Signal para que Angular lo detecte al instante
  selectedFirmware = signal<ArrayBuffer | null>(null);
  
  @ViewChild('fileInput') fileInput!: ElementRef; 

  // Inyectamos los 3 servicios como públicos para poder usarlos en el HTML
  constructor(
    public bleConnection: BleConnectionService,
    public sensorData: SensorDataService,
    public firmwareOta: FirmwareOtaService
  ) {}

  async ngOnInit() {
    // Inicializamos el motor Bluetooth desde la capa de red
    await this.bleConnection.init();
  }

  async conectar() {
    // 1. Levantamos la conexión física
    await this.bleConnection.conectarESP32();
    // 2. Justo después, nos suscribimos para escuchar al sensor
    await this.sensorData.iniciarSuscripcionSensor();
  }

  async toggleSensor() {
    if (this.sensorData.isDownloading()) return; 

    this.isSensorOn.update(v => !v);
    await this.sensorData.enviarComando(this.isSensorOn() ? 1 : 0);
  }

  async descargarMemoria() {
    this.isSensorOn.set(false); 
    this.sensorData.datosSpiffs.set([]); 
    this.sensorData.isDownloading.set(true); 
    
    await this.sensorData.enviarComando(2); 
  }

  async borrarMemoria() {
    const seguro = confirm('¿Estás seguro de borrar toda la memoria del sensor?');
    if (seguro) {
      await this.sensorData.enviarComando(3);
      this.sensorData.datosSpiffs.set([]);
      alert('Memoria borrada con éxito.');
    }
  }

  async desconectar() {
    // Solo llamamos a desconectar en la capa de red.
    // Los servicios de OTA y Sensor se limpian solos gracias a su effect().
    await this.bleConnection.desconectar();
    this.isSensorOn.set(false);
  }

  // -----------------------------------------
  // MÉTODOS PARA ACTUALIZACIÓN OTA
  // -----------------------------------------
  
  async onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      const buffer = await file.arrayBuffer();
      this.selectedFirmware.set(buffer); // Guardamos usando .set()
    } else {
      this.selectedFirmware.set(null);
    }
  }

  async iniciarActualizacion() {
    // Obtenemos el valor actual del archivo
    const firmware = this.selectedFirmware();

    if (firmware) {
      // 1. Usamos el servicio dedicado exclusivamente a la OTA
      await this.firmwareOta.enviarOTA(firmware);
      
      // 2. Limpiamos las variables y el recuadro cuando termine
      this.selectedFirmware.set(null);
      if (this.fileInput) {
        this.fileInput.nativeElement.value = ''; 
      }
    } else {
      alert('Por favor, selecciona un archivo .bin primero.');
    }
  }
}