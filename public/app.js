const byId = id => document.getElementById(id);
const SIZE = 11;
const CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const board = byId('board');
const notice = byId('notice');
const cells = [];
const bidButtons = [];
let session;
let state;
let snapshot;
let busy = false;
let offline = false;
let pollActive = false;
let requestVersion = 0;
let selection = 0;
let focusCell = 60;

function say(message, isError = false) {
  notice.textContent = message;
  notice.dataset.error = isError;
}

function put(id, value) {
  const element = byId(id);
  if (element.textContent !== String(value)) element.textContent = value;
}

async function api(path, { body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    body: body ? JSON.stringify(body) : undefined,
    headers,
    signal: AbortSignal.timeout(10000)
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
  return result;
}

function storage(code, token) {
  try {
    const key = `controluce/${code}`;
    if (token === null) sessionStorage.removeItem(key);
    else if (token) sessionStorage.setItem(key, token);
    else return sessionStorage.getItem(key);
  } catch {
    // Gameplay remains available when browser storage is blocked.
  }
  return null;
}

function roomPath(operation, code = session.code) {
  return `/api/rooms/${code}/${operation}`;
}

function apply(next) {
  const serialized = JSON.stringify(next);
  if (serialized === snapshot) return false;
  if (next.id !== state?.id || next.round !== state?.round) selection = 0;
  if (state && next.id !== state.id) say('Nuova partita. I colori sono stati scambiati.');
  state = next;
  snapshot = serialized;
  return true;
}

function paint() {
  const active = Boolean(state);
  byId('lobby').hidden = active;
  byId('game-panel').hidden = !active;
  byId('copy').hidden = !active;
  byId('create').disabled = busy;
  byId('lobby-form').querySelector('[type="submit"]').disabled = busy;
  if (!active) {
    paintBoard(false, []);
    put('eyebrow', 'STRATEGIA PER DUE');
    byId('headline').innerHTML = 'La partita si gioca<br>su due fronti.';
    byId('description').hidden = false;
    put('round', '11 × 11');
    put('board-status', 'Cinque pietre in linea per vincere.');
    put('move-count', '');
    return;
  }

  const { players, seat, code, phase, number, round, chips, moves, winner, turn, resetVotes } = state;
  const own = players[seat];
  const other = players[1 - seat];
  const canMove = Boolean(other && phase === 'place' && turn === seat && !busy && !offline);
  paintBoard(canMove, players);

  put('eyebrow', `STANZA ${code}`);
  put('headline', 'Sala di gioco');
  byId('description').hidden = true;
  put('round', `Partita ${number} · Round ${round}`);
  put('move-count', moves ? `Mosse ${moves}` : '');
  put('own-name', own.name);
  put('other-name', other?.name ?? 'Posto libero');
  put('own-chips', chips[seat]);
  put('other-chips', other ? chips[1 - seat] : '–');
  byId('own-stone').className = `stone ${own.color}`;
  byId('other-stone').className = `stone ${other?.color ?? (own.color === 'black' ? 'white' : 'black')}`;
  const bidding = other && phase === 'bid';
  put('other-status', !other ? 'In attesa di un giocatore' :
    bidding ? (state.opponentReady ? 'Puntata confermata' : 'Sta scegliendo la puntata') : 'Avversario');

  let title;
  let detail;
  let boardStatus;
  if (!other) {
    title = 'Invita un avversario';
    detail = 'Condividi il link o il codice della stanza per iniziare.';
    boardStatus = 'In attesa del secondo giocatore';
  } else if (phase === 'finished') {
    title = winner === null ? 'Pareggio' : winner === seat ? 'Hai vinto' : `Vince ${other.name}`;
    detail = winner === null ? 'Il tabellone è pieno.' : 'Cinque pietre consecutive.';
    boardStatus = title;
  } else if (phase === 'place') {
    title = turn === seat ? 'Tocca a te' : `Tocca a ${other.name}`;
    detail = turn === seat ? 'Scegli un incrocio libero sul tabellone.' : 'Attendi il piazzamento del tuo avversario.';
    boardStatus = title;
  } else {
    title = state.ownBid === null ? 'Punta per l’iniziativa' : 'Puntata confermata';
    detail = state.ownBid === null ?
      'La puntata resta segreta finché entrambi avete scelto.' :
      `Hai puntato ${state.ownBid} fiches. Attendi la scelta dell’avversario.`;
    boardStatus = 'Puntate in corso';
  }

  put('action-title', title);
  put('action-description', detail);
  put('board-status', offline ? 'Sincronizzazione in corso…' : boardStatus);
  byId('invite').hidden = Boolean(other);
  byId('bid-controls').hidden = !bidding || state.ownBid !== null;
  bidButtons.forEach((button, value) => {
    button.disabled = busy || offline || value > state.maxBid;
    button.setAttribute('aria-pressed', String(value === selection));
  });
  byId('submit-bid').disabled = busy || offline;
  byId('auction').hidden = !state.auction;
  if (state.auction) {
    const { bids, winner: first, tie } = state.auction;
    const label = phase === 'bid' ? 'Round precedente' : 'Iniziativa';
    const initiative = `${bids[seat]} a ${bids[1 - seat]}${tie ? ' (parità)' : ''}`;
    put('auction', `${label} · ${initiative} · ${first === seat ? 'hai iniziato tu' : `ha iniziato ${other.name}`}`);
  }

  const reset = byId('reset');
  reset.hidden = !other;
  reset.disabled = busy || offline;
  put('reset', resetVotes[seat] ? 'Annulla richiesta' : resetVotes[1 - seat] ? 'Conferma reset' : 'Ricomincia partita');
  put('reset-status', resetVotes[seat] ? 'In attesa della conferma.' :
    resetVotes[1 - seat] ? 'L’avversario ha chiesto di ricominciare.' : '');
}

function paintBoard(canMove, players) {
  const colors = players.map(player => player.color);
  board.classList.toggle('white-turn', canMove && colors[state.seat] === 'white');
  cells.forEach((button, index) => {
    const occupant = state?.board[index] ?? null;
    const color = colors[occupant];
    button.classList.toggle('occupied', occupant !== null);
    button.classList.toggle('white', color === 'white');
    button.classList.toggle('last', state?.lastMove === index);
    button.classList.toggle('winning', Boolean(state?.winningLine.includes(index)));
    button.setAttribute('aria-disabled', String(!canMove || occupant !== null));
    const position = `${String.fromCharCode(65 + index % SIZE)}${Math.floor(index / SIZE) + 1}`;
    button.setAttribute('aria-label', `${position}, ${occupant === null ? 'libero' : color === 'white' ? 'bianco' : 'nero'}`);
  });
}

async function sync() {
  if (!session || busy || pollActive) return;
  pollActive = true;
  const version = requestVersion;
  try {
    const next = await api(roomPath('state'), { token: session.token });
    if (version !== requestVersion) return;
    const wasOffline = offline;
    offline = false;
    if (wasOffline) say('');
    if (apply(next) || wasOffline) paint();
  } catch (error) {
    if (version !== requestVersion) return;
    if ([401, 404].includes(error.status)) {
      storage(session.code, null);
      session = state = snapshot = undefined;
      offline = false;
      say(error.message, true);
    } else {
      offline = true;
      say('Connessione interrotta. Tentativo di riconnessione…', true);
    }
    paint();
  } finally {
    pollActive = false;
  }
}

async function lobby(join) {
  if (busy) return;
  const code = byId('code').value.trim().toUpperCase();
  if (join && !CODE.test(code)) {
    say('Inserisci il codice di sei caratteri.', true);
    byId('code').focus();
    return;
  }
  busy = true;
  say('');
  paint();
  try {
    const path = join ? roomPath('join', code) : '/api/rooms';
    const result = await api(path, { body: { name: byId('nickname').value } });
    session = { code: result.state.code, token: result.token };
    storage(session.code, session.token);
    history.replaceState(null, '', `?stanza=${session.code}`);
    apply(result.state);
  } catch (error) {
    say(error.status ? error.message : 'Connessione non disponibile. Riprova.', true);
  } finally {
    busy = false;
    paint();
  }
}

async function act(type, extra) {
  if (!state || busy || offline) return;
  requestVersion++;
  busy = true;
  say('');
  const body = { type, match: state.id, round: state.round, ...extra };
  paint();
  try {
    apply(await api(roomPath('action'), { body, token: session.token }));
  } catch (error) {
    say(error.status ? error.message : 'Azione non confermata. Verifica lo stato e riprova.', true);
  } finally {
    busy = false;
    paint();
    sync();
  }
}

async function copyInvite() {
  if (!session) return;
  const url = new URL('/', location.origin);
  url.searchParams.set('stanza', session.code);
  try {
    await navigator.clipboard.writeText(url.href);
    say('Link d’invito copiato.');
  } catch {
    window.prompt('Copia il link d’invito', url.href);
  }
}

for (let index = 0; index < SIZE * SIZE; index++) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = index === focusCell ? 'cell center' : 'cell';
  button.tabIndex = index === focusCell ? 0 : -1;
  button.append(document.createElement('span'));
  button.addEventListener('focus', () => {
    cells[focusCell].tabIndex = -1;
    focusCell = index;
    button.tabIndex = 0;
  });
  button.addEventListener('click', () => {
    if (button.getAttribute('aria-disabled') === 'false') act('move', { cell: index, moves: state.moves });
  });
  cells.push(button);
  board.append(button);
}

board.addEventListener('keydown', event => {
  const row = Math.floor(focusCell / SIZE);
  const col = focusCell % SIZE;
  const adjacent = {
    ArrowLeft: col > 0 ? focusCell - 1 : focusCell,
    ArrowRight: col < SIZE - 1 ? focusCell + 1 : focusCell,
    ArrowUp: row > 0 ? focusCell - SIZE : focusCell,
    ArrowDown: row < SIZE - 1 ? focusCell + SIZE : focusCell
  };
  if (!Object.hasOwn(adjacent, event.key)) return;
  event.preventDefault();
  cells[adjacent[event.key]].focus();
});

for (let value = 0; value <= 5; value++) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = value;
  button.setAttribute('aria-label', `${value} fiches`);
  button.addEventListener('click', () => {
    selection = value;
    paint();
  });
  bidButtons.push(button);
  byId('bid-values').append(button);
}

byId('lobby-form').addEventListener('submit', event => {
  event.preventDefault();
  lobby(true);
});
byId('create').addEventListener('click', () => lobby(false));
byId('rules').addEventListener('click', () => byId('rules-dialog').showModal());
byId('copy').addEventListener('click', copyInvite);
byId('invite').addEventListener('click', copyInvite);
byId('submit-bid').addEventListener('click', () => act('bid', { value: selection }));
byId('reset').addEventListener('click', () => act('reset', { vote: !state.resetVotes[state.seat] }));

const initialCode = new URLSearchParams(location.search).get('stanza')?.toUpperCase();
if (CODE.test(initialCode ?? '')) {
  byId('code').value = initialCode;
  const token = storage(initialCode);
  if (token) session = { code: initialCode, token };
}
paint();
sync();
setInterval(sync, 1000);
