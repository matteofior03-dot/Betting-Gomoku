import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { newMatch, play, view } from './game.js';

const rooms = new Map();
const ROOM_LIMIT = 500;
const ROOM_TTL = 6 * 60 * 60 * 1000;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const roomCode = /^[A-HJ-NP-Z2-9]{6}$/;
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'application/javascript; charset=utf-8']]
].map(([path, [file, type]]) => [path, { type, body: readFileSync(new URL(`./public/${file}`, import.meta.url)) }]));

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function fail(res, status, error) {
  json(res, status, { error });
}

async function readJson(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) {
    throw Object.assign(new Error('Formato della richiesta non valido.'), { status: 415 });
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > 2048) {
      req.resume();
      throw Object.assign(new Error('Richiesta troppo grande.'), { status: 413 });
    }
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch {
    // Return the same error for malformed JSON and non-object bodies.
  }
  throw Object.assign(new Error('Richiesta non valida.'), { status: 400 });
}

function newCode() {
  let code;
  do {
    code = Array.from(randomBytes(6), byte => alphabet[byte % alphabet.length]).join('');
  } while (rooms.has(code));
  return code;
}

function addPlayer(room, body, res) {
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 24) : '';
  const seat = room.players.length;
  const token = randomBytes(32).toString('hex');
  room.players.push({ name: name || `Giocatore ${seat + 1}`, token });
  room.touched = Date.now();
  json(res, 201, { token, state: view(room, seat) });
}

function findRoom(code) {
  const room = rooms.get(code);
  if (!room || Date.now() - room.touched >= ROOM_TTL) {
    rooms.delete(code);
    return;
  }
  return room;
}

function expireRooms() {
  for (const code of rooms.keys()) findRoom(code);
}

async function handle(req, res) {
  const path = (req.url ?? '/').split('?')[0];
  if (req.method === 'GET' && path === '/health') return json(res, 200, { ok: true });

  if (req.method === 'GET' && assets.has(path)) {
    const asset = assets.get(path);
    res.writeHead(200, { 'Content-Type': asset.type });
    return res.end(asset.body);
  }

  if (path === '/api/rooms' && req.method === 'POST') {
    const body = await readJson(req);
    expireRooms();
    if (rooms.size >= ROOM_LIMIT) return fail(res, 503, 'Troppe stanze attive. Riprova più tardi.');
    const room = { code: newCode(), players: [], match: newMatch(), touched: Date.now() };
    rooms.set(room.code, room);
    return addPlayer(room, body, res);
  }

  const [, api, collection, code, operation, extra] = path.split('/');
  if (api !== 'api' || collection !== 'rooms' || !roomCode.test(code ?? '') || extra !== undefined) {
    return fail(res, 404, 'Pagina non trovata.');
  }

  if (operation === 'join' && req.method === 'POST') {
    const body = await readJson(req);
    const room = findRoom(code);
    if (!room) return fail(res, 404, 'Stanza inesistente o scaduta.');
    if (room.players.length >= 2) return fail(res, 409, 'La stanza è già al completo.');
    return addPlayer(room, body, res);
  }

  const isState = operation === 'state' && req.method === 'GET';
  const isAction = operation === 'action' && req.method === 'POST';
  if (!isState && !isAction) return fail(res, 404, 'Pagina non trovata.');

  const body = isAction ? await readJson(req) : null;
  const room = findRoom(code);
  if (!room) return fail(res, 404, 'Stanza inesistente o scaduta.');
  const authorization = req.headers.authorization;
  const seat = room.players.findIndex(player => authorization === `Bearer ${player.token}`);
  if (seat < 0) return fail(res, 401, 'Sessione non valida.');

  room.touched = Date.now();
  if (isAction) {
    const error = play(room, seat, body);
    if (error) return fail(res, 409, error);
  }
  return json(res, 200, view(room, seat));
}

setInterval(expireRooms, 10 * 60 * 1000).unref();
createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  handle(req, res).catch(error => {
    if (!error.status) console.error(error);
    if (!res.headersSent) fail(res, error.status || 500, error.status ? error.message : 'Errore del server.');
  });
}).listen(Number(process.env.PORT || 3000), '0.0.0.0', () => {
  console.log(`Controluce in ascolto sulla porta ${process.env.PORT || 3000}`);
});
