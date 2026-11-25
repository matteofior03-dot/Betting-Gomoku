# Controluce

Gioco originale per due persone. Il tabellone 11 × 11 è condiviso, mentre ogni giocatore apre la propria postazione e invia la puntata in privato.

## Avvio in locale

Serve Node.js 24. Dalla cartella che contiene `package.json`:

```sh
npm ci
npm start
```

Apri http://localhost:3000, crea una stanza e apri il link di invito in una finestra in incognito o in un altro browser. Una volta online, puoi condividere il link con chiunque debba occupare il secondo posto. L’invito dà accesso al posto libero, quindi invialo solo a chi vuoi far giocare.

La partita si può riprendere ricaricando la scheda del giocatore. Per mantenere la postazione, lascia aperta la scheda fino a fine partita.

## Pubblicazione su GitHub e Render

1. Crea un repository su GitHub e carica il contenuto di questa cartella. `render.yaml` e `package.json` devono trovarsi alla radice del repository.
2. Nel pannello di Render seleziona **New → Blueprint**, collega il repository e avvia il deploy. Il file `render.yaml` configura un Web Service Node sul piano gratuito con `npm ci`, `npm start` e controllo di salute su `/health`.
3. Apri l’indirizzo `.onrender.com` assegnato da Render e crea una stanza. Per le partite usa tale indirizzo.

Il server usa la porta indicata da Render in `PORT` e tiene le stanze in memoria su una singola istanza. Un riavvio o un nuovo deploy cancella le partite attive. Le stanze inattive scadono dopo sei ore. Sul piano gratuito il servizio può entrare in sospensione e richiedere tempo per riattivarsi.

## Regole

- Ogni giocatore parte con 18 fiches virtuali.
- A inizio round i giocatori puntano in segreto da 0 a 5 fiches, entro il proprio saldo. Chi punta di più paga la propria puntata e sceglie per primo dove piazzare. A parità, la precedenza alterna tra i colori a ogni round, partendo dal nero.
- Ogni giocatore piazza una pedina su un incrocio libero. La partita termina appena un giocatore allinea almeno cinque pedine dello stesso colore in orizzontale, verticale o diagonale. Se la griglia si riempie senza una linea vincente, la partita è pari.
- Entrambi possono chiedere di ricominciare. Dopo la doppia conferma il server svuota il tabellone, ripristina le fiches e scambia i colori nella stessa stanza.

## Struttura

- `game.js` gestisce fasi, puntate, turni, vittoria e reset.
- `server.js` serve l’interfaccia, gestisce le stanze e assegna credenziali private per ciascuna postazione.
- `public/` contiene l’interfaccia web, sincronizzata ogni secondo con il server. Le puntate in corso sono visibili solo a chi le ha fatte, fino alla rivelazione.
