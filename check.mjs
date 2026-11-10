// Checks the Samba from outside (a GitHub runner, not Railway) and updates the status page's data.
//   node check.mjs public/data/state.json
// Every service is tried once and, if it fails, again after 20 s: one hiccup on the runner's network is not an outage.
import fs from 'node:fs';
import path from 'node:path';

export const SERVICES = [
  {
    id: 'site',
    name: 'Site e app',
    hint: 'Abrir o Samba no PC, no celular e no navegador',
    check: () => http('https://sambachat.app/api/health', (body) => body.includes('"ok":true')),
  },
  {
    id: 'gateway',
    name: 'Mensagens e calls',
    hint: 'Mensagens chegando na hora, entrar e sair das calls',
    check: () => gateway('wss://sambachat.app/gateway'),
  },
  {
    id: 'voz',
    name: 'Voz e live',
    hint: 'O som das calls e a imagem das lives',
    check: () => http('https://voz.agenciasmite.com.br/'),
  },
  {
    id: 'updates',
    name: 'Download e atualizações',
    hint: 'Baixar o Samba e receber a versão nova',
    check: () => http('https://sambachat.app/downloads/latest.yml', (body) => body.includes('version:')),
  },
];

const TIMEOUT_MS = 10_000;
const RETRY_AFTER_MS = 20_000;
const KEEP_DAYS = 90;
const KEEP_RECENT_MS = 24 * 3_600_000;
const KEEP_INCIDENTS = 60;

async function http(url, accept = () => true) {
  const started = performance.now();
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': 'samba-status' } });
  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!accept(body)) throw new Error('resposta inesperada');
  return Math.round(performance.now() - started);
}

/** Opens the live connection like the apps do and waits for its "hello". */
function gateway(url) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let socket = null;
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // already closed
      }
      if (error) reject(error);
      else resolve(Math.round(performance.now() - started));
    };
    const timer = setTimeout(() => finish(new Error('sem resposta')), TIMEOUT_MS);
    try {
      socket = new WebSocket(url);
      socket.addEventListener('message', (event) => finish(String(event.data).includes('"hello"') ? null : new Error('resposta inesperada')));
      socket.addEventListener('error', () => finish(new Error('conexão recusada')));
      socket.addEventListener('close', () => finish(new Error('conexão fechada')));
    } catch (error) {
      finish(error);
    }
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** ms if it answered (on the first or the second try), null if it didn't. */
export async function probe(service, retryAfterMs = RETRY_AFTER_MS) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return { ms: await service.check(), error: null };
    } catch (error) {
      if (attempt === 0) await sleep(retryAfterMs);
      else return { ms: null, error: String(error?.message ?? error) };
    }
  }
  return { ms: null, error: 'sem resposta' };
}

/** The day in Brazil (the page shows Brazilian days). */
export const dayOf = (time) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(time));

/** Folds one round of results into the saved state (pure, for the tests). */
export function record(state, results, now) {
  const next = {
    version: 1,
    started: state?.started ?? now,
    updated: now,
    services: { ...(state?.services ?? {}) },
    incidents: [...(state?.incidents ?? [])],
  };
  const today = dayOf(now);
  const oldestDay = dayOf(now - (KEEP_DAYS - 1) * 86_400_000);
  for (const [id, result] of Object.entries(results)) {
    const before = next.services[id] ?? { status: null, since: now, days: {}, recent: [] };
    const status = result.ms === null ? 'down' : 'up';
    const days = { ...before.days };
    const [ok, total] = days[today] ?? [0, 0];
    days[today] = [ok + (status === 'up' ? 1 : 0), total + 1];
    for (const day of Object.keys(days)) if (day < oldestDay) delete days[day];
    next.services[id] = {
      status,
      since: before.status === status ? before.since : now,
      ms: result.ms,
      days,
      recent: [...before.recent, [now, result.ms]].filter(([time]) => time > now - KEEP_RECENT_MS),
    };
    const open = next.incidents.find((incident) => incident.service === id && incident.end === null);
    if (status === 'down' && !open) next.incidents.push({ service: id, start: now, end: null });
    if (status === 'up' && open) open.end = now;
  }
  next.incidents = next.incidents.filter((incident) => incident.end === null || incident.end > now - KEEP_DAYS * 86_400_000).slice(-KEEP_INCIDENTS);
  return next;
}

async function main() {
  const file = process.argv[2] ?? 'public/data/state.json';
  let state = null;
  // No file = first run. A file that doesn't parse stops here: starting over would wipe the history.
  if (fs.existsSync(file)) state = JSON.parse(fs.readFileSync(file, 'utf8'));
  else console.log('starting a fresh history');
  const outcomes = await Promise.all(SERVICES.map(async (service) => [service.id, await probe(service)]));
  for (const [id, outcome] of outcomes) console.log(`${id}: ${outcome.ms === null ? `FORA (${outcome.error})` : `${outcome.ms} ms`}`);
  const next = record(state, Object.fromEntries(outcomes), Date.now());
  next.names = Object.fromEntries(SERVICES.map((service) => [service.id, { name: service.name, hint: service.hint }]));
  next.order = SERVICES.map((service) => service.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next));
}

if (path.basename(process.argv[1] ?? '') === 'check.mjs') await main();
