// 3D 뷰 백엔드 ① — VWORLD WebGL 3.0 지도 (내부는 Cesium). 실제 지형·항공사진·주변 건물 위에 그린다.
(function () {
    'use strict';
    const G = window.ArchGeom;
    const DEFAULT_ORIGIN = { lon: 126.9779692, lat: 37.566535 }; // 서울시청

    function hideFooter() {
        document.querySelectorAll('#footer3d, .apifooter, .cesium-viewer-bottom').forEach(el => { el.style.display = 'none'; });
    }

    async function create(container, opts) {
        if (typeof vw === 'undefined' || !vw.Map) throw new Error('VWORLD 지도 스크립트를 불러오지 못했습니다');
        const origin0 = (opts && opts.origin) || DEFAULT_ORIGIN;
        const map = new vw.Map();
        map.setOption({
            mapId: container.id,
            initPosition: new vw.CameraPosition(new vw.CoordZ(origin0.lon, origin0.lat, 900), new vw.Direction(0, -55, 0))
        });
        map.start();
        // Cesium Viewer 가 준비될 때까지 대기
        const viewer = await new Promise((resolve, reject) => {
            const t0 = Date.now();
            (function poll() {
                if (map._wsViewer && window.Cesium) return resolve(map._wsViewer);
                if (Date.now() - t0 > 12000) return reject(new Error('VWORLD 3D 지도 초기화 시간 초과'));
                setTimeout(poll, 200);
            })();
        });
        // VWORLD 기본 라벨(건물명·지명·행정경계 이름)과 화면 컨트롤 끄기 — 허브의 떠 있는 패널과 겹치지 않게
        const LABEL_LAYERS = ['poi_base', 'poi_bound', 'hybrid_bound'];
        function cleanMap() {
            hideFooter();
            LABEL_LAYERS.forEach(id => { try { const e = map.getLayerElement(id); if (e && e.visible !== false) e.hide(); } catch (e) { /* 아직 없음 */ } });
            try { map.setNavigationZoomVisible(false); } catch (e) { /* 무시 */ }
            try { map.setLogoVisible(false); } catch (e) { /* 무시 */ }
        }
        cleanMap();
        [800, 2000, 5000].forEach(ms => setTimeout(cleanMap, ms));   // 레이어가 늦게 올라오는 경우
        const C = window.Cesium;

        let origin = origin0, groundH = 0, lastBBox = null;
        let touched = false;        // 사용자가 지도를 직접 움직였는지
        let pendingView = null;     // 다른 뷰에서 넘겨받은 시점 (사용자가 움직이기 전까지 유지)
        const sampleGround = () => {
            try {
                const h = viewer.scene.globe.getHeight(C.Cartographic.fromDegrees(origin.lon, origin.lat));
                return (h == null || isNaN(h)) ? null : h;
            } catch (e) { return null; }
        };
        // 화면에 보이는 지형 타일은 해상도가 낮아 높이가 크게 틀릴 수 있음 → 가장 정밀한 지형으로 다시 샘플링
        const setGround = h => {
            if (h != null && isFinite(h) && Math.abs(h - groundH) > 0.2) {
                groundH = h;
                if (pendingView && !touched) applyView(pendingView);   // 바닥 높이 기준 시점이라 다시 맞춤
                opts && opts.onGroundChange && opts.onGroundChange();
            }
        };
        function refineGround() {
            const o = origin;
            const tp = viewer.terrainProvider;
            if (!tp) return;
            const pts = [C.Cartographic.fromDegrees(o.lon, o.lat)];
            // VWORLD 지형은 availability 정보가 없어 MostDetailed 가 안 됨 → 고정 레벨(14 ≈ 10m 격자)로 샘플링
            Promise.resolve(tp.readyPromise).then(() => tp.availability ? C.sampleTerrainMostDetailed(tp, pts) : C.sampleTerrain(tp, 14, pts))
                .then(r => { if (o === origin) setGround(r[0].height); })
                .catch(e => console.warn('지형 높이 샘플링 실패:', e));
        }

        // VWORLD 는 requestRenderMode 로 돌아가서, 직접 카메라를 옮기거나 그리면 타일이 안 들어옴 → 몇 초간 렌더 요청
        let pumpUntil = 0, pumping = false;
        function kick(ms) {
            pumpUntil = Math.max(pumpUntil, Date.now() + (ms || 3000));
            if (pumping) return;
            pumping = true;
            (function loop() {
                viewer.scene.requestRender();
                const now = Date.now();
                const more = now < pumpUntil || (!viewer.scene.globe.tilesLoaded && now < pumpUntil + 15000);
                if (more) setTimeout(loop, 100); else pumping = false;
            })();
        }

        // ---- 기존 건물 철거(숨김) — VWORLD 3차원 건물 타일셋에 TD_ID 기준 show 조건을 건다 ----
        let demolished = [];
        function buildingTilesets() {
            const out = [];
            (function walk(c) {
                for (let i = 0; i < c.length; i++) {
                    const p = c.get(i);
                    if (p instanceof C.Cesium3DTileset) { if (!/\/poi\//i.test(p.resource && p.resource.url || '')) out.push(p); }
                    else if (p && typeof p.get === 'function' && p.length != null) walk(p);
                }
            })(viewer.scene.primitives);
            return out;
        }
        // 건물 스타일 = 철거(show 조건) + 재질 끄기(텍스처 대신 흰색으로 덮음)
        let noTexture = false;
        function applyDemolished() {
            const spec = {};
            if (demolished.length) spec.show = { conditions: demolished.map(id => ["${TD_ID} === '" + String(id).replace(/'/g, '') + "'", 'false']).concat([['true', 'true']]) };
            if (noTexture) spec.color = "color('#f2f2f0')";
            const style = Object.keys(spec).length ? new C.Cesium3DTileStyle(spec) : undefined;
            buildingTilesets().forEach(t => {
                t.style = style;
                t.colorBlendMode = noTexture ? C.Cesium3DTileColorBlendMode.REPLACE : C.Cesium3DTileColorBlendMode.HIGHLIGHT;
            });
            kick(1500);
        }
        // 건물 타일셋이 늦게 올라오면 그때 다시 적용
        [1500, 4000, 8000].forEach(ms => setTimeout(() => { if (demolished.length || noTexture) applyDemolished(); if (noTexture) setImagery(false); }, ms));

        // 항공사진(바탕 영상) — VWORLD 영상 타일(Layer=tile)과 지구 바탕(BlueMarble). 끄면 지면을 밝은 회색으로.
        // VWORLD 가 바탕 영상을 늦게 붙이므로 끌 때마다 주소로 찾음 (용도지역 WMS 등 다른 영상은 그대로)
        const baseColor0 = viewer.scene.globe.baseColor;
        const isBaseImagery = l => {
            const p = l.imageryProvider || {};
            const url = String(p.url || p._url || (p._resource && p._resource.url) || '');
            return /BlueMarble|[?&]Layer=tile(&|$)/.test(url);
        };
        function setImagery(on) {
            for (let i = 0; i < viewer.imageryLayers.length; i++) {
                const l = viewer.imageryLayers.get(i);
                if (isBaseImagery(l)) l.show = on;
            }
            viewer.scene.globe.baseColor = on ? baseColor0 : C.Color.fromCssColorString('#e8e8e5');
            kick(1500);
        }

        // 용도지역 — VWORLD 지도에 들어 있는 용도지역 WMS 레이어(도시·관리·농림·자연환경보전)
        const ZONING_LAYERS = ['lt_c_uq111', 'lt_c_uq112', 'lt_c_uq113', 'lt_c_uq114'];
        function setZoning(on) {
            ZONING_LAYERS.forEach(id => {
                // 이미 같은 상태면 건드리지 않음 (VWORLD 는 안 켜진 레이어를 hide 하면 내부에서 오류)
                try { const e = map.getLayerElement(id); if (e && !!e.visible !== on) { if (on) e.show(); else e.hide(); } }
                catch (err) { console.warn('용도지역 레이어 전환 실패(' + id + '):', err); }
            });
            kick(3000);
        }
        const featureId = f => (f instanceof C.Cesium3DTileFeature && f.getProperty('TD_ID')) || null;
        // 지도 클릭 → 건물 한 동 철거/복원 (허브가 프로젝트 데이터로 관리)
        new C.ScreenSpaceEventHandler(viewer.scene.canvas).setInputAction(ev => {
            const id = featureId(viewer.scene.pick(ev.position));
            if (id && opts && opts.onBuildingClick) opts.onBuildingClick(id);
        }, C.ScreenSpaceEventType.LEFT_CLICK);

        const color = (css, a) => C.Color.fromCssColorString(css).withAlpha(a == null ? 1 : a);
        const ll = p => G.xyToLonLat(origin, p.x, p.y);
        const flat2 = poly => { const a = []; poly.forEach(p => { const q = ll(p); a.push(q.lon, q.lat); }); return a; };
        const pos3 = p => { const q = ll(p); return C.Cartesian3.fromDegrees(q.lon, q.lat, groundH + (p.z || 0)); };

        const backend = {
            kind: 'vworld',
            viewer, map,   // 디버깅·고급 용도 (플러그인은 쓰지 말 것)
            groundHeight: () => groundH,
            draw(kind, s) {
                kick(800);
                if (kind === 'extrude') {
                    return viewer.entities.add({ polygon: {
                        hierarchy: C.Cartesian3.fromDegreesArray(flat2(s.poly)),
                        height: groundH + s.base, extrudedHeight: groundH + s.base + s.height,
                        material: color(s.color, s.opacity),
                        outline: s.outline, outlineColor: color(s.outlineColor, 0.9)
                    } });
                }
                if (kind === 'polygon') {
                    return viewer.entities.add({ polygon: {
                        hierarchy: C.Cartesian3.fromDegreesArray(flat2(s.poly)),
                        height: groundH + s.z, material: color(s.color, s.opacity)
                    } });
                }
                if (kind === 'line' && s.ground) {
                    // 땅 선(대지·필지 경계): 지형·건물에 가려진 부분도 조금 흐리게 비쳐 보이게 그려서 항상 보이도록
                    const pts = s.points.map(pos3);
                    if (s.closed && pts.length) pts.push(pts[0]);
                    const c = s.mapColor || s.color;
                    return viewer.entities.add({ polyline: {
                        positions: pts, width: s.width,
                        material: color(c, s.opacity),
                        depthFailMaterial: color(c, s.opacity * 0.55)
                    } });
                }
                if (kind === 'line') {
                    const pts = s.points.map(pos3);
                    if (s.closed && pts.length) pts.push(pts[0]);
                    return viewer.entities.add({ polyline: { positions: pts, width: s.width, material: color(s.color, 1) } });
                }
                if (kind === 'label') {
                    return viewer.entities.add({ position: pos3(s.pos), label: {
                        text: s.text, font: '600 ' + s.size + 'px sans-serif',
                        fillColor: s.dark ? color(s.color, 1) : C.Color.WHITE, outlineColor: s.dark ? C.Color.WHITE : color(s.color, 1), outlineWidth: s.dark ? 4 : 3,
                        style: C.LabelStyle.FILL_AND_OUTLINE, disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        distanceDisplayCondition: s.maxDistance ? new C.DistanceDisplayCondition(0, s.maxDistance) : undefined
                    } });
                }
                if (kind === 'point') {
                    return viewer.entities.add({ position: pos3(s.pos), point: {
                        pixelSize: s.size, color: color(s.color, 1), outlineColor: color(s.outlineColor, 1), outlineWidth: s.outlineWidth,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY
                    } });
                }
            },
            remove(e) { viewer.entities.remove(e); },
            render: () => kick(800),
            setOrigin(o) {
                origin = o || DEFAULT_ORIGIN;
                const h = sampleGround(); if (h != null) groundH = h;
                backend.focus(lastBBox);
                refineGround();
                setTimeout(refineGround, 3000);   // 지형 공급자가 늦게 준비되는 경우
            },
            // 시점 = 대지 좌표 위치(바닥 기준 z) + 방위(heading, 정북 0 시계방향) + 기울기(pitch) + 세로 화각
            getView() {
                const cam = viewer.camera, c = C.Cartographic.fromCartesian(cam.positionWC);
                const p = G.lonLatToXY(origin, C.Math.toDegrees(c.longitude), C.Math.toDegrees(c.latitude));
                return { x: p.x, y: p.y, z: c.height - groundH, heading: cam.heading, pitch: cam.pitch, fovy: cam.frustum.fovy };
            },
            setView(v) { pendingView = v; applyView(v); },
            setDemolished(ids) { demolished = (ids || []).slice(); applyDemolished(); },
            setLayers(o) {
                const wantNoTexture = o.texture === false;
                if (wantNoTexture !== noTexture) { noTexture = wantNoTexture; applyDemolished(); setImagery(!noTexture); }
                setZoning(!!o.zoning);
            },
            // 폴리곤(대지 좌표) 안쪽을 격자로 훑어 위에서 수직으로 찔러 맞는 건물 TD_ID 목록 (지도에 보이는 타일 기준)
            async findBuildingsIn(poly) {
                const bb = G.bbox(poly);
                const step = Math.max(3, Math.min(12, Math.sqrt(G.area(poly)) / 12));
                const found = new Set();
                let n = 0;
                const saved = demolished; demolished = []; applyDemolished();   // 이미 철거한 것도 다시 찾도록 잠시 보이게
                // 건물 타일이 다 들어올 때까지 (최대 10초) 기다림 — 안 들어온 타일은 광선에 안 맞음
                kick(10000);
                const t0 = Date.now();
                while (Date.now() - t0 < 10000 && !buildingTilesets().every(t => t.tilesLoaded)) await new Promise(r => setTimeout(r, 250));
                // 허브가 그린 매스·층이 광선을 먼저 막지 않게 잠시 숨김 (엔티티는 다음 갱신 때 반영되므로 바로 갱신)
                viewer.entities.show = false;
                viewer.dataSourceDisplay.update(viewer.clock.currentTime);
                for (let x = bb.minX + step / 2; x < bb.maxX; x += step) {
                    for (let y = bb.minY + step / 2; y < bb.maxY; y += step) {
                        if (!G.pointInPoly({ x, y }, poly)) continue;
                        const q = G.xyToLonLat(origin, x, y);
                        const top = C.Cartesian3.fromDegrees(q.lon, q.lat, groundH + 1000);
                        const dir = C.Cartesian3.normalize(C.Cartesian3.subtract(C.Cartesian3.fromDegrees(q.lon, q.lat, groundH - 50), top, new C.Cartesian3()), new C.Cartesian3());
                        try {
                            (viewer.scene.drillPickFromRay(new C.Ray(top, dir), 3) || []).forEach(r => { const id = r && featureId(r.object); if (id) found.add(id); });
                        } catch (e) { console.warn('건물 찾기 실패:', e); }
                        n++;
                    }
                }
                viewer.entities.show = true;
                viewer.dataSourceDisplay.update(viewer.clock.currentTime);
                demolished = saved; applyDemolished();
                return Array.from(found);
            },
            // 대지 남쪽 상공에서 북쪽을 내려다보도록 (카메라가 대지를 정면으로 바라봄)
            focus(bbox) {
                pendingView = null;
                lastBBox = bbox || null;
                const size = bbox ? Math.max(bbox.w, bbox.h, 30) : 60;
                const alt = size * 2.2, pitch = 40;
                const back = alt / Math.tan(pitch * Math.PI / 180);
                const c = bbox ? { x: bbox.cx, y: bbox.cy } : { x: 0, y: 0 };
                const cam = G.xyToLonLat(origin, c.x, c.y - back);
                // flyTo 는 VWORLD 자체 비행과 겹치면 중간에 멈춰버림 → 진행 중 비행을 끊고 즉시 이동
                viewer.camera.cancelFlight();
                viewer.camera.setView({
                    destination: C.Cartesian3.fromDegrees(cam.lon, cam.lat, groundH + alt),
                    orientation: { heading: 0, pitch: C.Math.toRadians(-pitch), roll: 0 }
                });
                kick(4000);
            },
            show(on) { container.style.display = on ? '' : 'none'; }
        };
        function applyView(v) {
            const q = G.xyToLonLat(origin, v.x, v.y);
            // 화각도 맞춤 — Cesium 의 fov 는 화면의 긴 쪽 기준
            if (v.fovy) {
                const f = viewer.camera.frustum, a = container.clientWidth / Math.max(1, container.clientHeight);
                f.fov = a >= 1 ? 2 * Math.atan(Math.tan(v.fovy / 2) * a) : v.fovy;
            }
            viewer.camera.cancelFlight();
            viewer.camera.setView({
                destination: C.Cartesian3.fromDegrees(q.lon, q.lat, groundH + v.z),
                orientation: { heading: v.heading, pitch: v.pitch, roll: 0 }
            });
            kick(4000);
        }

        backend.setOrigin(origin0);
        // VWORLD 가 시작할 때 자체 카메라 이동을 하므로, 사용자가 조작하기 전이라면 몇 번 더 맞춤
        ['pointerdown', 'wheel', 'touchstart'].forEach(t => container.addEventListener(t, () => { touched = true; pendingView = null; }, { capture: true }));
        [1500, 3500, 6000].forEach(ms => setTimeout(() => {
            if (touched) return;
            if (pendingView) applyView(pendingView); else backend.focus(lastBBox);
        }, ms));
        return backend;
    }

    window.ArchViewers = window.ArchViewers || {};
    window.ArchViewers.vworld = { label: 'VWORLD 3D', create };
})();
