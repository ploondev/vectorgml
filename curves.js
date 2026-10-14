'use strict';
// VectorGML - rounded corners and smooth curves.
//
// A ring is a list of [x, y] points. curveRing() takes the corners you placed and gives back the outline that is drawn and exported:
//   smoothing  turns the line through a corner into a curve (a Catmull-Rom spline that passes through the corner), and
//   rounding   replaces a sharp corner with a circular arc.
// Both are worked out here, in the editor, so the exported script only holds ordinary corners.
// info[i] = { r, s } for corner i: r = radius in pixels, s = smoothing from 0 (none) to 1 (full). Where s is above 0 the corner is
// smoothed and its radius is ignored. n = how many sides a full circle has, which also sets how finely arcs and curves are cut.

const CURVE_MIN_SWEEP = 0.2;   // corners that turn by less than this many radians (about 11 degrees) are left alone

function curveRing(pts, info, n) {
	if (pts.length < 3 || !info.some(i => i.r > 0 || i.s > 0)) return pts;
	const sm = smoothRing(pts, info, n);
	return roundCorners(sm.pts, sm.info, n);
}

// An open line: the same smoothing, with the two ends left where they are.
function curvePath(pts, info, n) {
	return pts.length < 2 || !info.some(i => i.s > 0) ? pts : smoothRing(pts, info, n, false).pts;
}

// Every edge that touches a smoothed corner becomes a cubic curve, cut into short straight pieces.
function smoothRing(pts, info, n, closed = true) {
	const N = pts.length;
	if (!info.some(i => i.s > 0)) return { pts, info };
	const outP = [], outI = [], most = Math.max(2, n >> 1), last = closed ? N : N - 1;
	for (let i = 0; i < last; i++) {
		const p0 = closed ? pts[(i + N - 1) % N] : pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[(i + 1) % N], p3 = closed ? pts[(i + 2) % N] : pts[Math.min(i + 2, N - 1)];
		const s1 = info[i].s || 0, s2 = info[(i + 1) % N].s || 0;
		outP.push(p1); outI.push(info[i]);
		if (!(s1 > 0 || s2 > 0)) continue;
		// the curve leaves a smoothed corner along the line between its two neighbours; a sharp corner keeps its own direction
		const c1 = s1 > 0 ? [p1[0] + (p2[0] - p0[0]) / 6 * s1, p1[1] + (p2[1] - p0[1]) / 6 * s1] : p1;
		const c2 = s2 > 0 ? [p2[0] - (p3[0] - p1[0]) / 6 * s2, p2[1] - (p3[1] - p1[1]) / 6 * s2] : p2;
		const m = clamp(Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 8), 1, most);
		for (let k = 1; k < m; k++) {
			const t = k / m, u = 1 - t;
			outP.push([
				u * u * u * p1[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p2[0],
				u * u * u * p1[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p2[1],
			]);
			outI.push({ r: 0, s: 0 });
		}
	}
	if (!closed) { outP.push(pts[N - 1]); outI.push(info[N - 1]); }
	return { pts: outP, info: outI };
}

// A corner with a radius is cut back along both edges and joined by an arc. A radius that does not fit is made smaller
// (each edge gives up at most half its length, so two rounded corners never overlap).
function roundCorners(pts, info, n) {
	const N = pts.length, out = [];
	for (let i = 0; i < N; i++) {
		const P = pts[i], r = info[i].r || 0;
		if (!(r > 0) || info[i].s > 0) { out.push(P); continue; }
		const A = pts[(i + N - 1) % N], B = pts[(i + 1) % N];
		const ux = A[0] - P[0], uy = A[1] - P[1], vx = B[0] - P[0], vy = B[1] - P[1], lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
		if (lu < 1e-9 || lv < 1e-9) { out.push(P); continue; }
		const theta = Math.acos(clamp((ux * vx + uy * vy) / (lu * lv), -1, 1));   // the angle inside the corner
		if (Math.PI - theta < CURVE_MIN_SWEEP) { out.push(P); continue; }
		const tan = Math.tan(theta / 2), d = Math.min(r / tan, lu / 2, lv / 2), re = d * tan;   // how far back to cut, and the radius that gives
		const T1 = [P[0] + ux / lu * d, P[1] + uy / lu * d], T2 = [P[0] + vx / lv * d, P[1] + vy / lv * d];
		const bx = ux / lu + vx / lv, by = uy / lu + vy / lv, bl = Math.hypot(bx, by), away = re / Math.sin(theta / 2);
		const C = [P[0] + bx / bl * away, P[1] + by / bl * away];
		const a1 = Math.atan2(T1[1] - C[1], T1[0] - C[0]);
		let da = Math.atan2(T2[1] - C[1], T2[0] - C[0]) - a1;
		while (da > Math.PI) da -= 2 * Math.PI;
		while (da < -Math.PI) da += 2 * Math.PI;
		const m = Math.max(1, Math.round(Math.abs(da) / (2 * Math.PI) * n));
		for (let k = 0; k <= m; k++) { const a = a1 + da * k / m; out.push([C[0] + Math.cos(a) * re, C[1] + Math.sin(a) * re]); }
	}
	// two cut points can land on the same spot when neighbours share an edge
	return out.filter((p, i) => { const q = out[(i + out.length - 1) % out.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-7; });
}

// Bezier sides. A vertex can carry handles: hs[i] = { ix, iy, ox, oy } in pixels, the offset of its "in" handle (toward the vertex before it)
// and its "out" handle (toward the vertex after it). The side between two vertices becomes a cubic curve when either end has a handle on
// that side. The curve is cut into short straight pieces; the corners you placed stay in the list and the new pieces carry no rounding.
function bezierFlatten(pts, info, hs, n, closed = true) {
	if (!hs.some(Boolean)) return { pts, info };
	const N = pts.length, outP = [], outI = [], last = closed ? N : N - 1;
	for (let i = 0; i < last; i++) {
		const j = (i + 1) % N, a = pts[i], b = pts[j], ha = hs[i], hb = hs[j];
		outP.push(a); outI.push(ha ? { r: 0, s: 0 } : info[i]);
		const out = ha && (ha.ox || ha.oy), into = hb && (hb.ix || hb.iy);
		if (!out && !into) continue;
		const c1 = out ? [a[0] + ha.ox, a[1] + ha.oy] : a, c2 = into ? [b[0] + hb.ix, b[1] + hb.iy] : b;
		const len = Math.hypot(c1[0] - a[0], c1[1] - a[1]) + Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) + Math.hypot(b[0] - c2[0], b[1] - c2[1]);
		const m = clamp(Math.ceil(len / 6), 3, Math.max(4, n));
		for (let k = 1; k < m; k++) {
			const t = k / m, u = 1 - t;
			outP.push([u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0], u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]]);
			outI.push({ r: 0, s: 0 });
		}
	}
	if (!closed) { outP.push(pts[N - 1]); outI.push(hs[N - 1] ? { r: 0, s: 0 } : info[N - 1]); }
	return { pts: outP, info: outI };
}

// the handles of a vertex, in pixels (null when it has none)
function vertexHandles(v, w, h) {
	return (v.ix || v.iy || v.ox || v.oy) ? { ix: (v.ix || 0) * w, iy: (v.iy || 0) * h, ox: (v.ox || 0) * w, oy: (v.oy || 0) * h } : null;
}
const hasHandles = (v) => !!(v.ix || v.iy || v.ox || v.oy);
