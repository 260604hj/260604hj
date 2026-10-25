// 3D 뷰 백엔드 ② — 간이 3D (Three.js). VWORLD 를 못 쓰는 환경(오프라인, 미등록 도메인)용.
// 좌표 변환: 대지 (x 동, y 북, z 위) → Three (x, z, -y)
(function () {
    'use strict';
    const G = window.ArchGeom;
    const LIBS = [
        'https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js',
        'https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/controls/OrbitControls.js'
    ];

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('스크립트 로드 실패: ' + src));
            document.head.appendChild(s);
        });
    }

    async function create(container) {
        if (!window.THREE) { for (const src of LIBS) await loadScript(src); }
        const T = window.THREE;

        const renderer = new T.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });   // 수 km 노선과 가까운 매스를 함께 그려도 깊이 오차 없게
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        container.appendChild(renderer.domElement);
        const scene = new T.Scene();
        scene.background = new T.Color('#eceff1');
        const camera = new T.PerspectiveCamera(40, 1, 0.5, 80000);
        camera.position.set(70, 80, 90);
        const controls = new T.OrbitControls(camera, renderer.domElement);
        controls.target.set(0, 10, 0);
        controls.maxPolarAngle = Math.PI / 2 - 0.02;

        scene.add(new T.HemisphereLight(0xffffff, 0x8a8f98, 0.85));
        const sun = new T.DirectionalLight(0xffffff, 0.6);
        sun.position.set(-60, 120, 80);
        scene.add(sun);
        const grid = new T.GridHelper(400, 40, 0xb8bec6, 0xd6dade);
        scene.add(grid);
        const ground = new T.Mesh(new T.PlaneGeometry(400, 400), new T.MeshLambertMaterial({ color: 0xf4f5f6 }));
        ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02;
        scene.add(ground);

        let pending = false;
        const render = () => {
            if (pending) return;
            pending = true;
            requestAnimationFrame(() => { pending = false; renderer.render(scene, camera); });
        };
        controls.addEventListener('change', render);
        function resize() {
            const w = container.clientWidth || 1, h = container.clientHeight || 1;
            renderer.setSize(w, h, false);
            renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
            camera.aspect = w / h; camera.updateProjectionMatrix(); render();
        }
        new ResizeObserver(resize).observe(container);
        resize();

        const v3 = p => new T.Vector3(p.x, p.z || 0, -p.y);
        const shapeOf = poly => new T.Shape(poly.map(p => new T.Vector2(p.x, p.y)));
        const mat = (color, opacity, extra) => new T.MeshLambertMaterial(Object.assign({
            color, transparent: opacity < 1, opacity, side: T.DoubleSide, depthWrite: opacity >= 1
        }, extra));

        function textSprite(text, color, size) {
            const pad = 6, fs = 28;
            const c = document.createElement('canvas'), g = c.getContext('2d');
            g.font = '600 ' + fs + 'px sans-serif';
            c.width = Math.ceil(g.measureText(text).width) + pad * 2; c.height = fs + pad * 2;
            g.font = '600 ' + fs + 'px sans-serif';
            g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(0, 0, c.width, c.height);
            g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, pad, c.height / 2);
            const tex = new T.CanvasTexture(c);
            const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false }));
            const k = size / 13 * 0.09;
            sp.scale.set(c.width * k, c.height * k, 1);
            sp.renderOrder = 10;
            return sp;
        }

        // 화면 크기가 일정한 점 (멀리 있어도 같은 픽셀 크기)
        function dotSprite(fill, stroke, size) {
            const c = document.createElement('canvas'), g = c.getContext('2d');
            c.width = c.height = 64;
            g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2);
            g.fillStyle = fill; g.fill(); g.lineWidth = 8; g.strokeStyle = stroke; g.stroke();
            const sp = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), depthTest: false, sizeAttenuation: false }));
            const k = size / Math.max(1, container.clientHeight) * 1.2;
            sp.scale.set(k, k, 1);
            sp.renderOrder = 11;
            return sp;
        }

        const backend = {
            kind: 'three',
            draw(kind, s) {
                let obj;
                if (kind === 'extrude') {
                    const geo = new T.ExtrudeGeometry(shapeOf(s.poly), { depth: s.height, bevelEnabled: false });
                    geo.rotateX(-Math.PI / 2); geo.translate(0, s.base, 0);
                    obj = new T.Group();
                    obj.add(new T.Mesh(geo, mat(s.color, s.opacity, { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })));
                    if (s.outline) obj.add(new T.LineSegments(new T.EdgesGeometry(geo, 20), new T.LineBasicMaterial({ color: s.outlineColor, transparent: true, opacity: 0.6 })));
                } else if (kind === 'polygon') {
                    const geo = new T.ShapeGeometry(shapeOf(s.poly));
                    geo.rotateX(-Math.PI / 2); geo.translate(0, s.z, 0);
                    obj = new T.Mesh(geo, mat(s.color, s.opacity, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
                } else if (kind === 'line') {
                    const geo = new T.BufferGeometry().setFromPoints(s.points.map(v3));
                    const m = new T.LineBasicMaterial({ color: s.color });
                    obj = s.closed ? new T.LineLoop(geo, m) : new T.Line(geo, m);
                } else if (kind === 'label') {
                    obj = textSprite(s.text, s.color, s.size);
                    obj.position.copy(v3(s.pos));
                } else if (kind === 'point') {
                    obj = dotSprite(s.color, s.outlineColor, s.size);
                    obj.position.copy(v3(s.pos));
                }
                if (obj) { scene.add(obj); render(); }
                return obj;
            },
            remove(obj) {
                scene.remove(obj);
                obj.traverse(o => {
                    if (o.geometry) o.geometry.dispose();
                    if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
                });
                render();
            },
            render,
            setOrigin() { },
            // 시점 주고받기 — VWORLD 뷰와 같은 형식 (대지 좌표, heading 정북 0 시계방향, pitch 아래가 음수, 세로 화각 라디안)
            getView() {
                const p = camera.position, d = camera.getWorldDirection(new T.Vector3());
                return {
                    x: p.x, y: -p.z, z: p.y,
                    heading: Math.atan2(d.x, -d.z), pitch: Math.asin(Math.max(-1, Math.min(1, d.y))),
                    fovy: camera.fov * Math.PI / 180
                };
            },
            setView(v) {
                if (v.fovy) { camera.fov = v.fovy * 180 / Math.PI; camera.updateProjectionMatrix(); }
                const cp = Math.cos(v.pitch);
                const dir = new T.Vector3(Math.sin(v.heading) * cp, Math.sin(v.pitch), -Math.cos(v.heading) * cp);
                camera.position.set(v.x, v.z, -v.y);
                // 회전 중심 = 시선이 지면(높이 0)과 만나는 점
                const t = dir.y < -0.02 ? Math.min(Math.max(v.z / -dir.y, 5), 4000) : 200;
                controls.target.copy(camera.position).addScaledVector(dir, t);
                camera.lookAt(controls.target);
                controls.update(); render();
            },
            // bbox = 대지 좌표 {minX..maxY}, 없으면 그려진 물체 전체
            focus(bbox) {
                let center, size;
                if (bbox) {
                    center = new T.Vector3(bbox.cx, 0, -bbox.cy);
                    size = Math.max(bbox.w, bbox.h, 20);
                } else {
                    const box = new T.Box3();
                    scene.children.forEach(o => { if (o !== grid && o !== ground && !o.isLight) box.expandByObject(o); });
                    if (box.isEmpty()) return;
                    center = box.getCenter(new T.Vector3()); size = Math.max(box.getSize(new T.Vector3()).length(), 20);
                }
                controls.target.copy(center).setY(center.y + size * 0.15);
                camera.position.copy(center).add(new T.Vector3(size * 0.9, size * 0.9, size * 1.1));
                controls.update(); render();
            },
            show(on) { container.style.display = on ? '' : 'none'; if (on) resize(); }
        };
        return backend;
    }

    window.ArchViewers = window.ArchViewers || {};
    window.ArchViewers.three = { label: '간이 3D', create };
})();
