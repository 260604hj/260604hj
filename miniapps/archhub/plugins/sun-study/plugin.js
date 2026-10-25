// 일조 시뮬레이션 — 태양 위치(근사 천문식)와 매스 그림자.
// 그림자 = (평면 ∪ 그림자 방향으로 옮긴 평면)의 볼록 껍질 → 볼록 평면은 정확, ㄱ·ㄷ자는 바깥쪽으로 근사.
ArchHub.registerPlugin({
    id: 'sun-study',
    name: '일조 시뮬레이션',
    version: '0.1.0',
    apiVersion: 1,
    writes: [],

    activate(ctx) {
        const { h, fmt } = ctx.ui;
        const G = ctx.geo;
        const RAD = Math.PI / 180;
        const year = new Date().getFullYear();
        const DEF = { date: year + '-12-22', time: 12, cumulative: true };
        const st = () => Object.assign({}, DEF, ctx.data.get());

        // 태양 고도·방위 (방위: 정북 0°, 시계방향). KST(UTC+9) 기준 날짜·시각.
        function sunPosition(dateStr, hour, lat, lon) {
            const [y, m, d] = dateStr.split('-').map(Number);
            const t = Date.UTC(y, m - 1, d, 0, 0, 0) + (hour - 9) * 3600000;
            const n = t / 86400000 + 2440587.5 - 2451545.0;
            const L = (280.460 + 0.9856474 * n) % 360;
            const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
            const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
            const eps = (23.439 - 0.0000004 * n) * RAD;
            const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
            const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
            const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
            const H = ((gmst * 15 + lon) * RAD) - ra;
            const phi = lat * RAD;
            const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
            let az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H)) / RAD;
            az = (az + 360) % 360;
            return { alt: alt / RAD, az };
        }

        function shadowOf(footSite, height, sun) {
            if (sun.alt <= 0.5) return null;
            const len = Math.min(height / Math.tan(sun.alt * RAD), 2000);
            const dx = -Math.sin(sun.az * RAD) * len, dy = -Math.cos(sun.az * RAD) * len;
            return { poly: G.convexHull(footSite.concat(G.translate(footSite, dx, dy))), len };
        }

        const s0 = st();
        const dateIn = h('input', { type: 'date', value: s0.date, onchange: e => save({ date: e.target.value }) });
        const timeLabel = h('span', { class: 'u' });
        const timeIn = h('input', { type: 'range', min: 6, max: 19, step: 0.25, value: s0.time,
            oninput: e => { save({ time: parseFloat(e.target.value) }, true); } });
        const presets = h('div', { class: 'row' },
            ...[['동지', '12-22'], ['춘·추분', '03-20'], ['하지', '06-21']].map(([n, md]) =>
                h('button', { class: 'btn ghost small', onclick: () => { dateIn.value = year + '-' + md; save({ date: dateIn.value }); } }, n)));
        const cum = h('input', { type: 'checkbox', checked: s0.cumulative, onchange: e => save({ cumulative: e.target.checked }) });
        const info = h('div');
        ctx.panel.append(
            h('section', { class: 'sec' }, h('h3', null, '날짜 · 시각'),
                h('label', { class: 'field' }, h('span', { class: 'k' }, '날짜'), dateIn), presets,
                h('label', { class: 'field', style: { marginTop: '10px' } }, h('span', { class: 'k' }, '시각'), timeLabel),
                timeIn,
                h('label', { class: 'field', style: { marginTop: '8px' } }, cum, ' 9~15시 누적 그림자 (1시간 간격)')),
            h('section', { class: 'sec' }, h('h3', null, '태양 · 그림자'), info,
                h('p', { class: 'hint', style: { marginTop: '8px' } }, '평탄한 지면 가정, 주변 건물·지형 그림자 미포함. 법정 일조(정북방향 이격) 검토는 별도.'))
        );

        const shadowLayer = ctx.scene.layer('shadow');
        const cumLayer = ctx.scene.layer('cumulative');
        const sunLayer = ctx.scene.layer('sun');

        const hhmm = t => String(Math.floor(t)).padStart(2, '0') + ':' + String(Math.round((t % 1) * 60)).padStart(2, '0');

        function save(patch, light) {
            ctx.data.set(Object.assign(st(), patch));
            run(light);
        }

        function run(onlyCurrent) {
            const s = st(), p = ctx.project.get();
            const o = p.site.origin || { lon: 126.978, lat: 37.5665 };
            const m = ctx.project.metrics();
            const foot = p.building.footprint.map(q => G.toSite(q, p.building.placement));
            timeLabel.textContent = hhmm(s.time);
            const sun = sunPosition(s.date, s.time, o.lat, o.lon);
            const sh = foot.length >= 3 ? shadowOf(foot, m.height, sun) : null;

            shadowLayer.clear(); sunLayer.clear();
            if (sh) shadowLayer.polygon(sh.poly, { z: 0.2, color: '#1b2a4a', opacity: 0.35 });
            if (sun.alt > 0 && foot.length >= 3) {
                // 건물 꼭대기 중심에서 태양 쪽으로 향하는 선
                const c = G.centroid(foot), L = 40;
                const dir = { x: Math.sin(sun.az * RAD) * Math.cos(sun.alt * RAD), y: Math.cos(sun.az * RAD) * Math.cos(sun.alt * RAD), z: Math.sin(sun.alt * RAD) };
                sunLayer.line([{ x: c.x, y: c.y, z: m.height }, { x: c.x + dir.x * L, y: c.y + dir.y * L, z: m.height + dir.z * L }], { color: '#f0a020', width: 3 });
                sunLayer.label({ x: c.x + dir.x * L, y: c.y + dir.y * L, z: m.height + dir.z * L }, '☀ ' + hhmm(s.time), { color: '#c77a00' });
            }

            if (!onlyCurrent) {
                cumLayer.clear();
                if (s.cumulative && foot.length >= 3) {
                    for (let t = 9; t <= 15; t++) {
                        const r = shadowOf(foot, m.height, sunPosition(s.date, t, o.lat, o.lon));
                        if (r) cumLayer.polygon(r.poly, { z: 0.1 + t * 0.002, color: '#3d5a80', opacity: 0.08 });
                    }
                }
            }

            const noon = sunPosition(s.date, 12 + (135 - o.lon) / 15, o.lat, o.lon); // 남중 ≈ KST 표준자오선(135°E) 경도 보정, 균시차 무시
            info.innerHTML = '';
            info.append(h('table', null,
                h('tr', null, h('td', null, '태양 고도'), h('td', null, fmt(sun.alt, 1) + '°' + (sun.alt <= 0 ? ' (해 없음)' : ''))),
                h('tr', null, h('td', null, '태양 방위'), h('td', null, fmt(sun.az, 1) + '° (정북 기준 시계방향)')),
                h('tr', null, h('td', null, '그림자 길이'), h('td', null, sh ? fmt(sh.len, 1) + ' m' : '–')),
                h('tr', null, h('td', null, '남중 고도 (근사)'), h('td', null, fmt(noon.alt, 1) + '°')),
                h('tr', null, h('td', null, '건물 높이'), h('td', null, fmt(m.height, 1) + ' m'))
            ));
        }

        run();
        ctx.project.onChange(ev => { if (ev.source !== ctx.id && (ev.touches('building') || ev.touches('site'))) run(); });
    }
});
