import { randomUUID } from 'node:crypto';

export const SIZE = 11;
export const BUDGET = 10;
const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]];

export function newMatch(number = 1) {
  return {
    id: randomUUID(),
    number,
    board: Array(SIZE * SIZE).fill(null),
    bids: [null, null],
    resetVotes: [false, false],
    phase: 'propose',
    round: 1,
    proposer: 0,
    targets: [],
    winner: null,
    finishReason: null,
    winningLines: [[], []],
    result: null
  };
}

export function view(room, seat) {
  const { bids, ...publicMatch } = room.match;
  return {
    ...publicMatch,
    budget: BUDGET,
    code: room.code,
    seat,
    players: room.players.map((player, index) => ({
      name: player.name,
      color: index === (room.match.number - 1) % 2 ? 'black' : 'white'
    })),
    ownBid: bids[seat],
    opponentReady: bids[1 - seat] !== null
  };
}

export function play(room, seat, action) {
  const match = room.match;
  if (room.players.length < 2) return 'Attendi che entri il secondo giocatore.';
  if (action.match !== match.id) return 'La partita è cambiata. Riprova.';
  if (action.type === 'reset') {
    if (typeof action.vote !== 'boolean') return 'Scelta non valida.';
    match.resetVotes[seat] = action.vote;
    if (match.resetVotes.every(Boolean)) room.match = newMatch(match.number + 1);
    return;
  }

  if (action.round !== match.round) return 'Il round è cambiato. Riprova.';
  if (action.type === 'propose') return propose(match, seat, action.cells);
  if (action.type === 'bid') return bid(match, seat, action.values);
  return 'Azione non valida.';
}

function propose(match, seat, cells) {
  if (match.phase !== 'propose' || match.proposer !== seat) return 'Non è il tuo turno di proposta.';
  if (!Array.isArray(cells) || cells.length !== 3 || new Set(cells).size !== 3 ||
      !cells.every(cell => Number.isInteger(cell) && match.board[cell] === null)) {
    return 'Scegli tre incroci liberi e distinti.';
  }

  const selected = new Set(cells);
  if (!cells.some(cell => DIRECTIONS.some(([dr, dc]) => trio(cell, dr, dc)?.every(index => selected.has(index))))) {
    return 'Scegli tre incroci consecutivi sulla stessa linea.';
  }

  match.targets = cells;
  match.phase = 'bid';
}

function bid(match, seat, values) {
  if (match.phase !== 'bid' || match.bids[seat] !== null) return 'La puntata è già chiusa.';
  if (!Array.isArray(values) || values.length !== 3 ||
      !values.every(value => Number.isInteger(value) && value >= 1 && value <= BUDGET) ||
      values.reduce((total, value) => total + value, 0) > BUDGET) {
    return 'Punta almeno un gettone per incrocio e usane al massimo 10 in totale.';
  }

  match.bids[seat] = values;
  if (match.bids.includes(null)) return;

  const [first, second] = match.bids;
  const awards = match.targets.map((cell, index) => {
    const a = first[index];
    const b = second[index];
    const owner = a === b ? 1 - match.proposer : Number(b > a);
    match.board[cell] = owner;
    return { cell, bids: [a, b], owner };
  });
  match.result = { round: match.round, awards };

  // All three positions are awarded before checking either player's lines.
  for (const { cell, owner } of awards) {
    const line = exactLine(match.board, cell, owner);
    if (line.length) match.winningLines[owner] = line;
  }
  const [aWins, bWins] = match.winningLines.map(line => line.length > 0);
  if (aWins || bWins) {
    match.phase = 'finished';
    match.winner = aWins && bWins ? null : Number(bWins);
    match.finishReason = aWins && bWins ? 'both-lines' : 'line';
  } else if (!hasOpenTrio(match.board)) {
    match.phase = 'finished';
    match.finishReason = 'no-space';
  } else {
    match.phase = 'propose';
    match.round++;
    match.proposer = 1 - match.proposer;
  }

  match.bids = [null, null];
  match.targets = [];
}

function inside(row, col) {
  return row >= 0 && row < SIZE && col >= 0 && col < SIZE;
}

function trio(cell, dr, dc) {
  const row = Math.floor(cell / SIZE);
  const col = cell % SIZE;
  if (!inside(row + 2 * dr, col + 2 * dc)) return null;
  const step = dr * SIZE + dc;
  return [cell, cell + step, cell + 2 * step];
}

function hasOpenTrio(board) {
  return board.some((value, cell) => value === null && DIRECTIONS.some(([dr, dc]) =>
    trio(cell, dr, dc)?.every(index => board[index] === null)));
}

function exactLine(board, cell, seat) {
  const row = Math.floor(cell / SIZE);
  const col = cell % SIZE;
  for (const [dr, dc] of DIRECTIONS) {
    const line = [cell];
    for (const step of [-1, 1]) {
      let r = row + dr * step;
      let c = col + dc * step;
      while (inside(r, c) && board[r * SIZE + c] === seat) {
        line.push(r * SIZE + c);
        r += dr * step;
        c += dc * step;
      }
    }
    if (line.length === 5) return line;
  }
  return [];
}
