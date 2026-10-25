// VWORLD API 래퍼 — 지오코딩, 연속지적도, 용도지역, 토지특성
// VWORLD REST API 는 fetch 시 CORS 헤더가 없어 브라우저가 막으므로 <script> 주입(JSONP, &callback=)으로 호출한다.
(function () {
    'use strict';
    const KEY = 'B5CEDD7D-84D6-314E-875C-9B5BF7E1233A'; // 지도·지오코더·데이터 API 공용 키 (massing 앱과 동일)
    const domain = () => encodeURIComponent(location.origin && location.origin !== 'null' ? location.origin : location.href);

    let seq = 0;
    function jsonpOnce(url, timeout) {
        return new Promise((resolve, reject) => {
            const cb = '__archhub_jsonp_' + (++seq) + '_' + Date.now();
            const script = document.createElement('script');
            const timer = setTimeout(() => { cleanup(); reject(new Error('JSONP 시간 초과')); }, timeout || 9000);
            function cleanup() {
                clearTimeout(timer);
                try { delete window[cb]; } catch (e) { window[cb] = undefined; }
                script.remove();
            }
            window[cb] = data => { cleanup(); resolve(data); };
            script.onerror = () => { cleanup(); reject(new Error('JSONP 로드 실패')); };
            script.src = url + (url.indexOf('?') === -1 ? '?' : '&') + 'callback=' + cb;
            document.head.appendChild(script);
        });
    }
    // 간헐적 실패에 대비해 재시도
    async function jsonp(url, opts) {
        const tries = (opts && opts.tries) || 3;
        let last;
        for (let i = 0; i < tries; i++) {
            try { return await jsonpOnce(url, opts && opts.timeout); }
            catch (e) { last = e; if (i < tries - 1) await new Promise(r => setTimeout(r, 400)); }
        }
        throw last;
    }

    // 주소 → 좌표. 도로명 → 지번 → (보조) OpenStreetMap 순으로 시도
    async function geocode(address) {
        for (const type of ['ROAD', 'PARCEL']) {
            try {
                const d = await jsonp('https://api.vworld.kr/req/address?service=address&request=getCoord&version=2.0' +
                    '&crs=EPSG:4326&type=' + type + '&address=' + encodeURIComponent(address) + '&format=json&key=' + KEY);
                const r = d.response;
                if (r && r.status === 'OK' && r.result && r.result.point) {
                    return { lon: +r.result.point.x, lat: +r.result.point.y, refined: (r.refined && r.refined.text) || address };
                }
            } catch (e) { console.warn('VWORLD 지오코딩 실패(' + type + '):', e); }
        }
        try {
            const res = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(address));
            const data = await res.json();
            if (data.length) return { lon: +data[0].lon, lat: +data[0].lat, refined: data[0].display_name };
        } catch (e) { console.warn('Nominatim 지오코딩 실패:', e); }
        return null;
    }

    // 데이터 API — geomFilter(WKT)에 걸리는 피처들 [{ geometry, props }]
    // geomFilter(WKT) 대신 { attrFilter: 'sig_cd:=:11440' } 처럼 속성 조건으로도 조회 가능
    async function features(layer, geomFilter, size) {
        const filter = (geomFilter && typeof geomFilter === 'object')
            ? '&attrFilter=' + encodeURIComponent(geomFilter.attrFilter)
            : '&geomFilter=' + geomFilter;
        const url = 'https://api.vworld.kr/req/data?service=data&version=2.0&request=GetFeature&format=json' +
            '&data=' + layer + '&key=' + KEY +
            filter + '&geometry=true&attribute=true&crs=EPSG:4326&size=' + (size || 10);
        let d = await jsonp(url + '&domain=' + domain());
        // 등록 도메인이 아니면(localhost 등) domain 값 때문에 INCORRECT_KEY → domain 없이 한 번 더
        if (d.response && d.response.error && d.response.error.code === 'INCORRECT_KEY') d = await jsonp(url);
        if (d.response && d.response.status === 'ERROR') throw new Error('VWORLD ' + layer + ': ' + (d.response.error && d.response.error.text));
        const fc = d.response && d.response.result && d.response.result.featureCollection;
        return (fc && fc.features || []).map(f => ({ geometry: f.geometry, props: f.properties || {} }));
    }
    async function featureAt(layer, lon, lat) {
        const list = await features(layer, 'POINT(' + lon + ' ' + lat + ')', 10);
        return list[0] || null;
    }

    // GeoJSON Polygon/MultiPolygon → 첫 외곽 링 [{lon,lat}] (닫는 점 제거)
    function outerRing(geom) {
        if (!geom || !geom.coordinates) return null;
        const c = geom.coordinates;
        const ring = geom.type === 'MultiPolygon' ? (c[0] && c[0][0]) : geom.type === 'Polygon' ? c[0] : null;
        if (!ring) return null;
        const pts = ring.map(p => ({ lon: +p[0], lat: +p[1] }));
        const f = pts[0], l = pts[pts.length - 1];
        if (pts.length > 1 && f.lon === l.lon && f.lat === l.lat) pts.pop();
        return pts;
    }

    // 좌표가 속한 필지 (연속지적도 LP_PA_CBND_BUBUN)
    async function parcelAt(lon, lat) {
        const f = await featureAt('LP_PA_CBND_BUBUN', lon, lat);
        if (!f) return null;
        return { ring: outerRing(f.geometry), jibun: f.props.addr || f.props.jibun || '', pnu: f.props.pnu || '', props: f.props };
    }

    // 용도지역 (도시지역 LT_C_UQ111 → 관리/농림/자연환경보전 LT_C_UQ112~114 순)
    async function zoningAt(lon, lat) {
        for (const layer of ['LT_C_UQ111', 'LT_C_UQ112', 'LT_C_UQ113', 'LT_C_UQ114']) {
            try {
                const f = await featureAt(layer, lon, lat);
                if (f && f.props.uname) return { name: f.props.uname, props: f.props, layer };
            } catch (e) { console.warn('용도지역 조회 실패(' + layer + '):', e); }
        }
        return null;
    }

    // 토지특성 (공부상 면적 lndpclAr, 용도지역 prposArea1Nm 등). 최신 기준연도 1건.
    async function landCharacteristics(pnu) {
        const url = 'https://api.vworld.kr/ned/data/getLandCharacteristics?key=' + KEY + '&pnu=' + pnu + '&format=json&numOfRows=20&pageNo=1';
        // 미등록 도메인에서 domain 값을 붙이면 JSONP 가 아닌 오류 응답이 옴 → 없이 먼저, 실패하면 붙여서
        let d;
        try { d = await jsonp(url, { tries: 2 }); }
        catch (e) { d = await jsonp(url + '&domain=' + domain(), { tries: 2 }); }
        const list = (d && d.landCharacteristicss && d.landCharacteristicss.field) || [];
        list.sort((a, b) => String(b.stdrYear).localeCompare(String(a.stdrYear)));
        return list[0] || null;
    }

    window.ArchVWorld = { KEY, jsonp, geocode, features, featureAt, outerRing, parcelAt, zoningAt, landCharacteristics };
})();
