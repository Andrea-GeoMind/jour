const { Planner: P } = require('./planner.js');
const MIN = 60000;
const d = s => new Date(s).getTime();
const cfg = {
  wake: '08:00', bed: '00:00', windDown: 30,
  routines: [{ name: 'Déjeuner', start: '12:30', dur: 45 }, { name: 'Dîner', start: '19:30', dur: 45 }],
  projects: [
    { id: 'libre', name: 'Libre', kind: 'libre', min: 90 },
    { id: 'poker', name: 'Poker', kind: 'daily', min: 60 },
    { id: 'geomind', name: 'GeoMind', kind: 'fill', max: 300, chunk: 120, minBlock: 45 },
  ],
};
const events = [
  { s: d('2026-10-29T09:00:00'), e: d('2026-10-29T12:00:00'), title: 'Cours marketing' },
  { s: d('2026-10-29T14:00:00'), e: d('2026-10-29T17:30:00'), title: 'Cours italien' },
  { s: d('2026-10-30T08:30:00'), e: d('2026-10-30T12:30:00'), title: 'Cours' },
];
const tasks = [{ id: 't1', name: 'Révision marketing', minutes: 180, deadline: '2026-11-02' }];
const ctx = { cfg, now: d('2026-10-29T07:00:00'), events, extras: [], tasks, overrides: {} };
const week = P.planWeek(ctx, 3);
const f = t => { const x = new Date(t); return P.pad(x.getHours()) + ':' + P.pad(x.getMinutes()); };
for (const ds of Object.keys(week)) {
  const day = week[ds];
  console.log('\n== ' + ds + ' (libre total ' + day.total + ' min)');
  const all = day.fixed.map(x => ({ ...x, tag: '[' + x.kind + ']' })).concat(day.blocks.map(x => ({ ...x, tag: '' }))).sort((a, b) => a.s - b.s);
  for (const b of all) console.log(f(b.s) + '-' + f(b.e), b.tag, b.title);
}
console.log('\n== parse');
const pctx = { cfg, now: d('2026-10-29T15:00:00'), tasks };
for (const t of [
  'dentiste demain de 14h à 16h',
  "j'ai un pote qui vient jusqu'à 22h",
  'pas fait poker',
  'fait',
  'révision marketing 3h avant vendredi',
  'coucher 1h',
  'libre 2h ce soir',
  'pas de poker demain',
  'il faut que je fasse le rendu de projet 2h30 pour le 3 novembre',
  'réunion GeoMind samedi 10h 11h30',
  'replanifie',
  'blabla',
]) console.log('-', t, '=>', JSON.stringify(P.parse(t, pctx)));
