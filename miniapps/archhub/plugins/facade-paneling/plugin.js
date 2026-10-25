// 입면 패널링 — 매스 입면을 모듈 폭으로 가로 분할하고 층마다 패널을 나눔.
//  inner skin: 유리 + 테두리(프레임). 프레임 depth = 입면에서 바깥(법선) 방향 돌출, thickness = 입면 안에서의 폭.
//  outer skin: 수평·수직 루버. 프레임 바깥면(유리면 + 프레임 depth)에서 시작해 depth 만큼 바깥으로, thickness 는 루버 단면 폭.
//              위치 = 모듈 경계(수직: 좌우, 수평: 층 상하)를 포함해 모듈을 개수만큼 나눈 선.
//              개수 = 한 모듈(수직: 패널 폭, 수평: 층 높이)을 몇 칸으로 나누는지.
// 부재 수를 줄이려고 세로 부재(멀리언·수직 루버)는 건물 전체 높이로, 가로 부재(트랜섬·수평 루버)는 면 전체 길이로 한 덩어리씩 그림.
ArchHub.registerPlugin({
    id: 'facade-paneling',
    name: '입면 패널링',
    version: '0.1.0',
    apiVersion: 1,
    writes: [],

    activate(ctx) {
        const { h, fmt } = ctx.ui;
        const G = ctx.geo;
        const DEF = {
            module: 3.0,                                   // 모듈 폭 (m)
            roofScreen: true,                              // 옥상 위로 입면만 1개 층 더 (코어 가림)
            countScreen: false,                            // 옥상 입면을 집계(패널·수평 루버 수)에 넣을지
            frameDepth: 150, frameThick: 80,               // 프레임 depth / thickness (mm)
            frameColor: '#2c2c2e', glassColor: '#7fa3c4', glassOpacity: 45,
            hLouver: false, hDepth: 300, hThick: 50, hCount: 2,
            vLouver: true, vDepth: 400, vThick: 60, vCount: 2,
            louverColor: '#c9b48f'
        };
        const st = () => Object.assign({}, DEF, ctx.data.get());
        const save = patch => { ctx.data.set(Object.assign(st(), patch)); redraw(); };

        // ---------- UI ----------
        const s0 = st();
        const numRow = (label, key, unit, min, max, step) => {
            const range = h('input', { type: 'range', min, max, step, value: s0[key] });
            const box = h('input', { type: 'number', min, max, step, value: s0[key] });
            const set = v => { v = Math.min(max, Math.max(min, +v || 0)); range.value = box.value = v; save({ [key]: v }); };
            range.oninput = () => set(range.value);
            box.onchange = () => set(box.value);
            return h('label', { class: 'field fp-row' }, h('span', { class: 'k' }, label), range, box, h('span', { class: 'u' }, unit));
        };
        const colorRow = (label, key) => h('label', { class: 'field' }, h('span', { class: 'k' }, label),
            h('input', { type: 'color', value: s0[key], oninput: e => save({ [key]: e.target.value }) }));
        const check = (label, key) => h('label', { class: 'field' },
            h('input', { type: 'checkbox', checked: s0[key], onchange: e => save({ [key]: e.target.checked }) }), ' ' + label);
        const summary = h('div');

        ctx.panel.append(
            h('style', null, `
                .fp-row input[type=range]{ flex:1; min-width:60px; }
                .fp-row input[type=number]{ flex:0 0 64px; width:64px; }
                .plugin-panel input[type=color]{ width:44px; height:26px; border:0; padding:0; background:none; cursor:pointer; }
            `),
            h('section', { class: 'sec' }, h('h3', null, '모듈'),
                numRow('모듈 폭', 'module', 'm', 0.6, 9, 0.1),
                check('옥상 위 입면 1개 층 더 (슬라브 없이, 코어 가림)', 'roofScreen'),
                check('옥상 입면도 집계에 포함', 'countScreen'),
                h('p', { class: 'hint' }, '면마다 길이를 모듈 폭에 가장 가까운 개수로 똑같이 나눕니다. 층마다 가로로 한 번 더 나눕니다.')),
            h('section', { class: 'sec' }, h('h3', null, 'Inner skin — 프레임 · 유리'),
                numRow('프레임 깊이', 'frameDepth', 'mm', 0, 600, 10),
                numRow('프레임 두께', 'frameThick', 'mm', 0, 300, 5),
                colorRow('프레임 색', 'frameColor'),
                colorRow('유리 색', 'glassColor'),
                numRow('유리 투명', 'glassOpacity', '%', 5, 100, 5),
                h('p', { class: 'hint' }, '깊이 = 입면에서 바깥쪽으로 나온 정도, 두께 = 입면 안에서 테두리 폭')),
            h('section', { class: 'sec' }, h('h3', null, 'Outer skin — 루버'),
                check('수직 루버', 'vLouver'),
                numRow('깊이', 'vDepth', 'mm', 0, 1500, 10), numRow('두께', 'vThick', 'mm', 10, 300, 5), numRow('모듈 분할', 'vCount', '칸', 1, 12, 1),
                check('수평 루버', 'hLouver'),
                numRow('깊이', 'hDepth', 'mm', 0, 1500, 10), numRow('두께', 'hThick', 'mm', 10, 300, 5), numRow('층 분할', 'hCount', '칸', 1, 12, 1),
                colorRow('루버 색', 'louverColor'),
                h('p', { class: 'hint' }, '루버는 프레임 바깥면(유리면 + 프레임 깊이)에서 시작해 바깥으로 나갑니다. 모듈 경계(수직은 좌우, 수평은 층 상하)에 기본으로 놓이고, 분할 수만큼 그 사이를 나눕니다. 1칸 = 경계에만.')),
            h('section', { class: 'sec' }, h('h3', null, '집계'), summary)
        );

        const glassL = ctx.scene.layer('glass');
        const frameL = ctx.scene.layer('frame');
        const louverL = ctx.scene.layer('louver');

        // ---------- 형상 ----------
        // 면(변) 하나의 좌표계: A 에서 시작, t = 변 방향 단위벡터, n = 바깥 법선. 상자 = [u0,u1]×[o0,o1]×[z0,z1]
        function box(layer, f, u0, u1, o0, o1, z0, z1, style) {
            if (u1 - u0 < 0.005 || o1 - o0 < 0.003 || z1 - z0 < 0.005) return;
            const P = (u, o) => ({ x: f.a.x + f.t.x * u + f.n.x * o, y: f.a.y + f.t.y * u + f.n.y * o });
            layer.extrude([P(u0, o0), P(u1, o0), P(u1, o1), P(u0, o1)], Object.assign({ base: z0, height: z1 - z0, outline: false }, style));
        }

        let timer = null;
        function redraw() { clearTimeout(timer); timer = setTimeout(build, 120); }

        function build() {
            const s = st(), b = ctx.project.get('building');
            glassL.clear(); frameL.clear(); louverL.clear(); summary.innerHTML = '';
            const foot = G.ccw(b.footprint.map(p => G.toSite(p, b.placement)));
            const levels = ctx.project.levels().filter(l => l.index > 0);
            if (foot.length < 3 || !levels.length) { summary.append(h('p', { class: 'hint' }, '내 건물 매스가 없습니다.')); return; }
            // 옥상 입면: 슬라브 없이 입면만 기준층 1개 높이 더 올려 옥상 위로 솟은 코어를 가림 (허브가 코어를 기준층 1개 높이만큼 더 그림)
            const roofZ = levels[levels.length - 1].z + levels[levels.length - 1].height;
            if (s.roofScreen) levels.push({ name: '옥상 입면', index: levels.length + 1, z: roofZ, height: b.floorHeight, screen: true });
            const zTop = levels[levels.length - 1].z + levels[levels.length - 1].height;
            const mm = v => v / 1000;
            const fD = mm(s.frameDepth), fT = mm(s.frameThick);
            const G0 = 0.02, gT = 0.02;                 // 유리면 위치(매스 면에서 2cm 바깥 — 겹침 방지)와 유리 두께
            const lStart = G0 + gT + fD;                // 루버 시작면 = 프레임 바깥면
            const frameStyle = { color: s.frameColor, opacity: 1 };
            const glassStyle = { color: s.glassColor, opacity: s.glassOpacity / 100 };
            const louverStyle = { color: s.louverColor, opacity: 1 };
            let panels = 0, vCount = 0, hCount = 0;
            const rows = [];

            foot.forEach((a, i) => {
                const c = foot[(i + 1) % foot.length], L = G.dist(a, c);
                if (L < 0.3) return;
                const t = { x: (c.x - a.x) / L, y: (c.y - a.y) / L };
                const f = { a, t, n: { x: t.y, y: -t.x } };          // 반시계 폴리곤의 바깥 법선
                const n = Math.max(1, Math.round(L / s.module)), w = L / n;
                panels += n * levels.filter(l => !l.screen || s.countScreen).length;
                // 면 방위 (바깥 법선이 향하는 쪽, 정북 0°)
                const az = (Math.atan2(f.n.x, f.n.y) * 180 / Math.PI + 360) % 360;
                rows.push({ dir: ['북', '북동', '동', '남동', '남', '남서', '서', '북서'][Math.round(az / 45) % 8], L, n, w });

                // 유리 — 면 전체 한 장 (프레임이 위에서 나눔)
                box(glassL, f, 0, L, G0, G0 + gT, levels[0].z, zTop, glassStyle);

                // 프레임: 멀리언(세로, 분할선마다) + 트랜섬(가로, 층 경계마다), 두께 fT 를 선 중심에 둠
                if (fT > 0) {
                    const o0 = G0, o1 = G0 + gT + Math.max(fD, 0.005);
                    for (let k = 0; k <= n; k++) {
                        const u = k * w;
                        box(frameL, f, Math.max(0, u - fT / 2), Math.min(L, u + fT / 2), o0, o1, levels[0].z, zTop, frameStyle);
                    }
                    levels.concat([{ z: zTop }]).forEach(l => {
                        box(frameL, f, 0, L, o0, o1, Math.max(levels[0].z, l.z - fT / 2), Math.min(zTop, l.z + fT / 2), frameStyle);
                    });
                }

                // 수직 루버: 모듈 경계(좌우)를 포함해 모듈 폭을 vCount 칸으로 나눈 선마다 — 이웃 모듈과 겹치는 경계는 한 번만.
                //           1개 = 모듈 경계마다, 2개 = 경계 + 모듈 가운데 … 건물 전체 높이로 한 덩어리
                if (s.vLouver && s.vDepth > 0) {
                    const d = mm(s.vDepth), th = mm(s.vThick), k = Math.max(1, s.vCount);
                    for (let i = 0; i <= n * k; i++) {
                        const u = i * w / k;
                        box(louverL, f, Math.max(0, u - th / 2), Math.min(L, u + th / 2), lStart, lStart + d, levels[0].z, zTop, louverStyle);
                        vCount++;
                    }
                }
                // 수평 루버: 층 경계(상하)를 포함해 층 높이를 hCount 칸으로 나눈 선마다 — 위아래 층이 겹치는 경계는 한 번만.
                //           면 전체 길이로 한 덩어리
                if (s.hLouver && s.hDepth > 0) {
                    const d = mm(s.hDepth), th = mm(s.hThick), k = Math.max(1, s.hCount);
                    const zs = [];
                    levels.forEach(l => { for (let j = 0; j < k; j++) zs.push(l.z + j * l.height / k); });
                    zs.push(zTop);
                    zs.forEach(z => {
                        box(louverL, f, 0, L, lStart, lStart + d, Math.max(levels[0].z, z - th / 2), Math.min(zTop, z + th / 2), louverStyle);
                        if (s.countScreen || z <= roofZ + 1e-6) hCount++;   // 옥상 입면 위 루버는 기본적으로 집계 제외
                    });
                }
            });

            summary.append(
                h('table', null,
                    h('tr', null, h('td', null, h('b', null, '면')), h('td', null, h('b', null, '길이 · 분할 · 실제 모듈 폭'))),
                    ...rows.map(r => h('tr', null, h('td', null, r.dir), h('td', null, `${fmt(r.L, 2)}m · ${r.n}개 · ${fmt(r.w, 3)}m`))),
                    h('tr', null, h('td', null, '패널'), h('td', null, `${panels.toLocaleString('ko-KR')}장 (${levels.filter(l => !l.screen).length}개 층${s.roofScreen ? (s.countScreen ? ' + 옥상 입면' : ', 옥상 입면 제외') : ''})`)),
                    h('tr', null, h('td', null, '수직 루버'), h('td', null, s.vLouver ? vCount.toLocaleString('ko-KR') + '개 (전체 높이)' : '–')),
                    h('tr', null, h('td', null, '수평 루버'), h('td', null, s.hLouver ? hCount.toLocaleString('ko-KR') + '줄 (면 길이)' : '–'))),
                h('p', { class: 'hint', style: { marginTop: '6px' } }, `루버 시작면: 유리면에서 ${fmt((gT + fD) * 1000, 0)}mm 바깥`)
            );
        }

        build();
        ctx.project.onChange(ev => { if (ev.source !== ctx.id && ev.touches('building')) redraw(); });
    }
});
