# 📱 App Cliente: Sensor de Presión BLE (Angular + Capacitor)

Esta es la aplicación oficial para interactuar con el **Sensor de Presión BLE**. Gracias a la combinación de **Angular 19** y **Capacitor**, la aplicación es multiplataforma, funcionando de manera nativa en dispositivos **Android** y como Web App (PWA) en navegadores con soporte Web Bluetooth (como Google Chrome).

---

## 🚀 Acceso a la Aplicación

Puedes usar la aplicación de dos formas según tu dispositivo:

### 🌐 Para Navegador (Web App)
[🔗 Acceder a la App en Vivo (GitHub Pages)](https://amc158.github.io/app-sensor-ble/)
> **Requisito crítico:** Para que el Bluetooth funcione en la web, debes usar **Google Chrome** o **Microsoft Edge**. La conexión Bluetooth web requiere un navegador compatible y una conexión segura HTTPS (ya incluida).

### 📱 Para Android (Instalable)
[⬇️ Descargar SensorBLE-App-v1.0.0.apk](https://github.com/amc158/app-sensor-ble/releases/download/v1.0.0/SensorBLE-App-v1.0.0.apk)
> **Nota:** Una vez descargado, abre el archivo para instalarlo. Si Android te muestra una advertencia, asegúrate de permitir la "Instalación desde orígenes desconocidos" en los ajustes de seguridad de tu navegador o gestor de archivos.

---

## ⚙️ Ecosistema: Proyecto de Hardware

Esta aplicación es el "visor" del sistema. La lógica del microcontrolador (firmware en C para ESP32-S3) que lee el sensor físico y gestiona la memoria interna se encuentra aquí:

🔗 **Repositorio del Firmware:** [https://github.com/ualamc158/sensorBLEAppAngular](https://github.com/ualamc158/sensorBLEAppAngular)

---

## ✨ Características Principales

* **Panel de Control en Vivo:** Visualiza la presión actual en milibares (mB) con un historial dinámico.
* **Gestión Remota:** Comandos para Activar/Pausar la lectura del sensor desde el móvil.
* **Descarga de Datos (Caja Negra):** Recupera el historial de promedios guardado en la memoria flash del ESP32.
* **Mantenimiento de Memoria:** Función para borrar remotamente los archivos de datos del sensor.

---

## 👨‍💻 Guía para Desarrolladores

Si deseas contribuir al código o compilar tu propia versión, el proyecto utiliza **Angular CLI** versión 21.2.7.

### 1. Requisitos previos
Clona el repositorio e instala las dependencias:
```bash
npm install
```

### 2. Servidor de desarrollo
Inicia el servidor local para pruebas web:
```bash
ng serve
```
Navega a `http://localhost:4200/`. El Bluetooth web solo funcionará si usas Chrome y el sitio es servido vía HTTPS o desde `localhost`.

### 3. Generación de componentes (Scaffolding)
Para añadir nuevas funcionalidades:
```bash
ng generate component nombre-del-componente
```

### 4. Compilación y Sincronización Nativa (Android)
Para generar los archivos de producción y pasarlos al proyecto de Android:
```bash
ng build
npx cap sync android
```
Luego puedes abrir Android Studio para generar tu propia APK con:
```bash
npx cap open android
```

### 5. Pruebas (Testing)
* **Unitarias:** `ng test` (usando Vitest).
* **End-to-End:** `ng e2e`.

---

## 🛠️ Tecnologías Utilizadas

* **Framework:** Angular 19+
* **Native Bridge:** Capacitor (Ionic)
* **Bluetooth Engine:** `@capacitor-community/bluetooth-le`
* **UI/Styles:** CSS3 nativo con diseño responsivo para móviles.