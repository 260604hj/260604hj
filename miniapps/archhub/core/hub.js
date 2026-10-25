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
                    h('label', { class: 'field', style: { marginTop: '8px' } }, check('view.autoDemolish'), ' 대지를 불러오면 자동 철거'),
                    h('p', { class: 'hint' }, 'VWORLD 3D 보기에서, 지도의 건물을 클릭해 한 동씩 철거·복원할 수도 있습니다.')
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
            ),
            pane('visibility',
                section('시점',
                    h('div', { class: 'row', id: 'viewPresets' }),
                    h('p', { class: 'hint', style: { marginTop: '8px' } }, '코너 = 기준축 방향 대지 네 모서리에서 수평으로 본 2점투시 · 탑뷰 = 대지 장변이 화면 가로')
                ),
                section('지도 레이어',
                    h('label', { class: 'field' }, check('view.zoning'), ' 용도지역'),
                    h('label', { class: 'field' }, check('view.stations'), ' 지하철 노선·역 (수도권 전철)'),
                    h('p', { class: 'hint', id: 'stationInfo', style: { marginBottom: '6px' } }),
                    h('label', { class: 'field' }, check('view.texture'), ' 건물 재질 (끄면 흰 매스 모형)'),
                    h('p', { class: 'hint' }, '용도지역·재질은 VWORLD 3D 보기에서 적용됩니다. 지하철 노선·역: © OpenStreetMap contributors')
                )
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
        return loadSiteAt(pt.lon, pt.lat, pt.refined);
    }
    // 좌표의 필지를 대지로 설정 (주소 검색, 플러그인 ctx.hub.loadSite 공용)
    async function loadSiteAt(lon, lat, label) {
        const pt = { lon, lat, refined: label || '' };
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
            'site.address': pt.refined || (parcel ? parcel.jibun : ''),
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
        // 기본: 대지 안 기존 건물 자동 철거 (카메라가 대지로 옮겨 건물 타일이 들어온 뒤)
        if (boundary.length && Store.get('view.autoDemolish') && activeViewer === 'vworld') setTimeout(() => demolishOnSite(true), 1500);
        return boundary.length > 0;
    }

    // =====================================================================
    // 가시성 — 시점 프리셋(4코너 2점투시 · 탑뷰) + 지도 레이어
    // =====================================================================
    // 기준축 좌표로 본 대지(없으면 매스) 범위와 높이
    function viewFrame() {
        const s = Store.get(), rot = s.building.placement.rotation || 0;
        const center = s.building.footprint.length >= 3
            ? G.toSite(G.centroid(s.building.footprint), s.building.placement)
            : (s.site.boundary.length >= 3 ? G.centroid(s.site.boundary) : { x: 0, y: 0 });
        const pts = s.site.boundary.length >= 3 ? s.site.boundary : s.building.footprint.map(p => G.toSite(p, s.building.placement));
        const local = pts.map(p => G.rotate({ x: p.x - center.x, y: p.y - center.y }, -rot));
        const bb = local.length ? G.bbox(local) : { minX: -15, maxX: 15, minY: -15, maxY: 15, w: 30, h: 30 };
        return { center, rot, bb, height: Math.max(Store.metrics().height, 6) };
    }
    const COMPASS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
    const compassOf = deg => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];   // deg: 정북 0 시계방향
    // 대지의 네 모서리(기준축 기준) — 각 모서리 바깥에서 대지 중심을 수평으로 바라봄
    function cornerViews() {
        const f = viewFrame();
        return [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([sx, sy]) => {
            const dir = G.rotate({ x: sx * f.bb.w / 2, y: sy * f.bb.h / 2 }, f.rot);   // 중심 → 모서리 (대지 좌표)
            const len = Math.hypot(dir.x, dir.y) || 1;
            const ux = dir.x / len, uy = dir.y / len;
            const camHeading = Math.atan2(-ux, -uy);                                   // 카메라 → 중심 방향
            const fromDeg = Math.atan2(ux, uy) * 180 / Math.PI;                         // 중심에서 본 모서리 방위
            return { label: compassOf(fromDeg) + ' 코너', build: fovy => {
                const el = $('view-' + activeViewer);
                const aspect = el ? el.clientWidth / Math.max(1, el.clientHeight) : 1.6;
                const fovx = 2 * Math.atan(Math.tan(fovy / 2) * aspect);
                // 2점투시: 카메라 수평(pitch 0), 눈높이 = 건물 높이의 절반 → 수직선이 평행하게 유지됨
                const half = Math.hypot(f.bb.w, f.bb.h) / 2;
                const D = Math.max((f.height / 2) / Math.tan(fovy / 2) * 1.25, half / Math.tan(fovx / 2) * 1.15) + half * 0.2;
                return { x: f.center.x + ux * D, y: f.center.y + uy * D, z: f.height / 2, heading: camHeading, pitch: 0, fovy };
            } };
        });
    }
    function topView(fovy) {
        const f = viewFrame();
        const el = $('view-' + activeViewer);
        const aspect = el ? el.clientWidth / Math.max(1, el.clientHeight) : 1.6;
        const need = Math.max(f.bb.h, f.bb.w / aspect) / 2 * 1.25;   // 대지 장변을 화면 가로로
        return { x: f.center.x, y: f.center.y, z: need / Math.tan(fovy / 2) + f.height,
            heading: -f.rot * Math.PI / 180, pitch: -89.9 * Math.PI / 180, fovy };
    }
    function applyPreset(make) {
        const v = activeViewer && viewers[activeViewer];
        if (!v || !v.getView) return;
        const fovy = v.getView().fovy || (40 * Math.PI / 180);
        const view = make(fovy);
        v.setView(view);
    }
    function renderViewButtons() {
        const box = $('viewPresets'); if (!box) return;
        box.innerHTML = '';
        box.append(h('button', { class: 'btn ghost small', onclick: () => applyPreset(topView) }, '탑뷰'));
        const cs = cornerViews(), count = {};
        cs.forEach(c => { count[c.label] = (count[c.label] || 0) + 1; });
        const seen = {};
        cs.forEach(c => {
            // 가늘고 긴 대지는 두 모서리가 같은 방위가 될 수 있음 → 번호로 구분
            const label = count[c.label] > 1 ? c.label + ' ' + (seen[c.label] = (seen[c.label] || 0) + 1) : c.label;
            box.append(h('button', { class: 'btn ghost small', onclick: () => applyPreset(c.build) }, label));
        });
        box.append(h('button', { class: 'btn ghost small', onclick: () => Scene.focus(siteBBox()) }, '조감'));
    }

    // 지하철 — 수도권 전철 노선(노선색)과 역 전체. 자료는 data/seoul-subway.js (OpenStreetMap, 처음 켤 때 한 번 읽음)
    let subwayPromise = null, stationsKey = '';
    function loadSubway() {
        if (!subwayPromise) subwayPromise = loadScriptOnce('data/seoul-subway.js').then(() => {
            const D = window.ArchSubwayData;
            // 역마다 지나는 노선 (역 좌표에서 노선까지 80m 이내)
            const toM = (o, p) => G.lonLatToXY(o, p[0], p[1]);
            D.stations = D.stations.map(([name, lon, lat]) => {
                const o = { lon, lat }, lines = [];
                D.lines.forEach((ln, li) => {
                    const near = ln.paths.some(path => {
                        for (let i = 0; i < path.length - 1; i++) {
                            const a = path[i], b = path[i + 1];
                            if (Math.abs(a[1] - lat) > 0.01 && Math.abs(b[1] - lat) > 0.01) continue;   // 빠른 거르기
                            if (G.distToSegment({ x: 0, y: 0 }, toM(o, a), toM(o, b)) < 80) return true;
                        }
                        return false;
                    });
                    if (near) lines.push(li);
                });
                return { name, lon, lat, lines };
            }).filter(st => st.lines.length);
            D.lines.forEach(ln => { ln.drawPaths = mergeParallel(ln.paths); });
            return D;
        });
        return subwayPromise;
    }
    // 한 노선의 상·하행선, 급행선 등 나란한 선로를 한 줄로 — 긴 선로부터 남기고,
    // 이미 남긴 선로에서 25m 안을 지나는 부분은 버리고 새로 뻗는 구간만 남김
    function mergeParallel(paths) {
        const O = { lon: 126.98, lat: 37.56 }, TOL = 25, CELL = 50;
        const P = paths.map(p => p.map(q => G.lonLatToXY(O, q[0], q[1])));
        const len = p => p.reduce((s, q, i) => i ? s + G.dist(p[i - 1], q) : 0, 0);
        const order = P.map((p, i) => i).sort((a, b) => len(P[b]) - len(P[a]));
        const grid = new Map(), cellKey = (x, y) => Math.floor(x / CELL) + ',' + Math.floor(y / CELL);
        const addSeg = (a, b) => {
            const bb = G.bbox([a, b]);
            for (let x = Math.floor((bb.minX - TOL) / CELL); x <= Math.floor((bb.maxX + TOL) / CELL); x++)
                for (let y = Math.floor((bb.minY - TOL) / CELL); y <= Math.floor((bb.maxY + TOL) / CELL); y++) {
                    const k = x + ',' + y; if (!grid.has(k)) grid.set(k, []); grid.get(k).push([a, b]);
                }
        };
        const covered = q => (grid.get(cellKey(q.x, q.y)) || []).some(([a, b]) => G.distToSegment(q, a, b) < TOL);
        const out = [];
        order.forEach(i => {
            const p = P[i], src = paths[i];
            const cov = p.map(covered);
            // 덮이지 않은 점들의 연속 구간 (앞뒤 한 점씩 이어 붙여 끊김 없게)
            let run = [];
            const flush = () => { if (run.length >= 2) out.push(run.map(j => src[j])); run = []; };
            for (let j = 0; j < p.length; j++) {
                if (!cov[j]) {
                    if (!run.length && j > 0) run.push(j - 1);
                    run.push(j);
                } else if (run.length) { run.push(j); flush(); }
            }
            flush();
            for (let j = 0; j < p.length - 1; j++) addSeg(p[j], p[j + 1]);
        });
        return out;
    }
    function loadScriptOnce(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('불러올 수 없음: ' + src));
            document.head.appendChild(s);
        });
    }
    async function drawStations() {
        const L = Scene.layer('core/stations');
        const s = Store.get();
        if (!s.view.stations || !s.site.origin) { L.clear(); stationsKey = ''; if ($('stationInfo')) $('stationInfo').textContent = ''; return; }
        const key = s.site.origin.lon + ',' + s.site.origin.lat;
        if (key === stationsKey) return;
        stationsKey = key;
        let D;
        try { D = await loadSubway(); } catch (e) { stationsKey = ''; return toast('지하철 자료를 불러오지 못했습니다: ' + e.message, 'error'); }
        if (stationsKey !== key) return;
        const o = s.site.origin;
        const xy = p => G.lonLatToXY(o, p[0], p[1]);
        L.clear();
        // 노선 — 지형·건물에 가려도 비쳐 보이게 (ground 선)
        D.lines.forEach(ln => ln.drawPaths.forEach(path => L.line(path.map(xy), { z: 2, ground: true, color: ln.color, mapColor: ln.color, width: 2, seeThrough: 1 })));
        // 역 — 한 노선이면 그 색, 환승역은 흰 점 + 진한 테두리. 이름은 대지 5km 안 역만, 카메라가 2.5km 안일 때 (VWORLD)
        const near = [];
        D.stations.forEach(st => {
            const p = G.lonLatToXY(o, st.lon, st.lat), d = Math.hypot(p.x, p.y);
            const single = st.lines.length === 1 ? D.lines[st.lines[0]].color : null;
            L.point({ x: p.x, y: p.y, z: 3 }, { color: single || '#ffffff', outlineColor: single ? '#ffffff' : '#1d1d1f', size: single ? 12 : 14 });
            if (d < 5000) L.label({ x: p.x, y: p.y, z: 18 }, st.name, { color: '#1d1d1f', dark: true, size: 13, maxDistance: 2500 });
            if (d <= 1000) near.push({ st, d });
        });
        near.sort((a, b) => a.d - b.d);
        const seen = new Set();
        const list = near.filter(n => !seen.has(n.st.name) && seen.add(n.st.name));
        if ($('stationInfo')) {
            const box = $('stationInfo'); box.innerHTML = '';
            if (!list.length) box.textContent = '반경 1km 안에 역이 없습니다.';
            list.forEach(n => box.append(h('span', { class: 'st' },
                ...n.st.lines.map(li => h('i', { style: { background: D.lines[li].color }, title: D.lines[li].name })),
                `${n.st.name} ${Math.round(n.d)}m`)));
        }
    }

    function applyMapLayers() {
        const v = Store.get('view');
        if (viewers.vworld && viewers.vworld.setLayers) viewers.vworld.setLayers({ zoning: v.zoning, texture: v.texture });
        drawStations();
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
    async function demolishOnSite(auto, retried) {
        auto = auto === true;   // 대지 불러올 때 자동 실행 — 못 찾아도 오류 안내 안 함
        const key = JSON.stringify(Store.get('site.origin'));
        const b = Store.get('site.boundary');
        if (b.length < 3) return auto || toast('먼저 대지를 불러오세요.');
        const vwv = viewers.vworld;
        if (!vwv || activeViewer !== 'vworld') return auto || toast('VWORLD 3D 보기에서 쓸 수 있습니다 (간이 3D 에는 기존 건물이 없음).');
        toast('대지 안 건물을 찾는 중…');
        const inner = G.inset(b, 0.8);   // 경계선에 걸친 옆 대지 건물은 빼려고 살짝 안쪽만
        const ids = await vwv.findBuildingsIn(inner.length >= 3 ? inner : b);
        const cur = new Set(Store.get('site.demolished'));
        const before = cur.size;
        ids.forEach(id => cur.add(id));
        Store.set('site.demolished', Array.from(cur), 'hub');
        if (ids.length) toast(`대지 안 기존 건물 ${cur.size - before}동을 철거했습니다`);
        else if (!auto) toast('대지 안에서 건물을 찾지 못했습니다. 대지가 화면에 보이게 한 뒤 다시 눌러 보세요.');
        // 자동 실행인데 못 찾았으면 건물 타일이 늦게 들어온 것일 수 있어 한 번 더 (같은 대지일 때만)
        else if (!retried) setTimeout(() => { if (JSON.stringify(Store.get('site.origin')) === key) demolishOnSite(true, true); }, 4000);
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
                if (viewers[kind].setLayers) viewers[kind].setLayers({ zoning: Store.get('view.zoning'), texture: Store.get('view.texture') });
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
            // 허브 동작 — 좌표의 필지를 대지로 설정 (주소 검색과 같은 처리: 경계·인접 필지·카메라 이동)
            hub: { loadSite: (lon, lat, label) => loadSiteAt(lon, lat, label) },
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
        list = list.filter(e => e.id !== 'template');   // 예전에 목록에 있던 템플릿은 다시 켜지 않음
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
        const close = () => h('button', { class: 'icon-btn sheet-close', 'data-close-sheet': true, title: '닫기' }, '×');
        if (!currentPlugin) {
            head.append(h('div', { class: 'panel-title' }, '플러그인'));
            head.append(h('button', { class: 'icon-btn', title: '접기', onclick: () => { $('pluginPanel').classList.toggle('collapsed'); renderHead(); } },
                $('pluginPanel').classList.contains('collapsed') ? '+' : '–'), close());
            return;
        }
        const rec = active[currentPlugin];
        head.append(
            h('button', { class: 'icon-btn', title: '플러그인 목록', onclick: () => showPlugin(null) }, '‹'),
            h('div', { class: 'panel-title' }, rec ? rec.def.name : currentPlugin),
            h('button', { class: 'btn text', title: '끄면 이 플러그인의 그림과 화면이 사라집니다 (저장된 값은 남음)', onclick: () => deactivatePlugin(currentPlugin) }, '끄기'),
            close()
        );
    }
    // 모바일 시트 — 'data' | 'plugin' | '' (닫힘)
    function setSheet(name) {
        document.body.dataset.sheet = name;
        document.querySelectorAll('#dock [data-sheet]').forEach(b => b.classList.toggle('on', b.getAttribute('data-sheet') === name));
    }
    function showPlugin(id) {
        if (id && !active[id]) id = null;
        currentPlugin = id;
        $('pluginPanel').classList.remove('collapsed');
        $('pluginPanel').classList.toggle('rail', !id && !devOpen);
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
        // 데스크톱 홈은 아이콘이 세로 한 줄인 좁은 레일 (개발용 주소 칸을 열면 넓게)
        $('pluginPanel').classList.toggle('rail', !currentPlugin && !devOpen);
        const grid = h('div', { class: 'apps' });
        const entries = registry.slice();
        // registry 밖(개발 중 주소로 불러온) 플러그인도 홈에 보이게
        Object.keys(active).forEach(id => { if (!entries.some(e => e.id === id)) entries.push(entryOf(id)); });
        entries.forEach(e => {
            const on = !!active[e.id];
            const btn = h('button', { class: 'app-open', title: (e.description || e.name) + ' — 눌러서 열기' },
                h('span', { class: 'tile' }, appGlyph(e)),
                h('span', { class: 'name' }, e.name));
            const cell = h('div', { class: 'app' + (on ? ' on' : '') }, btn);
            btn.onclick = () => openApp(e, cell);
            // 아이콘 아래 켜기/끄기 — 화면을 열지 않고 플러그인만 켜고 끔 (그림·계산이 지도에 남거나 사라짐)
            const sw = h('input', { type: 'checkbox', checked: on, 'aria-label': e.name + ' 켜기' });
            sw.onchange = async () => {
                sw.disabled = true;
                try { if (sw.checked) await loadPlugin(e); else deactivatePlugin(e.id); }
                catch (err) { toast(err.message, 'error'); }
                renderLibrary();
            };
            cell.append(h('label', { class: 'switch', title: on ? '끄기' : '켜기' }, sw, h('span')));
            grid.append(cell);
        });
        const add = h('div', { class: 'app add' },
            h('button', { class: 'app-open', title: '개발 중 플러그인 불러오기', onclick: () => { devOpen = !devOpen; renderLibrary(); } },
                h('span', { class: 'tile' }, '+'), h('span', { class: 'name' }, '불러오기')));
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
        if (ev.touches('view') || ev.touches('site.origin') || ev.paths.includes('*')) applyMapLayers();
        if (ev.touches('site') || ev.touches('building') || ev.paths.includes('*')) renderViewButtons();
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
        // 모바일 독 — 데이터/플러그인 시트 중 하나만 열고, 열린 것을 다시 누르거나 × 로 닫아서 지도를 크게
        document.querySelectorAll('#dock [data-sheet]').forEach(b => {
            b.onclick = () => setSheet(document.body.dataset.sheet === b.getAttribute('data-sheet') ? '' : b.getAttribute('data-sheet'));
        });
        document.addEventListener('click', e => { if (e.target.closest('[data-close-sheet]')) setSheet(''); });
        setSheet(window.matchMedia('(max-width: 700px)').matches ? '' : 'data');   // 휴대폰은 지도부터
        // 지도만 보기 — 메뉴(도구막대·패널·독)를 모두 숨기고, 오른쪽 아래 '메뉴' 로 되돌림
        $('btnHideUI').onclick = () => { document.body.dataset.ui = 'hidden'; };
        $('showUI').onclick = () => { document.body.dataset.ui = ''; };

        Store.on(onProjectChange);
        syncForm(); renderMetrics(); showPlugin(null); renderViewButtons();
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
        applyMapLayers();
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
