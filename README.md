# Barber Booking App

Web app completa per barber shop con:
- app cliente mobile-first
- percorso prenotazione guidato
- gestione slot da 30 minuti
- blocco automatico slot occupati
- dashboard admin web con login
- CRUD servizi
- CRUD specialisti
- gestione disponibilita ed eccezioni
- agenda prenotazioni
- database SQLite persistente

## Stack
- Node.js
- Express
- SQLite (`better-sqlite3`)
- frontend vanilla HTML/CSS/JS

## Avvio
1. Installa Node.js 20 o superiore.
2. Apri il terminale nella cartella del progetto.
3. Installa le dipendenze:
   ```bash
   npm install
   ```
4. Avvia il server:
   ```bash
   npm start
   ```
5. Apri:
   - cliente: `http://localhost:3000`
   - admin: `http://localhost:3000/admin`

## Credenziali admin seed
- username: `admin`
- password: `barber123`

## File principali
- `src/server.js`: API Express e routing
- `src/db.js`: schema SQLite, seed dati, logica disponibilita
- `src/auth.js`: hash password e token admin
- `public/index.html`: homepage e prenotazione cliente
- `public/admin.html`: login e dashboard admin
- `public/app.js`: logica lato cliente
- `public/admin.js`: logica dashboard admin
- `public/styles.css`: interfaccia cliente e admin

## Note tecniche
- gli slot sono generati a intervalli da 30 minuti
- la durata del servizio blocca automaticamente gli slot successivi necessari
- le eccezioni possono chiudere un giorno intero o definire una fascia custom
- le prenotazioni confermate e pending rendono gli slot non piu disponibili

## Persistenza
Il database viene creato in:
- `barber-shop.sqlite`

In produzione puoi usare:
- `DB_PATH=/var/data/barber-shop.sqlite`

## Deploy Render

Il progetto include gia:
- `render.yaml`
- health check su `/healthz`
- supporto a `DB_PATH` per disco persistente

Passi rapidi:
1. pubblica il progetto su GitHub
2. su Render crea un nuovo servizio da repository
3. usa il blueprint `render.yaml`
4. Render creera:
   - web service Node
   - disco persistente su `/var/data`

## Variabili ambiente utili
- `PORT`
- `HOST`
- `DB_PATH`
- `WHATSAPP_WEBHOOK_URL` (opzionale)

## Personalizzazione rapida
- servizi seed: `src/db.js`
- specialisti seed: `src/db.js`
- orari e pause: `shop_settings` + `weekly_availability`
- testi homepage: `public/index.html`
