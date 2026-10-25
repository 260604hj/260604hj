// Arch Hub 공용 기하 유틸
// 좌표는 모두 미터 {x, y} — x = 동쪽(+), y = 북쪽(+). 폴리곤은 반시계 방향(CCW)을 기본으로 함.
(function () {
    'use strict';
    const G = {};
    const RAD = Math.PI / 180;
    const M_PER_DEG = 111320;

    // ---------- 폴리곤 기본 ----------
    G.signedArea = function (poly) {
        let s = 0;
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i], b = poly[(i + 1) % poly.length];
            s += a.x * b.y - b.x * a.y;
        }
        return s / 2;
    };
    G.area = poly => (poly && poly.length >= 3) ? Math.abs(G.signedArea(poly)) : 0;
    G.ccw = poly => G.signedArea(poly) < 0 ? poly.slice().reverse() : poly.slice();

    G.perimeter = function (poly) {
        let s = 0;
        for (let i = 0; i < poly.length; i++) s += G.dist(poly[i], poly[(i + 1) % poly.length]);
        return s;
    };
    G.dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

    G.centroid = function (poly) {
        let a = 0, cx = 0, cy = 0;
        for (let i = 0; i < poly.length; i++) {
            const p = poly[i], q = poly[(i + 1) % poly.length];
            const f = p.x * q.y - q.x * p.y;
            a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
        }
        if (Math.abs(a) < 1e-9) {
            const n = poly.length || 1;
            return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
        }
        return { x: cx / (3 * a), y: cy / (3 * a) };
    };

    G.bbox = function (pts) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        pts.forEach(p => {
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        });
        return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
    };

    // 점이 폴리곤 내부인지 (ray casting)
    G.pointInPoly = function (p, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const a = poly[i], b = poly[j];
            if (((a.y > p.y) !== (b.y > p.y)) && (p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x)) inside = !inside;
        }
        return inside;
    };
    G.distToSegment = function (p, a, b) {
        const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
        let t = L ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L : 0;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    };
    // 내부이거나 경계선 위(tol 이내)면 true
    G.pointInPolyOrOn = function (p, poly, tol) {
        tol = tol == null ? 1e-3 : tol;
        if (G.pointInPoly(p, poly)) return true;
        for (let i = 0; i < poly.length; i++) {
            if (G.distToSegment(p, poly[i], poly[(i + 1) % poly.length]) <= tol) return true;
        }
        return false;
    };

    // 볼록 껍질 (monotone chain), 결과 CCW
    G.convexHull = function (points) {
        const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
        if (pts.length < 3) return pts;
        const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
        const lower = [], upper = [];
        for (const p of pts) {
            while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
            lower.push(p);
        }
        for (let i = pts.length - 1; i >= 0; i--) {
            const p = pts[i];
            while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
            upper.push(p);
        }
        upper.pop(); lower.pop();
        return lower.concat(upper);
    };

    // 방향선 a→b 의 왼쪽(반시계 폴리곤의 안쪽)만 남기는 클리핑 (Sutherland–Hodgman 한 단계)
    G.clipHalfPlane = function (poly, a, b) {
        const side = p => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
        const out = [];
        for (let i = 0; i < poly.length; i++) {
            const P = poly[i], Q = poly[(i + 1) % poly.length];
            const sp = side(P), sq = side(Q);
            if (sp >= 0) out.push(P);
            if ((sp >= 0) !== (sq >= 0)) {
                const t = sp / (sp - sq);
                out.push({ x: P.x + (Q.x - P.x) * t, y: P.y + (Q.y - P.y) * t });
            }
        }
        return out;
    };

    // 각 변을 안쪽으로 d 만큼 평행이동한 반평면들의 교집합 — 절대 원래 폴리곤 밖으로 안 나감.
    // 볼록 폴리곤은 정확, 오목 폴리곤은 보수적(조금 더 작게) 결과.
    G.inset = function (poly, d) {
        let P = G.ccw(poly);
        if (!d) return P;
        const src = P.slice();
        for (let i = 0; i < src.length && P.length >= 3; i++) {
            const a = src[i], b = src[(i + 1) % src.length];
            const L = G.dist(a, b); if (L < 1e-9) continue;
            const nx = -(b.y - a.y) / L * d, ny = (b.x - a.x) / L * d; // 왼쪽 법선
            P = G.clipHalfPlane(P, { x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny });
        }
        return P.length >= 3 ? P : [];
    };

    // 거의 겹치는 점·일직선 위의 점 제거 (지적도 노이즈 정리)
    G.cleanRing = function (poly, tol) {
        tol = tol == null ? 0.05 : tol;
        let pts = poly.filter((p, i) => G.dist(p, poly[(i + 1) % poly.length]) > tol);
        let changed = true;
        while (changed && pts.length > 3) {
            changed = false;
            for (let i = 0; i < pts.length; i++) {
                const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
                if (G.distToSegment(b, a, c) < tol) { pts.splice(i, 1); changed = true; break; }
            }
        }
        return pts;
    };

    // ---------- 변환 ----------
    G.rotate = function (p, deg) {
        const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD);
        return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
    };
    // 건물 좌표 → 대지 좌표 (placement = {x, y, rotation(도, 반시계)})
    G.toSite = function (p, pl) {
        const r = G.rotate(p, pl.rotation || 0);
        return Object.assign({}, p, { x: r.x + (pl.x || 0), y: r.y + (pl.y || 0) });
    };
    // 대지 좌표 → 건물 좌표
    G.toBuilding = function (p, pl) {
        const r = G.rotate({ x: p.x - (pl.x || 0), y: p.y - (pl.y || 0) }, -(pl.rotation || 0));
        return Object.assign({}, p, r);
    };
    G.translate = (poly, dx, dy) => poly.map(p => ({ x: p.x + dx, y: p.y + dy }));

    // 두 점 a→b 방향 각도(도, 동쪽 기준 반시계)
    G.angleOf = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) / RAD;
    // 축 각도를 -90° 초과 ~ 90° 이하로 (선의 방향만 의미 있음)
    G.normAxis = a => { a = ((a % 180) + 180) % 180; return a > 90 ? a - 180 : a; };

    // 가장 긴 변의 방향 (대지 장변)
    G.longestEdgeAngle = function (poly) {
        let best = -1, ang = 0;
        poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length], d = G.dist(p, q); if (d > best) { best = d; ang = G.angleOf(p, q); } });
        return G.normAxis(ang);
    };
    // 최소 면적 외접 직사각형의 긴 변 방향 (매스 주축) — 볼록껍질 각 변 방향만 시험하면 충분
    G.mainAxisAngle = function (poly) {
        const hull = G.convexHull(poly);
        let bestA = Infinity, ang = 0;
        hull.forEach((p, i) => {
            const t = G.angleOf(p, hull[(i + 1) % hull.length]);
            const bb = G.bbox(hull.map(q => G.rotate(q, -t)));
            const area = bb.w * bb.h;
            if (area < bestA - 1e-6) { bestA = area; ang = bb.w >= bb.h ? t : t + 90; }
        });
        return G.normAxis(ang);
    };

    // ---------- 기본 형태 (중심이 원점) ----------
    G.rectAt = (cx, cy, w, d) => [
        { x: cx - w / 2, y: cy - d / 2 }, { x: cx + w / 2, y: cy - d / 2 },
        { x: cx + w / 2, y: cy + d / 2 }, { x: cx - w / 2, y: cy + d / 2 }
    ];
    G.shapes = {
        rect: s => G.rectAt(0, 0, s.w, s.d),
        // ㄱ/L형: 북동쪽 모서리를 cutW × cutD 만큼 따냄
        L: s => {
            const w = s.w / 2, d = s.d / 2;
            const cw = Math.min(s.cutW, s.w - 0.5), cd = Math.min(s.cutD, s.d - 0.5);
            return [
                { x: -w, y: -d }, { x: w, y: -d }, { x: w, y: d - cd },
                { x: w - cw, y: d - cd }, { x: w - cw, y: d }, { x: -w, y: d }
            ];
        },
        // ㄷ/U형: 북쪽 가운데를 cutW × cutD 만큼 따냄
        U: s => {
            const w = s.w / 2, d = s.d / 2;
            const cw = Math.min(s.cutW, s.w - 1) / 2, cd = Math.min(s.cutD, s.d - 0.5);
            return [
                { x: -w, y: -d }, { x: w, y: -d }, { x: w, y: d }, { x: cw, y: d },
                { x: cw, y: d - cd }, { x: -cw, y: d - cd }, { x: -cw, y: d }, { x: -w, y: d }
            ];
        }
    };

    // ---------- 위경도 ↔ 로컬 미터 (대지 규모에서 충분히 정확한 등장방형 근사) ----------
    G.lonLatToXY = function (origin, lon, lat) {
        return {
            x: (lon - origin.lon) * M_PER_DEG * Math.cos(origin.lat * RAD),
            y: (lat - origin.lat) * M_PER_DEG
        };
    };
    G.xyToLonLat = function (origin, x, y) {
        return {
            lon: origin.lon + x / (M_PER_DEG * Math.cos(origin.lat * RAD)),
            lat: origin.lat + y / M_PER_DEG
        };
    };

    G.round = (v, n) => { const k = Math.pow(10, n == null ? 2 : n); return Math.round(v * k) / k; };

    window.ArchGeom = G;
})();
