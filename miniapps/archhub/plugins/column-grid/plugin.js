// 기둥 위치 스터디 — 건물 외곽 박스를 최대 스팬 이하로 균등 분할해 그리드를 만들고,
// 평면 안(경계 포함)이면서 코어 밖인 교점에 기둥을 둔다. 결과는 plugins.column-grid.columns 로 공유.
ArchHub.registerPlugin({
    id: 'column-grid',
    name: '기둥 위치 스터디',
    version: '0.1.0',
    apiVersion: 1,
    writes: [],

    activate(ctx) {
        const { h, fmt } = ctx.ui;
        const G = ctx.geo;
        const DEF = { maxSpanX: 8.4, maxSpanY: 8.4, size: 0.8, avoidCores: true, showGrid: true };
        const settings = () => Object.assign({}, DEF, ctx.data.get());

        const num = (key, label, unit, step) => h('label', { class: 'field' }, h('span', { class: 'k' }, label),
            h('input', { type: 'number', step: step || 0.1, min: 0.3, value: settings()[key],
                onchange: e => { const v = parseFloat(e.target.value); if (v > 0) save({ [key]: v }); } }),
            h('span', { class: 'u' }, unit));
        const check = (key, label) => h('label', { class: 'field' },
            h('input', { type: 'checkbox', checked: settings()[key], onchange: e => save({ [key]: e.target.checked }) }), label);

        const result = h('div');
        ctx.panel.append(
            h('section', { class: 'sec' }, h('h3', null, '그리드 설정'),
                num('maxSpanX', '최대 X 스팬', 'm'), num('maxSpanY', '최대 Y 스팬', 'm'), num('size', '기둥 크기', 'm', 0.05),
                check('avoidCores', ' 코어 안 기둥 제외'), check('showGrid', ' 그리드선·번호 표시'),
                h('p', { class: 'hint' }, '건물 좌표(건물 회전 기준) X·Y 방향으로 분할합니다.')),
            h('section', { class: 'sec' }, h('h3', null, '결과'), result)
        );

        const colLayer = ctx.scene.layer('columns', { frame: 'building' });
        const gridLayer = ctx.scene.layer('grid', { frame: 'building' });

        // 0..L 을 최대 span 이하로 균등 분할한 좌표들
        const divide = (min, max, span) => {
            const n = Math.max(1, Math.ceil((max - min) / span - 1e-6));
            return Array.from({ length: n + 1 }, (_, i) => min + (max - min) * i / n);
        };

        function compute() {
            const st = settings(), b = ctx.project.get('building');
            const fp = b.footprint;
            if (fp.length < 3) return null;
            const bb = G.bbox(fp);
            const xs = divide(bb.minX, bb.maxX, st.maxSpanX), ys = divide(bb.minY, bb.maxY, st.maxSpanY);
            const half = st.size / 2;
            const inCore = p => b.cores.some(c => Math.abs(p.x - c.x) < c.w / 2 + half && Math.abs(p.y - c.y) < c.d / 2 + half);
            const columns = [];
            xs.forEach((x, i) => ys.forEach((y, j) => {
                const p = { x: G.round(x, 3), y: G.round(y, 3) };
                if (!G.pointInPolyOrOn(p, fp, 0.01)) return;
                if (st.avoidCores && inCore(p)) return;
                columns.push(Object.assign(p, { grid: 'X' + (i + 1) + '-Y' + String.fromCharCode(65 + j) }));
            }));
            return { st, bb, xs, ys, columns, spanX: xs[1] - xs[0], spanY: ys[1] - ys[0] };
        }

        function save(patch) {
            ctx.data.set(Object.assign(settings(), patch));
            run();
        }

        function run() {
            const r = compute();
            colLayer.clear(); gridLayer.clear(); result.innerHTML = '';
            if (!r) { result.append(h('p', { class: 'hint' }, '건물 평면이 없습니다.')); return; }
            const levels = ctx.project.levels();
            const bottom = levels.length ? levels[0].z : 0;
            const top = ctx.project.metrics().height;
            r.columns.forEach(c => colLayer.extrude(G.rectAt(c.x, c.y, r.st.size, r.st.size),
                { base: bottom, height: top - bottom, color: '#3b5bdb', opacity: 1, outlineColor: '#1d2f80' }));
            if (r.st.showGrid) {
                const ext = 3;
                r.xs.forEach((x, i) => {
                    gridLayer.line([{ x, y: r.bb.minY - ext }, { x, y: r.bb.maxY + ext }], { z: 0.4, color: '#3b5bdb', width: 1 });
                    gridLayer.label({ x, y: r.bb.minY - ext - 1.5, z: 0.5 }, 'X' + (i + 1), { color: '#3b5bdb', size: 11 });
                });
                r.ys.forEach((y, j) => {
                    gridLayer.line([{ x: r.bb.minX - ext, y }, { x: r.bb.maxX + ext, y }], { z: 0.4, color: '#3b5bdb', width: 1 });
                    gridLayer.label({ x: r.bb.minX - ext - 1.5, y, z: 0.5 }, 'Y' + String.fromCharCode(65 + j), { color: '#3b5bdb', size: 11 });
                });
            }
            result.append(h('table', null,
                h('tr', null, h('td', null, '그리드'), h('td', null, (r.xs.length - 1) + ' × ' + (r.ys.length - 1) + ' 베이')),
                h('tr', null, h('td', null, 'X 스팬'), h('td', null, fmt(r.spanX, 2) + ' m')),
                h('tr', null, h('td', null, 'Y 스팬'), h('td', null, fmt(r.spanY, 2) + ' m')),
                h('tr', null, h('td', null, '기둥 수 (층당)'), h('td', null, r.columns.length + ' 개'))
            ));
            // 다른 플러그인(주차, 구조 등)이 읽을 수 있게 결과 저장 — 값이 바뀔 때만
            const prev = ctx.data.get();
            const out = { xs: r.xs, ys: r.ys, columns: r.columns.map(c => ({ x: c.x, y: c.y, grid: c.grid })) };
            if (JSON.stringify({ xs: prev.xs, ys: prev.ys, columns: prev.columns }) !== JSON.stringify(out)) {
                ctx.data.set(Object.assign(settings(), out));
                ctx.bus.emit('columns:changed', out);
            }
        }

        run();
        ctx.project.onChange(ev => { if (ev.source !== ctx.id && ev.touches('building')) run(); });
    }
});
