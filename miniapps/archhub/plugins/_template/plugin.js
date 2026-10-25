// 플러그인 템플릿 — 이 폴더를 복사해서 이름을 바꾸고 시작하세요. (자세한 규칙: PLUGIN_GUIDE.md)
ArchHub.registerPlugin({
    id: 'template',                 // 영문 소문자·숫자·하이픈, 폴더 이름과 같게
    name: '플러그인 템플릿',
    version: '0.1.0',
    apiVersion: 1,
    // 메인 데이터 중 이 플러그인이 쓰는(바꾸는) 경로. 자기 데이터(plugins.template)는 선언 없이 쓸 수 있음.
    writes: [],

    activate(ctx) {
        const { h } = ctx.ui;
        const out = h('div', { class: 'sec' });
        ctx.panel.append(
            h('section', { class: 'sec' },
                h('h3', null, '템플릿'),
                h('p', { class: 'hint' }, '메인 데이터를 읽어 표시하고, 코어 위에 라벨을 띄우는 예제입니다.'),
                h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: () => {
                    ctx.data.update(d => ({ clicks: (d.clicks || 0) + 1 }));   // 자기 데이터 저장 → 프로젝트 파일에 함께 저장됨
                } }, '클릭 수 저장'))
            ),
            out
        );

        // 건물 좌표 레이어 — 건물을 옮기거나 돌려도 같이 따라감
        const layer = ctx.scene.layer('labels', { frame: 'building' });

        function render() {
            const b = ctx.project.get('building');
            const m = ctx.project.metrics();
            out.innerHTML = '';
            out.append(h('table', null,
                h('tr', null, h('td', null, '층수'), h('td', null, `지상 ${b.floorsAbove} / 지하 ${b.floorsBelow}`)),
                h('tr', null, h('td', null, '높이'), h('td', null, ctx.ui.fmt(m.height) + ' m')),
                h('tr', null, h('td', null, '코어 수'), h('td', null, b.cores.length)),
                h('tr', null, h('td', null, '저장된 클릭 수'), h('td', null, ctx.data.get().clicks || 0))
            ));
            layer.clear();
            b.cores.forEach(c => layer.label({ x: c.x, y: c.y, z: m.height + 6 }, c.id, { color: '#e0663a' }));
        }

        render();
        ctx.project.onChange(ev => {
            if (ev.touches('building') || ev.touches('plugins.' + ctx.id)) render();
        });

        // 끌 때 정리할 것이 있으면 여기서 (레이어·이벤트는 허브가 자동 정리)
        return { deactivate() { } };
    }
});
