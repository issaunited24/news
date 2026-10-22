// Shared engine for the Briefly design previews: live data, tabs, swipes, thumbnails, mini charts and the chart panel.
// Each concept page supplies its own look through a THEME object and calls Kit.start(THEME).
(function () {
  const TABS = [
    { id: 'top', name: 'Top' },
    { id: 'world', name: 'World' },
    { id: 'us', name: 'U.S.' },
    { id: 'forex', name: 'Forex' },
    { id: 'tech', name: 'Tech & AI' },
  ];
  const U = id => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&q=70&w=`;
  // Cinematic category photography (Unsplash)
  const PHOTOS = {
    top: [U('1451187580459-43490279c0fa'), U('1634176866089-b633f4aec882'), U('1676944229887-b2def0f94185')],
    world: [U('1617336422396-e1dfc4210ec5'), U('1611323340350-bdcc0e6cfae5'), U('1515868769-ad822a0c67e9'), U('1599578705716-8d3d9246f53b')],
    us: [U('1635255752782-febbe92c2da6'), U('1648231150978-27af59c1d3ca'), U('1764004657175-11ce991efcca'), U('1569285647999-67fc5a1ff1ad')],
    tech: [U('1677442135136-760c813028c0'), U('1756908992154-c8a89f5e517f'), U('1631375937044-6dd5beac01d2'), U('1695144244472-a4543101ef35')],
    forex: [U('1559094522-79422598840f'), U('1611974789855-9c2a0a7236a3'), U('1610375461246-83df859d849d'), U('1605702012553-e954fbde66eb')],
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hashN = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
  const ago = t => { const m = Math.round((Date.now() - t) / 60000); if (m < 1) return 'now'; if (m < 60) return `${m}m`; const h = Math.round(m / 60); return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`; };

  const Kit = {
    TABS, PHOTOS, esc, ago, data: null, charts: null, tab: 'top', theme: null,
    photo(cat, w = 1200, n = 0) { const list = PHOTOS[cat] || PHOTOS.world; return list[n % list.length] + w; },
    // Story thumbnail: the outlet's own photo, else a fitting category photo
    thumb(s, cat, w = 300) {
      if (s.image) return { src: s.image, fallback: Kit.photo(cat, w, hashN(s.id)) };
      return { src: Kit.photo(cat, w, hashN(s.id)), fallback: null };
    },
    level(s) {
      if (s.breaking) return { k: 'red', tag: 'Breaking' };
      const i = s.fx?.impact;
      return i === 'high' ? { k: 'red', tag: 'High' } : i === 'medium' ? { k: 'gold', tag: 'Medium' } : { k: 'cyan', tag: 'Low' };
    },
    catOf(s) { const c = s.categories.find(c => c !== 'forex') || s.categories[0] || 'world'; return c; },
    catName(id) { return (TABS.find(t => t.id === id) || { name: id }).name; },
    stories(tab) {
      if (!Kit.data) return [];
      let list = Kit.data.stories;
      if (tab === 'top') list = list.filter(s => s.top || s.tier === 'major' || s.breaking).sort((a, b) => b.score - a.score);
      else {
        list = list.filter(s => s.categories.includes(tab));
        if (tab === 'forex') list = list.filter(s => (s.fx && s.fx.impact !== 'low') || s.tier === 'major');
        else if (tab === 'us') list = list.filter(s => s.tier !== 'minor' || (s.flags || []).some(f => ['viral', 'culture', 'crime', 'stream'].includes(f)));
        else if (tab === 'world') list = list.filter(s => s.tier !== 'minor' || ((s.flags || []).includes('disaster') && s.sources.length));
        else list = list.filter(s => s.tier !== 'minor');
        list = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
      }
      return list.slice(0, 24);
    },
    // Smoothed closes for a market card from the chart data (falls back to the 5-day series)
    series(key, range = '1W', max = 72) {
      const r = Kit.charts?.assets?.[key]?.ranges?.[range];
      let pts = r?.bars?.map(b => b[4]);
      if (!pts || pts.length < 4) pts = Kit.market(key).points?.map(p => p[1]) || [];
      const out = [];
      if (pts.length > max) { const g = pts.length / max; for (let i = 0; i < max; i++) { const ch = pts.slice(Math.floor(i * g), Math.floor((i + 1) * g)); out.push(ch.reduce((a, b) => a + b, 0) / ch.length); } out[out.length - 1] = pts[pts.length - 1]; }
      else out.push(...pts);
      const last = pts[pts.length - 1] ?? Kit.market(key).last, base = range === '1D' && r?.prevClose ? r.prevClose : pts[0];
      return { pts: out, last, chg: last != null && base ? (last - base) / base * 100 : Kit.market(key).change, range };
    },
    market(key) { return Kit.data?.markets?.items?.[key] || {}; },
    price(key, v) { if (v == null) return '—'; return key === 'usd' ? v.toFixed(2) : v.toLocaleString(undefined, { maximumFractionDigits: key === 'gold' ? 1 : 0 }); },

    // Smooth sparkline path with optional dashed forecast tip. Returns SVG markup.
    spark(points, o = {}) {
      const W = o.w || 120, H = o.h || 40, id = `k${Math.random().toString(36).slice(2, 8)}`;
      const col = o.color || '#7cf';
      if (!points || points.length < 4) return `<svg viewBox="0 0 ${W} ${H}" class="${o.cls || ''}" aria-hidden="true"><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="${col}" stroke-opacity=".35" stroke-dasharray="2 3"/></svg>`;
      let hist = points.slice(-(o.n || 40));
      let fc = [];
      if (o.dir) {
        const diffs = hist.slice(1).map((v, i) => Math.abs(v - hist[i])).slice(-10);
        const step = (diffs.reduce((a, b) => a + b, 0) / diffs.length) || hist[hist.length - 1] * 0.001;
        const sign = o.dir === 'up' ? 1 : o.dir === 'down' ? -1 : 0, k = o.conf ? 0.6 + o.conf / 10 : 0.4, last = hist[hist.length - 1];
        for (let i = 1; i <= Math.max(4, Math.round(hist.length / 5)); i++) fc.push(last + sign * step * k * i);
      }
      const all = hist.concat(fc), n = all.length;
      const min = Math.min(...all), max = Math.max(...all), pad = (max - min) * 0.12 || 1;
      const X = i => (o.padX ?? 1) + i * (W - 2 * (o.padX ?? 1)) / (n - 1), Y = v => H - 2 - ((v - min + pad) / (max - min + 2 * pad)) * (H - 4);
      const P = all.map((v, i) => [X(i), Y(v)]), f = x => x.toFixed(1);
      const smooth = a => { let d = `M${f(a[0][0])} ${f(a[0][1])}`; for (let i = 0; i < a.length - 1; i++) { const p0 = a[i - 1] || a[i], p1 = a[i], p2 = a[i + 1], p3 = a[i + 2] || p2; d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`; } return d; };
      const hi = P.slice(0, hist.length), line = smooth(hi);
      const [ex, ey] = P[n - 1];
      return `<svg viewBox="0 0 ${W} ${H}" class="${o.cls || ''}" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity="${o.fillOpacity ?? 0.35}"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient>
        <filter id="${id}g" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="${o.glow ?? 1.6}"/></filter></defs>
        <path d="${line} L${f(hi[hi.length - 1][0])} ${H} L${f(hi[0][0])} ${H} Z" fill="url(#${id})"/>
        ${o.glow === 0 ? '' : `<path d="${line}" fill="none" stroke="${col}" stroke-width="${(o.stroke || 1.6) * 2.2}" stroke-opacity=".45" filter="url(#${id}g)"/>`}
        <path d="${line}" fill="none" stroke="${col}" stroke-width="${o.stroke || 1.6}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
        ${fc.length ? `<path d="${smooth(P.slice(hist.length - 1))}" fill="none" stroke="${col}" stroke-width="${o.stroke || 1.6}" stroke-dasharray="3 2.5" vector-effect="non-scaling-stroke"/>` : ''}
        ${o.dot === false ? '' : `<circle cx="${f(ex)}" cy="${f(ey)}" r="${o.dotR || 2.4}" fill="${col}"/><circle cx="${f(ex)}" cy="${f(ey)}" r="${(o.dotR || 2.4) * 2.4}" fill="${col}" opacity=".22"/>`}
      </svg>`;
    },
    // The three forecast mini charts for a Forex story
    forecasts(fx, o = {}) {
      const a = fx?.assets || {};
      return [['GOLD', 'gold'], ['USD', 'usd'], ['NDQ', 'ndq']].map(([label, key]) => {
        const f = a[key] || { dir: 'flat' }, col = f.dir === 'up' ? (o.up || '#38f5b0') : f.dir === 'down' ? (o.down || '#ff5c8a') : (o.flat || '#8a90a8');
        const pts = Kit.market(key).points?.map(p => p[1]);
        return { label, key, dir: f.dir, conf: f.conf || 0, color: col, svg: Kit.spark(pts, { w: o.w || 72, h: o.h || 18, color: col, dir: f.dir === 'flat' ? null : f.dir, conf: f.conf, n: 22, stroke: 1.2, dotR: 1.4, glow: o.glow ?? 1.2, fillOpacity: 0.32 }) };
      });
    },

    /* ---------- Chart panel ---------- */
    CH: { asset: 'gold', range: '1D', type: 'area' },
    ASSETS: { gold: { name: 'Gold', sym: 'XAU/USD' }, usd: { name: 'US Dollar Index', sym: 'DXY' }, ndq: { name: 'Nasdaq', sym: 'NASDAQ' } },
    RANGES: ['1D', '1W', '1M', '3M', '1Y', '5Y'],
    TYPES: [['candles', 'Candles'], ['line', 'Line'], ['area', 'Area'], ['bars', 'Bars']],
    openChart(key, from) {
      Kit.CH.asset = key;
      const T = Kit.theme, root = document.getElementById('chartPanel');
      // where the panel grows from (themes can animate out of the tapped card)
      if (from) { const r = from.getBoundingClientRect(); Object.entries({ '--ox': r.left, '--oy': r.top, '--ow': r.width, '--oh': r.height }).forEach(([k, v]) => root.style.setProperty(k, v + 'px')); }
      root.innerHTML = T.chartShell();
      root.hidden = false;
      void root.offsetWidth; requestAnimationFrame(() => { void root.offsetWidth; root.classList.add('open'); });
      setTimeout(() => Kit.drawChart(), 60);
    },
    closeChart() {
      const root = document.getElementById('chartPanel');
      root.classList.remove('open');
      setTimeout(() => { root.hidden = true; root.innerHTML = ''; }, 420);
    },
    drawChart() {
      const T = Kit.theme, c = Kit.CH, root = document.getElementById('chartPanel');
      const r = Kit.charts?.assets?.[c.asset]?.ranges?.[c.range];
      const bars = r?.bars || [];
      const last = bars[bars.length - 1]?.[4];
      const base = c.range === '1D' && r?.prevClose ? r.prevClose : bars[0]?.[1];
      const chg = last != null && base ? last - base : null, pct = chg != null ? chg / base * 100 : null;
      const up = (chg ?? 0) >= 0;
      const q = sel => root.querySelector(sel);
      const set = (sel, html) => { const el = q(sel); if (el) el.innerHTML = html; };
      set('[data-k=name]', esc(Kit.ASSETS[c.asset].name));
      set('[data-k=sym]', esc(Kit.ASSETS[c.asset].sym));
      const showPrice = (v, t) => {
        set('[data-k=price]', v != null ? Kit.price(c.asset, v) : '—');
        if (t != null) set('[data-k=chg]', `<span class="ch-time">${new Intl.DateTimeFormat(undefined, ['1D', '1W'].includes(c.range) ? { weekday: 'short', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', year: ['1Y', '5Y'].includes(c.range) ? 'numeric' : undefined }).format(t * 1000)}</span>`);
        else set('[data-k=chg]', chg != null ? `${up ? '+' : ''}${Kit.price(c.asset, chg)} (${up ? '+' : ''}${pct.toFixed(2)}%) <span>${c.range}</span>` : 'No data yet');
      };
      showPrice(last, null);
      q('[data-k=chg]')?.classList.toggle('dn', !up);
      root.querySelectorAll('[data-asset]').forEach(b => b.setAttribute('aria-pressed', b.dataset.asset === c.asset));
      root.querySelectorAll('[data-range]').forEach(b => b.setAttribute('aria-pressed', b.dataset.range === c.range));
      root.querySelectorAll('[data-type]').forEach(b => b.setAttribute('aria-pressed', b.dataset.type === c.type));
      const box = q('[data-k=chart]');
      if (!bars.length) { box.innerHTML = '<div class="ch-msg">No chart data yet. It arrives with the next update.</div>'; return; }
      Kit.chart(box, bars, { type: c.type, base: c.range === '1D' ? base : null, col: T.chartColors(up), range: c.range, onScrub: (b) => { if (b) showPrice(b[4], b[0]); else { showPrice(last, null); q('[data-k=chg]')?.classList.toggle('dn', !up); } } });
    },
    // A hand-built canvas chart: smooth line or area, candles, or OHLC bars, with touch scrubbing
    chart(box, raw, o) {
      box.innerHTML = '<canvas></canvas>';
      const cv = box.firstChild, ctx = cv.getContext('2d');
      const col = o.col, dpr = Math.min(3, window.devicePixelRatio || 1);
      const W = box.clientWidth, H = box.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
      ctx.scale(dpr, dpr);
      // candles and bars: group into at most ~70 so each is readable
      let bars = raw;
      if ((o.type === 'candles' || o.type === 'bars') && raw.length > 70) {
        const g = Math.ceil(raw.length / 70); bars = [];
        for (let i = 0; i < raw.length; i += g) { const ch = raw.slice(i, i + g); bars.push([ch[0][0], ch[0][1], Math.max(...ch.map(b => b[2])), Math.min(...ch.map(b => b[3])), ch[ch.length - 1][4]]); }
      }
      const n = bars.length, PT = 14, PB = 22, PL = 2, PR = 46;
      const lo = Math.min(...bars.map(b => (o.type === 'line' || o.type === 'area') ? b[4] : b[3]), o.base ?? Infinity);
      const hi = Math.max(...bars.map(b => (o.type === 'line' || o.type === 'area') ? b[4] : b[2]), o.base ?? -Infinity);
      const pad = (hi - lo) * 0.08 || hi * 0.001 || 1;
      const min = lo - pad, max = hi + pad;
      const X = i => PL + (n === 1 ? (W - PL - PR) / 2 : i * (W - PL - PR) / (n - 1));
      const Y = v => PT + (1 - (v - min) / (max - min)) * (H - PT - PB);
      const fmt = v => (Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v.toFixed(2));
      const tfmt = t => new Intl.DateTimeFormat(undefined, ['1D'].includes(o.range) ? { hour: '2-digit', minute: '2-digit' } : ['1W', '1M'].includes(o.range) ? { day: 'numeric', month: 'short' } : o.range === '5Y' ? { year: 'numeric' } : { month: 'short' }).format(t * 1000);
      const smooth = pts => { // monotone-ish cubic through points
        if (pts.length < 2) return '';
        let d = `M${pts[0][0]},${pts[0][1]}`;
        for (let i = 0; i < pts.length - 1; i++) { const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2; const t = 0.18; d += ` C${p1[0] + (p2[0] - p0[0]) * t},${p1[1] + (p2[1] - p0[1]) * t} ${p2[0] - (p3[0] - p1[0]) * t},${p2[1] - (p3[1] - p1[1]) * t} ${p2[0]},${p2[1]}`; }
        return d;
      };
      const pts = bars.map((b, i) => [X(i), Y(b[4])]);
      const path = new Path2D(smooth(pts));
      let progress = 0, scrub = -1;
      function frame() {
        ctx.clearRect(0, 0, W, H);
        // grid + price labels
        ctx.font = `500 10px ${col.mono || 'ui-monospace, monospace'}`; ctx.textBaseline = 'middle';
        for (let k = 0; k <= 3; k++) {
          const v = min + (max - min) * (0.1 + 0.8 * k / 3), y = Y(v);
          ctx.strokeStyle = col.grid; ctx.lineWidth = 1; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(W - PR + 4, y); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = col.text; ctx.textAlign = 'right'; ctx.fillText(fmt(v), W - 2, y);
        }
        // time labels
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        [0.12, 0.5, 0.88].forEach(f => { const i = Math.round(f * (n - 1)); ctx.fillStyle = col.text; ctx.fillText(tfmt(bars[i][0]), X(i), H - 6); });
        // previous close
        if (o.base != null) { const y = Y(o.base); ctx.strokeStyle = col.baseLine || 'rgba(255,255,255,.25)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(W - PR, y); ctx.stroke(); ctx.setLineDash([]); }
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, PL + (W - PL - PR) * progress + 2, H); ctx.clip();
        if (o.type === 'line' || o.type === 'area') {
          if (o.type === 'area') {
            const g = ctx.createLinearGradient(0, PT, 0, H - PB); g.addColorStop(0, col.areaTop); g.addColorStop(1, col.areaBottom);
            const a = new Path2D(smooth(pts) + ` L${pts[n - 1][0]},${H - PB} L${pts[0][0]},${H - PB} Z`); ctx.fillStyle = g; ctx.fill(a);
          }
          ctx.strokeStyle = col.main; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
          ctx.shadowColor = col.glow || col.main; ctx.shadowBlur = 12; ctx.stroke(path); ctx.shadowBlur = 0;
        } else {
          const bw = Math.max(1.5, ((W - PL - PR) / n) * 0.62);
          bars.forEach((b, i) => {
            const x = X(i), upc = b[4] >= b[1], c = upc ? col.up : col.down;
            ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(x, Y(b[2])); ctx.lineTo(x, Y(b[3])); ctx.stroke();
            if (o.type === 'candles') { const y1 = Y(Math.max(b[1], b[4])), y2 = Y(Math.min(b[1], b[4])); ctx.globalAlpha = .95; roundRect(ctx, x - bw / 2, y1, bw, Math.max(1.2, y2 - y1), Math.min(2, bw / 3)); ctx.fill(); ctx.globalAlpha = 1; }
            else { ctx.beginPath(); ctx.moveTo(x - bw / 2, Y(b[1])); ctx.lineTo(x, Y(b[1])); ctx.moveTo(x, Y(b[4])); ctx.lineTo(x + bw / 2, Y(b[4])); ctx.lineWidth = 1.6; ctx.stroke(); }
          });
        }
        ctx.restore();
        // last price dot + tag
        if (progress >= 1 && scrub < 0) {
          const [lx, ly] = [X(n - 1), Y(bars[n - 1][4])];
          ctx.fillStyle = col.main; ctx.shadowColor = col.main; ctx.shadowBlur = 14; ctx.beginPath(); ctx.arc(lx, ly, 3.4, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
          tag(fmt(bars[n - 1][4]), ly, col.main);
        }
        if (scrub >= 0) {
          const b = bars[scrub], x = X(scrub), y = Y(b[4]);
          ctx.strokeStyle = col.cross; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, PT - 6); ctx.lineTo(x, H - PB); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill(); ctx.strokeStyle = col.main; ctx.lineWidth = 2; ctx.stroke();
          tag(fmt(b[4]), y, col.label || col.main, col.labelText);
        }
      }
      function tag(txt, y, bg, fg) {
        ctx.font = `600 10px ${col.mono || 'ui-monospace, monospace'}`;
        const w = ctx.measureText(txt).width + 10, x = W - w;
        ctx.fillStyle = bg; roundRect(ctx, x, y - 9, w, 18, 6); ctx.fill();
        ctx.fillStyle = fg || col.tagText || '#05101c'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, x + w / 2, y + .5);
      }
      function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
      const t0 = performance.now(), reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      (function anim(t) { progress = reduce ? 1 : Math.min(1, (t - t0) / 650); progress = 1 - Math.pow(1 - progress, 3); frame(); if (progress < 1) requestAnimationFrame(anim); })(t0);
      const pick = e => { const r = cv.getBoundingClientRect(), x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left; return Math.max(0, Math.min(n - 1, Math.round((x - PL) / ((W - PL - PR) / Math.max(1, n - 1))))); };
      const move = e => { scrub = pick(e); frame(); o.onScrub?.(bars[scrub]); };
      const end = () => { scrub = -1; frame(); o.onScrub?.(null); };
      cv.style.touchAction = 'none';
      cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); move(e); });
      cv.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'touch') move(e); });
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end); cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') end(); });
    },

    /* ---------- Rendering and navigation ---------- */
    render() {
      const T = Kit.theme;
      document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === Kit.tab));
      document.body.dataset.view = Kit.tab;
      T.renderTab(Kit.tab, Kit.stories(Kit.tab));
      document.querySelector('[data-tab][aria-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    },
    go(tab) { if (tab === Kit.tab) return; Kit.tab = tab; Kit.render(); window.scrollTo({ top: 0 }); },
    async start(theme) {
      Kit.theme = theme;
      document.getElementById('app').innerHTML = theme.shell();
      try {
        const [n, c] = await Promise.all([fetch(`../data/news.json?t=${Date.now()}`).then(r => r.json()), fetch(`../data/charts.json?t=${Date.now()}`).then(r => r.json()).catch(() => null)]);
        Kit.data = n; Kit.charts = c;
      } catch { document.getElementById('app').insertAdjacentHTML('beforeend', '<p style="padding:20px;color:#aaa">Couldn’t load the news. Pull to refresh.</p>'); }
      Kit.render();
      document.addEventListener('click', e => {
        const t = e.target.closest('[data-tab]'); if (t && !e.target.closest('#chartPanel')) { Kit.go(t.dataset.tab); return; }
        const m = e.target.closest('[data-chart]'); if (m) { Kit.openChart(m.dataset.chart, m); return; }
        const p = e.target.closest('#chartPanel');
        if (p) {
          const b = e.target.closest('button');
          if (e.target.closest('[data-close]') || e.target.matches('.ch-scrim')) { Kit.closeChart(); return; }
          if (!b) return;
          if (b.dataset.asset) Kit.CH.asset = b.dataset.asset; else if (b.dataset.range) Kit.CH.range = b.dataset.range; else if (b.dataset.type) Kit.CH.type = b.dataset.type; else return;
          Kit.drawChart();
        }
      });
      // swipe between tabs, following the finger
      const main = document.getElementById('feedArea');
      if (main) {
        let x0 = 0, y0 = 0, t0 = 0, dx = 0, lock = null, on = false;
        const idx = () => TABS.findIndex(t => t.id === Kit.tab);
        main.addEventListener('touchstart', e => { on = e.touches.length === 1; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = performance.now(); dx = 0; lock = null; }, { passive: true });
        main.addEventListener('touchmove', e => {
          if (!on) return; dx = e.touches[0].clientX - x0; const dy = e.touches[0].clientY - y0;
          if (!lock && Math.max(Math.abs(dx), Math.abs(dy)) > 8) lock = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
          if (lock !== 'x') return; e.preventDefault();
          const d = dx < 0 ? 1 : -1, ok = idx() + d >= 0 && idx() + d < TABS.length;
          main.style.transition = 'none'; main.style.transform = `translate3d(${ok ? dx : dx * 0.22}px,0,0)`; main.style.opacity = String(1 - Math.min(Math.abs(dx) / innerWidth, 1) * 0.45);
        }, { passive: false });
        const end = () => {
          if (!on || lock !== 'x') { on = false; return; } on = false;
          const d = dx < 0 ? 1 : -1, ok = idx() + d >= 0 && idx() + d < TABS.length, v = dx / Math.max(1, performance.now() - t0);
          if (ok && (Math.abs(dx) > innerWidth * 0.2 || (Math.abs(v) > 0.45 && Math.abs(dx) > 40))) {
            main.style.transition = 'transform .17s cubic-bezier(.4,0,1,1), opacity .17s'; main.style.transform = `translate3d(${-d * innerWidth * 0.6}px,0,0)`; main.style.opacity = '0';
            setTimeout(() => { Kit.tab = TABS[idx() + d].id; Kit.render(); window.scrollTo({ top: 0 }); main.style.transition = 'none'; main.style.transform = `translate3d(${d * innerWidth * 0.35}px,0,0)`; void main.offsetWidth; main.style.transition = 'transform .34s cubic-bezier(.2,.8,.2,1), opacity .26s'; main.style.transform = 'none'; main.style.opacity = '1'; }, 170);
          } else { main.style.transition = 'transform .32s cubic-bezier(.2,.8,.2,1), opacity .32s'; main.style.transform = 'none'; main.style.opacity = '1'; }
        };
        main.addEventListener('touchend', end, { passive: true }); main.addEventListener('touchcancel', end, { passive: true });
      }
    },
    // image tag with graceful fallback to a category photo
    img(t, cls, alt = '') {
      return `<img class="${cls}" src="${esc(t.src)}" alt="${esc(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer"${t.fallback ? ` onerror="this.onerror=null;this.src='${esc(t.fallback)}'"` : ` onerror="this.style.visibility='hidden'"`}>`;
    },
  };
  window.Kit = Kit;
})();
