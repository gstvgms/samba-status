// Draws the status page from data/state.json (written by check.mjs every ~5 min) and avisos.json (what the team writes
// by hand: outages, instability and planned maintenance, with updates; format in the README).
'use strict';

const TZ = 'America/Sao_Paulo';
const STALE_MS = 25 * 60_000;
const DAY = 86_400_000;
const UPCOMING_MS = 30 * DAY;

const $ = (id) => document.getElementById(id);
const fmtTime = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const fmtDayTime = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtDay = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' });
const fmtFullDay = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const dayKey = (time) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(time));
const pct = (value) => `${(Math.floor(value * 1000) / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

const KIND_TITLE = { queda: 'Fora do ar', parcial: 'Instável', manutencao: 'Em manutenção' };
const STEP_LABEL = {
  investigando: 'Investigando',
  identificado: 'Achamos a causa',
  monitorando: 'De olho',
  resolvido: 'Resolvido',
  agendada: 'Agendada',
  andamento: 'Em andamento',
  concluida: 'Concluída',
};

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

function span(start, end) {
  if (end === null) return `Desde ${fmtDayTime.format(start)}`;
  const endText = (dayKey(end) === dayKey(start) ? fmtTime : fmtDayTime).format(end);
  return `${fmtDayTime.format(start)} até ${endText} (${duration(end - start)})`;
}

/** avisos.json → notes with times as numbers; anything malformed is skipped. */
function readNotes(raw, state) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((note) => ({
      kind: KIND_TITLE[note.tipo] ? note.tipo : 'queda',
      title: String(note.titulo ?? ''),
      text: String(note.texto ?? ''),
      services: Array.isArray(note.servicos) && note.servicos.length ? note.servicos.filter((id) => state.names[id]) : [...state.order],
      start: Date.parse(note.inicio),
      end: note.fim ? Date.parse(note.fim) : null,
      steps: (Array.isArray(note.atualizacoes) ? note.atualizacoes : [])
        .map((step) => ({ at: Date.parse(step.quando), label: STEP_LABEL[step.estado] ?? String(step.estado ?? ''), text: String(step.texto ?? '') }))
        .filter((step) => Number.isFinite(step.at))
        .sort((a, b) => b.at - a.at),
    }))
    .filter((note) => note.title && Number.isFinite(note.start) && (note.end === null || Number.isFinite(note.end)));
}

const isActive = (note, now) => note.start <= now && (note.end === null || note.end > now);
const touchesDay = (note, key, now) => dayKey(note.start) <= key && dayKey(note.end ?? now) >= key;

/** What the team says about a service right now (maintenance wins over instability). */
function activeNote(notes, id, now) {
  const active = notes.filter((note) => note.services.includes(id) && isActive(note, now));
  return active.find((note) => note.kind === 'manutencao') ?? active.find((note) => note.kind === 'queda') ?? active.find((note) => note.kind === 'parcial') ?? null;
}

/** A day's bar: what the checks saw, coloured by what the team wrote about that day. */
function dayGrade(ok, total, dayNotes) {
  if (dayNotes.some((note) => note.kind === 'manutencao')) return 'maint';
  if (dayNotes.some((note) => note.kind === 'queda')) return 'bad';
  if (!total) return dayNotes.length ? 'meh' : 'none';
  if (ok === total) return dayNotes.some((note) => note.kind === 'parcial') ? 'meh' : 'ok';
  return ok / total >= 0.97 ? 'meh' : 'bad';
}

const GRADE_TEXT = { ok: 'no ar', meh: 'oscilou', bad: 'caiu', maint: 'manutenção', none: 'sem dados' };

function renderSummary(state, notes, now) {
  const summary = $('summary');
  const title = $('summary-title');
  const detail = $('summary-detail');
  const down = state.order.filter((id) => state.services[id]?.status === 'down');
  const maintenance = notes.filter((note) => note.kind === 'manutencao' && isActive(note, now));
  const partial = notes.filter((note) => note.kind !== 'manutencao' && isActive(note, now));
  if (down.length) {
    const names = down.map((id) => state.names[id].name);
    summary.className = 'summary bad';
    title.textContent = down.length === state.order.length ? 'O Samba está fora do ar' : `Com problema: ${names.join(', ')}`;
    const since = Math.min(...down.map((id) => state.services[id].since));
    detail.textContent = `Desde as ${fmtTime.format(since)}. A gente já está sabendo e mexendo nisso.`;
  } else if (maintenance.length) {
    summary.className = 'summary maint';
    title.textContent = 'Manutenção em andamento';
    const end = maintenance.map((note) => note.end).filter((time) => time !== null);
    detail.textContent = end.length ? `Deve terminar até as ${fmtTime.format(Math.max(...end))}.` : 'Avisamos aqui quando terminar.';
  } else if (partial.length) {
    summary.className = 'summary meh';
    title.textContent = 'Funcionando, com instabilidade';
    detail.textContent = partial[0].title;
  } else {
    summary.className = 'summary ok';
    title.textContent = 'Tudo funcionando';
    detail.textContent = `Última verificação ${ago(now - state.updated)}.`;
  }
  if (now - state.updated > STALE_MS) {
    summary.classList.add('stale');
    detail.textContent += ` A verificação está atrasada (a última foi ${ago(now - state.updated)}), então isto pode estar desatualizado.`;
  }
}

function renderUpcoming(notes, now) {
  const section = $('upcoming');
  const list = $('upcoming-list');
  list.replaceChildren();
  const upcoming = notes.filter((note) => note.kind === 'manutencao' && note.start > now && note.start - now < UPCOMING_MS).sort((a, b) => a.start - b.start);
  section.hidden = !upcoming.length;
  for (const note of upcoming) list.append(noteItem(note, now));
}

function renderServices(state, notes, now) {
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
    const note = activeNote(notes, id, now);
    let pill;
    if (service.status === 'down') pill = el('span', 'pill bad', 'Fora do ar');
    else if (note) pill = el('span', `pill ${note.kind === 'manutencao' ? 'maint' : note.kind === 'queda' ? 'bad' : 'meh'}`, KIND_TITLE[note.kind]);
    else pill = el('span', 'pill ok', 'Funcionando');
    head.append(title, pill);

    // 90 bars, one per Brazilian day, the oldest first. Phones show the last 45 (CSS).
    const mine = notes.filter((candidate) => candidate.services.includes(id) && candidate.start <= now);
    let ok = 0;
    let total = 0;
    const bars = el('div', 'bars');
    for (let back = 89; back >= 0; back--) {
      const time = now - back * DAY;
      const key = dayKey(time);
      const [dayOk, dayTotal] = service.days[key] ?? [0, 0];
      ok += dayOk;
      total += dayTotal;
      const dayNotes = mine.filter((candidate) => touchesDay(candidate, key, now));
      const grade = dayGrade(dayOk, dayTotal, dayNotes);
      const bar = el('span', `bar ${grade}`);
      const measured = dayTotal ? `${pct(dayOk / dayTotal)} no ar` : GRADE_TEXT[grade];
      bar.title = `${fmtDay.format(time)}: ${measured}${dayNotes.length ? `. ${dayNotes.map((candidate) => candidate.title).join('; ')}` : ''}`;
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

/** One written note: title, state, when, what it affects, and its updates newest first. */
function noteItem(note, now) {
  const done = note.end !== null && note.end <= now;
  const upcoming = note.start > now;
  const item = el('li', `note-item ${note.kind}${done ? ' done' : ''}`);
  const head = el('div', 'note-head');
  head.append(el('h3', '', note.title));
  const badge = upcoming ? 'Agendada' : done ? (note.kind === 'manutencao' ? 'Concluída' : 'Resolvido') : note.kind === 'manutencao' ? 'Em andamento' : 'Em aberto';
  head.append(el('span', `badge ${upcoming ? 'maint' : done ? 'ok' : note.kind === 'manutencao' ? 'maint' : note.kind === 'queda' ? 'bad' : 'meh'}`, badge));
  item.append(head);
  item.append(el('p', 'muted when', upcoming && note.end ? `${fmtDayTime.format(note.start)} até ${(dayKey(note.end) === dayKey(note.start) ? fmtTime : fmtDayTime).format(note.end)}` : span(note.start, note.end)));
  if (note.text) item.append(el('p', 'note', note.text));
  if (note.steps.length) {
    const steps = el('ol', 'steps');
    for (const step of note.steps) {
      const row = el('li');
      const line = el('p');
      line.append(el('b', '', step.label), document.createTextNode(` · ${fmtDayTime.format(step.at)}`));
      row.append(line);
      if (step.text) row.append(el('p', 'note', step.text));
      steps.append(row);
    }
    item.append(steps);
  }
  return item;
}

function renderHistory(state, notes, now) {
  const list = $('history');
  list.replaceChildren();
  const cutoff = now - 30 * DAY;
  const written = notes.filter((note) => note.start <= now && (note.end ?? now) >= cutoff);
  // A drop the checks saw and the team already explained shows only once, as the written note.
  const explained = (incident) =>
    written.some((note) => note.services.includes(incident.service) && note.start <= (incident.end ?? now) + 15 * 60_000 && (note.end ?? now) >= incident.start - 15 * 60_000);
  const automatic = state.incidents
    .filter((incident) => (incident.end ?? now) >= cutoff && !explained(incident))
    .map((incident) => ({ start: incident.start, auto: incident }));
  const entries = [...written.map((note) => ({ start: note.start, note })), ...automatic].sort((a, b) => b.start - a.start);
  if (!entries.length) {
    list.append(el('li', 'empty muted', `Nenhuma queda desde ${fmtFullDay.format(Math.max(cutoff, state.started))}.`));
    return;
  }
  for (const entry of entries) {
    if (entry.note) {
      list.append(noteItem(entry.note, now));
      continue;
    }
    const incident = entry.auto;
    list.append(
      noteItem(
        { kind: 'queda', title: `${state.names[incident.service]?.name ?? incident.service} fora do ar`, text: '', start: incident.start, end: incident.end, steps: [] },
        now,
      ),
    );
  }
}

async function load() {
  const bust = `?t=${Date.now()}`;
  try {
    const [stateResponse, notesResponse] = await Promise.all([fetch(`data/state.json${bust}`), fetch(`avisos.json${bust}`)]);
    if (!stateResponse.ok) throw new Error(String(stateResponse.status));
    const state = await stateResponse.json();
    const rawNotes = notesResponse.ok ? await notesResponse.json().catch(() => []) : [];
    const notes = readNotes(rawNotes, state);
    const now = Date.now();
    renderSummary(state, notes, now);
    renderUpcoming(notes, now);
    renderServices(state, notes, now);
    renderHistory(state, notes, now);
    $('since').textContent = `Medindo desde ${fmtFullDay.format(state.started)}.`;
  } catch {
    $('summary').className = 'summary stale';
    $('summary-title').textContent = 'Não deu para carregar o status';
    $('summary-detail').textContent = 'A página tenta de novo sozinha em um minuto.';
  }
}

load();
setInterval(load, 60_000);
