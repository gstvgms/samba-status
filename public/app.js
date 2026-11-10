// Draws the status page from data/state.json (written by check.mjs every ~5 min) and avisos.json (notes the team writes
// by hand about an outage: [{ "inicio": "2026-11-10T03:10:00-03:00", "fim": "...", "titulo": "...", "texto": "..." }]).
'use strict';

const TZ = 'America/Sao_Paulo';
const STALE_MS = 25 * 60_000;
const DAY = 86_400_000;

const $ = (id) => document.getElementById(id);
const fmtTime = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const fmtDayTime = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtDay = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' });
const fmtFullDay = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const dayKey = (time) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(time));
const pct = (value) => `${(Math.floor(value * 1000) / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function ago(ms) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'agora há pouco';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `há ${hours} h` : `há ${Math.floor(hours / 24)} dias`;
}

function duration(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function grade(ok, total) {
  if (!total) return 'none';
  if (ok === total) return 'ok';
  return ok / total >= 0.97 ? 'meh' : 'bad';
}

function renderSummary(state, now) {
  const summary = $('summary');
  const down = state.order.filter((id) => state.services[id]?.status === 'down');
  const stale = now - state.updated > STALE_MS;
  summary.className = `summary ${down.length ? 'bad' : 'ok'}`;
  if (down.length) {
    const names = down.map((id) => state.names[id].name);
    $('summary-title').textContent = down.length === state.order.length ? 'O Samba está fora do ar' : `Com problema: ${names.join(', ')}`;
    const since = Math.min(...down.map((id) => state.services[id].since));
    $('summary-detail').textContent = `Desde as ${fmtTime.format(since)}. A gente já está sabendo e mexendo nisso.`;
  } else {
    $('summary-title').textContent = 'Tudo funcionando';
    $('summary-detail').textContent = `Última verificação ${ago(now - state.updated)}.`;
  }
  if (stale) {
    summary.classList.add('stale');
    $('summary-detail').textContent += ` A verificação está atrasada (a última foi ${ago(now - state.updated)}), então isto pode estar desatualizado.`;
  }
}

function renderServices(state, now) {
  const list = $('services');
  list.replaceChildren();
  for (const id of state.order) {
    const service = state.services[id];
    const info = state.names[id];
    if (!service) continue;
    const item = el('li', 'service');
    const head = el('div', 'service-head');
    const title = el('div');
    title.append(el('h3', '', info.name), el('p', 'muted hint', info.hint));
    const pill = el('span', `pill ${service.status === 'up' ? 'ok' : 'bad'}`, service.status === 'up' ? 'Funcionando' : 'Fora do ar');
    head.append(title, pill);

    // 90 bars, one per Brazilian day, the oldest first. Phones show the last 45 (CSS).
    let ok = 0;
    let total = 0;
    const bars = el('div', 'bars');
    for (let back = 89; back >= 0; back--) {
      const key = dayKey(now - back * DAY);
      const [dayOk, dayTotal] = service.days[key] ?? [0, 0];
      ok += dayOk;
      total += dayTotal;
      const label = dayTotal ? `${fmtDay.format(now - back * DAY)}: ${pct(dayOk / dayTotal)} no ar` : `${fmtDay.format(now - back * DAY)}: sem dados`;
      const bar = el('span', `bar ${grade(dayOk, dayTotal)}`);
      bar.title = label;
      bars.append(bar);
    }
    bars.setAttribute('role', 'img');
    bars.setAttribute('aria-label', total ? `${info.name}: ${pct(ok / total)} do tempo no ar nos últimos 90 dias` : `${info.name}: ainda sem dados`);

    const foot = el('div', 'service-foot muted');
    const left = el('span');
    left.append(el('span', 'long', '90 dias atrás'), el('span', 'short', '45 dias atrás'));
    foot.append(left, el('span', 'uptime', total ? `${pct(ok / total)} no ar` : 'medindo'), el('span', '', 'hoje'));
    item.append(head, bars, foot);
    list.append(item);
  }
}

function renderHistory(state, notes, now) {
  const list = $('history');
  list.replaceChildren();
  const cutoff = now - 30 * DAY;
  const entries = [
    ...state.incidents.map((incident) => ({
      start: incident.start,
      end: incident.end,
      title: `${state.names[incident.service]?.name ?? incident.service} fora do ar`,
      text: '',
    })),
    ...notes.map((note) => ({ start: Date.parse(note.inicio), end: note.fim ? Date.parse(note.fim) : null, title: note.titulo, text: note.texto ?? '' })),
  ]
    .filter((entry) => Number.isFinite(entry.start) && (entry.end ?? now) >= cutoff)
    .sort((a, b) => b.start - a.start);
  if (!entries.length) {
    const since = Math.max(cutoff, state.started);
    list.append(el('li', 'empty muted', `Nenhuma queda desde ${fmtFullDay.format(since)}.`));
    return;
  }
  for (const entry of entries) {
    const item = el('li', entry.end === null ? 'open' : '');
    const when = entry.end === null ? `Desde ${fmtDayTime.format(entry.start)}, ainda sem voltar` : `${fmtDayTime.format(entry.start)} até ${(dayKey(entry.end) === dayKey(entry.start) ? fmtTime : fmtDayTime).format(entry.end)} (${duration(entry.end - entry.start)})`;
    item.append(el('h3', '', entry.title), el('p', 'muted when', when));
    if (entry.text) item.append(el('p', 'note', entry.text));
    list.append(item);
  }
}

async function load() {
  const bust = `?t=${Date.now()}`;
  try {
    const [stateResponse, notesResponse] = await Promise.all([fetch(`data/state.json${bust}`), fetch(`avisos.json${bust}`)]);
    if (!stateResponse.ok) throw new Error(String(stateResponse.status));
    const state = await stateResponse.json();
    const notes = notesResponse.ok ? await notesResponse.json().catch(() => []) : [];
    const now = Date.now();
    renderSummary(state, now);
    renderServices(state, now);
    renderHistory(state, Array.isArray(notes) ? notes : [], now);
    $('since').textContent = `Medindo desde ${fmtFullDay.format(state.started)}.`;
  } catch {
    $('summary').className = 'summary stale';
    $('summary-title').textContent = 'Não deu para carregar o status';
    $('summary-detail').textContent = 'A página tenta de novo sozinha em um minuto.';
  }
}

load();
setInterval(load, 60_000);
