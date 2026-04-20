import { Component, OnInit, signal } from '@angular/core';
import { BleService } from './services/ble.service';

@Component({
  selector: 'app-root',
  standalone: false,
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class AppComponent implements OnInit {
  
  isSensorOn = signal<boolean>(false);

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
}