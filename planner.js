// planner.js — moteur de planification pur (pas de DOM), utilisable dans le navigateur et sous Node.
(function (global) {
  const MIN = 60000;
  const hm = s => { const [a, b] = String(s).split(':').map(Number); return a * 60 + (b || 0); };
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const round5 = t => Math.ceil(t / (5 * MIN)) * 5 * MIN;
  const dayMs = ds => new Date(ds + 'T00:00:00').getTime();

  // ---------- Fenêtre de la journée ----------
  function dayWindow(dateStr, cfg, ov) {
    const base = dayMs(dateStr);
    const start = base + hm((ov && ov.wake) || cfg.wake) * MIN;
    let bed = hm((ov && ov.bed) || cfg.bed);
    if (bed < 6 * 60) bed += 24 * 60; // 00:00 ou 01:00 = lendemain
    const end = base + bed * MIN - (cfg.windDown == null ? 30 : cfg.windDown) * MIN;
    return { start, end };
  }

  function subtract(free, busy) {
    busy = busy.slice().sort((a, b) => a.s - b.s);
    const out = [];
    for (const f of free) {
      let cur = f.s;
      for (const b of busy) {
        if (b.e <= cur || b.s >= f.e) continue;
        if (b.s > cur) out.push({ s: cur, e: b.s });
        cur = Math.max(cur, b.e);
      }
      if (cur < f.e) out.push({ s: cur, e: f.e });
    }
    return out.filter(x => x.e - x.s >= 15 * MIN);
  }

  // Prend `need` minutes dans les créneaux libres (mutés). Retourne les minutes prises.
  function take(slots, blocks, need, meta, opts) {
    const minBlock = opts.minBlock || 30, maxChunk = opts.maxChunk || 120;
    let got = 0;
    let order = opts.reverse ? slots.slice().reverse() : slots.slice();
    if (opts.preferWhole) { // d'abord les créneaux qui contiennent le bloc entier (évite poker coupé en deux par le déjeuner)
      const big = order.filter(sl => (sl.e - sl.s) / MIN >= Math.min(need, maxChunk));
      order = big.concat(order.filter(sl => !big.includes(sl)));
    }
    for (const sl of order) {
      if (need - got <= 0) break;
      const len = (sl.e - sl.s) / MIN;
      if (len < minBlock) continue;
      let chunk = Math.min(need - got, len, maxChunk);
      chunk = Math.floor(chunk / 5) * 5;
      if (chunk < minBlock) {
        // si le créneau est petit mais ≥ minBlock, on prend tout
        if (len >= minBlock && need - got >= minBlock) chunk = Math.min(len, minBlock); else continue;
      }
      let s, e;
      if (opts.reverse) { e = sl.e; s = e - chunk * MIN; sl.e = s; }
      else { s = sl.s; e = s + chunk * MIN; sl.s = e; }
      blocks.push(Object.assign({ s, e }, meta));
      got += chunk;
    }
    return got;
  }

  function mergeBlocks(blocks) {
    blocks.sort((a, b) => a.s - b.s);
    const out = [];
    for (const b of blocks) {
      const last = out[out.length - 1];
      if (last && last.ref === b.ref && last.kind === b.kind && last.e === b.s) last.e = b.e;
      else out.push(Object.assign({}, b));
    }
    return out;
  }

  // ---------- Planifier un jour ----------
  // ctx: {cfg, now, events:[{s,e,title}], extras:[{date,s,e,title}], tasks, overrides, planned:{}, dayIndex}
  function planDay(dateStr, ctx) {
    const cfg = ctx.cfg;
    const ov = ctx.overrides[dateStr] || {};
    const w = dayWindow(dateStr, cfg, ov);
    const base = dayMs(dateStr);
    const fixed = [];
    for (const ev of ctx.events) {
      if (ev.e > w.start && ev.s < w.end + 30 * MIN) fixed.push({ s: ev.s, e: ev.e, title: ev.title, kind: 'fixed' });
    }
    for (const r of (cfg.routines || [])) {
      if (r.off) continue;
      const s = base + hm(r.start) * MIN;
      fixed.push({ s, e: s + r.dur * MIN, title: r.name, kind: 'routine' });
    }
    for (const x of ctx.extras) {
      if (x.date === dateStr) fixed.push({ s: x.s, e: x.e, title: x.title, kind: 'imprevu' });
    }
    let from = w.start;
    if (ctx.now > from) from = round5(ctx.now);
    const slots = subtract([{ s: from, e: w.end }], fixed);
    const total = slots.reduce((a, x) => a + (x.e - x.s), 0) / MIN;
    const blocks = [];
    const skip = new Set(ov.skip || []);

    // 1. tâches à deadline
    const tasks = (ctx.tasks || []).filter(t => !t.done && remaining(t, ctx) > 0);
    tasks.sort((a, b) => (a.deadline || '9999') < (b.deadline || '9999') ? -1 : 1);
    let taskBudget = total * 0.6;
    for (const t of tasks) {
      const rem = remaining(t, ctx);
      let daysLeft = 3;
      if (t.deadline) daysLeft = Math.round((dayMs(t.deadline) - base) / 86400000); // jours avant le jour J (exclu)
      const urgent = daysLeft <= 1;
      daysLeft = Math.max(1, daysLeft);
      let need = Math.min(rem, Math.ceil(rem / daysLeft / 30) * 30);
      if (!urgent) need = Math.min(need, Math.max(0, Math.floor(taskBudget / 5) * 5));
      if (need <= 0) continue;
      const got = take(slots, blocks, need, { title: t.name, kind: 'task', ref: t.id, color: t.color }, { minBlock: 30, maxChunk: 120, preferWhole: true });
      ctx.planned[t.id] = (ctx.planned[t.id] || 0) + got;
      taskBudget -= got;
    }

    // 2. projets
    const projects = (cfg.projects || []).filter(p => !p.off && !skip.has(p.id));
    const libre = projects.find(p => p.kind === 'libre');
    const dailies = projects.filter(p => p.kind === 'daily');
    const fills = projects.filter(p => p.kind === 'fill');

    if (libre) {
      let want = ov.libre != null ? ov.libre : libre.min;
      if (total < 180) want = Math.min(want, 60); // journée courte : le libre rétrécit
      take(slots, blocks, want, { title: libre.name, kind: 'libre', ref: libre.id, color: libre.color }, { reverse: true, minBlock: 30, maxChunk: 240 });
    }
    for (const p of dailies) {
      take(slots, blocks, ov[p.id] != null ? ov[p.id] : p.min, { title: p.name, kind: 'project', ref: p.id, color: p.color }, { minBlock: 30, maxChunk: p.max || p.min, preferWhole: true });
    }
    for (const p of fills) {
      take(slots, blocks, ov[p.id] != null ? ov[p.id] : (p.max || 300), { title: p.name, kind: 'project', ref: p.id, color: p.color }, { minBlock: p.minBlock || 45, maxChunk: p.chunk || 120 });
    }
    // 3. restes → libre
    for (const sl of slots) {
      const len = (sl.e - sl.s) / MIN;
      if (len >= 30 && libre) { blocks.push({ s: sl.s, e: sl.e, title: libre.name, kind: 'libre', ref: libre.id, color: libre.color }); sl.s = sl.e; }
    }
    return { date: dateStr, window: w, fixed: fixed.sort((a, b) => a.s - b.s), blocks: mergeBlocks(blocks), total };
  }

  function remaining(t, ctx) { return (t.minutes || 0) - (t.doneMin || 0) - (ctx.planned[t.id] || 0); }

  function planWeek(ctx, days) {
    days = days || 7;
    ctx.planned = {};
    const today = new Date(ctx.now);
    // si on est après minuit mais avant le lever, on est encore "hier" côté planning
    const wake = hm(ctx.cfg.wake);
    if (today.getHours() * 60 + today.getMinutes() < Math.min(wake, 6 * 60)) today.setDate(today.getDate() - 1);
    const out = {};
    for (let i = 0; i < days; i++) {
      const ds = ymd(addDays(today, i));
      ctx.dayIndex = i;
      out[ds] = planDay(ds, ctx);
    }
    return out;
  }

  // ---------- Parseur de dictée (français) ----------
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();
  const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
  // "14h", "14h30", "14 h 30", "14 heures", "14:30", "midi", "minuit" ; les minutes ne sont prises que si elles ne sont pas elles-mêmes une heure ("10h 11h30")
  const TIME_RE = /(\d{1,2})\s*(?:heures?|h|:)(?:\s?(\d{2})(?!\s*(?:h|heures?|:)))?|\bmidi\b|\bminuit\b/g;

  function timeToMin(m) {
    if (m[0] === 'midi') return 720;
    if (m[0] === 'minuit') return 0;
    return +m[1] * 60 + (+(m[2] || 0));
  }
  function findTimes(s) { const out = []; let m; TIME_RE.lastIndex = 0; while ((m = TIME_RE.exec(s))) out.push({ idx: m.index, min: timeToMin(m), raw: m[0] }); return out; }
  function findDate(s, today) {
    if (/apres[- ]demain/.test(s)) return ymd(addDays(today, 2));
    if (/\bdemain\b/.test(s)) return ymd(addDays(today, 1));
    if (/\bce soir\b|\baujourd'hui\b|\bauj\b/.test(s)) return ymd(today);
    for (let i = 0; i < 7; i++) {
      if (new RegExp('\\b' + DAYS[i] + '\\b').test(s)) {
        let diff = (i - today.getDay() + 7) % 7; if (diff === 0 && !/\bce\b/.test(s)) diff = 7;
        return ymd(addDays(today, diff));
      }
    }
    const m = /\b(?:le|avant le|pour le|d'ici le)\s+(\d{1,2})(?:\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre))?\b/.exec(s);
    if (m) {
      let d = new Date(today); d.setDate(+m[1]);
      if (m[2]) d.setMonth(MONTHS.indexOf(m[2]));
      if (d < today) { if (m[2]) d.setFullYear(d.getFullYear() + 1); else d.setMonth(d.getMonth() + 1); }
      return ymd(d);
    }
    return null;
  }
  function findDuration(s) {
    let m = /(\d+)\s*(?:heures?|h)\s*(\d{2})?/.exec(s);
    const hasTimes = findTimes(s).length >= 2;
    if (m && !hasTimes) return +m[1] * 60 + (+(m[2] || 0));
    m = /(\d+)\s*min/.exec(s); if (m) return +m[1];
    m = /(une|1)\s*demi[- ]heure/.test(s); if (m) return 30;
    return null;
  }
  const STOP = new Set(['imprevu', 'un', 'une', 'le', 'la', 'les', 'de', 'des', 'du', 'a', 'au', 'et', 'j', 'ai', "j'ai", 'je', 'il', 'y', 'ya', 'jusqu', "jusqu'a", 'demain', 'apres', 'ce', 'soir', 'aujourd', "aujourd'hui", 'chez', 'moi', 'vient', 'viennent', 'ajoute', 'ajouter', 'rajoute', 'rajouter', 'faut', 'que', 'il', 'pour', 'avant', 'd', 'ici', 'mettre', 'mets', 'heures', 'heure', 'h', 'min', 'minutes', 'tache', 'nouvelle', 'nouveau', 'en', 'entre', 'vers', 'partir', 'puis', 'sur', 'dans', 'bloque', 'bloquer', 'reserve', 'reserver', 'qui', 'fasse', 'faire', 'fais', 'dois', 'doit', 'falloir', 'me', 'ma', 'mon', 'mes', 'passe', 'passer', 'rdv', 'ai', 'avoir', 'avec']);
  function cleanTitle(s) {
    let t = s.replace(TIME_RE, ' ').replace(/\b(apres[- ]demain|demain|ce soir|aujourd'hui)\b/g, ' ');
    for (const d of DAYS) t = t.replace(new RegExp('\\b' + d + '\\b', 'g'), ' ');
    t = t.replace(/\b(le|avant le|pour le|d'ici le)\s+\d{1,2}(\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre))?\b/g, ' ');
    t = t.replace(/\b\d+\s*(h|min)\b/g, ' ');
    const words = t.split(/[^a-z0-9']+/).filter(w => w && !STOP.has(w) && !/^\d+$/.test(w));
    if (!words.length) return '';
    const title = words.join(' ');
    return title.charAt(0).toUpperCase() + title.slice(1);
  }
  function matchProject(s, cfg, tasks) {
    for (const p of (cfg.projects || [])) if (s.includes(norm(p.name))) return { type: 'project', id: p.id, name: p.name };
    for (const t of (tasks || [])) if (s.includes(norm(t.name))) return { type: 'task', id: t.id, name: t.name };
    return null;
  }

  // Retourne {action, ...champs, summary} ou {action:'unknown'}
  function parse(text, ctx) {
    const today = new Date(ctx.now);
    const s = norm(text);
    const date = findDate(s, today) || ymd(today);
    const times = findTimes(s);
    const proj = matchProject(s, ctx.cfg, ctx.tasks);
    const fmt = m => pad(Math.floor(m / 60)) + 'h' + pad(m % 60);
    const nice = ds => ds === ymd(today) ? "aujourd'hui" : ds === ymd(addDays(today, 1)) ? 'demain' : new Date(ds + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const dlabel = nice(date);

    if (/^(c'est )?(fait|fini|termine|ok|done|bon)\b/.test(s) || /\bj'ai (fait|fini|termine)\b/.test(s))
      return { action: 'done', target: proj, summary: 'Marquer ' + (proj ? proj.name : 'le bloc en cours') + ' comme fait' };
    if (/\b(pas fait|pas eu le temps|pas pu|j'ai saute|j'ai rate|saute|zappe)\b/.test(s))
      return { action: 'skip', target: proj, summary: 'Marquer ' + (proj ? proj.name : 'le bloc en cours') + ' comme sauté' };
    if (/\b(replanifie|reorganise|recalcule|refais)\b/.test(s)) return { action: 'replan', summary: 'Replanifier la semaine' };
    const val = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
    if (/\bcoucher\b/.test(s) && times.length) {
      const m = times[0].min;
      return { action: 'override', date, field: 'bed', value: val(m), summary: 'Coucher à ' + fmt(m) + ' ' + dlabel };
    }
    if (/\blever\b/.test(s) && times.length) {
      const m = times[0].min;
      return { action: 'override', date, field: 'wake', value: val(m), summary: 'Lever à ' + fmt(m) + ' ' + dlabel };
    }
    if (/\bpas de\b/.test(s) && proj && proj.type === 'project')
      return { action: 'override', date, field: 'skip', value: proj.id, summary: 'Pas de ' + proj.name + ' ' + dlabel };
    const dur = findDuration(s);
    if (/\blibre\b/.test(s) && dur != null && times.length < 2)
      return { action: 'override', date, field: 'libre', value: dur, summary: dur + ' min de temps libre ' + dlabel };
    if (proj && proj.type === 'project' && dur != null && times.length < 2 && /\b(que|seulement|juste|max|maxi|mets|mettre|veux)\b/.test(s))
      return { action: 'override', date, field: proj.id, value: dur, summary: proj.name + ' : ' + dur + ' min ' + dlabel };

    // bloc fixe (imprévu / rdv / révision à heure fixe)
    if (times.length >= 2 || (times.length === 1 && /\bjusqu'a\b/.test(s))) {
      const base = dayMs(date);
      let sMin, eMin;
      if (times.length >= 2) { sMin = times[0].min; eMin = times[1].min; }
      else { sMin = null; eMin = times[0].min; }
      let sMs = sMin == null ? round5(ctx.now) : base + sMin * MIN;
      let eMs = base + eMin * MIN;
      if (eMin < 6 * 60) eMs += 24 * 3600000; // "jusqu'à 1h" = lendemain
      if (eMs <= sMs) eMs += 24 * 3600000;
      const title = cleanTitle(s) || 'Imprévu';
      return { action: 'extra', date, s: sMs, e: eMs, title, summary: title + ' ' + dlabel + ' ' + fmt(sMin == null ? Math.round((sMs - base) / MIN) : sMin) + ' → ' + fmt(eMin) };
    }
    // nouvelle tâche avec durée
    if (dur != null) {
      const deadline = findDate(s, today);
      const title = cleanTitle(s) || 'Tâche';
      return { action: 'task', title, minutes: dur, deadline, summary: title + ' : ' + dur + ' min' + (deadline ? ' avant ' + nice(deadline) : ' (réparti sur 3 jours)') };
    }
    return { action: 'unknown', summary: 'Pas compris. Exemples : « dentiste demain de 14h à 16h », « pas fait poker », « révision marketing 3h avant vendredi », « coucher 1h ».' };
  }

  global.Planner = { planDay, planWeek, parse, dayWindow, norm, ymd, addDays, hm, pad, MIN };
})(typeof module !== 'undefined' ? module.exports : window);
