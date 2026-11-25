# Controluce

Gioco originale per due persone. Il tabellone 11 × 11 è condiviso, mentre ogni giocatore apre la propria postazione e invia in privato tre puntate per round.

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

1. Il giocatore 1 inizia proponendo tre incroci liberi e consecutivi, in orizzontale, verticale o diagonale. Il ruolo di proponente si alterna a ogni round.
2. Si parte con 10 fiches a testa. Dal secondo round ciascuno riceve 10 fiches più la metà di quelle che ha avanzato nel round precedente, arrotondata per difetto. Per esempio, con 5 fiches avanzate si riparte da 12. Ognuno punta da 1 a 10 fiches per ogni incrocio, entro il proprio budget.
3. Per ogni incrocio il valore più alto conquista la posizione. In caso di parità, la posizione va a chi non ha proposto quel round. Il tabellone mostra le pedine assegnate. Gli importi delle puntate e i budget degli avversari restano privati.
4. Dopo aver assegnato tutte e tre le posizioni, si controlla se qualcuno ha una linea di esattamente cinque pedine consecutive del proprio colore, in orizzontale, verticale o diagonale. Una fila di sei o più non conta. Se entrambi completano una linea valida nello stesso round oppure non resta alcun gruppo valido di tre caselle libere, è pareggio.
5. Dopo la doppia conferma di reset il server svuota il tabellone, riparte dal giocatore 1 e scambia i colori nella stessa stanza.

## Aggiornare un servizio Render esistente

Carica i file aggiornati mantenendo la stessa struttura e fai il commit sul branch collegato a Render. Se il deploy automatico è attivo partirà al commit. In alternativa, dal servizio seleziona **Manual Deploy → Deploy latest commit**. Il servizio conserva il suo indirizzo.

## Struttura

- `game.js` gestisce la proposta, le puntate, l’assegnazione delle posizioni, la vittoria e il reset.
- `server.js` serve l’interfaccia, gestisce le stanze e assegna credenziali private per ciascuna postazione.
- `public/` contiene l’interfaccia web, sincronizzata ogni secondo con il server.
