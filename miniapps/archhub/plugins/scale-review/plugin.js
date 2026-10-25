// 규모검토 — 대지면적(공부상/경계계산), 용도지역별 건폐율·용적률 한도, 현재 매스 검토
ArchHub.registerPlugin({
    id: 'scale-review',
    name: '규모검토',
    version: '0.1.0',
    apiVersion: 1,
    writes: ['site.area', 'site.areaSource', 'site.zoning'],

    activate(ctx) {
        const { h, fmt, toast } = ctx.ui;
        const G = ctx.geo;

        // 국토의 계획 및 이용에 관한 법률 시행령 §84·§85 상한 (%). 실제 한도는 지자체 도시계획 조례가 더 낮을 수 있음.
        const ZONING_TABLE = {
            '제1종전용주거지역': { bcr: 50, far: 100 }, '제2종전용주거지역': { bcr: 50, far: 150 },
            '제1종일반주거지역': { bcr: 60, far: 200 }, '제2종일반주거지역': { bcr: 60, far: 250 },
            '제3종일반주거지역': { bcr: 50, far: 300 }, '준주거지역': { bcr: 70, far: 500 },
            '중심상업지역': { bcr: 90, far: 1500 }, '일반상업지역': { bcr: 80, far: 1300 },
            '근린상업지역': { bcr: 70, far: 900 }, '유통상업지역': { bcr: 80, far: 1100 },
            '전용공업지역': { bcr: 70, far: 300 }, '일반공업지역': { bcr: 70, far: 350 }, '준공업지역': { bcr: 70, far: 400 },
            '보전녹지지역': { bcr: 20, far: 80 }, '생산녹지지역': { bcr: 20, far: 100 }, '자연녹지지역': { bcr: 20, far: 100 },
            '보전관리지역': { bcr: 20, far: 80 }, '생산관리지역': { bcr: 20, far: 80 }, '계획관리지역': { bcr: 40, far: 100 },
            '농림지역': { bcr: 20, far: 80 }, '자연환경보전지역': { bcr: 20, far: 80 }
        };
        const lookupZone = name => {
            if (!name) return null;
            const key = Object.keys(ZONING_TABLE).find(k => name.replace(/\s/g, '').indexOf(k) !== -1);
            return key ? Object.assign({ name: key }, ZONING_TABLE[key]) : null;
        };

        const areaBox = h('div'), zoneBox = h('div'), checkBox = h('div');
        const setbackIn = h('input', { type: 'number', step: 0.1, min: 0, value: ctx.data.get().setback == null ? 0.5 : ctx.data.get().setback });
        ctx.panel.append(
            h('section', { class: 'sec' }, h('h3', null, '대지면적'), areaBox),
            h('section', { class: 'sec' }, h('h3', null, '용도지역 · 법정 한도'), zoneBox),
            h('section', { class: 'sec' }, h('h3', null, '검토'), checkBox),
            h('section', { class: 'sec' }, h('h3', null, '건축선 후퇴 표시'),
                h('label', { class: 'field' }, h('span', { class: 'k' }, '후퇴 거리'), setbackIn, h('span', { class: 'u' }, 'm')),
                h('p', { class: 'hint' }, '대지경계에서 일정 거리 안쪽 선을 보여줍니다 (대지안의 공지·건축선 검토용 근사).'))
        );
        setbackIn.onchange = () => { ctx.data.update(d => Object.assign(d, { setback: parseFloat(setbackIn.value) || 0 })); };

        const layer = ctx.scene.layer('setback');
        let busy = false;

        async function fetchOfficial() {
            const pnu = ctx.project.get('site.pnu');
            if (!pnu) return toast('PNU 가 없습니다. 왼쪽에서 주소를 먼저 검색하세요.');
            busy = true; render();
            try {
                const f = await ctx.vworld.landCharacteristics(pnu);
                if (!f) throw new Error('토지특성 자료가 없습니다');
                ctx.data.update(d => Object.assign(d, {
                    official: { pnu, area: parseFloat(f.lndpclAr), zone: f.prposArea1Nm || '', jimok: f.lndcgrCodeNm || '', year: f.stdrYear || '' }
                }));
                const area = parseFloat(f.lndpclAr);
                if (area > 0) ctx.project.patch({ 'site.area': area, 'site.areaSource': '공부상 면적 (토지특성 ' + (f.stdrYear || '') + ')' });
                if (!ctx.project.get('site.zoning') && f.prposArea1Nm) applyZone(f.prposArea1Nm, '토지특성');
                toast('공부상 면적을 반영했습니다');
            } catch (e) {
                toast('토지특성 조회 실패: ' + e.message + ' — 경계 계산값을 쓰거나 직접 입력하세요.', 'error');
            }
            busy = false; render();
        }

        async function fetchZone() {
            const o = ctx.project.get('site.origin');
            if (!o) return toast('먼저 대지를 불러오세요.');
            busy = true; render();
            try {
                const z = await ctx.vworld.zoningAt(o.lon, o.lat);
                if (!z) throw new Error('해당 위치의 용도지역을 찾지 못했습니다');
                applyZone(z.name, 'VWORLD 용도지역도');
            } catch (e) { toast(e.message, 'error'); }
            busy = false; render();
        }

        function applyZone(name, source) {
            const z = lookupZone(name);
            ctx.project.set('site.zoning', z
                ? { name: z.name, bcr: z.bcr, far: z.far, source: source + ' · 국토계획법 시행령 상한' }
                : { name, bcr: null, far: null, source });
        }

        function editLimit(key, v) {
            const z = ctx.project.get('site.zoning') || { name: '직접 입력' };
            z[key] = isFinite(v) ? v : null;
            z.source = '직접 입력 (조례 반영)';
            ctx.project.set('site.zoning', z);
        }

        // 조례는 특별시·광역시·특별자치시는 시, 그 외는 시·군 단위
        function ordinanceQuery() {
            const t = (ctx.project.get('site.address') || '').split(/\s+/);
            if (!t[0]) return '도시계획 조례';
            const city = /(특별시|광역시|특별자치시)$/.test(t[0]) || !t[1] ? t[0] : t[0] + ' ' + t[1];
            return city + ' 도시계획 조례';
        }

        function render() {
            const s = ctx.project.get('site'), m = ctx.project.metrics(), d = ctx.data.get();
            const boundaryArea = G.area(s.boundary);
            const off = d.official && d.official.pnu === s.pnu ? d.official : null; // 다른 대지의 조회값은 무시

            areaBox.innerHTML = '';
            areaBox.append(h('table', null,
                h('tr', null, h('td', null, '지번'), h('td', null, s.jibun || '–')),
                h('tr', null, h('td', null, '경계 계산값'), h('td', null, boundaryArea ? fmt(boundaryArea, 2) + ' ㎡' : '–')),
                h('tr', null, h('td', null, '공부상 면적'), h('td', null, off && off.area ? fmt(off.area, 2) + ' ㎡' : '–')),
                h('tr', null, h('td', null, h('b', null, '적용 대지면적')), h('td', null, h('b', null, s.area ? fmt(s.area, 2) + ' ㎡' : '–')))
            ), h('p', { class: 'hint' }, s.areaSource || ''),
            h('div', { class: 'row' },
                h('button', { class: 'btn', disabled: busy || !s.pnu, onclick: fetchOfficial }, '공부상 면적 조회'),
                h('button', { class: 'btn ghost', disabled: !boundaryArea, onclick: () => ctx.project.patch({ 'site.area': G.round(boundaryArea, 2), 'site.areaSource': '지적경계 계산값' }) }, '경계 계산값 적용')
            ));

            const z = s.zoning;
            const limIn = key => h('input', { type: 'number', step: 1, min: 0, value: z && z[key] != null ? z[key] : '',
                onchange: e => editLimit(key, parseFloat(e.target.value)) });
            zoneBox.innerHTML = '';
            zoneBox.append(
                h('p', { class: 'info' }, z ? h('b', null, z.name) : h('span', { class: 'muted' }, '아직 조회하지 않음')),
                h('div', { class: 'grid2' },
                    h('label', { class: 'field' }, h('span', { class: 'k' }, '건폐율'), limIn('bcr'), h('span', { class: 'u' }, '%')),
                    h('label', { class: 'field' }, h('span', { class: 'k' }, '용적률'), limIn('far'), h('span', { class: 'u' }, '%'))),
                h('p', { class: 'hint' }, (z && z.source ? z.source + '. ' : '') + '지자체 조례 한도가 더 낮으면 직접 고쳐 넣으세요.'),
                h('div', { class: 'row' },
                    h('button', { class: 'btn', disabled: busy || !s.origin, onclick: fetchZone }, '용도지역 조회'),
                    h('a', { class: 'btn ghost', target: '_blank', rel: 'noopener', style: { textDecoration: 'none' },
                        href: 'https://www.law.go.kr/LSW/ordinSc.do?menuId=3&query=' + encodeURIComponent(ordinanceQuery()) }, '조례 찾기 (법제처) ↗'))
            );

            checkBox.innerHTML = '';
            const bar = (v, max) => {
                const pct = max ? Math.min(100, v / max * 100) : 0;
                return h('div', { class: 'bar' + (max && v > max ? ' over' : '') }, h('i', { style: { width: pct + '%' } }));
            };
            if (!s.area) {
                checkBox.append(h('p', { class: 'hint' }, '대지면적이 있어야 검토할 수 있습니다.'));
            } else {
                const maxBA = z && z.bcr ? s.area * z.bcr / 100 : null;
                const maxGFA = z && z.far ? s.area * z.far / 100 : null;
                const maxFloors = maxGFA && m.buildingArea ? Math.floor(maxGFA / m.buildingArea) : null;
                const verdict = (v, max) => max == null ? '' : (v <= max ? ' ✓' : ' ✕ 초과');
                checkBox.append(
                    h('table', null,
                        h('tr', null, h('td', null, '건폐율'), h('td', null, fmt(m.bcr) + '%' + (z && z.bcr ? ' / ' + z.bcr + '%' : '') + verdict(m.bcr, z && z.bcr)))),
                    bar(m.bcr, z && z.bcr),
                    h('table', null,
                        h('tr', null, h('td', null, '용적률'), h('td', null, fmt(m.far) + '%' + (z && z.far ? ' / ' + z.far + '%' : '') + verdict(m.far, z && z.far)))),
                    bar(m.far, z && z.far),
                    h('table', null,
                        h('tr', null, h('td', null, '최대 건축면적'), h('td', null, maxBA ? fmt(maxBA) + ' ㎡' : '–')),
                        h('tr', null, h('td', null, '최대 연면적(지상)'), h('td', null, maxGFA ? fmt(maxGFA) + ' ㎡' : '–')),
                        h('tr', null, h('td', null, '현 평면으로 가능한 층수'), h('td', null, maxFloors != null ? maxFloors + '층' : '–')),
                        h('tr', null, h('td', null, '현재 지상 층수'), h('td', null, ctx.project.get('building.floorsAbove') + '층'))
                    ),
                    h('p', { class: 'hint', style: { marginTop: '8px' } }, '용적률은 지상 연면적 ÷ 대지면적으로 근사 (지하·주차·피난안전구역 등 제외 항목 미반영).')
                );
            }

            layer.clear();
            const sb = d.setback == null ? 0.5 : d.setback;
            if (s.boundary.length >= 3 && sb > 0) {
                const inner = G.inset(s.boundary, sb);
                if (inner.length >= 3) layer.line(inner, { z: 0.35, color: '#2f6fd6', mapColor: '#64d2ff', width: 2, closed: true, ground: true });
            }
        }

        render();
        ctx.project.onChange(ev => {
            if (ev.touches('site') || ev.touches('building') || ev.touches('plugins.' + ctx.id)) render();
        });
    }
});
