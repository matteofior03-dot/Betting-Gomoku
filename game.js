import { randomUUID } from 'node:crypto';

export const SIZE = 11;
export const STARTING_CHIPS = 18;
export const MAX_BID = 5;

export function newMatch(number = 1) {
  return {
    id: randomUUID(),
    number,
    board: Array(SIZE * SIZE).fill(null),
    chips: [STARTING_CHIPS, STARTING_CHIPS],
    bids: [null, null],
    resetVotes: [false, false],
    phase: 'bid',
    round: 1,
    turn: null,
    first: null,
    winner: null,
    moves: 0,
    lastMove: null,
    winningLine: [],
    auction: null
  };
}

export function view(room, seat) {
  const { bids, resetVotes, ...publicMatch } = room.match;
  return {
    ...publicMatch,
    code: room.code,
    seat,
    players: room.players.map((player, index) => ({
      name: player.name,
      color: index === (room.match.number - 1) % 2 ? 'black' : 'white'
    })),
    ownBid: bids[seat],
    opponentReady: bids[1 - seat] !== null,
    resetVotes,
    maxBid: Math.min(MAX_BID, room.match.chips[seat])
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
  if (action.type === 'bid') return bid(match, seat, action.value);
  if (action.type === 'move') return move(match, seat, action);
  return 'Azione non valida.';
}

function bid(match, seat, value) {
  if (match.phase !== 'bid' || match.bids[seat] !== null) return 'La puntata è già chiusa.';
  if (!Number.isInteger(value) || value < 0 || value > Math.min(MAX_BID, match.chips[seat])) {
    return 'Scegli un importo valido.';
  }

  match.bids[seat] = value;
  if (match.bids.includes(null)) return;

  const [a, b] = match.bids;
  const priority = (match.round + match.number) % 2;
  const first = a === b ? priority : Number(b > a);
  match.chips[first] -= match.bids[first];
  match.auction = { bids: match.bids, winner: first, tie: a === b };
  match.first = first;
  match.turn = first;
  match.phase = 'place';
}

function move(match, seat, { cell, moves }) {
  if (match.phase !== 'place' || match.turn !== seat || moves !== match.moves) {
    return 'Non è il tuo turno.';
  }
  if (!Number.isInteger(cell) || cell < 0 || cell >= match.board.length || match.board[cell] !== null) {
    return 'Scegli un incrocio libero.';
  }

  match.board[cell] = seat;
  match.moves++;
  match.lastMove = cell;
  match.winningLine = findLine(match.board, cell, seat);
  if (match.winningLine.length || match.moves === match.board.length) {
    match.phase = 'finished';
    match.winner = match.winningLine.length ? seat : null;
    match.turn = null;
    return;
  }

  if (seat === match.first) {
    match.turn = 1 - seat;
    return;
  }

  match.round++;
  match.bids = [null, null];
  match.turn = null;
  match.phase = 'bid';
}

function findLine(board, cell, seat) {
  const row = Math.floor(cell / SIZE);
  const col = cell % SIZE;
  const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];

  for (const [dr, dc] of directions) {
    const line = [cell];
    for (const step of [-1, 1]) {
      let r = row + dr * step;
      let c = col + dc * step;
      while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r * SIZE + c] === seat) {
        line.push(r * SIZE + c);
        r += dr * step;
        c += dc * step;
      }
    }
    if (line.length >= 5) return line;
  }
  return [];
}
