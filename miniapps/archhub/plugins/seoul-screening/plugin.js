// 서울 대지 스크리닝 — 행정구역(구)·필지 크기·용도지역 조건에 맞는 필지 1개를 무작위로 추천.
// 구 안 무작위 지점 → 주변 용도지역도에서 고른 용도의 폴리곤 안 지점 → 그 주변 필지(연속지적도) 중 조건에 맞는 것 하나.
ArchHub.registerPlugin({
    id: 'seoul-screening',
    name: '서울 대지 스크리닝',
    version: '0.1.0',
    apiVersion: 1,
    writes: [],   // 대지 설정은 ctx.hub.loadSite 로 허브가 처리

    activate(ctx) {
        const { h, fmt, toast } = ctx.ui;
        const G = ctx.geo, V = ctx.vworld;

        const GU = [
            ['11110', '종로구'], ['11140', '중구'], ['11170', '용산구'], ['11200', '성동구'], ['11215', '광진구'],
            ['11230', '동대문구'], ['11260', '중랑구'], ['11290', '성북구'], ['11305', '강북구'], ['11320', '도봉구'],
            ['11350', '노원구'], ['11380', '은평구'], ['11410', '서대문구'], ['11440', '마포구'], ['11470', '양천구'],
            ['11500', '강서구'], ['11530', '구로구'], ['11545', '금천구'], ['11560', '영등포구'], ['11590', '동작구'],
            ['11620', '관악구'], ['11650', '서초구'], ['11680', '강남구'], ['11710', '송파구'], ['11740', '강동구']
        ];
        const ZONES = {
            주거: ['제1종전용주거지역', '제2종전용주거지역', '제1종일반주거지역', '제2종일반주거지역', '제3종일반주거지역', '준주거지역'],
            상업: ['중심상업지역', '일반상업지역', '근린상업지역', '유통상업지역'],
            공업: ['전용공업지역', '일반공업지역', '준공업지역'],
            녹지: ['보전녹지지역', '생산녹지지역', '자연녹지지역']
        };
        const ALL = [].concat(...Object.values(ZONES));
        const short = z => z.replace('지역', '').replace('일반주거', '일주').replace('전용주거', '전주');
        const DEF = { gu: '', minArea: 200, maxArea: 2000, zones: ALL.filter(z => !/녹지|전용공업/.test(z)), onlyDae: true, last: null };
        const st = () => Object.assign({}, DEF, ctx.data.get());
        const save = patch => ctx.data.set(Object.assign(st(), patch));

        // ---------- UI ----------
        const guSel = h('select', { onchange: e => save({ gu: e.target.value }) },
            h('option', { value: '' }, '서울 전체 (무작위 구)'), ...GU.map(([c, n]) => h('option', { value: c }, n)));
        guSel.value = st().gu;
        const minIn = h('input', { type: 'number', min: 0, step: 10, value: st().minArea, onchange: e => save({ minArea: parseFloat(e.target.value) || 0 }) });
        const maxIn = h('input', { type: 'number', min: 0, step: 10, value: st().maxArea, onchange: e => save({ maxArea: parseFloat(e.target.value) || 0 }) });
        const zoneBox = h('div', { class: 'zones' });
        function renderZones() {
            const sel = new Set(st().zones);
            zoneBox.innerHTML = '';
            Object.entries(ZONES).forEach(([group, list]) => {
                const allOn = list.every(z => sel.has(z));
                zoneBox.append(h('div', { class: 'zone-row' },
                    h('button', { class: 'chip group' + (allOn ? ' on' : ''), onclick: () => {
                        const s = new Set(st().zones);
                        list.forEach(z => allOn ? s.delete(z) : s.add(z));
                        save({ zones: Array.from(s) }); renderZones();
                    } }, group),
                    ...list.map(z => h('button', { class: 'chip' + (sel.has(z) ? ' on' : ''), title: z, onclick: () => {
                        const s = new Set(st().zones);
                        s.has(z) ? s.delete(z) : s.add(z);
                        save({ zones: Array.from(s) }); renderZones();
                    } }, short(z)))));
            });
        }
        const dae = h('input', { type: 'checkbox', checked: st().onlyDae, onchange: e => save({ onlyDae: e.target.checked }) });
        const goBtn = h('button', { class: 'btn', onclick: () => run() }, '랜덤 추천');
        const progress = h('p', { class: 'hint' });
        const result = h('div');

        ctx.panel.append(
            h('style', null, `
                .zones{ display:flex; flex-direction:column; gap:6px; }
                .zone-row{ display:flex; flex-wrap:wrap; gap:4px; }
                .chip{ border:0; border-radius:980px; padding:4px 10px; font-size:12px; cursor:pointer;
                       background:rgba(118,118,128,.12); color:var(--secondary); }
                .chip.on{ background:var(--foreground); color:#fff; }
                .chip.group{ font-weight:600; min-width:44px; }
                .pick{ background:var(--surface); border-radius:12px; padding:12px; }
                .pick .t{ font-family:var(--font-display); font-size:17px; font-weight:600; margin-bottom:8px; }
            `),
            h('section', { class: 'sec' }, h('h3', null, '조건'),
                h('label', { class: 'field' }, h('span', { class: 'k' }, '행정구역'), guSel),
                h('div', { class: 'grid2' },
                    h('label', { class: 'field' }, h('span', { class: 'k' }, '최소'), minIn, h('span', { class: 'u' }, '㎡')),
                    h('label', { class: 'field' }, h('span', { class: 'k' }, '최대'), maxIn, h('span', { class: 'u' }, '㎡'))),
                h('h3', { style: { marginTop: '8px' } }, '용도지역'),
                zoneBox,
                h('label', { class: 'field', style: { marginTop: '8px' } }, dae, " 지목 '대'(대지)만"),
                h('div', { class: 'row' }, goBtn),
                progress),
            h('section', { class: 'sec' }, h('h3', null, '추천 필지'), result)
        );
        renderZones();

        // ---------- 조회 ----------
        const guCache = {};
        const outerRings = geom => {
            const out = [];
            if (!geom || !geom.coordinates) return out;
            const polys = geom.type === 'MultiPolygon' ? geom.coordinates : geom.type === 'Polygon' ? [geom.coordinates] : [];
            polys.forEach(p => { if (p[0]) out.push(p[0].map(c => ({ x: +c[0], y: +c[1] }))); });   // x=경도, y=위도
            return out;
        };
        async function guRings(code) {
            if (!guCache[code]) {
                const f = await V.features('LT_C_ADSIGG_INFO', { attrFilter: 'sig_cd:=:' + code }, 5);
                if (!f.length) throw new Error('구 경계를 찾지 못했습니다 (' + code + ')');
                guCache[code] = outerRings(f[0].geometry);
            }
            return guCache[code];
        }
        const inRings = (p, rings) => rings.some(r => G.pointInPoly(p, r));
        function randomPoint(rings) {
            const bb = G.bbox([].concat(...rings));
            for (let i = 0; i < 300; i++) {
                const p = { x: bb.minX + Math.random() * bb.w, y: bb.minY + Math.random() * bb.h };
                if (inRings(p, rings)) return p;
            }
            return null;
        }
        const jimokOf = j => { const m = String(j || '').trim().match(/[가-힣]$/); return m ? m[0] : ''; };

        let busy = false;
        async function run() {
            if (busy) return;
            const s = st();
            if (!s.zones.length) return toast('용도지역을 하나 이상 고르세요.');
            if (s.maxArea && s.minArea > s.maxArea) return toast('최소 면적이 최대 면적보다 큽니다.');
            busy = true; goBtn.disabled = true;
            const TRIES = 30;
            let found = null;
            try {
                for (let t = 1; t <= TRIES && !found; t++) {
                    const [code, guName] = s.gu ? GU.find(g => g[0] === s.gu) : GU[Math.floor(Math.random() * GU.length)];
                    progress.textContent = `찾는 중… ${guName} (${t}/${TRIES})`;
                    const rings = await guRings(code);
                    const c0 = randomPoint(rings);
                    if (!c0) continue;
                    // ① 넓게(±700m) 용도지역도를 읽어 고른 용도지역 폴리곤 안에서 지점을 다시 뽑음
                    //    (상업지역처럼 면적 비중이 작은 용도도 잘 걸리게)
                    const boxAround = (p, m) => {
                        const dLat = m / 111320, dLon = m / (111320 * Math.cos(p.y * Math.PI / 180));
                        return `BOX(${p.x - dLon},${p.y - dLat},${p.x + dLon},${p.y + dLat})`;
                    };
                    const zones = await V.features('LT_C_UQ111', boxAround(c0, 700), 200);
                    const zonePolys = zones.map(z => {
                        const name = z.props.uname || '';
                        return { name, zone: ALL.find(a => name.replace(/\s/g, '').indexOf(a) !== -1) || null, rings: outerRings(z.geometry) };
                    });
                    const targets = zonePolys.filter(z => z.zone && s.zones.indexOf(z.zone) !== -1);
                    if (!targets.length) continue;
                    // 면적에 비례해 하나 고르고, 그 안(그리고 구 안)의 무작위 지점
                    const w = targets.map(z => z.rings.reduce((a, r) => a + G.area(r), 0));
                    let k = Math.random() * w.reduce((a, b) => a + b, 0), zi = 0;
                    while (zi < w.length - 1 && (k -= w[zi]) > 0) zi++;
                    const zr = targets[zi].rings, zbb = G.bbox([].concat(...zr));
                    let c = null;
                    for (let i = 0; i < 200 && !c; i++) {
                        const p = { x: zbb.minX + Math.random() * zbb.w, y: zbb.minY + Math.random() * zbb.h };
                        if (inRings(p, zr) && inRings(p, rings)) c = p;
                    }
                    if (!c) continue;
                    // ② 그 주변(±90m) 필지
                    const parcels = await V.features('LP_PA_CBND_BUBUN', boxAround(c, 90), 300);
                    const cands = [];
                    parcels.forEach(f => {
                        const jm = jimokOf(f.props.jibun);
                        if (s.onlyDae ? jm !== '대' : jm === '도') return;
                        const ring = outerRings(f.geometry)[0];
                        if (!ring || ring.length < 3) return;
                        const o = { lon: ring[0].x, lat: ring[0].y };
                        const local = ring.map(p => G.lonLatToXY(o, p.x, p.y));
                        const area = G.area(local);
                        if (area < s.minArea || (s.maxArea && area > s.maxArea)) return;
                        const cl = G.centroid(local), cll = G.xyToLonLat(o, cl.x, cl.y), cp = { x: cll.lon, y: cll.lat };
                        if (!G.pointInPoly(cp, ring) || !inRings(cp, rings)) return;   // 오목한 필지·구 경계 밖 제외
                        const z = zonePolys.find(zp => inRings(cp, zp.rings));
                        const zoneName = z ? z.zone : null;
                        if (!zoneName || s.zones.indexOf(zoneName) === -1) return;
                        cands.push({ lon: cp.x, lat: cp.y, addr: f.props.addr || f.props.jibun, jibun: f.props.jibun, pnu: f.props.pnu,
                            area, zone: zoneName, jimok: jm, jiga: +f.props.jiga || null, gu: guName });
                    });
                    if (cands.length) found = cands[Math.floor(Math.random() * cands.length)];
                }
            } catch (e) {
                toast('조회 실패: ' + e.message, 'error');
            }
            busy = false; goBtn.disabled = false;
            progress.textContent = found ? '' : '조건에 맞는 필지를 찾지 못했습니다. 조건을 넓혀 다시 눌러 보세요.';
            if (found) save({ last: found });
            renderResult();
        }

        // 원 → "12억 3,400만 원" 식
        function won(v) {
            const eok = Math.floor(v / 1e8), man = Math.round((v - eok * 1e8) / 1e4);
            if (!eok) return fmt(man, 0) + '만 원';
            return eok.toLocaleString('ko-KR') + '억' + (man ? ' ' + man.toLocaleString('ko-KR') + '만' : '') + ' 원';
        }

        function renderResult() {
            const r = st().last;
            result.innerHTML = '';
            if (!r) { result.append(h('p', { class: 'hint' }, '조건을 정하고 랜덤 추천을 누르세요.')); return; }
            result.append(h('div', { class: 'pick' },
                h('div', { class: 't' }, r.addr),
                h('table', null,
                    h('tr', null, h('td', null, '면적'), h('td', null, fmt(r.area, 1) + ' ㎡ (' + fmt(r.area / 3.3058, 1) + '평)')),
                    h('tr', null, h('td', null, '용도지역'), h('td', null, r.zone)),
                    h('tr', null, h('td', null, '지목'), h('td', null, r.jimok)),
                    h('tr', null, h('td', null, '공시지가'), h('td', null, r.jiga ? fmt(r.jiga, 0) + ' 원/㎡' : '–')),
                    h('tr', null, h('td', null, '총 지가'), h('td', null, r.jiga ? won(r.jiga * r.area) : '–'))),
                h('p', { class: 'hint', style: { marginTop: '4px' } }, '총 지가 = 공시지가 × 면적(지적경계 계산값). 실거래가와 다릅니다.'),
                h('div', { class: 'row', style: { marginTop: '10px' } },
                    h('button', { class: 'btn small', onclick: async () => {
                        toast('대지를 불러오는 중…');
                        await ctx.hub.loadSite(r.lon, r.lat, r.addr);
                    } }, '이 필지를 대지로'),
                    h('button', { class: 'btn ghost small', onclick: () => run() }, '다시 추천'))
            ));
        }
        renderResult();
    }
});
