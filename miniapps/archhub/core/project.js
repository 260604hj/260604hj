// Arch Hub 프로젝트 저장소 — 모든 플러그인이 공유하는 "건물 메인 데이터"
// 읽기: ArchProject.get('building.floorsAbove')   쓰기: ArchProject.set(path, value, source)
// 변경되면 on() 으로 등록한 함수가 { paths, source, touches(prefix) } 를 받음.
(function () {
    'use strict';
    const G = window.ArchGeom;
    const SCHEMA = 'archhub/1';
    const STORAGE_KEY = 'archhub.project.v1';

    function defaults() {
        return {
            schema: SCHEMA,
            meta: { name: '새 프로젝트', updatedAt: null },
            // 위치 — 좌표는 origin(위경도) 기준 로컬 미터
            site: {
                address: '',
                origin: null,          // { lon, lat } — 로컬 좌표 (0,0)
                boundary: [],          // 대지경계 [{x,y}] (대지 좌표, CCW)
                jibun: '',
                jimok: '',             // 지목 (대, 전, 답 …)
                pnu: '',
                area: 0,               // 대지면적 ㎡ (건폐율·용적률 분모)
                areaSource: '',        // '지적경계 계산' | '공부상 면적' | '직접 입력'
                zoning: null,          // { name, bcr, far, source } — 규모검토 플러그인 등이 채움
                neighbors: [],         // 도로를 뺀 인접 필지 [{ jibun, pnu, boundary:[{x,y}] }] (대지 좌표)
                showNeighbors: true,
                demolished: []         // 철거(숨김)한 기존 VWORLD 건물 TD_ID 목록
            },
            // 규모 · 형태 · 코어 — footprint 와 cores 는 "건물 좌표"(placement 기준)
            building: {
                floorsAbove: 10,
                floorsBelow: 2,
                groundFloorHeight: 4.5,
                floorHeight: 3.6,
                basementHeight: 4.0,
                placement: { x: 0, y: 0, rotation: 0 },
                // 건물 좌표(코어·기둥 그리드 등)의 기준축
                //  'site'   = 대지 장변에 맞춤 (회전 자동)
                //  'mass'   = 매스 주축에 맞춤 (대지경계 후퇴 형태는 최소 외접 직사각형 방향, 그 외 형태는 매스 회전 그대로)
                //  'manual' = placement.rotation 을 직접 입력
                axisMode: 'site',
                shape: { type: 'site', w: 30, d: 20, cutW: 10, cutD: 8, setback: 1.5 },
                footprint: [],         // shape 로부터 자동 생성 (type 'custom' 이면 그대로 유지)
                cores: [{ id: 'C1', x: 0, y: 0, w: 8, d: 10 }],
                coreRatio: 20,         // 코어비 % (코어 면적 합 ÷ 바닥면적)
                coreAuto: true         // true 면 코어 크기를 코어비에 맞춤 (각 코어의 중심·가로세로 비율은 유지)
            },
            // 플러그인별 개인 데이터 — plugins[pluginId]
            plugins: {}
        };
    }

    function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
    function deepMerge(base, src) {
        if (!isObj(src)) return base;
        Object.keys(src).forEach(k => {
            if (isObj(base[k]) && isObj(src[k])) deepMerge(base[k], src[k]);
            else base[k] = src[k];
        });
        return base;
    }
    const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    function getPath(obj, path) {
        if (!path) return obj;
        return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
    }
    function setPath(obj, path, val) {
        const keys = path.split('.');
        let o = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!isObj(o[keys[i]])) o[keys[i]] = {};
            o = o[keys[i]];
        }
        o[keys[keys.length - 1]] = val;
    }

    // shape → footprint 등 파생값 갱신
    function derive(s) {
        const b = s.building, sh = b.shape;
        const hasSite = s.site.boundary && s.site.boundary.length >= 3;
        // 기준축 — 대지 장변 맞춤은 모든 형태에 적용
        if (b.axisMode === 'site' && hasSite) b.placement.rotation = G.round(G.longestEdgeAngle(s.site.boundary), 2);
        if (G.shapes[sh.type]) {
            b.footprint = G.shapes[sh.type](sh);
        } else if (sh.type === 'site') {
            // 대지경계를 setback 만큼 후퇴한 형태. 건물 원점 = 매스 중심, 축 = 기준축 → 코어·그리드가 이 축을 따름
            const inner = hasSite ? G.inset(s.site.boundary, sh.setback || 0) : [];
            if (inner.length >= 3) {
                const c = G.centroid(inner);
                b.placement.x = G.round(c.x, 3); b.placement.y = G.round(c.y, 3);
                if (b.axisMode === 'mass') b.placement.rotation = G.round(G.mainAxisAngle(inner), 2);
                b.footprint = inner.map(p => G.toBuilding(p, b.placement));
            } else b.footprint = G.shapes.rect(sh);
        }
        b.footprint = G.ccw(b.footprint).map(p => ({ x: G.round(p.x, 3), y: G.round(p.y, 3) }));
        b.floorsAbove = Math.max(0, Math.round(b.floorsAbove));
        b.floorsBelow = Math.max(0, Math.round(b.floorsBelow));
        // 코어비 자동: 바닥면적 × 코어비 를 코어 수로 나눠 각 코어에 배분
        const A = G.area(b.footprint);
        if (b.coreAuto && A > 0 && b.cores.length) {
            const each = A * (b.coreRatio || 0) / 100 / b.cores.length;
            b.cores.forEach(c => {
                const aspect = (c.w > 0 && c.d > 0) ? c.w / c.d : 1;
                c.d = G.round(Math.sqrt(each / aspect), 2);
                c.w = G.round(c.d * aspect, 2);
            });
        }
    }

    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) return deepMerge(defaults(), JSON.parse(raw));
        } catch (e) { console.warn('저장된 프로젝트를 읽지 못함:', e); }
        return null;
    }

    let state = load() || defaults();
    derive(state);
    const listeners = new Set();
    let saveTimer = null;

    function scheduleSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
            catch (e) { console.warn('자동 저장 실패:', e); }
        }, 300);
    }

    function emit(paths, source) {
        const ev = {
            paths, source,
            // 이 변경이 prefix 경로(또는 그 하위/상위)를 건드렸는지
            touches(prefix) {
                return paths.some(p => p === '*' || p === prefix ||
                    p.startsWith(prefix + '.') || prefix.startsWith(p + '.'));
            }
        };
        listeners.forEach(fn => {
            try { fn(ev); } catch (e) { console.error('프로젝트 변경 처리 중 오류:', e); }
        });
    }

    const Store = {
        SCHEMA,
        defaults,
        get(path) { return clone(getPath(state, path)); },
        set(path, value, source) { Store.patch({ [path]: value }, source); },
        // 여러 경로를 한 번에 바꾸고 이벤트는 한 번만
        patch(changes, source) {
            const paths = Object.keys(changes);
            paths.forEach(p => setPath(state, p, clone(changes[p])));
            derive(state);
            state.meta.updatedAt = new Date().toISOString();
            scheduleSave();
            emit(paths, source || 'unknown');
        },
        replace(json, source) {
            if (!json || (json.schema && json.schema !== SCHEMA)) throw new Error('지원하지 않는 프로젝트 형식입니다: ' + (json && json.schema));
            state = deepMerge(defaults(), clone(json));
            derive(state);
            scheduleSave();
            emit(['*'], source || 'load');
        },
        reset() { Store.replace(defaults(), 'reset'); },
        toJSON() { return clone(state); },
        on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

        // 층 목록 — z 는 1층 바닥(0) 기준, 지하층은 음수
        levels() {
            const b = state.building, out = [];
            for (let i = b.floorsBelow; i >= 1; i--) {
                out.push({ name: 'B' + i, index: -i, z: -i * b.basementHeight, height: b.basementHeight });
            }
            let z = 0;
            for (let i = 1; i <= b.floorsAbove; i++) {
                const h = i === 1 ? b.groundFloorHeight : b.floorHeight;
                out.push({ name: i + 'F', index: i, z, height: h });
                z += h;
            }
            return out;
        },
        // 집계 — 현재는 모든 층이 같은 평면(footprint)이라고 가정
        metrics() {
            const s = state, b = s.building;
            const buildingArea = G.area(b.footprint);
            const height = b.floorsAbove ? b.groundFloorHeight + (b.floorsAbove - 1) * b.floorHeight : 0;
            const gfaAbove = buildingArea * b.floorsAbove;
            const gfaBelow = buildingArea * b.floorsBelow;
            const siteArea = s.site.area || 0;
            return {
                buildingArea, height, gfaAbove, gfaBelow, gfaTotal: gfaAbove + gfaBelow, siteArea,
                coreArea: b.cores.reduce((t, c) => t + c.w * c.d, 0),
                bcr: siteArea ? buildingArea / siteArea * 100 : null,   // 건폐율 %
                far: siteArea ? gfaAbove / siteArea * 100 : null        // 용적률 % (지상 연면적 기준)
            };
        }
    };

    window.ArchProject = Store;
})();
