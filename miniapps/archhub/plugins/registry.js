// 플러그인 목록 — 새 플러그인을 만들면 여기에 한 줄 추가 (id 는 플러그인 파일 안의 id 와 같아야 함)
// glyph: 홈 화면 아이콘 — 24×24 좌표의 SVG 선 그림(안쪽 마크업만). 없으면 이름 첫 글자가 아이콘이 됨.
ArchHub.setRegistry([
    {
        id: 'seoul-screening', name: '대지 스크리닝',
        src: 'plugins/seoul-screening/plugin.js',
        glyph: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/><path d="M8 10.5h5M10.5 8v5"/>',
        description: '서울의 구·필지 크기·용도지역 조건으로 필지 1개를 무작위 추천'
    },
    {
        id: 'scale-review', name: '규모검토',
        src: 'plugins/scale-review/plugin.js',
        glyph: '<path d="M4 5h16v14H4z"/><path d="M8 9h6v6H8z"/><path d="M4 19l4-4M14 9l6-4"/>',
        description: 'VWORLD 토지특성·용도지역으로 대지면적과 건폐율·용적률 한도를 찾아 현재 매스를 검토'
    },
    {
        id: 'column-grid', name: '기둥 스터디',
        src: 'plugins/column-grid/plugin.js',
        glyph: '<path d="M4 4v16M12 4v16M20 4v16M4 4h16M4 12h16M4 20h16"/><rect x="10.5" y="10.5" width="3" height="3" fill="currentColor"/>',
        description: '최대 스팬으로 기둥 그리드를 균등 분할해 평면 안에 배치 (코어 회피)'
    },
    {
        id: 'sun-study', name: '일조',
        src: 'plugins/sun-study/plugin.js',
        glyph: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
        description: '고른 인접 건물이 내 건물 입면에 드리우는 그림자 — 층별 일조시간 분석'
    },
    {
        id: 'facade-paneling', name: '입면 패널링',
        src: 'plugins/facade-paneling/plugin.js',
        glyph: '<rect x="4" y="3.5" width="16" height="17" rx="1"/><path d="M9.3 3.5v17M14.7 3.5v17M4 9.2h16M4 14.8h16"/>',
        description: '모듈 폭으로 입면을 나눠 층별 패널(프레임·유리)과 수평·수직 루버를 만듦'
    }
]);
// 새 플러그인은 plugins/_template 를 복사해서 시작 (목록에는 넣지 않음, PLUGIN_GUIDE.md 참고)
