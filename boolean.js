'use strict';
// VectorGML - boolean operations on outlines (union, intersect, subtract, exclude).
//
// A region is a list of rings, each ring a list of [x, y] points. A point is inside a region when a ray from it crosses an odd
// number of ring edges (so a ring inside another ring is a hole). boolOp() returns rings in the same form, with outer rings
// counting clockwise on screen (positive area) and holes the other way.
//
// Method: cut every edge of both regions where it meets the other region's edges, then keep each little piece whose two sides
// differ in whether the result contains them, and join the kept pieces back into rings. Sampling both sides of a piece also
// makes edges that lie along each other work, which is common when shapes sit on the same pixel grid.

const BOOL_SIDE = 1e-3;   // how far from an edge to look when deciding which side is inside

function ringArea(pts) {
	let a = 0;
	for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
	return a / 2;
}

function insideRegion(pt, rings) {
	let inside = false;
	for (const r of rings) {
		for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
			const a = r[i], b = r[j];
			if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
		}
	}
	return inside;
}

function boolOp(op, A, B) {
	if (op === 'xor') return boolOp('subtract', A, B).concat(boolOp('subtract', B, A));
	const keep = op === 'union' ? (a, b) => a || b : op === 'intersect' ? (a, b) => a && b : (a, b) => a && !b;

	// points are shared by rounding: two points closer than about a millionth are the same point
	const known = new Map();
	const canon = (p) => {
		const k = Math.round(p[0] * 1e6) + ',' + Math.round(p[1] * 1e6);
		let q = known.get(k);
		if (!q) { q = [p[0], p[1], k]; known.set(k, q); }
		return q;
	};
	const edgesOf = (rings) => rings.flatMap(r => r.map((p, i) => [p, r[(i + 1) % r.length]]).filter(([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-9));
	const eA = edgesOf(A), eB = edgesOf(B);

	// where an edge is met by the edges of the other region (as fractions along the edge)
	const cuts = (e, others) => {
		const a = e[0], r = [e[1][0] - a[0], e[1][1] - a[1]], rr = r[0] * r[0] + r[1] * r[1], len = Math.sqrt(rr), ts = [];
		for (const f of others) {
			const c = f[0], s = [f[1][0] - c[0], f[1][1] - c[1]], qp = [c[0] - a[0], c[1] - a[1]];
			const rxs = r[0] * s[1] - r[1] * s[0], slen = Math.hypot(s[0], s[1]);
			if (Math.abs(rxs) < 1e-12 * len * slen) {
				if (Math.abs(qp[0] * r[1] - qp[1] * r[0]) > 1e-9 * len) continue;   // parallel, not on the same line
				for (const p of f) ts.push(((p[0] - a[0]) * r[0] + (p[1] - a[1]) * r[1]) / rr);   // overlapping: cut at its ends
			} else {
				const t = (qp[0] * s[1] - qp[1] * s[0]) / rxs, u = (qp[0] * r[1] - qp[1] * r[0]) / rxs;
				if (u >= -1e-9 && u <= 1 + 1e-9) ts.push(t);
			}
		}
		const out = [0, 1, ...ts.filter(t => t > 1e-9 && t < 1 - 1e-9)].sort((p, q) => p - q);
		return out.map(t => t === 0 ? canon(e[0]) : t === 1 ? canon(e[1]) : canon([a[0] + r[0] * t, a[1] + r[1] * t]));
	};

	const kept = new Map();   // directed pieces, keyed so that a piece both regions share is only kept once
	const consider = (p, q) => {
		if (p === q) return;
		const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
		if (len < 1e-9) return;
		const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], nx = -dy / len * BOOL_SIDE, ny = dx / len * BOOL_SIDE;
		const L = [m[0] + nx, m[1] + ny], R = [m[0] - nx, m[1] - ny];
		const fL = keep(insideRegion(L, A), insideRegion(L, B)), fR = keep(insideRegion(R, A), insideRegion(R, B));
		if (fL === fR) return;
		const [s, e] = fL ? [p, q] : [q, p];   // the result is always on the left of a kept piece
		kept.set(s[2] + '>' + e[2], [s, e]);
	};
	for (const [edges, others] of [[eA, eB], [eB, eA]]) {
		for (const e of edges) {
			const pts = cuts(e, others);
			for (let i = 0; i + 1 < pts.length; i++) consider(pts[i], pts[i + 1]);
		}
	}

	// join the pieces into rings; where several leave a point, take the sharpest left turn so touching rings stay apart
	const out = new Map();
	for (const [s, e] of kept.values()) { if (!out.has(s[2])) out.set(s[2], []); out.get(s[2]).push([s, e]); }
	const used = new Set(), rings = [];
	for (const [first] of kept) {
		if (used.has(first)) continue;
		const ring = [];
		let cur = kept.get(first), ok = true;
		const startKey = cur[0][2];
		for (let guard = 0; guard < 100000; guard++) {
			const key = cur[0][2] + '>' + cur[1][2];
			used.add(key); ring.push(cur[0]);
			if (cur[1][2] === startKey) break;
			const opts = (out.get(cur[1][2]) || []).filter(o => !used.has(o[0][2] + '>' + o[1][2]));
			if (!opts.length) { ok = false; break; }
			const din = [cur[1][0] - cur[0][0], cur[1][1] - cur[0][1]];
			let best = null, bestTurn = -Infinity;
			for (const o of opts) {
				const d = [o[1][0] - o[0][0], o[1][1] - o[0][1]], turn = Math.atan2(din[0] * d[1] - din[1] * d[0], din[0] * d[0] + din[1] * d[1]);
				if (turn > bestTurn) { bestTurn = turn; best = o; }
			}
			cur = best;
		}
		if (!ok) continue;
		// drop points that sit on a straight line between their neighbours
		let pts = ring.map(p => [p[0], p[1]]), changed = true;
		while (changed && pts.length > 3) {
			changed = false;
			for (let i = 0; i < pts.length; i++) {
				const p = pts[(i + pts.length - 1) % pts.length], c = pts[i], q = pts[(i + 1) % pts.length];
				const cr = (c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]);
				if (Math.abs(cr) < 1e-9 * (Math.hypot(c[0] - p[0], c[1] - p[1]) + 1) * (Math.hypot(q[0] - c[0], q[1] - c[1]) + 1)) { pts.splice(i, 1); changed = true; break; }
			}
		}
		if (pts.length >= 3 && Math.abs(ringArea(pts)) > 1e-6) rings.push(pts);
	}
	return rings;
}
