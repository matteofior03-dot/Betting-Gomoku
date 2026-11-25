const byId = id => document.getElementById(id);
const SIZE = 11;
const CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const board = byId('board');
const notice = byId('notice');
const cells = [];
const bidInputs = [byId('bid-1'), byId('bid-2'), byId('bid-3')];
const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
let session;
let state;
let snapshot;
let busy = false;
let offline = false;
let pollActive = false;
let requestVersion = 0;
let selection = [];
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
  if (next.id !== state?.id || next.round !== state?.round) {
    selection = [];
    bidInputs.forEach(input => { input.value = 1; });
  }
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
    put('board-status', 'Esattamente cinque pietre in linea per vincere.');
    return;
  }

  const { players, seat, code, phase, number, round, board: stones, winner, proposer, resetVotes } = state;
  const own = players[seat];
  const other = players[1 - seat];
  const mayPropose = Boolean(other && phase === 'propose' && proposer === seat);
  paintBoard(mayPropose && !busy && !offline, players);

  put('eyebrow', `STANZA ${code}`);
  put('headline', 'Sala di gioco');
  byId('description').hidden = true;
  put('round', `Partita ${number} · Round ${round}`);
  put('own-name', own.name);
  put('own-status', `Tu · ${state.budget} fiches nel round`);
  put('other-name', other?.name ?? 'Posto libero');
  put('own-chips', stones.filter(owner => owner === seat).length);
  put('other-chips', other ? stones.filter(owner => owner === 1 - seat).length : '–');
  byId('own-stone').className = `stone ${own.color}`;
  byId('other-stone').className = `stone ${other?.color ?? (own.color === 'black' ? 'white' : 'black')}`;
  const bidding = other && phase === 'bid';
  put('other-status', !other ? 'In attesa di un giocatore' :
    bidding ? (state.opponentReady ? 'Puntate confermate' : 'Sta puntando') : 'Avversario');

  let title;
  let detail;
  let boardStatus;
  if (!other) {
    title = 'Invita un avversario';
    detail = 'Condividi il link o il codice della stanza per iniziare.';
    boardStatus = 'In attesa del secondo giocatore';
  } else if (phase === 'finished') {
    title = winner === null ? 'Pareggio' : winner === seat ? 'Hai vinto' : `Vince ${other.name}`;
    detail = {
      'both-lines': 'Avete completato una linea valida nello stesso round.',
      'no-space': 'Non restano tre incroci liberi consecutivi.',
      line: 'Esattamente cinque pietre consecutive.'
    }[state.finishReason];
    boardStatus = title;
  } else if (phase === 'propose') {
    title = mayPropose ? 'Scegli tre caselle' : `Tocca a ${other.name}`;
    detail = mayPropose ? 'Seleziona tre incroci liberi consecutivi. Tocca di nuovo un incrocio per deselezionarlo.' :
      'Il tuo avversario sta scegliendo le tre caselle su cui puntare.';
    boardStatus = mayPropose ? `Caselle selezionate: ${selection.length}/3` : 'Scelta delle caselle in corso';
  } else {
    title = state.ownReady ? 'Puntate confermate' : 'Punta sulle tre caselle';
    detail = state.ownReady ? 'Attendi che anche l’avversario confermi.' :
      `Distribuisci fino a ${state.budget} fiches. Le puntate restano segrete.`;
    boardStatus = 'Puntate in corso';
  }

  put('action-title', title);
  put('action-description', detail);
  put('board-status', offline ? 'Sincronizzazione in corso…' : boardStatus);
  byId('invite').hidden = Boolean(other);
  const proposal = byId('submit-proposal');
  proposal.hidden = !mayPropose;
  proposal.disabled = busy || offline || selection.length !== 3;
  byId('bid-controls').hidden = !bidding || state.ownReady;
  if (bidding) {
    state.targets.forEach((cell, index) => put(`bid-label-${index + 1}`, `${index + 1} · ${coordinate(cell)}`));
    bidInputs.forEach(input => { input.max = state.maxBid; });
    updateBudget();
  }

  const reset = byId('reset');
  reset.hidden = !other;
  reset.disabled = busy || offline;
  put('reset', resetVotes[seat] ? 'Annulla richiesta' : resetVotes[1 - seat] ? 'Conferma reset' : 'Ricomincia partita');
  put('reset-status', resetVotes[seat] ? 'In attesa della conferma.' :
    resetVotes[1 - seat] ? 'L’avversario ha chiesto di ricominciare.' : '');
}

function coordinate(index) {
  return `${String.fromCharCode(65 + index % SIZE)}${Math.floor(index / SIZE) + 1}`;
}

function eligibleCells() {
  const eligible = new Set(selection);
  if (selection.length === 3) return eligible;
  state.board.forEach((value, index) => {
    if (value !== null) return;
    const row = Math.floor(index / SIZE);
    const col = index % SIZE;
    for (const [dr, dc] of directions) {
      const endRow = row + dr * 2;
      const endCol = col + dc * 2;
      if (endRow >= SIZE || endCol >= SIZE || endCol < 0) continue;
      const step = dr * SIZE + dc;
      const trio = [index, index + step, index + step * 2];
      if (trio.every(cell => state.board[cell] === null) && selection.every(cell => trio.includes(cell))) {
        trio.forEach(cell => eligible.add(cell));
      }
    }
  });
  return eligible;
}

function paintBoard(canPropose, players) {
  const colors = players.map(player => player.color);
  const eligible = canPropose ? eligibleCells() : new Set();
  const targets = state?.phase === 'bid' ? state.targets : canPropose ? selection : [];
  const last = state?.lastTargets ?? [];
  const winning = new Set(state?.winningLines.flat());
  cells.forEach((button, index) => {
    const occupant = state?.board[index] ?? null;
    const color = colors[occupant];
    const target = targets.indexOf(index);
    button.classList.toggle('occupied', occupant !== null);
    button.classList.toggle('white', color === 'white');
    button.classList.toggle('last', last.includes(index));
    button.classList.toggle('winning', winning.has(index));
    button.classList.toggle('target', target !== -1);
    button.firstElementChild.textContent = target === -1 ? '' : target + 1;
    button.setAttribute('aria-disabled', String(!eligible.has(index)));
    const label = target !== -1 ? `casella ${target + 1}` : ({ white: 'bianco', black: 'nero' }[color] ?? 'libero');
    button.setAttribute('aria-label', `${coordinate(index)}, ${label}`);
  });
}

function bidValues() {
  return bidInputs.map(input => input.valueAsNumber);
}

function updateBudget() {
  const values = bidValues();
  const valid = values.every(value => Number.isInteger(value) && value >= 1 && value <= state.maxBid);
  const total = values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  const remaining = state.budget - total;
  put('budget', remaining < 0 ? `Riduci di ${-remaining} fiches` : `Fiches disponibili: ${remaining} / ${state.budget}`);
  byId('budget').classList.toggle('invalid', remaining < 0);
  byId('submit-bid').disabled = busy || offline || !valid || remaining < 0;
  bidInputs.forEach(input => { input.disabled = busy || offline; });
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
    if (button.getAttribute('aria-disabled') !== 'false') return;
    selection = selection.includes(index) ? selection.filter(cell => cell !== index) : [...selection, index];
    paint();
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

bidInputs.forEach(input => input.addEventListener('input', updateBudget));

byId('lobby-form').addEventListener('submit', event => {
  event.preventDefault();
  lobby(true);
});
byId('create').addEventListener('click', () => lobby(false));
byId('rules').addEventListener('click', () => byId('rules-dialog').showModal());
byId('copy').addEventListener('click', copyInvite);
byId('invite').addEventListener('click', copyInvite);
byId('submit-proposal').addEventListener('click', () => act('propose', { cells: selection }));
byId('submit-bid').addEventListener('click', () => act('bid', { values: bidValues() }));
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
