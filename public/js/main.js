import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config/supabase-config.js';
import { QUESTIONS } from '../config/questions.js';
import { SPRITES } from '../config/sprites.js';
import { TOTAL, VOTE_SEC, getPhase, buildCounts, summarize } from './logic.js';

const $ = s => document.querySelector(s);
const app = $('#app');
const L = 'ABCD';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uuid = () => crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });

const S = { id: localStorage.getItem('quiz_id') || uuid(), team: 0, startedAt: null, counts: null, votes: {}, voteQ: -1, my: {}, key: '', last: '' };
localStorage.setItem('quiz_id', S.id);

const configured = !SUPABASE_URL.startsWith('ВСТАВЬТЕ');
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

/* ---------- серверное время ---------- */
let offset = 0;
const nowS = () => (Date.now() + offset) / 1000;
async function syncTime() {
  let best = null;
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const { data, error } = await sb.rpc('server_now');
    const t1 = Date.now();
    if (error) continue;
    const rtt = t1 - t0;
    if (!best || rtt < best.rtt) best = { rtt, off: new Date(data).getTime() - (t0 + t1) / 2 };
  }
  if (best) offset = best.off;
}

/* ---------- данные ---------- */
async function loadGame() {
  const { data } = await sb.from('game').select('started_at').eq('id', 1).maybeSingle();
  const st = data && data.started_at ? Date.parse(data.started_at) : null;
  if (st !== S.startedAt) Object.assign(S, { startedAt: st, key: '', last: '', counts: null, my: {}, votes: {}, voteQ: -1 });
}
async function loadVotes(q) {
  const { data } = await sb.from('votes').select('player_id,team,choice').eq('q', q).eq('team', S.team);
  if (!data || S.voteQ !== q) return;
  const v = {};
  data.forEach(r => { v[r.player_id] = { team: r.team, choice: r.choice }; });
  if (S.my[q] !== undefined) v[S.id] = { team: S.team, choice: S.my[q] };
  else if (v[S.id]) S.my[q] = v[S.id].choice;
  S.votes = v;
}
async function loadTally() {
  const { data } = await sb.rpc('get_tally');
  if (data) S.counts = buildCounts(data);
}
async function join(team, silent) {
  const { data, error } = await sb.rpc('join_game', { p_id: S.id, p_team: team });
  if (error) { if (!silent) alert('Нет соединения. Попробуйте ещё раз.'); return false; }
  S.team = data; localStorage.setItem('quiz_team', data); S.key = '';
  return true;
}

/* ---------- фазы ---------- */
const curPhase = () => (S.startedAt ? getPhase(nowS() - S.startedAt / 1000) : null);
const keyOf = ph => (ph.q !== undefined ? ph.phase + ph.q : ph.phase);

async function refresh() {
  const ph = curPhase(); if (!ph) return;
  const key = keyOf(ph);
  if (ph.phase === 'question') { await loadVotes(ph.q); renderVotes(); }
  else if (ph.phase === 'result' || ph.phase === 'final') {
    await loadTally();
    const now = curPhase();
    if (!now || keyOf(now) !== key) return;
    const sig = key + JSON.stringify(S.counts);
    if (sig === S.last) return;
    S.last = sig;
    ph.phase === 'result' ? renderResult(ph.q) : renderFinal();
  }
}

function enter(ph) {
  if (ph.phase === 'countdown') app.innerHTML = '<div class="win center"><p class="dim">Игра начинается через</p><div class="huge" id="cd">5</div></div>';
  else if (ph.phase === 'question') {
    if (S.voteQ !== ph.q) { S.voteQ = ph.q; S.votes = {}; }
    renderQuestion(ph.q); renderVotes(); refresh();
  } else { app.innerHTML = '<div class="win center dim">…</div>'; refresh(); }
}

function tick() {
  if (!S.team) return;
  if (!S.startedAt) {
    if (S.key !== 'lobby') {
      S.key = 'lobby';
      app.innerHTML = `<div class="win center"><h1>Вы в <span class="teamtag t${S.team}">Команде ${S.team}</span></h1><p class="dim">Ждём начала игры<span class="cur">_</span></p></div>`;
    }
    return;
  }
  const ph = curPhase(), key = keyOf(ph);
  if (key !== S.key) { S.key = key; S.last = ''; enter(ph); }
  app.classList.toggle('warn', ph.phase === 'question' && ph.left <= 5);
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  if (ph.phase === 'countdown') set('cd', Math.ceil(ph.left));
  if (ph.phase === 'question') {
    set('tn', Math.ceil(ph.left));
    const b = document.getElementById('tb'); if (b) b.style.width = (ph.left / VOTE_SEC * 100) + '%';
  }
  if (ph.phase === 'result') set('nx', Math.ceil(ph.left));
}

/* ---------- экраны ---------- */
function showTeamChoice() {
  S.key = 'choose';
  app.innerHTML = `<div class="win center"><h1>&gt; Викторина<span class="cur">_</span></h1><p class="dim">Выберите свою команду</p>
    <button class="big t1" data-team="1">Команда 1</button><button class="big t2" data-team="2">Команда 2</button></div>`;
}

function renderQuestion(q) {
  const Q = QUESTIONS[q];
  app.innerHTML = `<div class="bar"><span>Вопрос ${q + 1}/${TOTAL}</span><span class="teamtag t${S.team}">Команда ${S.team}</span><span class="tnum" id="tn">20</span></div>
    <div class="tbar"><i id="tb"></i></div><h2 class="qtext">${esc(Q.q)}</h2>
    ${Q.options.map((o, i) => `<button class="opt" data-i="${i}"><b>${L[i]}</b>${esc(o)}<div class="voters" id="v${i}"></div></button>`).join('')}`;
}

function renderVotes() {
  if (!document.getElementById('v0')) return;
  const mine = S.votes[S.id];
  const list = Object.entries(S.votes).filter(([, v]) => v.team === S.team).sort((a, b) => a[1].team - b[1].team || (a[0] < b[0] ? -1 : 1));
  for (let i = 0; i < 4; i++) {
    document.getElementById('v' + i).innerHTML = list.filter(([, v]) => v.choice === i)
      .map(([id, v]) => `<svg class="fl t${v.team}${id === S.id ? ' me' : ''}"><use href="#flame"/></svg>`).join('');
    document.querySelector(`.opt[data-i="${i}"]`).classList.toggle('sel', !!mine && mine.choice === i);
  }
}

async function vote(i) {
  const ph = curPhase(); if (!ph || ph.phase !== 'question') return;
  S.my[ph.q] = i; S.votes[S.id] = { team: S.team, choice: i }; renderVotes();
  const { error } = await sb.rpc('cast_vote', { p_player: S.id, p_q: ph.q, p_choice: i });
  if (error) console.error(error);
}

/* пиксельные компьютеры (настройки — config/sprites.js) */
const scale = () => {
  const w = Math.min(innerWidth, 900) - 40;
  return Math.max(1, Math.min(3, Math.floor((w - 24) / (2 * SPRITES.frame))));
};
function pcHTML(team, score) {
  const s = scale(), P = SPRITES, c = P.screen, fs = P.frame * s;
  return `<div class="pc" data-pc="${team}" data-s="${s}" style="--s:${s};width:${fs}px;height:${fs}px;background-image:url(${P.sheets[team]});background-size:${fs * P.frames}px ${fs}px">
    <div class="pc-screen" style="left:${c.x * s}px;top:${c.y * s}px;width:${c.w * s}px;height:${c.h * s}px"><span class="pc-score">${score}</span></div></div>`;
}
function animate() {
  const P = SPRITES, f = Math.floor(Date.now() / (1000 / P.fps)) % P.frames;
  document.querySelectorAll('.pc').forEach(el => {
    if (el.dataset.f === String(f)) return;
    el.dataset.f = f;
    const s = +el.dataset.s;
    el.style.backgroundPositionX = `${-f * P.frame * s}px`;
    el.firstElementChild.style.transform = `translateY(${P.yOffsets[el.dataset.pc][f] * s}px)`;
  });
}

const sign = n => (n > 0 ? '+' + n : String(n));
const ptsClass = n => (n > 0 ? 'plus' : n < 0 ? 'minus' : 'zero');

function renderResult(q) {
  const Q = QUESTIONS[q], sum = summarize(S.counts, QUESTIONS, q);
  const card = t => {
    const r = sum[t].per[q];
    const ans = r.kind === 'none' ? 'Нет голосов' : r.kind === 'tie' ? 'Ничья' : `Ответ: <b>${L[r.choice]}</b> ${r.kind === 'right' ? '✓' : '✗'}`;
    return `<div class="card t${t}"><div class="pcwrap">${pcHTML(t, sum[t].score)}</div>
      <div>${ans}</div><div class="cnt">${r.counts.map((n, i) => `${L[i]}:${n}`).join(' ')}</div>
      <div class="pts ${ptsClass(r.points)}">${sign(r.points)}</div></div>`;
  };
  app.innerHTML = `<div class="bar"><span>Вопрос ${q + 1}/${TOTAL}</span></div>
    <div class="correct">Правильный ответ: <b>${L[Q.correct]} — ${esc(Q.options[Q.correct])}</b></div>
    <div class="cards">${card(1)}${card(2)}</div><div class="next">Следующий вопрос через <span id="nx">5</span></div>`;
}

function renderFinal() {
  const sum = summarize(S.counts, QUESTIONS, TOTAL - 1), a = sum[1].score, b = sum[2].score;
  const head = a === b ? 'Ничья!' : `Победила Команда ${a > b ? 1 : 2}!`;
  const card = t => `<div class="card t${t}${a !== b && sum[t].score === Math.max(a, b) ? ' win' + t : ''}"><div class="pcwrap">${pcHTML(t, sum[t].score)}</div>
    <div class="stat">Правильных: <b>${sum[t].right}</b><br>Неправильных: <b>${sum[t].wrong}</b><br>Ничьих (0 баллов): <b>${sum[t].draw}</b></div></div>`;
  app.innerHTML = `<div class="winner">${head}</div><div class="cards">${card(1)}${card(2)}</div>`;
}

/* ---------- запуск ---------- */
app.addEventListener('click', async e => {
  const o = e.target.closest('.opt'); if (o) return vote(+o.dataset.i);
  const t = e.target.closest('button[data-team]');
  if (t && await join(+t.dataset.team)) tick();
});
addEventListener('resize', () => { S.key = ''; S.last = ''; });

(async function boot() {
  $('#bgcode').textContent = Array(60).fill('const team = pick(1 | 2);\nfunction vote(i) { return db.save(i); }\nwhile (alive) { think(); code(); }\nif (bug) fix(); else ship();\nconsole.log("hello, world");\n').join('');
  Object.values(SPRITES.sheets).forEach(src => { const im = new Image(); im.onerror = () => document.body.classList.add('nosprite'); im.src = src; });
  if (!sb) { app.innerHTML = '<div class="win center">Сначала впишите URL и ключ Supabase в <b>config/supabase-config.js</b></div>'; return; }
  await syncTime(); setInterval(syncTime, 30000);
  await loadGame();
  const saved = +localStorage.getItem('quiz_team');
  if (saved && !(await join(saved, true))) S.team = saved;
  if (!S.team) showTeamChoice();
  sb.channel('quiz')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'votes' }, p => {
      const r = p.new;
      if (r && r.q === S.voteQ && r.team === S.team && r.player_id !== S.id) { S.votes[r.player_id] = { team: r.team, choice: r.choice }; renderVotes(); }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game' }, () => loadGame())
    .subscribe();
  setInterval(tick, 100); setInterval(animate, 60);
  setInterval(async () => { await loadGame(); refresh(); }, 2000);
  if (new URLSearchParams(location.search).has('admin')) {
    const a = $('#admin'); a.hidden = false;
    a.innerHTML = '<input id="pin" type="password" placeholder="PIN"><button id="go">Старт</button><button id="rs">Сброс</button>';
    const adm = async fn => { const { error } = await sb.rpc(fn, { p_pin: $('#pin').value }); error ? alert('Ошибка: ' + error.message) : loadGame(); };
    $('#go').onclick = () => adm('start_game'); $('#rs').onclick = () => adm('reset_game');
  }
})();
