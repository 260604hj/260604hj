// Arch Hub 장면 관리자 — 플러그인은 3D 엔진(VWORLD/Cesium, Three.js)을 몰라도 되도록
// "레이어"에 도형을 넣기만 한다. 좌표는 대지 좌표(미터) 또는 건물 좌표(frame: 'building').
//   const L = ArchScene.layer('my-plugin/columns', { frame: 'building' });
//   L.extrude(poly, { base: 0, height: 30, color: '#3b5bdb', opacity: 1 });
//   L.clear();
(function () {
    'use strict';
    const G = window.ArchGeom;
    const layers = new Map();
    let backend = null;
    let placement = { x: 0, y: 0, rotation: 0 };

    function Layer(name, opts) {
        this.name = name;
        this.frame = (opts && opts.frame) || 'site';
        this.items = [];
        this.shown = true;
    }
    Layer.prototype._toSite = function (p) { return this.frame === 'building' ? G.toSite(p, placement) : p; };
    Layer.prototype._add = function (kind, spec) {
        const item = { kind, spec };
        this.items.push(item);
        drawItem(this, item);
        return this;
    };
    // 수직 돌출 (매스, 기둥, 코어 등)
    Layer.prototype.extrude = function (poly, o) {
        o = o || {};
        return this._add('extrude', { poly, base: o.base || 0, height: o.height == null ? 3 : o.height,
            color: o.color || '#d9d4c7', opacity: o.opacity == null ? 1 : o.opacity, outline: o.outline !== false,
            outlineColor: o.outlineColor || '#555' });
    };
    // 수평 면 (대지, 그림자, 영역 표시)
    Layer.prototype.polygon = function (poly, o) {
        o = o || {};
        return this._add('polygon', { poly, z: o.z || 0, color: o.color || '#ffcc00', opacity: o.opacity == null ? 0.4 : o.opacity });
    };
    // 선 — points 는 {x,y,z?}, z 가 없으면 o.z.
    // ground: true 면 실제 지형 위에 붙여 그림 (VWORLD 3D 에서 경사지에서도 안 묻힘. 간이 3D 는 z 그대로)
    // mapColor: VWORLD 항공사진 위에서 쓸 색 (어두운 배경용, 없으면 color)
    Layer.prototype.line = function (points, o) {
        o = o || {};
        return this._add('line', { points: points.map(p => ({ x: p.x, y: p.y, z: p.z == null ? (o.z || 0) : p.z })),
            closed: !!o.closed, color: o.color || '#222', mapColor: o.mapColor || null, width: o.width || 2, ground: !!o.ground, opacity: o.opacity == null ? 1 : o.opacity });
    };
    Layer.prototype.label = function (pos, text, o) {
        o = o || {};
        return this._add('label', { pos: { x: pos.x, y: pos.y, z: pos.z || 0 }, text: String(text), color: o.color || '#15171c', size: o.size || 13 });
    };
    Layer.prototype.clear = function () { this.items.forEach(undrawItem); this.items = []; return this; };
    Layer.prototype.visible = function (on) {
        this.shown = !!on;
        this.items.forEach(it => { undrawItem(it); if (on) drawItem(this, it); });
        return this;
    };
    Layer.prototype.remove = function () { this.clear(); layers.delete(this.name); };

    // 건물 좌표 → 대지 좌표로 바꿔 백엔드에 전달
    function toSiteSpec(layer, kind, s) {
        const t = p => layer._toSite(p);
        if (kind === 'extrude' || kind === 'polygon') return Object.assign({}, s, { poly: s.poly.map(t) });
        if (kind === 'line') return Object.assign({}, s, { points: s.points.map(t) });
        if (kind === 'label') return Object.assign({}, s, { pos: t(s.pos) });
        return s;
    }
    function drawItem(layer, item) {
        if (!backend || !layer.shown) return;
        try { item.handle = backend.draw(item.kind, toSiteSpec(layer, item.kind, item.spec)); }
        catch (e) { console.error('도형 그리기 실패(' + layer.name + '):', e); }
    }
    function undrawItem(item) {
        if (backend && item.handle != null) { try { backend.remove(item.handle); } catch (e) { /* 이미 지워짐 */ } }
        item.handle = null;
    }
    function redraw(filter) {
        layers.forEach(layer => {
            if (filter && !filter(layer)) return;
            layer.items.forEach(it => { undrawItem(it); drawItem(layer, it); });
        });
        if (backend && backend.render) backend.render();
    }

    window.ArchScene = {
        layer(name, opts) {
            if (!layers.has(name)) layers.set(name, new Layer(name, opts));
            return layers.get(name);
        },
        layers: () => Array.from(layers.values()),
        setBackend(b) {
            layers.forEach(l => l.items.forEach(undrawItem));
            backend = b;
            redraw();
        },
        backend: () => backend,
        // 건물 배치가 바뀌면 건물 좌표 레이어를 다시 그림
        setPlacement(p) {
            const changed = p.x !== placement.x || p.y !== placement.y || p.rotation !== placement.rotation;
            placement = { x: p.x || 0, y: p.y || 0, rotation: p.rotation || 0 };
            if (changed) redraw(l => l.frame === 'building');
        },
        redraw: () => redraw(),
        setOrigin(o) { if (backend && backend.setOrigin) backend.setOrigin(o); },
        focus(bbox) { if (backend && backend.focus) backend.focus(bbox); }
    };
})();
