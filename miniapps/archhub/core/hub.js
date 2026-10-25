// Arch Hub — 통합 허브
// 메인 데이터(위치·규모·형태·코어) 편집, 3D 뷰, 플러그인 로드/실행/해제를 담당한다.
// 플러그인 작성법은 PLUGIN_GUIDE.md 참고.
(function () {
    'use strict';
    const G = window.ArchGeom, Store = window.ArchProject, Scene = window.ArchScene, V = window.ArchVWorld;
    const $ = id => document.getElementById(id);
    const ACTIVE_KEY = 'archhub.activePlugins';
    const VIEWER_KEY = 'archhub.viewer';

    // ---------- 작은 DOM 도우미 (플러그인에도 ctx.ui.h 로 제공) ----------
    function h(tag, attrs) {
        const el = document.createElement(tag);
        Object.entries(attrs || {}).forEach(([k, v]) => {
            if (v == null || v === false) return;
            if (k === 'class') el.className = v;
            else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
            else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
            else if (k === 'value' || k === 'checked' || k === 'disabled') el[k] = v;
            else el.setAttribute(k, v === true ? '' : v);
        });
        for (let i = 2; i < arguments.length; i++) {
            [].concat(arguments[i]).forEach(c => { if (c != null && c !== false) el.append(c.nodeType ? c : String(c)); });
        }
        return el;
    }
    let toastTimer;
    function toast(msg, kind) {
        const el = $('toast');
        el.textContent = msg; el.className = 'toast show' + (kind ? ' ' + kind : '');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { el.className = 'toast'; }, kind === 'error' ? 6000 : 3000);
    }
    const fmt = (v, n) => (v == null || !isFinite(v)) ? '–' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: n == null ? 1 : n });

    // =====================================================================
    // 메인 데이터 패널
    // =====================================================================
    const bindings = [];
    function bind(el, path, parse) {
        bindings.push({ el, path });
        el.addEventListener('change', () => {
            const v = parse ? parse(el.value) : el.value;
            if (v === undefined) return syncForm();
            Store.set(path, v, 'form');
        });
        return el;
    }
    const num = (path, o) => bind(h('input', { type: 'number', step: (o && o.step) || 'any', min: o && o.min }), path,
        s => { const v = parseFloat(s); return isFinite(v) ? ((o && o.int) ? Math.round(v) : v) : undefined; });
    const check = path => {
        const el = h('input', { type: 'checkbox' });
        bindings.push({ el, path });
        el.addEventListener('change', () => Store.set(path, el.checked, 'form'));
        return el;
    };
    const field = (label, input, unit, extra) => h('label', Object.assign({ class: 'field' }, extra), h('span', { class: 'k' }, label), input, unit ? h('span', { class: 'u' }, unit) : null);
    const section = (title, ...body) => h('section', { class: 'sec' }, h('h3', null, title), ...body);

    // 슬라이더 + 숫자칸 한 쌍 (드래그·마우스 휠로 값 조절)
    const sliders = [];
    function wheelStep(el, path, step) {
        el.addEventListener('wheel', e => {
            e.preventDefault();
            const v = (parseFloat(Store.get(path)) || 0) + (e.deltaY < 0 ? step : -step);
            Store.set(path, G.round(v, 2), 'form');
        }, { passive: false });
    }
    function slider(label, path, unit, step) {
        const range = h('input', { type: 'range', step });
        range.addEventListener('input', () => Store.set(path, parseFloat(range.value), 'form'));
        const box = num(path, { step });
        wheelStep(range, path, step); wheelStep(box, path, step);
        sliders.push({ range, path });
        return h('label', { class: 'field slider' }, h('span', { class: 'k' }, label), range, box, h('span', { class: 'u' }, unit));
    }

    function syncForm() {
        bindings.forEach(b => {
            if (document.activeElement === b.el) return;
            const v = Store.get(b.path);
            if (b.el.type === 'checkbox') b.el.checked = !!v;
            else b.el.value = v == null ? '' : v;
        });
        // 배치 슬라이더 범위 = 대지 범위 (대지가 없으면 ±60m)
        const bd = Store.get('site.boundary');
        const bb = bd.length >= 3 ? G.bbox(bd) : { minX: -60, maxX: 60, minY: -60, maxY: 60 };
        sliders.forEach(s => {
            const v = Store.get(s.path) || 0;
            const lo = Math.floor(Math.min(s.path.endsWith('.x') ? bb.minX : bb.minY, v)), hi = Math.ceil(Math.max(s.path.endsWith('.x') ? bb.maxX : bb.maxY, v));
            s.range.min = lo; s.range.max = hi;
            if (document.activeElement !== s.range) s.range.value = v;
        });
        // 코어 입력칸 (코어비 자동이면 크기가 바뀜)
        const cores = Store.get('building.cores') || [];
        document.querySelectorAll('[data-core]').forEach(el => {
            if (document.activeElement === el) return;
            const [i, k] = el.getAttribute('data-core').split(':');
            if (cores[i]) el.value = cores[i][k];
        });
        const auto = Store.get('building.coreAuto');
        document.querySelectorAll('[data-core$=":w"], [data-core$=":d"]').forEach(el => { el.title = auto ? '코어비 자동: 가로·세로 비율만 반영되고 크기는 코어비에 맞춰집니다' : ''; });
        const type = Store.get('building.shape.type');
        document.querySelectorAll('[data-shape]').forEach(el => {
            el.hidden = !el.getAttribute('data-shape').split(' ').includes(type);
        });
        const s = Store.get('site');
        $('siteInfo').innerHTML = s.origin
            ? `${s.jibun || s.address || ''}`
            : '<span class="hint">주소를 검색하면 대지경계를 불러옵니다.</span>';
        $('areaSource').textContent = s.areaSource || '';

        // 필지 탭
        const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
        $('parcelInfo').innerHTML = s.origin
            ? row('지번', s.jibun || '–') + row('PNU', s.pnu || '–') + row('지목', s.jimok || '–') + row('경계 면적', fmt(G.area(s.boundary), 2) + ' ㎡')
            : row('대지', '개요 탭에서 주소를 검색하세요');
        $('neighborInfo').textContent = s.neighbors.length ? `주변 필지 ${s.neighbors.length}개 · 맞닿은 필지 ${s.neighbors.filter(n => n.touching).length}개 (도로 제외, 30m 이내)` : (s.origin ? '인접 필지를 아직 불러오지 않았습니다' : '');
        $('demoInfo').textContent = s.demolished.length ? `철거한 기존 건물 ${s.demolished.length}동` : '철거한 건물 없음';
        // 기준축 설명
        const bld = Store.get('building');
        if (bld.shape.type === 'site') {
            const fb = G.bbox(bld.footprint);
            $('siteRectInfo').textContent = s.boundary.length < 3 ? '대지를 불러오면 후퇴선 안 최대 직사각형으로 매스를 만듭니다.'
                : bld.footprint.length < 3 ? '후퇴 거리가 커서 직사각형이 들어가지 않습니다. 후퇴를 줄여 보세요.'
                : `후퇴선 안 최대 직사각형 ${fmt(fb.w, 2)} × ${fmt(fb.h, 2)} m (기준축 방향)`;
        }
        const rot = fmt(bld.placement.rotation, 1) + '°';
        $('axisInfo').textContent = {
            site: s.boundary.length >= 3 ? `대지 장변 방향(${rot})에 코어·기둥 그리드를 맞춥니다.` : '대지를 불러오면 대지 장변 방향에 맞춥니다.',
            mass: bld.shape.type === 'site' ? `후퇴선의 주축(최소 외접 직사각형, ${rot})에 맞춥니다.` : `매스 회전(${rot})을 따릅니다. 회전값을 직접 바꿀 수 있습니다.`,
            manual: `직접 정한 각도(${rot})를 씁니다. 마우스 휠로 1°씩 돌릴 수 있습니다.`
        }[bld.axisMode] + (bld.shape.type === 'site' ? ' 건물 원점은 매스 중심입니다.' : '');
        // 코어비 실제값
        const m = Store.metrics();
        $('coreInfo').textContent = m.buildingArea
            ? `코어 ${fmt(m.coreArea)}㎡ ÷ 바닥 ${fmt(m.buildingArea)}㎡ = ${fmt(m.coreArea / m.buildingArea * 100)}%`
            : '';
    }

    // 메인 데이터 패널 — 개요 / 형태 / 코어 탭
    function buildMainPanel() {
        const root = $('mainPanel');
        const addr = bind(h('input', { type: 'text', placeholder: '도로명 또는 지번 주소' }), 'site.address');
        addr.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); searchSite(addr.value.trim()); } });

        const shapeSel = bind(h('select', null,
            h('option', { value: 'rect' }, '직사각형'),
            h('option', { value: 'L' }, 'ㄱ자 (L형)'),
            h('option', { value: 'U' }, 'ㄷ자 (U형)'),
            h('option', { value: 'site' }, '대지경계 후퇴 (최대 직사각형)'),
            h('option', { value: 'custom' }, '사용자 정의 (플러그인이 지정)')
        ), 'building.shape.type');

        const pane = (id, ...body) => h('div', { 'data-pane': id, hidden: id !== 'overview' }, ...body);
        root.append(
            pane('overview',
                section('주소',
                    h('div', { class: 'search' }, addr, h('button', { class: 'btn', onclick: () => searchSite(addr.value.trim()) }, '검색')),
                    h('p', { class: 'info', id: 'siteInfo' }),
                    field('대지면적', num('site.area', { min: 0 }), '㎡'),
                    h('p', { class: 'hint', id: 'areaSource' })
                ),
                section('면적',
                    h('div', { class: 'stats' },
                        h('div', { class: 'stat' }, h('div', { class: 'k' }, '건축면적'), h('div', { class: 'v', id: 'statBA' })),
                        h('div', { class: 'stat' }, h('div', { class: 'k' }, '연면적'), h('div', { class: 'v', id: 'statGFA' }),
                            h('div', { class: 'sub', id: 'statGFASub' }))
                    )
                ),
                section('높이',
                    h('div', { class: 'stats' },
                        h('div', { class: 'stat' }, h('div', { class: 'k' }, '높이'), h('div', { class: 'v', id: 'statH' })),
                        h('div', { class: 'floors' },
                            field('지상', num('building.floorsAbove', { int: true, min: 0, step: 1 }), '층'),
                            field('지하', num('building.floorsBelow', { int: true, min: 0, step: 1 }), '층'))
                    )
                )
            ),
            pane('parcel',
                section('필지', h('table', { class: 'kv', id: 'parcelInfo' })),
                section('인접 대지',
                    h('label', { class: 'field' }, check('site.showNeighbors'), ' 인접 대지경계선 표시'),
                    h('p', { class: 'hint', id: 'neighborInfo' }),
                    h('div', { class: 'row' }, h('button', { class: 'btn ghost small', onclick: () => loadNeighbors(false) }, '다시 불러오기'))
                ),
                section('기존 건물',
                    h('p', { class: 'info', id: 'demoInfo' }),
                    h('div', { class: 'row' },
                        h('button', { class: 'btn small', onclick: demolishOnSite }, '대지 안 건물 철거'),
                        h('button', { class: 'btn ghost small', onclick: () => Store.set('site.demolished', [], 'hub') }, '모두 복원')),
                    h('p', { class: 'hint', style: { marginTop: '8px' } }, 'VWORLD 3D 보기에서, 지도의 건물을 클릭해 한 동씩 철거·복원할 수도 있습니다.')
                )
            ),
            pane('shape',
                section('평면 형태',
                    field('형태', shapeSel),
                    h('div', { class: 'grid2' },
                        field('가로', num('building.shape.w', { min: 1, step: 0.5 }), 'm', { 'data-shape': 'rect L U' }),
                        field('세로', num('building.shape.d', { min: 1, step: 0.5 }), 'm', { 'data-shape': 'rect L U' }),
                        field('따냄 가로', num('building.shape.cutW', { min: 0, step: 0.5 }), 'm', { 'data-shape': 'L U' }),
                        field('따냄 세로', num('building.shape.cutD', { min: 0, step: 0.5 }), 'm', { 'data-shape': 'L U' }),
                        field('후퇴', num('building.shape.setback', { min: 0, step: 0.1 }), 'm', { 'data-shape': 'site' })
                    ),
                    h('p', { class: 'hint', id: 'siteRectInfo', 'data-shape': 'site' }
                    )
                ),
                section('층고',
                    field('1층', num('building.groundFloorHeight', { min: 2, step: 0.1 }), 'm'),
                    field('기준층', num('building.floorHeight', { min: 2, step: 0.1 }), 'm'),
                    field('지하층', num('building.basementHeight', { min: 2, step: 0.1 }), 'm')
                ),
                section('기준축 · 배치',
                    field('기준축', bind(h('select', null,
                        h('option', { value: 'site' }, '대지 장변'),
                        h('option', { value: 'mass' }, '매스 기준'),
                        h('option', { value: 'manual' }, '직접 회전')
                    ), 'building.axisMode')),
                    field('회전', rotationInput(), '°'),
                    h('p', { class: 'hint', id: 'axisInfo', style: { marginBottom: '6px' } }),
                    h('div', { 'data-shape': 'rect L U custom' },
                        slider('X', 'building.placement.x', 'm', 0.5),
                        slider('Y', 'building.placement.y', 'm', 0.5),
                        h('div', { class: 'row' }, h('button', { class: 'btn ghost small', onclick: centerOnSite }, '대지 중앙에'))
                    )
                )
            ),
            pane('core',
                section('코어비',
                    h('div', { class: 'grid2' },
                        field('코어비', num('building.coreRatio', { min: 0, step: 1 }), '%'),
                        h('label', { class: 'field' }, check('building.coreAuto'), ' 크기 자동')),
                    h('p', { class: 'hint', id: 'coreInfo' })
                ),
                section('코어', h('div', { id: 'cores' }), h('p', { class: 'hint' }, '건물 좌표 기준 (건물 중심 = 0,0) · 크기 자동이면 가로·세로는 비율만 반영'))
            )
        );
        renderCores();

        // 탭 전환 — 고른 탭을 다시 누르면 패널을 접었다 폄
        const panel = $('dataPanel');
        $('dataTabs').querySelectorAll('button').forEach(b => {
            b.onclick = () => {
                const id = b.getAttribute('data-tab');
                if (b.classList.contains('on')) { panel.classList.toggle('collapsed'); syncCollapse(); return; }
                $('dataTabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
                root.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.getAttribute('data-pane') !== id; });
                panel.classList.remove('collapsed'); syncCollapse();
            };
        });
        const syncCollapse = () => { $('dataCollapse').textContent = panel.classList.contains('collapsed') ? '+' : '–'; };
        $('dataCollapse').onclick = () => { panel.classList.toggle('collapsed'); syncCollapse(); };
    }

    function renderCores() {
        const box = $('cores'); box.innerHTML = '';
        const cores = Store.get('building.cores') || [];
        const edit = (i, k, v) => { const cs = Store.get('building.cores'); cs[i][k] = v; Store.set('building.cores', cs, 'form'); };
        const labels = { x: '중심 X', y: '중심 Y', w: '가로', d: '세로' };
        cores.forEach((c, i) => {
            box.append(h('div', { class: 'core-card' },
                h('div', { class: 'top' },
                    h('span', { class: 'tag' }, c.id || 'C' + (i + 1)),
                    h('button', { class: 'btn text', onclick: () => { const cs = Store.get('building.cores'); cs.splice(i, 1); Store.set('building.cores', cs, 'form'); renderCores(); } }, '삭제')),
                h('div', { class: 'grid4' }, ...['x', 'y', 'w', 'd'].map(k => h('label', null, labels[k],
                    h('input', { type: 'number', step: 0.5, value: c[k], 'data-core': i + ':' + k, onchange: e => { const v = parseFloat(e.target.value); if (isFinite(v)) edit(i, k, v); } }))))
            ));
        });
        box.append(h('button', { class: 'btn ghost small', onclick: () => {
            const cs = Store.get('building.cores') || [];
            let n = cs.length + 1; while (cs.some(c => c.id === 'C' + n)) n++;
            cs.push({ id: 'C' + n, x: 0, y: 0, w: 8, d: 10 });
            Store.set('building.cores', cs, 'form'); renderCores();
        } }, '+ 코어 추가'));
    }

    // 개요 탭의 건축면적 · 연면적
    function renderMetrics() {
        const m = Store.metrics();
        $('statBA').innerHTML = fmt(m.buildingArea) + '<small>㎡</small>';
        $('statGFA').innerHTML = fmt(m.gfaTotal) + '<small>㎡</small>';
        $('statGFASub').innerHTML = `<span>지상</span><span>${fmt(m.gfaAbove)}㎡</span><span>지하</span><span>${fmt(m.gfaBelow)}㎡</span>`;
        $('statH').innerHTML = fmt(m.height) + '<small>m</small>';
    }

    // ---------- 위치 검색 ----------
    async function searchSite(address) {
        if (!address) return;
        toast('주소 검색 중…');
        const pt = await V.geocode(address);
        if (!pt) return toast('검색 결과가 없습니다.', 'error');
        let origin = { lon: pt.lon, lat: pt.lat }, boundary = [], parcel = null;
        try { parcel = await V.parcelAt(pt.lon, pt.lat); } catch (e) { console.warn(e); }
        if (parcel && parcel.ring && parcel.ring.length >= 3) {
            // 원점 = 필지 중심 → 대지 좌표 (0,0) 이 대지 가운데
            const tmp = parcel.ring.map(p => G.lonLatToXY(origin, p.lon, p.lat));
            const c = G.centroid(tmp);
            origin = G.xyToLonLat(origin, c.x, c.y);
            boundary = G.cleanRing(G.ccw(parcel.ring.map(p => G.lonLatToXY(origin, p.lon, p.lat))));
        }
        const area = G.round(G.area(boundary), 2);
        Store.patch({
            'site.address': pt.refined,
            'site.origin': origin,
            'site.boundary': boundary,
            'site.jibun': parcel ? parcel.jibun : '',
            'site.pnu': parcel ? parcel.pnu : '',
            'site.area': area,
            'site.areaSource': boundary.length ? '지적경계 계산값' : '',
            'site.zoning': null,
            'site.jimok': parcel ? jimokOf(parcel.props.jibun) : '',
            'site.neighbors': [],
            'site.demolished': [],
            'building.placement': { x: 0, y: 0, rotation: Store.get('building.placement.rotation') || 0 }
        }, 'hub');
        toast(boundary.length ? `대지경계를 불러왔습니다 · ${fmt(area)} ㎡` : '위치로 이동했습니다 (대지경계는 못 가져옴 — 네트워크/VWORLD 확인)', boundary.length ? '' : 'error');
        if (boundary.length) loadNeighbors(true);
    }
    // 연속지적도 jibun 끝 글자가 지목 ("737대" → 대, "12-3도" → 도로)
    const jimokOf = j => { const m = String(j || '').trim().match(/[가-힣]$/); return m ? m[0] : ''; };

    // 인접 필지 — 대지에서 30m 안의 필지 중 도로(지목 '도')를 뺀 것. 맞닿은(1m 이내) 필지는 touching 표시
    async function loadNeighbors(quiet) {
        const s = Store.get('site');
        if (!s.origin || s.boundary.length < 3) return quiet || toast('먼저 대지를 불러오세요.');
        const bb = G.bbox(s.boundary), pad = 35, RANGE = 30;
        const a = G.xyToLonLat(s.origin, bb.minX - pad, bb.minY - pad), b = G.xyToLonLat(s.origin, bb.maxX + pad, bb.maxY + pad);
        let feats;
        try { feats = await V.features('LP_PA_CBND_BUBUN', `BOX(${a.lon},${a.lat},${b.lon},${b.lat})`, 200); }
        catch (e) { return toast('인접 필지를 불러오지 못했습니다: ' + e.message, 'error'); }
        const gap = (P, Q) => {
            let d = Infinity;
            const one = (A, B) => A.forEach(p => B.forEach((q, i) => { d = Math.min(d, G.distToSegment(p, q, B[(i + 1) % B.length])); }));
            one(P, Q); one(Q, P);
            return d;
        };
        const out = [];
        feats.forEach(f => {
            if (f.props.pnu && f.props.pnu === s.pnu) return;
            if (jimokOf(f.props.jibun) === '도') return;
            const ring = V.outerRing(f.geometry);
            if (!ring || ring.length < 3) return;
            const poly = G.cleanRing(G.ccw(ring.map(p => G.lonLatToXY(s.origin, p.lon, p.lat))));
            const d = poly.length >= 3 ? gap(poly, s.boundary) : Infinity;
            if (d > RANGE) return;
            out.push({ jibun: f.props.jibun || '', pnu: f.props.pnu || '', touching: d <= 1, boundary: poly.map(p => ({ x: G.round(p.x, 2), y: G.round(p.y, 2) })) });
        });
        Store.set('site.neighbors', out, 'hub');
        if (!quiet) toast(`인접 필지 ${out.length}개를 불러왔습니다`);
    }

    // 대지 안 기존 건물 철거 — VWORLD 3D 건물 타일에서 대지 안쪽에 걸린 건물을 찾아 숨김
    async function demolishOnSite() {
        const b = Store.get('site.boundary');
        if (b.length < 3) return toast('먼저 대지를 불러오세요.');
        const vwv = viewers.vworld;
        if (!vwv || activeViewer !== 'vworld') return toast('VWORLD 3D 보기에서 쓸 수 있습니다 (간이 3D 에는 기존 건물이 없음).');
        toast('대지 안 건물을 찾는 중…');
        const inner = G.inset(b, 0.8);   // 경계선에 걸친 옆 대지 건물은 빼려고 살짝 안쪽만
        const ids = await vwv.findBuildingsIn(inner.length >= 3 ? inner : b);
        const cur = new Set(Store.get('site.demolished'));
        const before = cur.size;
        ids.forEach(id => cur.add(id));
        Store.set('site.demolished', Array.from(cur), 'hub');
        toast(ids.length ? `건물 ${cur.size - before}동을 철거했습니다` : '대지 안에서 건물을 찾지 못했습니다. 대지가 화면에 보이게 한 뒤 다시 눌러 보세요.');
    }
    function toggleBuilding(id) {
        const list = Store.get('site.demolished');
        const i = list.indexOf(id);
        if (i === -1) list.push(id); else list.splice(i, 1);
        Store.set('site.demolished', list, 'hub');
    }
    function centerOnSite() {
        const b = Store.get('site.boundary');
        if (!b.length) return toast('먼저 대지를 불러오세요.');
        const c = G.centroid(b), pl = Store.get('building.placement');
        Store.set('building.placement', { x: G.round(c.x, 2), y: G.round(c.y, 2), rotation: pl.rotation }, 'form');
    }
    // 회전 입력 — 자동 기준축(대지 장변 / 대지경계 후퇴의 매스 기준)일 때 직접 고치면 '직접 회전'으로 바뀜
    function setRotation(v) {
        const b = Store.get('building');
        const auto = b.axisMode === 'site' || (b.axisMode === 'mass' && b.shape.type === 'site');
        const changes = { 'building.placement.rotation': G.round(v, 2) };
        if (auto) changes['building.axisMode'] = 'manual';
        Store.patch(changes, 'form');
    }
    function rotationInput() {
        const el = h('input', { type: 'number', step: 1 });
        bindings.push({ el, path: 'building.placement.rotation' });
        el.addEventListener('change', () => { const v = parseFloat(el.value); if (isFinite(v)) setRotation(v); else syncForm(); });
        el.addEventListener('wheel', e => { e.preventDefault(); setRotation((Store.get('building.placement.rotation') || 0) + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
        return el;
    }

    // ---------- 허브가 그리는 기본 장면 (대지 + 매스 + 코어) ----------
    function drawCore() {
        const s = Store.get();
        Scene.setPlacement(s.building.placement);
        const site = Scene.layer('core/site');
        site.clear();
        if (s.site.boundary.length >= 3) {
            site.polygon(s.site.boundary, { z: 0.05, color: '#e8b04a', opacity: 0.18 });
            site.line(s.site.boundary, { z: 0.3, color: '#d6452f', mapColor: '#ff453a', width: 3, closed: true, ground: true });
        }
        const nb = Scene.layer('core/neighbors');
        nb.clear();
        if (s.site.showNeighbors) s.site.neighbors.forEach(n => nb.line(n.boundary, {
            z: 0.25, closed: true, ground: true,
            color: n.touching ? '#3a3a3c' : '#8e8e93',                         // 간이 3D (밝은 바닥)
            mapColor: '#ffffff', opacity: n.touching ? 0.95 : 0.6,           // VWORLD 항공사진 위
            width: n.touching ? 3 : 2
        }));
        const bl = Scene.layer('core/building', { frame: 'building' });
        bl.clear();
        const fp = s.building.footprint;
        if (fp.length < 3) return;
        const levels = Store.levels();
        levels.forEach(l => {
            const above = l.index > 0;
            bl.extrude(fp, { base: l.z, height: l.height - 0.08, color: above ? '#f3efe6' : '#9aa3ad', opacity: above ? 0.55 : 0.35, outlineColor: '#6b6f76' });
        });
        if (levels.length) {
            const bottom = levels[0].z, top = levels[levels.length - 1].z + levels[levels.length - 1].height;
            s.building.cores.forEach(c => {
                bl.extrude(G.rectAt(c.x, c.y, c.w, c.d), { base: bottom, height: top - bottom + s.building.floorHeight, color: '#e0663a', opacity: 0.9, outlineColor: '#8a3a1f' });
            });
        }
    }

    // =====================================================================
    // 3D 뷰 전환
    // =====================================================================
    const viewers = {};   // kind → backend
    let activeViewer = null;
    async function useViewer(kind, quiet) {
        const def = window.ArchViewers[kind];
        if (kind === activeViewer) return true;
        // 지금 보던 시점 (대지 좌표 기준) — 새 뷰에 그대로 넘겨서 대상지 배경만 바뀌는 것처럼 보이게
        const prev = activeViewer && viewers[activeViewer];
        const view = prev && prev.getView ? prev.getView() : null;
        try {
            if (!viewers[kind]) {
                const el = $('view-' + kind);
                el.style.display = '';
                viewers[kind] = await def.create(el, { origin: Store.get('site.origin'), onGroundChange: () => Scene.redraw(), onBuildingClick: toggleBuilding });
                if (viewers[kind].setDemolished) viewers[kind].setDemolished(Store.get('site.demolished'));
            }
            Object.keys(viewers).forEach(k => viewers[k].show(k === kind));
            activeViewer = kind;
            Scene.setBackend(viewers[kind]);
            const o = Store.get('site.origin'); if (o) Scene.setOrigin(o);
            if (view && viewers[kind].setView) viewers[kind].setView(view);
            else Scene.focus(siteBBox());
            try { localStorage.setItem(VIEWER_KEY, kind); } catch (e) { /* 무시 */ }
            document.querySelectorAll('[data-viewer]').forEach(b => b.classList.toggle('on', b.getAttribute('data-viewer') === kind));
            return true;
        } catch (e) {
            console.warn(def.label + ' 시작 실패:', e);
            $('view-' + kind).style.display = 'none';
            if (!quiet) toast(def.label + '를 열 수 없습니다: ' + e.message, 'error');
            return false;
        }
    }
    function siteBBox() {
        const s = Store.get();
        const pts = s.site.boundary.concat(s.building.footprint.map(p => G.toSite(p, s.building.placement)));
        return pts.length ? G.bbox(pts) : null;
    }

    // =====================================================================
    // 플러그인 시스템
    // =====================================================================
    const registry = [];          // plugins/registry.js 가 채움: { id, name, src, description }
    const defs = {};              // 등록된 플러그인 정의 (id → def)
    const active = {};            // 실행 중 (id → { def, ctx, inst, panel, tab })
    let justRegistered = [];
    const busListeners = {};

    function registerPlugin(def) {
        if (!def || !/^[a-z0-9][a-z0-9-]*$/.test(def.id || '')) throw new Error('플러그인 id 는 영문 소문자·숫자·하이픈만 가능합니다: ' + (def && def.id));
        if (typeof def.activate !== 'function') throw new Error(def.id + ': activate(ctx) 함수가 필요합니다');
        if (def.apiVersion && def.apiVersion !== 1) console.warn(def.id + ': 허브 API 버전(1)과 다릅니다 → ' + def.apiVersion);
        defs[def.id] = def;
        justRegistered.push(def.id);
    }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src; s.onload = resolve;
            s.onerror = () => reject(new Error('파일을 불러올 수 없습니다: ' + src));
            document.head.appendChild(s);
        });
    }

    // 플러그인 파일을 읽어 등록 → 실행
    async function loadPlugin(entry) {
        if (entry.id && active[entry.id]) return active[entry.id];
        if (!entry.id || !defs[entry.id]) {
            justRegistered = [];
            await loadScript(entry.src);
            if (!justRegistered.length) throw new Error('파일 안에서 ArchHub.registerPlugin(...) 이 호출되지 않았습니다');
            entry = Object.assign({}, entry, { id: entry.id || justRegistered[0] });
            if (!defs[entry.id]) throw new Error('registry 의 id(' + entry.id + ')와 파일 안의 id(' + justRegistered.join(',') + ')가 다릅니다');
        }
        return activatePlugin(defs[entry.id], entry.src);
    }

    function activatePlugin(def, src) {
        const panel = h('div', { class: 'plugin-panel', 'data-plugin': def.id });
        $('pluginPanels').append(panel);
        const ctx = makeContext(def, panel);
        const rec = { def, ctx, panel, src, inst: null };
        active[def.id] = rec;
        try {
            const r = def.activate(ctx);
            if (r && typeof r.then === 'function') r.then(v => { rec.inst = v || null; }, e => pluginError(def, e));
            else rec.inst = r || null;
        } catch (e) { pluginError(def, e); }
        panel.hidden = true;
        saveActive(); renderLibrary();
        return rec;
    }

    function deactivatePlugin(id) {
        const rec = active[id]; if (!rec) return;
        try { rec.inst && rec.inst.deactivate && rec.inst.deactivate(); } catch (e) { console.error(e); }
        rec.ctx._dispose();
        rec.panel.remove();
        delete active[id];
        saveActive(); showPlugin(null);
    }

    function pluginError(def, e) {
        console.error('[' + def.id + ']', e);
        toast(def.name + ' 오류: ' + (e && e.message || e), 'error');
    }

    // 플러그인이 받는 ctx — 허브와 소통하는 유일한 통로
    function makeContext(def, panel) {
        const disposers = [], layers = [];
        const writes = def.writes || [];
        const own = 'plugins.' + def.id;
        const allowed = path => path === own || path.startsWith(own + '.') ||
            writes.some(w => path === w || path.startsWith(w + '.'));
        const guard = path => {
            if (allowed(path)) return true;
            pluginError(def, new Error('"' + path + '" 쓰기 권한이 없습니다. 플러그인 정의의 writes 에 선언하세요.'));
            return false;
        };
        const safe = fn => function () { try { return fn.apply(null, arguments); } catch (e) { pluginError(def, e); } };

        const ctx = {
            id: def.id,
            panel,
            project: {
                get: Store.get,
                levels: Store.levels,
                metrics: Store.metrics,
                set(path, value) { if (guard(path)) Store.set(path, value, def.id); },
                patch(changes) { if (Object.keys(changes).every(guard)) Store.patch(changes, def.id); },
                // 다른 쪽(허브·다른 플러그인·사용자)이 바꾼 것만 받으려면 ev.source !== ctx.id 확인
                onChange(fn) { const off = Store.on(safe(fn)); disposers.push(off); return off; }
            },
            // 이 플러그인 전용 저장 공간 (project.plugins[id]) — 프로젝트 파일에 함께 저장됨
            data: {
                get: () => Store.get(own) || {},
                set: obj => Store.set(own, obj, def.id),
                update: fn => Store.set(own, fn(Store.get(own) || {}), def.id)
            },
            scene: {
                layer(name, opts) { const l = Scene.layer(def.id + '/' + name, opts); if (!layers.includes(l)) layers.push(l); return l; },
                focus: () => Scene.focus(siteBBox())
            },
            geo: G,
            vworld: V,
            ui: { h, toast, fmt },
            // 플러그인 간 메시지 (예: bus.emit('columns:changed', {...}))
            bus: {
                emit(type, payload) { (busListeners[type] || []).slice().forEach(fn => fn(payload, def.id)); },
                on(type, fn) {
                    const f = safe(fn);
                    (busListeners[type] = busListeners[type] || []).push(f);
                    const off = () => { busListeners[type] = (busListeners[type] || []).filter(x => x !== f); };
                    disposers.push(off); return off;
                }
            },
            _dispose() { disposers.forEach(f => f()); layers.forEach(l => l.remove()); }
        };
        return ctx;
    }

    function saveActive() {
        try { localStorage.setItem(ACTIVE_KEY, JSON.stringify(Object.values(active).map(r => ({ id: r.def.id, src: r.src })))); }
        catch (e) { /* 무시 */ }
    }
    async function restoreActive() {
        let list = [];
        try { list = JSON.parse(localStorage.getItem(ACTIVE_KEY) || '[]'); } catch (e) { /* 무시 */ }
        for (const e of list) {
            try { await loadPlugin(e); } catch (err) { toast('플러그인 복원 실패(' + e.id + '): ' + err.message, 'error'); }
        }
        showPlugin(null);
    }

    // ---------- 플러그인 패널: 홈(아이콘 격자) ↔ 플러그인 화면 ----------
    let currentPlugin = null;   // null = 홈
    let devOpen = false;
    const SVG_NS = 'http://www.w3.org/2000/svg';
    // registry 의 glyph(24×24 SVG 안쪽 마크업) → 아이콘. 없으면 이름 첫 글자
    function appGlyph(entry) {
        if (!entry.glyph) return document.createTextNode((entry.name || '?').trim().charAt(0));
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '1.6'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
        svg.innerHTML = entry.glyph;
        return svg;
    }
    function entryOf(id) {
        return registry.find(e => e.id === id) || (active[id] && { id, name: active[id].def.name, glyph: active[id].def.glyph, src: active[id].src });
    }
    function renderHead() {
        const head = $('pluginHead'); head.innerHTML = '';
        if (!currentPlugin) {
            head.append(h('div', { class: 'panel-title' }, '플러그인'));
            head.append(h('button', { class: 'icon-btn', title: '접기', onclick: () => { $('pluginPanel').classList.toggle('collapsed'); renderHead(); } },
                $('pluginPanel').classList.contains('collapsed') ? '+' : '–'));
            return;
        }
        const rec = active[currentPlugin];
        head.append(
            h('button', { class: 'icon-btn', title: '플러그인 목록', onclick: () => showPlugin(null) }, '‹'),
            h('div', { class: 'panel-title' }, rec ? rec.def.name : currentPlugin),
            h('button', { class: 'btn text', title: '끄면 이 플러그인의 그림과 화면이 사라집니다 (저장된 값은 남음)', onclick: () => deactivatePlugin(currentPlugin) }, '끄기')
        );
    }
    function showPlugin(id) {
        if (id && !active[id]) id = null;
        currentPlugin = id;
        $('pluginPanel').classList.remove('collapsed');
        $('library').hidden = !!id;
        Object.values(active).forEach(r => { r.panel.hidden = r.def.id !== id; });
        renderHead();
        if (!id) renderLibrary();
    }
    async function openApp(entry, tileEl) {
        if (!active[entry.id]) {
            tileEl && tileEl.classList.add('busy');
            try { await loadPlugin(entry); }
            catch (err) { toast(err.message, 'error'); tileEl && tileEl.classList.remove('busy'); return; }
        }
        showPlugin(entry.id);
    }
    function renderLibrary() {
        const box = $('library'); if (!box) return;
        box.innerHTML = '';
        const grid = h('div', { class: 'apps' });
        const entries = registry.slice();
        // registry 밖(개발 중 주소로 불러온) 플러그인도 홈에 보이게
        Object.keys(active).forEach(id => { if (!entries.some(e => e.id === id)) entries.push(entryOf(id)); });
        entries.forEach(e => {
            const btn = h('button', { class: 'app' + (active[e.id] ? ' on' : ''), title: e.description || e.name },
                h('span', { class: 'tile' }, appGlyph(e)),
                h('span', { class: 'name' }, e.name),
                h('span', { class: 'dot' }));
            btn.onclick = () => openApp(e, btn);
            grid.append(btn);
        });
        const add = h('button', { class: 'app add', title: '개발 중 플러그인 불러오기', onclick: () => { devOpen = !devOpen; renderLibrary(); } },
            h('span', { class: 'tile' }, '+'), h('span', { class: 'name' }, '불러오기'), h('span', { class: 'dot' }));
        grid.append(add);
        box.append(grid);
        if (devOpen) {
            const url = h('input', { type: 'text', placeholder: 'plugins/my-plugin/plugin.js' });
            box.append(h('div', { class: 'dev' },
                h('div', { class: 'search' }, url, h('button', { class: 'btn small', onclick: async () => {
                    if (!url.value.trim()) return;
                    try { const rec = await loadPlugin({ src: url.value.trim() }); devOpen = false; showPlugin(rec.def.id); }
                    catch (err) { toast(err.message, 'error'); }
                } }, '불러오기')),
                h('p', { class: 'hint' }, '개발 중인 플러그인 파일 주소. 직접 만든, 믿을 수 있는 파일만 불러오세요.')
            ));
        }
    }

    // =====================================================================
    // 프로젝트 파일 (JSON 저장/열기)
    // =====================================================================
    function exportProject() {
        const p = Store.toJSON();
        const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
        const a = h('a', { href: URL.createObjectURL(blob), download: (p.meta.name || 'project').replace(/[\\/:*?"<>|]/g, '_') + '.archhub.json' });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    function importProject(file) {
        const r = new FileReader();
        r.onload = () => {
            try { Store.replace(JSON.parse(r.result), 'load'); toast('프로젝트를 열었습니다'); }
            catch (e) { toast('열 수 없는 파일입니다: ' + e.message, 'error'); }
        };
        r.readAsText(file);
    }

    // =====================================================================
    // 시작
    // =====================================================================
    function onProjectChange(ev) {
        // 코어 입력칸을 직접 고치는 중(form)에는 다시 그리지 않음 — 포커스 유지
        if (ev.paths.includes('*') || (ev.touches('building.cores') && ev.source !== 'form')) renderCores();
        syncForm();
        renderMetrics();
        if (ev.touches('site') || ev.touches('building') || ev.paths.includes('*')) drawCore();
        if ((ev.touches('site.demolished') || ev.paths.includes('*')) && viewers.vworld) viewers.vworld.setDemolished(Store.get('site.demolished'));
        if (ev.touches('site.origin')) {
            const o = Store.get('site.origin');
            if (o) Scene.setOrigin(o);
            Scene.focus(siteBBox());
        }
        if (ev.touches('meta.name') || ev.paths.includes('*')) document.title = (Store.get('meta.name') || 'Arch Hub') + ' · Arch Hub';
    }

    async function start() {
        buildMainPanel();
        bind($('projectName'), 'meta.name');
        $('btnExport').onclick = exportProject;
        $('btnImport').onclick = () => $('fileInput').click();
        $('fileInput').onchange = e => { if (e.target.files[0]) importProject(e.target.files[0]); e.target.value = ''; };
        $('btnNew').onclick = () => { if (confirm('현재 프로젝트를 지우고 새로 시작할까요? (먼저 저장하세요)')) Store.reset(); };
        document.querySelectorAll('[data-viewer]').forEach(b => { b.onclick = () => useViewer(b.getAttribute('data-viewer')); });

        Store.on(onProjectChange);
        syncForm(); renderMetrics(); showPlugin(null);
        drawCore();
        // 필지 탭이 생기기 전에 저장된 프로젝트 — 인접 필지를 한 번 자동으로 불러옴
        if (Store.get('site.boundary').length >= 3 && !Store.get('site.neighbors').length) loadNeighbors(true);

        let pref = 'vworld';
        try { pref = localStorage.getItem(VIEWER_KEY) || 'vworld'; } catch (e) { /* 무시 */ }
        if (!(await useViewer(pref, true))) {
            const other = pref === 'vworld' ? 'three' : 'vworld';
            if (await useViewer(other, true)) toast(window.ArchViewers[pref].label + '를 열 수 없어 ' + window.ArchViewers[other].label + '로 표시합니다.');
            else toast('3D 뷰를 열 수 없습니다. 인터넷 연결을 확인하세요.', 'error');
        }
        await restoreActive();
    }

    window.ArchHub = {
        apiVersion: 1,
        registerPlugin,
        // plugins/registry.js 에서 호출
        setRegistry(list) { registry.splice(0, registry.length, ...list); renderLibrary(); },
        start,
        // 디버깅용
        _active: active, _defs: defs
    };
})();
