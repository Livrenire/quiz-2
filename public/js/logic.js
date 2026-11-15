// Чистая логика игры (без DOM и сети): фазы по серверному времени и подсчёт баллов.
export const TOTAL = 30, VOTE_SEC = 20, RESULT_SEC = 5, CYCLE = VOTE_SEC + RESULT_SEC;

// elapsed — секунд с момента старта игры (по серверному времени)
export function getPhase(elapsed) {
  if (elapsed < 0) return { phase: 'countdown', left: -elapsed };
  const q = Math.floor(elapsed / CYCLE);
  if (q >= TOTAL) return { phase: 'final', left: 0 };
  const r = elapsed - q * CYCLE;
  return r < VOTE_SEC ? { phase: 'question', q, left: VOTE_SEC - r } : { phase: 'result', q, left: CYCLE - r };
}

// counts — голоса ОДНОЙ команды за варианты [A,B,C,D]
export function judge(counts, correct) {
  const max = Math.max(...counts);
  if (max === 0) return { kind: 'none', points: 0, choice: null };
  const top = counts.map((c, i) => (c === max ? i : -1)).filter(i => i >= 0);
  if (top.length > 1) return { kind: 'tie', points: 0, choice: null };
  const ok = top[0] === correct;
  return { kind: ok ? 'right' : 'wrong', points: ok ? 2 : -2, choice: top[0] };
}

// rows: [{q, team, choice, n}] → counts[q][team][choice]
export function buildCounts(rows) {
  const c = {};
  for (const r of rows || []) {
    c[r.q] ??= { 1: [0, 0, 0, 0], 2: [0, 0, 0, 0] };
    c[r.q][r.team][r.choice] = Number(r.n);
  }
  return c;
}

// Баллы считаются заново из голосов — начислить дважды невозможно.
export function summarize(counts, questions, upTo) {
  const mk = () => ({ score: 0, right: 0, wrong: 0, draw: 0, per: [] });
  const out = { 1: mk(), 2: mk() };
  for (let q = 0; q <= upTo && q < questions.length; q++) {
    for (const t of [1, 2]) {
      const c = (counts && counts[q] && counts[q][t]) || [0, 0, 0, 0];
      const r = { ...judge(c, questions[q].correct), counts: c };
      const o = out[t];
      o.per[q] = r; o.score += r.points;
      if (r.kind === 'right') o.right++; else if (r.kind === 'wrong') o.wrong++; else o.draw++;
    }
  }
  return out;
}
