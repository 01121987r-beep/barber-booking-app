# Android quick path

Questa app e' gia' pronta per la divisione:

- cliente: app Android
- admin: web app browser
- backend: unico server Node/Express

## 1. Preparare il backend pubblico

Prima di impacchettare Android, il backend deve essere online.

Esempio:

- `https://barber-booking.onrender.com`

## 2. Impostare l'URL API per la parte cliente

Apri:

- `public/runtime-config.js`

e sostituisci:

```js
window.APP_CONFIG = window.APP_CONFIG || {
  API_BASE: ''
};
```

con:

```js
window.APP_CONFIG = {
  API_BASE: 'https://barber-booking.onrender.com'
};
```

## 3. Installare Capacitor

Nella cartella progetto:

```bash
cd /Users/buscattidocet/Documents/Playground/barber-booking-app
npm install @capacitor/core @capacitor/cli @capacitor/android
```

## 4. Inizializzare Capacitor

Se il file `capacitor.config.json` e' gia' presente, basta aggiungere Android:

```bash
npx cap add android
```

## 5. Copiare gli asset web dentro Android

Ogni volta che modifichi il frontend cliente:

```bash
npx cap sync android
```

## 6. Aprire Android Studio

```bash
npx cap open android
```

Da Android Studio puoi:

- avviare un emulatore
- collegare un telefono Android
- generare APK / AAB

## 7. Cosa resta web

L'area admin continua a stare sul backend online:

- `https://barber-booking.onrender.com/admin`

L'app Android cliente usa solo le API e il flusso prenotazione.

## 8. Note pratiche

- Le prenotazioni cliente sono salvate sul dispositivo tramite `localStorage`.
- Se l'utente cambia telefono o cancella i dati app, perde la vista locale delle prenotazioni.
- Per una versione piu' robusta, in futuro si puo' passare a un account cliente o a un recupero tramite token remoto.

## 9. Comandi rapidi

```bash
cd /Users/buscattidocet/Documents/Playground/barber-booking-app
npm install
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap add android
npx cap sync android
npx cap open android
```
