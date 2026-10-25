// 일조 분석 — 고른 인접 건물이 "내 건물 매스"의 입면에 드리우는 그림자.
// 입면을 층마다(바닥 + 1.2m) 일정 간격으로 찍은 점에서 태양 쪽으로 광선을 쏴, 인접 건물(외곽선 × 높이의 각기둥)에
// 막히는지 30분 간격(08~16시)으로 판정 → 점마다 일조시간, 층별 기준 충족률.
// 인접 건물 외곽·높이: VWORLD GIS건물통합정보(LT_C_BLDGINFO). 높이가 없으면 층수×3.3m (도로명주소 건물 층수 포함), 그것도 없으면 10m 가정.
ArchHub.registerPlugin({
    id: 'sun-study',
    name: '일조 분석',
    version: '0.2.0',
    apiVersion: 1,
    writes: [],

    activate(ctx) {
        const { h, fmt, toast } = ctx.ui;
        const G = ctx.geo;
        const RAD = Math.PI / 180;
        const year = new Date().getFullYear();
        const DEF = { date: year + '-12-22', time: 12, radius: 100, neighbors: [], siteKey: '', selected: [], heights: {} };
        const st = () => Object.assign({}, DEF, ctx.data.get());
        const save = patch => ctx.data.set(Object.assign(st(), patch));

        // ---------- 태양 (KST, 방위: 정북 0° 시계방향) ----------
        function sunPosition(dateStr, hour, lat, lon) {
            const [y, m, d] = dateStr.split('-').map(Number);
            const n = (Date.UTC(y, m - 1, d) + (hour - 9) * 3600000) / 86400000 + 2440587.5 - 2451545.0;
            const L = (280.460 + 0.9856474 * n) % 360, g = ((357.528 + 0.9856003 * n) % 360) * RAD;
            const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD, eps = (23.439 - 0.0000004 * n) * RAD;
            const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)), dec = Math.asin(Math.sin(eps) * Math.sin(lam));
            const H = (((18.697374558 + 24.06570982441908 * n) % 24) * 15 + lon) * RAD - ra, phi = lat * RAD;
            const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
            const az = (Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H)) / RAD + 360) % 360;
            return { alt: alt / RAD, az, ux: Math.sin(az * RAD), uy: Math.cos(az * RAD), tanAlt: Math.tan(alt) };
        }
        // 30분 구간의 가운데 시각들: 08:15 … 15:45
        const SLOTS = Array.from({ length: 16 }, (_, i) => 8.25 + i * 0.5);

        // ---------- UI ----------
        const s0 = st();
        const dateIn = h('input', { type: 'date', value: s0.date, onchange: e => { save({ date: e.target.value }); analyze(); } });
        const presets = h('div', { class: 'row' }, ...[['동지', '12-22'], ['춘·추분', '03-20'], ['하지', '06-21']].map(([nm, md]) =>
            h('button', { class: 'btn ghost small', onclick: () => { dateIn.value = year + '-' + md; save({ date: dateIn.value }); analyze(); } }, nm)));
        const timeLabel = h('span', { class: 'u' });
        const timeIn = h('input', { type: 'range', min: 7, max: 17, step: 0.25, value: s0.time, oninput: e => { save({ time: +e.target.value }); drawPreview(); } });
        const radiusIn = h('input', { type: 'number', min: 30, max: 300, step: 10, value: s0.radius, onchange: e => { save({ radius: +e.target.value || 100, neighbors: [], siteKey: '' }); loadNeighbors(); } });
        const listBox = h('div', { class: 'nb-list' });
        const status = h('p', { class: 'hint' });
        const result = h('div');

        ctx.panel.append(
            h('style', null, `
                .nb-list{ max-height:220px; overflow-y:auto; margin:6px 0; border-radius:10px; background:var(--surface); }
                .nb-row{ display:flex; align-items:center; gap:6px; padding:5px 8px; border-bottom:1px solid var(--hairline); font-size:12px; }
                .nb-row:last-child{ border-bottom:0; }
                .nb-row .nm{ flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
                .nb-row .d{ color:var(--muted); width:42px; text-align:right; }
                .nb-row input[type=number]{ width:58px; height:24px; padding:0 6px; font-size:12px; min-width:0; }
                .nb-row .src{ color:var(--muted); font-size:10px; width:26px; }
                .legend{ display:flex; gap:8px; flex-wrap:wrap; font-size:11px; color:var(--secondary); margin:6px 0; }
                .legend i{ display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:3px; vertical-align:-1px; }
            `),
            h('section', { class: 'sec' }, h('h3', null, '날짜'),
                h('label', { class: 'field' }, h('span', { class: 'k' }, '날짜'), dateIn), presets),
            h('section', { class: 'sec' }, h('h3', null, '인접 건물'),
                h('label', { class: 'field' }, h('span', { class: 'k' }, '검토 반경'), radiusIn, h('span', { class: 'u' }, 'm')),
                h('div', { class: 'row' },
                    h('button', { class: 'btn small', onclick: autoSelect }, '그림자 주는 건물 자동 선택'),
                    h('button', { class: 'btn ghost small', onclick: () => { save({ selected: [] }); renderList(); analyze(); } }, '모두 해제')),
                listBox, status),
            h('section', { class: 'sec' }, h('h3', null, '내 건물 입면 일조'), result),
            h('section', { class: 'sec' }, h('h3', null, '그림자 미리보기'),
                h('label', { class: 'field' }, h('span', { class: 'k' }, '시각'), timeLabel), timeIn,
                h('p', { class: 'hint' }, '고른 건물의 지면 그림자(볼록 근사). 내 건물 그림자는 그리지 않습니다.'))
        );

        const nbLayer = ctx.scene.layer('neighbors');
        const ptLayer = ctx.scene.layer('facade');
        const shLayer = ctx.scene.layer('shadow');

        // ---------- 인접 건물 ----------
        const myFoot = () => { const b = ctx.project.get('building'); return G.ccw(b.footprint.map(p => G.toSite(p, b.placement))); };
        const siteKey = () => { const o = ctx.project.get('site.origin'); return o ? o.lon.toFixed(6) + ',' + o.lat.toFixed(6) : ''; };
        const heightOf = n => { const e = st().heights[n.id]; return e > 0 ? e : n.height; };
        const outer = geom => { const c = geom && geom.coordinates; if (!c) return null; const r = geom.type === 'MultiPolygon' ? c[0] && c[0][0] : c[0]; return r || null; };

        async function loadNeighbors() {
            const s = ctx.project.get('site');
            if (!s.origin || !s.boundary.length) { status.textContent = '먼저 대지를 불러오세요.'; renderList(); return; }
            const R = st().radius, foot = myFoot(), bb = G.bbox(foot.length ? foot : s.boundary);
            const a = G.xyToLonLat(s.origin, bb.minX - R, bb.minY - R), b = G.xyToLonLat(s.origin, bb.maxX + R, bb.maxY + R);
            status.textContent = '인접 건물을 불러오는 중…';
            let feats;
            try { feats = await ctx.vworld.features('LT_C_BLDGINFO', `BOX(${a.lon},${a.lat},${b.lon},${b.lat})`, 400); }
            catch (e) { status.textContent = ''; return toast('인접 건물 조회 실패: ' + e.message, 'error'); }
            const list = [];
            feats.forEach((f, i) => {
                const ring = outer(f.geometry); if (!ring || ring.length < 4) return;
                const poly = G.cleanRing(G.ccw(ring.map(p => G.lonLatToXY(s.origin, +p[0], +p[1]))), 0.1);
                if (poly.length < 3) return;
                const c = G.centroid(poly);
                if (G.pointInPoly(c, s.boundary)) return;   // 대지 안 기존 건물(철거 대상)은 제외
                const d = foot.length ? Math.min(...poly.map(p => G.distToPoly(p, foot))) : Math.hypot(c.x, c.y);
                if (d > R) return;
                const hgt = +f.props.height, fl = +f.props.grnd_flr;
                list.push({
                    id: Math.round(c.x * 10) + '_' + Math.round(c.y * 10),
                    name: f.props.bld_nm || (fl ? fl + '층 건물' : '건물'),
                    footprint: poly.map(p => ({ x: G.round(p.x, 2), y: G.round(p.y, 2) })),
                    height: hgt > 0 ? hgt : fl > 0 ? fl * 3.3 : 0,
                    hsrc: hgt > 0 ? '대장' : fl > 0 ? '층수' : '',
                    dist: Math.round(d)
                });
            });
            list.sort((p, q) => p.dist - q.dist);
            // 높이 정보가 없는 건물 → 도로명주소 건물(LT_C_SPBD)의 지상층수 × 3.3m, 그래도 없으면 10m 가정 (목록에서 고쳐 넣기)
            const missing = list.filter(n => !n.height);
            if (missing.length) {
                let spbd = [];
                try {
                    spbd = (await ctx.vworld.features('LT_C_SPBD', `BOX(${a.lon},${a.lat},${b.lon},${b.lat})`, 400))
                        .map(f => ({ fl: +f.props.gro_flo_co, ring: outer(f.geometry) }))
                        .filter(f => f.fl > 0 && f.ring)
                        .map(f => ({ fl: f.fl, poly: f.ring.map(p => G.lonLatToXY(s.origin, +p[0], +p[1])) }));
                } catch (e) { console.warn('도로명주소 건물 조회 실패:', e); }
                missing.forEach(n => {
                    const c = G.centroid(n.footprint), m = spbd.find(sb => G.pointInPoly(c, sb.poly));
                    if (m) { n.height = G.round(m.fl * 3.3, 1); n.hsrc = '층수'; if (n.name === '건물') n.name = m.fl + '층 건물'; }
                    else { n.height = 10; n.hsrc = '가정'; }
                });
            }
            save({ neighbors: list, siteKey: siteKey(), selected: st().selected.filter(id => list.some(n => n.id === id)) });
            status.textContent = list.length ? `반경 ${R}m 안 건물 ${list.length}동. 체크한 건물만 그림자 계산에 씁니다.` : '반경 안에 건물이 없습니다.';
            renderList(); analyze();
        }

        function renderList() {
            const s = st(), sel = new Set(s.selected);
            listBox.innerHTML = '';
            s.neighbors.forEach(n => {
                const cb = h('input', { type: 'checkbox', checked: sel.has(n.id), onchange: e => {
                    const set = new Set(st().selected); e.target.checked ? set.add(n.id) : set.delete(n.id);
                    save({ selected: Array.from(set) }); drawNeighbors(); analyze();
                } });
                const hi = h('input', { type: 'number', min: 1, step: 0.5, value: G.round(heightOf(n), 1), title: '높이(m) — 고쳐 넣을 수 있음', onchange: e => {
                    const v = +e.target.value; save({ heights: Object.assign(st().heights, { [n.id]: v > 0 ? v : undefined }) }); drawNeighbors(); analyze();
                } });
                listBox.append(h('label', { class: 'nb-row' }, cb, h('span', { class: 'nm', title: n.name }, n.name), h('span', { class: 'd' }, n.dist + 'm'), hi,
                    h('span', { class: 'src', title: { 대장: '건축물 정보의 높이', 층수: '지상층수 × 3.3m', 가정: '정보 없음 — 10m 가정, 고쳐 넣으세요' }[n.hsrc] || '' }, n.hsrc)));
            });
            drawNeighbors();
        }

        function drawNeighbors() {
            const s = st(), sel = new Set(s.selected);
            nbLayer.clear();
            s.neighbors.forEach(n => {
                if (sel.has(n.id)) nbLayer.extrude(n.footprint, { base: 0, height: heightOf(n), color: '#ff9f0a', opacity: 0.45, outlineColor: '#c25e00' });
                else nbLayer.line(n.footprint, { z: 0.4, closed: true, ground: true, color: '#8e8e93', mapColor: '#ffffff', opacity: 0.7, width: 1.5 });
            });
        }

        // ---------- 그림자 판정 ----------
        // 내 건물 입면 점: 변마다 바깥쪽 0.3m, 층마다 바닥 + 1.2m
        function facadeSamples() {
            const foot = myFoot(); if (foot.length < 3) return [];
            const levels = ctx.project.levels().filter(l => l.index > 0);
            const step = Math.min(6, Math.max(1.5, G.perimeter(foot) / 120));
            const out = [];
            foot.forEach((a, i) => {
                const b = foot[(i + 1) % foot.length], len = G.dist(a, b); if (len < 0.5) return;
                const nx = (b.y - a.y) / len, ny = -(b.x - a.x) / len;   // 반시계 폴리곤의 바깥 법선
                const cnt = Math.max(1, Math.round(len / step));
                for (let k = 0; k < cnt; k++) {
                    const t = (k + 0.5) / cnt;
                    const x = a.x + (b.x - a.x) * t + nx * 0.3, y = a.y + (b.y - a.y) * t + ny * 0.3;
                    levels.forEach((l, li) => out.push({ x, y, z: l.z + 1.2, nx, ny, li }));
                }
            });
            return out;
        }
        function obstacles(ids) {
            const s = st(), sel = new Set(ids || s.selected);
            const obs = s.neighbors.filter(n => sel.has(n.id)).map(n => ({ poly: n.footprint, h: heightOf(n), bb: G.bbox(n.footprint) }));
            // 내 건물 자신 (ㄱ·ㄷ자 날개가 서로 가리는 경우)
            const foot = myFoot(); if (foot.length >= 3) obs.push({ poly: foot, h: ctx.project.metrics().height, bb: G.bbox(foot), self: true });
            return obs;
        }
        function lit(p, sun, obs) {
            if (sun.alt <= 0) return false;
            if (p.nx * sun.ux + p.ny * sun.uy <= 0.02) return false;   // 해를 등진 면
            for (const o of obs) {
                if (p.z >= o.h) continue;
                const L = (o.h - p.z) / sun.tanAlt;
                const q = { x: p.x + sun.ux * L, y: p.y + sun.uy * L };
                if (Math.max(p.x, q.x) < o.bb.minX || Math.min(p.x, q.x) > o.bb.maxX || Math.max(p.y, q.y) < o.bb.minY || Math.min(p.y, q.y) > o.bb.maxY) continue;
                if (!o.self && G.pointInPoly(p, o.poly)) return false;
                for (let i = 0; i < o.poly.length; i++) if (G.segmentsCross(p, q, o.poly[i], o.poly[(i + 1) % o.poly.length])) return false;
            }
            return true;
        }

        function suns() {
            const o = ctx.project.get('site.origin') || { lon: 126.978, lat: 37.5665 }, d = st().date;
            return SLOTS.map(t => sunPosition(d, t, o.lat, o.lon));
        }

        function autoSelect() {
            const s = st(); if (!s.neighbors.length) return toast('인접 건물이 없습니다.');
            const pts = facadeSamples().filter((_, i) => i % 2 === 0), sn = suns();
            const picked = s.neighbors.filter(n => {
                const obs = [{ poly: n.footprint, h: heightOf(n), bb: G.bbox(n.footprint) }];
                return pts.some(p => sn.some(su => su.alt > 0 && p.nx * su.ux + p.ny * su.uy > 0.02 && !lit(p, su, obs)));
            }).map(n => n.id);
            save({ selected: picked }); renderList(); analyze();
            toast(picked.length ? `그림자를 드리우는 건물 ${picked.length}동을 골랐습니다` : '이 날짜에 내 건물에 그림자를 드리우는 인접 건물이 없습니다');
        }

        const COLORS = [[0, '#ff3b30', '0시간'], [2, '#ff9500', '2시간 미만'], [4, '#ffcc00', '4시간 미만'], [99, '#34c759', '4시간 이상']];
        const colorOf = hrs => (COLORS.find(c => hrs < c[0]) || COLORS[3])[1];
        let timer = null;
        function analyze() { clearTimeout(timer); timer = setTimeout(runAnalysis, 150); }
        function runAnalysis() {
            const pts = facadeSamples(), sn = suns(), obs = obstacles();
            ptLayer.clear(); result.innerHTML = '';
            if (!pts.length) { result.append(h('p', { class: 'hint' }, '내 건물 매스가 없습니다.')); return; }
            const levels = ctx.project.levels().filter(l => l.index > 0);
            const perLevel = levels.map(() => ({ sum: 0, ok: 0, n: 0 }));
            pts.forEach(p => {
                const flags = sn.map(su => lit(p, su, obs));
                const total = flags.filter(Boolean).length * 0.5;
                let run = 0, best = 0;
                SLOTS.forEach((t, i) => { if (t > 9 && t < 15 && flags[i]) { run++; best = Math.max(best, run); } else run = 0; });
                const ok = best * 0.5 >= 2 || total >= 4;
                const L = perLevel[p.li]; L.sum += total; L.n++; if (ok) L.ok++;
                ptLayer.point({ x: p.x, y: p.y, z: p.z }, { color: colorOf(total), outlineColor: '#ffffff', outlineWidth: 1, size: 7 });
            });
            const all = perLevel.reduce((a, l) => ({ ok: a.ok + l.ok, n: a.n + l.n }), { ok: 0, n: 0 });
            result.append(
                h('div', { class: 'legend' }, ...COLORS.map(c => h('span', null, h('i', { style: { background: c[1] } }), c[2]))),
                h('p', { class: 'info' }, `입면 기준 충족 ${fmt(all.ok / all.n * 100, 0)}% · 고른 건물 ${st().selected.length}동`),
                h('table', null,
                    h('tr', null, h('td', null, h('b', null, '층')), h('td', null, h('b', null, '평균 일조 · 충족'))),
                    ...levels.map((l, i) => i).reverse().map(i => h('tr', null,
                        h('td', null, levels[i].name),
                        h('td', null, `${fmt(perLevel[i].sum / Math.max(1, perLevel[i].n), 1)}시간 · ${fmt(perLevel[i].ok / Math.max(1, perLevel[i].n) * 100, 0)}%`)))),
                h('p', { class: 'hint', style: { marginTop: '6px' } }, '기준(참고): 09~15시 연속 2시간 이상 또는 08~16시 합계 4시간 이상. 30분 간격, 평탄한 지면, 지형·수목 미반영.')
            );
            drawPreview();
        }

        function drawPreview() {
            const s = st(), o = ctx.project.get('site.origin') || { lon: 126.978, lat: 37.5665 };
            const t = s.time, sun = sunPosition(s.date, t, o.lat, o.lon);
            timeLabel.textContent = String(Math.floor(t)).padStart(2, '0') + ':' + String(Math.round((t % 1) * 60)).padStart(2, '0') +
                (sun.alt > 0 ? ` · 고도 ${fmt(sun.alt, 1)}° 방위 ${fmt(sun.az, 0)}°` : ' · 해 없음');
            shLayer.clear();
            if (sun.alt <= 0.5) return;
            obstacles().filter(ob => !ob.self).forEach(ob => {
                const len = Math.min(ob.h / sun.tanAlt, 2000);
                shLayer.polygon(G.convexHull(ob.poly.concat(G.translate(ob.poly, -sun.ux * len, -sun.uy * len))), { z: 0.15, color: '#1b2a4a', opacity: 0.3 });
            });
        }

        // ---------- 시작 · 변경 반응 ----------
        if (st().siteKey !== siteKey() || !st().neighbors.length) loadNeighbors(); else { renderList(); analyze(); }
        ctx.project.onChange(ev => {
            if (ev.source === ctx.id) return;
            if (ev.touches('site.origin')) { save({ neighbors: [], selected: [], siteKey: '' }); loadNeighbors(); return; }
            if (ev.touches('building') || ev.touches('site')) analyze();
        });
    }
});
