'use strict';
// VectorGML - styled lines: dashes, tapered ends and arrowheads.
// A plain line is drawn as a stroke (a thick path with round or flat ends). A line with any of these styles is instead turned into
// plain filled polygons here, in the editor, so the canvas, the PNG/SVG export and the exported GameMaker script all show exactly
// the same shape and the game needs no extra code. Every dash, the body and the arrowheads are cut out with boolOp() and merged.
//   s.dash        [on, off]  dash and gap length in pixels
//   s.taperStart  0-0.5      the width grows from nothing over this fraction of the length, at the start
//   s.taperEnd    0-0.5      the same at the end
//   s.arrowStart, s.arrowEnd   an arrowhead at that end; s.arrowSize is its width in line widths (default 3)

const lineStyled = (s) => s.type === 'line' && !!(s.dash || s.taperStart || s.taperEnd || s.arrowStart || s.arrowEnd);
const LINE_DASH_DEFAULT = [8, 6];
const ARROW_SIZE_DEFAULT = 3;

const styleCache = new Map();

// the points of a polyline between two distances along it
function polySlice(pts, cum, from, to) {
	const at = (d) => {
		let i = 1;
		while (i < cum.length - 1 && cum[i] < d) i++;
		const span = cum[i] - cum[i - 1] || 1, t = clamp((d - cum[i - 1]) / span, 0, 1);
		return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
	};
	const out = [{ p: at(from), d: from }];
	for (let i = 1; i < pts.length - 1; i++) if (cum[i] > from + 1e-9 && cum[i] < to - 1e-9) out.push({ p: pts[i], d: cum[i] });
	out.push({ p: at(to), d: to });
	return out;
}

// the parts (region parts in the shape's own coordinates, like worldParts gives) of a styled line. part = the line's own part.
function styledLineParts(s, part, n) {
	const key = n + '|' + JSON.stringify(part) + '|' + [s.lineWidth, s.cap, s.dash, s.taperStart, s.taperEnd, s.arrowStart, s.arrowEnd, s.arrowSize].join();
	const hit = styleCache.get(s.id);
	if (hit && hit.key === key) return hit.parts;
	const parts = ringsToRegions(buildStyledLine(s, part, n));
	styleCache.set(s.id, { key, parts });
	if (styleCache.size > 300) styleCache.delete(styleCache.keys().next().value);
	return parts;
}

function buildStyledLine(s, part, n) {
	const w = s.lineWidth, round = s.cap !== 'flat', steps = Math.max(4, Math.min(24, Math.round(n / 2)));
	const pts = partRings(part, n)[0].pts.filter((p, i, a) => !i || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 1e-6);
	if (pts.length < 2) return [];
	const cum = [0];
	for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
	const total = cum[cum.length - 1];
	const heads = [];   // the arrowheads, merged with the rest at the end

	// arrowheads shorten the visible body of the line; the head sits on the end
	const headW = w * (s.arrowSize || ARROW_SIZE_DEFAULT), headL = Math.min(headW * 0.9, total * 0.6);
	let lo = 0, hi = total;
	const head = (tip, base) => {
		const dx = tip[0] - base[0], dy = tip[1] - base[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len * headW / 2, ny = dx / len * headW / 2;
		const tri = [tip, [base[0] + nx, base[1] + ny], [base[0] - nx, base[1] - ny]];
		heads.push(ringArea(tri) < 0 ? tri.reverse() : tri);
	};
	const pointAt = (d) => polySlice(pts, cum, d, d + 1e-9)[0].p;
	if (s.arrowEnd) { hi = total - headL; head(pts[pts.length - 1], pointAt(hi)); }
	if (s.arrowStart) { lo = headL; head(pts[0], pointAt(lo)); }
	if (hi - lo <= 1e-6) return heads.length ? heads : [];

	const Lm = hi - lo, ts = Math.min(s.taperStart || 0, 0.5), te = Math.min(s.taperEnd || 0, 0.5);
	const wAt = (d) => { const u = d - lo; return Math.max(w * clamp(Math.min(ts > 0 ? u / (ts * Lm) : 1, te > 0 ? (Lm - u) / (te * Lm) : 1), 0, 1), Math.min(w, 0.2)); };   // a point is a very thin end: exactly nothing would leave repeated points
	const kinks = [ts > 0 ? lo + ts * Lm : null, te > 0 ? hi - te * Lm : null].filter(d => d != null);   // where the width stops changing

	// the pieces of the body: dashes, or the whole of it. An arrowhead is overlapped a little so the two merge cleanly.
	const over = headL * 0.4;
	let pieces = [[lo, hi]];
	if (s.dash) {
		let on = Math.max(+s.dash[0] || 1, 0.5), off = Math.max(+s.dash[1] || 1, 0.5);
		const k = Math.max(1, Math.ceil(Lm / (on + off) / 400));   // never more than about 400 dashes
		on *= k; off *= k;
		pieces = [];
		for (let a = lo; a < hi - 1e-6; a += on + off) pieces.push([a, Math.min(a + on, hi)]);
	}
	const disjoint = !s.dash || !round || (+s.dash[1] || 1) >= w;   // dashes whose round ends do not overlap can just sit side by side
	const polys = [];
	for (const [a0, b0] of pieces) {
		const a = a0 === lo && s.arrowStart ? Math.max(0, lo - over) : a0, b = b0 === hi && s.arrowEnd ? Math.min(total, hi + over) : b0;
		const capA = round && !(a0 === lo && s.arrowStart), capB = round && !(b0 === hi && s.arrowEnd);
		let samples = polySlice(pts, cum, a, b);
		for (const d of kinks) if (d > a + 1e-6 && d < b - 1e-6) samples.push({ p: pointAt(d), d });
		samples.sort((x, y) => x.d - y.d);
		samples = samples.filter((q, i) => !i || q.d - samples[i - 1].d > 1e-6);
		if (samples.length < 2) continue;
		// a sharp bend splits the stroke in two and is filled with a disc, so thick lines do not fold over themselves at a corner
		const runs = [];
		let from = 0;
		for (let i = 1; i < samples.length - 1; i++) {
			const p = samples[i - 1].p, q = samples[i].p, r = samples[i + 1].p, dx1 = q[0] - p[0], dy1 = q[1] - p[1], dx2 = r[0] - q[0], dy2 = r[1] - q[1];
			if (Math.atan2(Math.abs(dx1 * dy2 - dy1 * dx2), dx1 * dx2 + dy1 * dy2) > 0.7) {
				runs.push([from, i]); from = i;
				const rad = wAt(samples[i].d) / 2 * 0.99, disc = [];   // a hair smaller, so the stroke's square ends do not just touch the disc
				for (let k = 0; k < Math.max(8, n); k++) disc.push([q[0] + Math.cos((k + 0.5) / Math.max(8, n) * 2 * Math.PI) * rad, q[1] + Math.sin((k + 0.5) / Math.max(8, n) * 2 * Math.PI) * rad]);
				polys.push(disc);
			}
		}
		runs.push([from, samples.length - 1]);
		runs.forEach(([i0, i1], ri) => {
			const ring = strokeRing(samples.slice(i0, i1 + 1), wAt, ri === 0 && capA, ri === runs.length - 1 && capB, steps);
			if (ring.length >= 3 && Math.abs(ringArea(ring)) > 1e-4) polys.push(ring);
		});
	}
	let out = [];
	if (disjoint && !heads.length) {   // nothing overlaps except the discs at sharp bends: merge only if there are any
		const bends = polys.some((p, i) => p.length === Math.max(8, n));
		out = bends ? polys.reduce((acc, p) => acc ? boolOp('union', acc, [p]) : [p], null) || [] : polys;
	} else out = polys.reduce((acc, p) => acc ? boolOp('union', acc, [p]) : [p], null) || [];
	for (const h of heads) out = out.length ? boolOp('union', out, [h]) : [h];
	return out;
}

// one stroke as a single outline: along the left side, round the far end, back along the right side, round the near end.
// samples = [{ p, d }]; wAt(d) = the width there.
function strokeRing(samples, wAt, capStart, capEnd, steps) {
	const m = samples.length, nrm = [];
	for (let i = 0; i < m - 1; i++) { const p = samples[i].p, q = samples[i + 1].p, len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; nrm.push([-(q[1] - p[1]) / len, (q[0] - p[0]) / len]); }
	const L = [], R = [];
	for (let i = 0; i < m; i++) {
		const h = wAt(samples[i].d) / 2, a = nrm[Math.max(0, i - 1)], b = nrm[Math.min(m - 2, i)];
		let nx = a[0] + b[0], ny = a[1] + b[1];
		const len = Math.hypot(nx, ny);
		let k = 1;
		if (len < 1e-9) { nx = a[0]; ny = a[1]; } else { nx /= len; ny /= len; k = Math.min(1 / Math.max(nx * a[0] + ny * a[1], 0.5), 2); }   // a bend is mitred, up to a limit
		const p = samples[i].p;
		L.push([p[0] + nx * h * k, p[1] + ny * h * k]); R.push([p[0] - nx * h * k, p[1] - ny * h * k]);
	}
	const ring = [...L];
	const arc = (c, n0, h, sign) => { const out = [], a0 = Math.atan2(n0[1], n0[0]); for (let j = 1; j < steps; j++) { const t = a0 + sign * Math.PI * j / steps; out.push([c[0] + Math.cos(t) * h, c[1] + Math.sin(t) * h]); } return out; };
	const hEnd = wAt(samples[m - 1].d) / 2, hStart = wAt(samples[0].d) / 2;
	if (capEnd && hEnd > 0.1) ring.push(...arc(samples[m - 1].p, nrm[m - 2], hEnd, -1));
	ring.push(...R.reverse());
	if (capStart && hStart > 0.1) ring.push(...arc(samples[0].p, [-nrm[0][0], -nrm[0][1]], hStart, -1));
	const clean = ring.filter((p, i, a) => Math.hypot(p[0] - a[(i + a.length - 1) % a.length][0], p[1] - a[(i + a.length - 1) % a.length][1]) > 1e-6);
	return ringArea(clean) < 0 ? clean.reverse() : clean;   // outer outlines run the same way boolOp gives them
}
