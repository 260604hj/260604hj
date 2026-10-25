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
        description: '날짜·시각별 태양 위치와 건물 그림자, 동지 9~15시 누적 일영'
    },
    {
        id: 'template', name: '템플릿',
        src: 'plugins/_template/plugin.js',
        glyph: '<rect x="5" y="5" width="14" height="14" rx="3" stroke-dasharray="3 3"/>',
        description: '새 플러그인을 만들 때 복사해서 시작하는 최소 예제'
    }
]);
