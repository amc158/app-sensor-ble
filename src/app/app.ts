import { Component, OnInit, signal, ViewChild, ElementRef } from '@angular/core';
import { BleService } from './services/ble.service';

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

  constructor(public bleService: BleService) {}

  async ngOnInit() {
    await this.bleService.init();
  }

  async conectar() {
    await this.bleService.conectarESP32();
  }

  async toggleSensor() {
    if (this.bleService.isDownloading()) return; 

    this.isSensorOn.update(v => !v);
    await this.bleService.enviarComando(this.isSensorOn() ? 1 : 0);
  }

  async descargarMemoria() {
    this.isSensorOn.set(false); 
    this.bleService.datosSpiffs.set([]); 
    this.bleService.isDownloading.set(true); 
    
    await this.bleService.enviarComando(2); 
  }

  async borrarMemoria() {
    const seguro = confirm('¿Estás seguro de borrar toda la memoria del sensor?');
    if (seguro) {
      await this.bleService.enviarComando(3);
      this.bleService.datosSpiffs.set([]);
      alert('Memoria borrada con éxito.');
    }
  }

  async desconectar() {
    await this.bleService.desconectar();
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
      // 1. Enviamos el firmware
      await this.bleService.enviarOTA(firmware);
      
      // 2. Limpiamos las variables y el recuadro cuando termine
      this.selectedFirmware.set(null);
      if (this.fileInput) {
        this.fileInput.nativeElement.value = ''; 
      }
    } else {
      // Ahora esta alerta sí saldrá si intentas pulsar el botón sin archivo
      alert('Por favor, selecciona un archivo .bin primero.');
    }
  }
}