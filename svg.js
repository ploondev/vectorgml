'use strict';
// VectorGML - SVG import.
// Reads an .svg file and turns what it can into shapes: polygons, circles, lines and shapes with holes, with colors, opacity and
// gradients. Curves are cut into short straight pieces, because every outline in a design is made of straight pieces.
// Anything that cannot be carried over (filters, masks, text, dashes ...) is counted, and the import window lists it before
// anything is added to a design.
// Depends on studio.js (makeShape, normalize, uniqueName, commit ...), core.js and ui.js (el, openDialog).

const SVG_COLORS = Object.fromEntries(('aliceblue f0f8ff,antiquewhite faebd7,aqua 00ffff,aquamarine 7fffd4,azure f0ffff,beige f5f5dc,bisque ffe4c4,black 000000,'
	+ 'blanchedalmond ffebcd,blue 0000ff,blueviolet 8a2be2,brown a52a2a,burlywood deb887,cadetblue 5f9ea0,chartreuse 7fff00,chocolate d2691e,coral ff7f50,'
	+ 'cornflowerblue 6495ed,cornsilk fff8dc,crimson dc143c,cyan 00ffff,darkblue 00008b,darkcyan 008b8b,darkgoldenrod b8860b,darkgray a9a9a9,darkgreen 006400,'
	+ 'darkgrey a9a9a9,darkkhaki bdb76b,darkmagenta 8b008b,darkolivegreen 556b2f,darkorange ff8c00,darkorchid 9932cc,darkred 8b0000,darksalmon e9967a,'
	+ 'darkseagreen 8fbc8f,darkslateblue 483d8b,darkslategray 2f4f4f,darkslategrey 2f4f4f,darkturquoise 00ced1,darkviolet 9400d3,deeppink ff1493,'
	+ 'deepskyblue 00bfff,dimgray 696969,dimgrey 696969,dodgerblue 1e90ff,firebrick b22222,floralwhite fffaf0,forestgreen 228b22,fuchsia ff00ff,gainsboro dcdcdc,'
	+ 'ghostwhite f8f8ff,gold ffd700,goldenrod daa520,gray 808080,grey 808080,green 008000,greenyellow adff2f,honeydew f0fff0,hotpink ff69b4,indianred cd5c5c,'
	+ 'indigo 4b0082,ivory fffff0,khaki f0e68c,lavender e6e6fa,lavenderblush fff0f5,lawngreen 7cfc00,lemonchiffon fffacd,lightblue add8e6,lightcoral f08080,'
	+ 'lightcyan e0ffff,lightgoldenrodyellow fafad2,lightgray d3d3d3,lightgreen 90ee90,lightgrey d3d3d3,lightpink ffb6c1,lightsalmon ffa07a,lightseagreen 20b2aa,'
	+ 'lightskyblue 87cefa,lightslategray 778899,lightslategrey 778899,lightsteelblue b0c4de,lightyellow ffffe0,lime 00ff00,limegreen 32cd32,linen faf0e6,'
	+ 'magenta ff00ff,maroon 800000,mediumaquamarine 66cdaa,mediumblue 0000cd,mediumorchid ba55d3,mediumpurple 9370db,mediumseagreen 3cb371,'
	+ 'mediumslateblue 7b68ee,mediumspringgreen 00fa9a,mediumturquoise 48d1cc,mediumvioletred c71585,midnightblue 191970,mintcream f5fffa,mistyrose ffe4e1,'
	+ 'moccasin ffe4b5,navajowhite ffdead,navy 000080,oldlace fdf5e6,olive 808000,olivedrab 6b8e23,orange ffa500,orangered ff4500,orchid da70d6,'
	+ 'palegoldenrod eee8aa,palegreen 98fb98,paleturquoise afeeee,palevioletred db7093,papayawhip ffefd5,peachpuff ffdab9,peru cd853f,pink ffc0cb,plum dda0dd,'
	+ 'powderblue b0e0e6,purple 800080,rebeccapurple 663399,red ff0000,rosybrown bc8f8f,royalblue 4169e1,saddlebrown 8b4513,salmon fa8072,sandybrown f4a460,'
	+ 'seagreen 2e8b57,seashell fff5ee,sienna a0522d,silver c0c0c0,skyblue 87ceeb,slateblue 6a5acd,slategray 708090,slategrey 708090,snow fffafa,'
	+ 'springgreen 00ff7f,steelblue 4682b4,tan d2b48c,teal 008080,thistle d8bfd8,tomato ff6347,turquoise 40e0d0,violet ee82ee,wheat f5deb3,white ffffff,'
	+ 'whitesmoke f5f5f5,yellow ffff00,yellowgreen 9acd32').split(',').map(p => p.split(' ')));

// ------------------------------------------------------------------------------------------------ small helpers

const svgNum = (v, fallback = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fallback; };
const hex2 = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');

// a length like "12", "12px", "1.5in" or "50%" in user units (percent of ref)
function svgLen(v, ref = 0, fallback = 0) {
	if (v == null || v === '') return fallback;
	const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(px|pt|pc|mm|cm|in|em|ex|%)?\s*$/i.exec(String(v));
	if (!m) return fallback;
	const n = parseFloat(m[1]), u = (m[2] || '').toLowerCase();
	return n * ({ '': 1, px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, em: 16, ex: 8, '%': ref / 100 }[u]);
}

// a color: { hex, a } or null for none. undefined when the text is not a color.
function svgColor(str, current) {
	let s = String(str ?? '').trim().toLowerCase();
	if (s === 'none' || s === 'transparent') return null;
	if (s === 'currentcolor') return current ? svgColor(current) : { hex: '#000000', a: 1 };
	let m;
	if ((m = /^#([0-9a-f]{3,8})$/.exec(s))) {
		let h = m[1];
		if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('');
		if (h.length === 6 || h.length === 8) return { hex: '#' + h.slice(0, 6), a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
		return undefined;
	}
	if ((m = /^rgba?\(([^)]*)\)$/.exec(s))) {
		const p = m[1].split(/[\s,/]+/).filter(Boolean);
		const c = (v) => v.endsWith('%') ? parseFloat(v) * 2.55 : parseFloat(v);
		if (p.length < 3) return undefined;
		return { hex: '#' + hex2(c(p[0])) + hex2(c(p[1])) + hex2(c(p[2])), a: p[3] != null ? (p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3])) : 1 };
	}
	if ((m = /^hsla?\(([^)]*)\)$/.exec(s))) {
		const p = m[1].split(/[\s,/]+/).filter(Boolean), h = (parseFloat(p[0]) % 360 + 360) % 360, sat = parseFloat(p[1]) / 100, l = parseFloat(p[2]) / 100;
		const f = (n) => { const k = (n + h / 30) % 12; return l - sat * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
		return { hex: '#' + hex2(f(0) * 255) + hex2(f(8) * 255) + hex2(f(4) * 255), a: p[3] != null ? parseFloat(p[3]) : 1 };
	}
	if (SVG_COLORS[s]) return { hex: '#' + SVG_COLORS[s], a: 1 };
	return undefined;
}

// ---- matrices: [a, b, c, d, e, f], x' = a x + c y + e, y' = b x + d y + f
const M_ID = [1, 0, 0, 1, 0, 0];
const mmul = (p, q) => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];   // q first, then p
const mapPt = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
const mScale = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

function svgTransform(str) {
	let m = M_ID;
	if (!str) return m;
	for (const t of String(str).matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
		const a = t[2].split(/[\s,]+/).filter(Boolean).map(parseFloat), r = (d) => d * Math.PI / 180;
		let T = M_ID;
		if (t[1] === 'translate') T = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
		else if (t[1] === 'scale') T = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
		else if (t[1] === 'rotate') { const c = Math.cos(r(a[0] || 0)), s = Math.sin(r(a[0] || 0)); T = [c, s, -s, c, 0, 0]; if (a.length >= 3) T = mmul(mmul([1, 0, 0, 1, a[1], a[2]], T), [1, 0, 0, 1, -a[1], -a[2]]); }
		else if (t[1] === 'skewX') T = [1, 0, Math.tan(r(a[0] || 0)), 1, 0, 0];
		else if (t[1] === 'skewY') T = [1, Math.tan(r(a[0] || 0)), 0, 1, 0, 0];
		else if (t[1] === 'matrix' && a.length >= 6) T = a.slice(0, 6);
		m = mmul(m, T);
	}
	return m.every(Number.isFinite) ? m : M_ID;
}

// ---- style sheets: .class, tag, #id (and combinations of those). Anything fancier is ignored.
function svgParseDecl(text) {
	const o = {};
	for (const part of String(text || '').split(';')) {
		const i = part.indexOf(':');
		if (i > 0) o[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).replace(/!important/i, '').trim();
	}
	return o;
}
function svgParseCss(text) {
	const rules = [];
	for (const m of String(text).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
		const decl = svgParseDecl(m[2]);
		for (const sel of m[1].split(',').map(s => s.trim()).filter(Boolean)) rules.push({ sel, decl });
	}
	return rules;
}
function svgMatches(el, sel) {
	const m = /^([a-z0-9]*)((?:\.[\w-]+)*)(#[\w-]+)?$/i.exec(sel);
	if (!m) return false;
	if (m[1] && m[1].toLowerCase() !== el.localName.toLowerCase()) return false;
	if (m[3] && '#' + el.getAttribute('id') !== m[3]) return false;
	const classes = (el.getAttribute('class') || '').split(/\s+/);
	return m[2].split('.').filter(Boolean).every(c => classes.includes(c));
}

const SVG_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'fill-rule', 'opacity', 'fill-opacity', 'stroke-opacity',
	'display', 'visibility', 'color', 'clip-path', 'mask', 'filter', 'mix-blend-mode', 'stop-color', 'stop-opacity', 'marker-start', 'marker-mid', 'marker-end'];
const SVG_INHERIT = new Set(['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'fill-rule', 'fill-opacity', 'stroke-opacity', 'visibility', 'color']);

// ------------------------------------------------------------------------------------------------ paths

// path data -> a list of commands, each [letter, numbers...]
function svgPathParse(d) {
	const out = [], re = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y, N = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
	let i = 0, cmd = '';
	const skip = () => { while (i < d.length && /[\s,]/.test(d[i])) i++; };
	const num = () => { skip(); re.lastIndex = i; const m = re.exec(d); if (!m) return NaN; i = re.lastIndex; return parseFloat(m[0]); };
	const flag = () => { skip(); const c = d[i]; if (c === '0' || c === '1') { i++; return +c; } return NaN; };
	while (true) {
		skip();
		if (i >= d.length) break;
		if (/[a-zA-Z]/.test(d[i])) { cmd = d[i++]; if (!(cmd.toLowerCase() in N)) break; if (!N[cmd.toLowerCase()]) { out.push([cmd]); continue; } }
		else if (!cmd) break;
		const k = N[cmd.toLowerCase()], args = [];
		for (let j = 0; j < k; j++) args.push(cmd.toLowerCase() === 'a' && (j === 3 || j === 4) ? flag() : num());
		if (args.some(Number.isNaN)) break;
		out.push([cmd, ...args]);
		if (cmd === 'M') cmd = 'L'; else if (cmd === 'm') cmd = 'l';   // extra pairs after a moveto are line segments
	}
	return out;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function distToSeg(p, a, b) {
	const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
	if (l2 < 1e-12) return dist(p, a);
	const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1);
	return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
}
function flattenCubic(p0, p1, p2, p3, tol, out, depth = 0) {
	if (depth >= 14 || Math.max(distToSeg(p1, p0, p3), distToSeg(p2, p0, p3)) <= tol) { out.push(p3); return; }
	const m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], a = m(p0, p1), b = m(p1, p2), c = m(p2, p3), d = m(a, b), e = m(b, c), f = m(d, e);
	flattenCubic(p0, a, d, f, tol, out, depth + 1); flattenCubic(f, e, c, p3, tol, out, depth + 1);
}
function flattenArc(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2, tol, out) {
	if (x1 === x2 && y1 === y2) return;
	rx = Math.abs(rx); ry = Math.abs(ry);
	if (!rx || !ry) { out.push([x2, y2]); return; }
	const phi = phiDeg * Math.PI / 180, c = Math.cos(phi), s = Math.sin(phi);
	const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, x1p = c * dx + s * dy, y1p = -s * dx + c * dy;
	const lam = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
	if (lam > 1) { const k = Math.sqrt(lam); rx *= k; ry *= k; }
	const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p, den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
	const coef = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, num / (den || 1))), cxp = coef * rx * y1p / ry, cyp = -coef * ry * x1p / rx;
	const cx = c * cxp - s * cyp + (x1 + x2) / 2, cy = s * cxp + c * cyp + (y1 + y2) / 2;
	const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
	const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
	let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
	if (!fs && dth > 0) dth -= 2 * Math.PI; else if (fs && dth < 0) dth += 2 * Math.PI;
	const rmax = Math.max(rx, ry), da = tol < rmax ? 2 * Math.acos(1 - tol / rmax) : Math.PI / 2, steps = clamp(Math.ceil(Math.abs(dth) / Math.max(da, 1e-3)), 1, 720);
	for (let k = 1; k <= steps; k++) {
		const t = th1 + dth * k / steps;
		out.push([cx + rx * Math.cos(t) * c - ry * Math.sin(t) * s, cy + rx * Math.cos(t) * s + ry * Math.sin(t) * c]);
	}
	out[out.length - 1] = [x2, y2];
}

// path data -> subpaths [{ pts, closed }] in the path's own units; tol = how far a straight piece may stray from the curve
function svgPathToSubpaths(d, tol) {
	const subs = [];
	let cur = null, x = 0, y = 0, sx = 0, sy = 0, last = null, lastCmd = '';
	const start = (px, py) => { cur = { pts: [[px, py]], closed: false }; subs.push(cur); sx = px; sy = py; };
	for (const [cmd, ...a] of svgPathParse(d)) {
		const rel = cmd === cmd.toLowerCase(), c = cmd.toLowerCase(), ox = rel ? x : 0, oy = rel ? y : 0;
		if (c !== 'm' && c !== 'z' && !cur) start(x, y);
		if (c === 'm') { x = ox + a[0]; y = oy + a[1]; start(x, y); last = null; }
		else if (c === 'l') { x = ox + a[0]; y = oy + a[1]; cur.pts.push([x, y]); last = null; }
		else if (c === 'h') { x = ox + a[0]; cur.pts.push([x, y]); last = null; }
		else if (c === 'v') { y = oy + a[0]; cur.pts.push([x, y]); last = null; }
		else if (c === 'c' || c === 's') {
			const p0 = [x, y];
			let p1 = c === 's' ? (lastCmd === 'c' || lastCmd === 's' ? [2 * x - last[0], 2 * y - last[1]] : p0) : [ox + a[0], oy + a[1]];
			const o = c === 's' ? 0 : 2, p2 = [ox + a[o], oy + a[o + 1]], p3 = [ox + a[o + 2], oy + a[o + 3]];
			flattenCubic(p0, p1, p2, p3, tol, cur.pts); last = p2; x = p3[0]; y = p3[1];
		} else if (c === 'q' || c === 't') {
			const p0 = [x, y];
			const q = c === 't' ? (lastCmd === 'q' || lastCmd === 't' ? [2 * x - last[0], 2 * y - last[1]] : p0) : [ox + a[0], oy + a[1]];
			const e = c === 't' ? [ox + a[0], oy + a[1]] : [ox + a[2], oy + a[3]];
			flattenCubic(p0, [p0[0] + 2 / 3 * (q[0] - p0[0]), p0[1] + 2 / 3 * (q[1] - p0[1])], [e[0] + 2 / 3 * (q[0] - e[0]), e[1] + 2 / 3 * (q[1] - e[1])], e, tol, cur.pts);
			last = q; x = e[0]; y = e[1];
		} else if (c === 'a') {
			const ex = ox + a[5], ey = oy + a[6];
			flattenArc(x, y, a[0], a[1], a[2], a[3], a[4], ex, ey, tol, cur.pts); x = ex; y = ey; last = null;
		} else if (c === 'z') { if (cur) { cur.closed = true; x = sx; y = sy; cur = null; } last = null; }
		lastCmd = c;
	}
	return subs;
}

// drop repeated points, then thin out points that are within tol of the line between their neighbours
function svgSimplify(pts, closed, tol) {
	let p = pts.filter((q, i) => i === 0 || dist(q, pts[i - 1]) > 1e-6);
	if (closed && p.length > 1 && dist(p[0], p[p.length - 1]) < 1e-6) p.pop();
	if (p.length < 4 || tol <= 0) return p;
	const keep = new Uint8Array(p.length);
	const run = (lo, hi) => {   // Douglas-Peucker between two kept points, without recursion
		const stack = [[lo, hi]];
		while (stack.length) {
			const [a, b] = stack.pop();
			let far = -1, fd = tol;
			for (let i = a + 1; i < b; i++) { const d = distToSeg(p[i], p[a], p[b]); if (d > fd) { fd = d; far = i; } }
			if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
		}
	};
	if (closed) {
		let far = 0, fd = 0;
		p.forEach((q, i) => { const d = dist(q, p[0]); if (d > fd) { fd = d; far = i; } });
		keep[0] = keep[far] = 1;
		run(0, far);
		const tail = [...p.slice(far), p[0]];   // from the far point back round to the start
		const kt = new Uint8Array(tail.length);
		const stack = [[0, tail.length - 1]];
		while (stack.length) {
			const [a, b] = stack.pop();
			let f = -1, d0 = tol;
			for (let i = a + 1; i < b; i++) { const d = distToSeg(tail[i], tail[a], tail[b]); if (d > d0) { d0 = d; f = i; } }
			if (f >= 0) { kt[f] = 1; stack.push([a, f], [f, b]); }
		}
		for (let i = 1; i < tail.length - 1; i++) if (kt[i]) keep[far + i] = 1;
	} else { keep[0] = keep[p.length - 1] = 1; run(0, p.length - 1); }
	return p.filter((_, i) => keep[i]);
}

const ringArea2 = (p) => { let a = 0; p.forEach((q, i) => { const r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; }); return a; };   // twice the signed area
function pointInRing(pt, ring) {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const a = ring[i], b = ring[j];
		if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
	}
	return inside;
}

// closed outlines -> [{ outer, holes: [] }] following the fill rule: a ring is a boundary of the filled area, or of a hole in it
function svgRegions(rings, rule) {
	const info = rings.map((r, i) => {
		const xs = r.map(p => p[0]), ys = r.map(p => p[1]), area = ringArea2(r);
		return { r, i, area, orient: Math.sign(area) || 1, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
	});
	const solids = [], holes = [];
	for (const a of info) {
		const rep = a.r[0], containers = info.filter(b => b !== a && Math.abs(b.area) > Math.abs(a.area) && rep[0] >= b.x0 && rep[0] <= b.x1 && rep[1] >= b.y0 && rep[1] <= b.y1 && pointInRing(rep, b.r));
		const out = rule === 'evenodd' ? containers.length : containers.reduce((n, b) => n + b.orient, 0);
		const inn = rule === 'evenodd' ? containers.length + 1 : out + a.orient;
		const filledIn = rule === 'evenodd' ? inn % 2 !== 0 : inn !== 0, filledOut = rule === 'evenodd' ? out % 2 !== 0 : out !== 0;
		if (filledIn && !filledOut) solids.push(a); else if (!filledIn && filledOut) holes.push(a);
	}
	const regions = solids.map(s => ({ outer: s.r, area: Math.abs(s.area), holes: [] }));
	for (const h of holes) {
		const owner = regions.filter(g => pointInRing(h.r[0], g.outer)).sort((p, q) => p.area - q.area)[0];
		if (owner) owner.holes.push(h.r);
	}
	return regions;
}

// ------------------------------------------------------------------------------------------------ the importer

// doc: a parsed SVG document. opts: { scale, tolerance (px of the finished design), name }
function svgBuild(doc, opts) {
	const root = doc.documentElement, scale = opts.scale || 1, tol = opts.tolerance ?? 0.25;
	const warns = {}, shapes = [], groupSizes = {};
	const warn = (key, kind, text, n = 1) => { (warns[key] ||= { kind, text, n: 0 }).n += n; };
	let points = 0, strokesMade = 0;

	// the viewBox sets where the artboard is; its centre becomes the design's origin
	const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(parseFloat);
	const hasVb = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
	const width = svgLen(root.getAttribute('width'), hasVb ? vb[2] : 100, hasVb ? vb[2] : 0), height = svgLen(root.getAttribute('height'), hasVb ? vb[3] : 100, hasVb ? vb[3] : 0);
	const vbW = hasVb ? vb[2] : width, vbH = hasVb ? vb[3] : height;

	// style sheets, and the things other elements point to (gradients, reusable pieces)
	const rules = [...doc.getElementsByTagName('style')].flatMap(s => svgParseCss(s.textContent));
	const byId = {};
	for (const e of doc.getElementsByTagName('*')) { const id = e.getAttribute('id'); if (id) byId[id] = e; }

	const styleOf = (el, inherited) => {
		const st = {};
		for (const k of SVG_INHERIT) if (inherited[k] != null) st[k] = inherited[k];
		for (const k of SVG_PROPS) { const v = el.getAttribute(k); if (v != null) st[k] = v.trim(); }
		for (const r of rules) if (svgMatches(el, r.sel)) Object.assign(st, r.decl);
		Object.assign(st, svgParseDecl(el.getAttribute('style')));
		return st;
	};

	// ---- gradients
	const gradStops = (g, seen = new Set()) => {
		if (!g || seen.has(g)) return [];
		seen.add(g);
		const own = [...g.children].filter(c => c.localName === 'stop');
		if (own.length) return own.map(s => {
			const st = { ...svgParseDecl(s.getAttribute('style')) }, color = svgColor(st['stop-color'] ?? s.getAttribute('stop-color') ?? 'black', null) || { hex: '#000000', a: 1 };
			const off = String(s.getAttribute('offset') ?? '0'), op = svgNum(st['stop-opacity'] ?? s.getAttribute('stop-opacity'), 1) * (color.a ?? 1);
			if (op < 0.99) warn('stopalpha', 'changed', 'Gradient stops with transparency (drawn solid)');
			return { u: clamp(off.endsWith('%') ? parseFloat(off) / 100 : parseFloat(off) || 0, 0, 1), hex: color.hex };
		}).reduce((acc, s) => { acc.push({ ...s, u: Math.max(s.u, acc.length ? acc[acc.length - 1].u : 0) }); return acc; }, []);
		const href = g.getAttribute('href') || g.getAttribute('xlink:href');
		return href && href[0] === '#' ? gradStops(byId[href.slice(1)], seen) : [];
	};
	const gradAttr = (g, name, seen = new Set()) => {
		if (!g || seen.has(g)) return null;
		seen.add(g);
		if (g.hasAttribute(name)) return g.getAttribute(name);
		const href = g.getAttribute('href') || g.getAttribute('xlink:href');
		return href && href[0] === '#' ? gradAttr(byId[href.slice(1)], name, seen) : null;
	};
	const colorAtU = (stops, u) => {
		if (u <= stops[0].u) return stops[0].hex;
		for (let i = 1; i < stops.length; i++) if (u <= stops[i].u) return mixHex(stops[i - 1].hex, stops[i].hex, (u - stops[i - 1].u) / Math.max(stops[i].u - stops[i - 1].u, 1e-6));
		return stops[stops.length - 1].hex;
	};
	// a gradient painted on a shape, as the look fields our shapes use. D = element units -> design units; bb = bounding box in element units
	const gradientLook = (g, bb, D, box) => {
		const stops = gradStops(g);
		if (!stops.length) return null;
		if (stops.length === 1) return { fillType: 'solid', color: stops[0].hex };
		const obb = (gradAttr(g, 'gradientUnits') || 'objectBoundingBox') !== 'userSpaceOnUse';
		let T = svgTransform(gradAttr(g, 'gradientTransform'));
		if (obb) T = mmul([bb.w || 1e-6, 0, 0, bb.h || 1e-6, bb.x, bb.y], T);
		const total = mmul(D, T), W = box[2] - box[0], H = box[3] - box[1], cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
		const lenAttr = (n, def) => { const v = gradAttr(g, n); if (v == null) return def; return v.trim().endsWith('%') ? parseFloat(v) / 100 : svgNum(v, def); };
		const spread = gradAttr(g, 'spreadMethod');
		if (spread && spread !== 'pad') warn('spread', 'changed', 'Gradients that repeat or reflect (drawn once)');
		if (g.localName === 'linearGradient') {
			const p1 = mapPt(total, [lenAttr('x1', 0), lenAttr('y1', 0)]), p2 = mapPt(total, [lenAttr('x2', 1), lenAttr('y2', 0)]);
			const Dd = dist(p1, p2);
			if (Dd < 1e-6) return { fillType: 'solid', color: stops[stops.length - 1].hex };
			const dx = (p2[0] - p1[0]) / Dd, dy = (p2[1] - p1[1]) / Dd, L = Math.max(W * Math.abs(dx) + H * Math.abs(dy), 1e-6);
			const s = L / Dd, o = ((cx - p1[0]) * dx + (cy - p1[1]) * dy) / Dd, a = o - s / 2, b = o + s / 2;
			return { fillType: 'linear', gradAngle: Math.round(Math.atan2(dy, dx) * 180 / Math.PI * 100) / 100, color: colorAtU(stops, a), color2: colorAtU(stops, b),
				stops: stops.filter(q => q.u > a + 1e-6 && q.u < b - 1e-6).map(q => ({ t: (q.u - a) / s, color: q.hex })) };
		}
		const c = mapPt(total, [lenAttr('cx', 0.5), lenAttr('cy', 0.5)]), r = lenAttr('r', 0.5) * mScale(total), R = Math.max(Math.hypot(W, H) / 2, 1e-6);
		const fx = gradAttr(g, 'fx'), fy = gradAttr(g, 'fy');
		if ((fx != null || fy != null) && dist(mapPt(total, [lenAttr('fx', lenAttr('cx', 0.5)), lenAttr('fy', lenAttr('cy', 0.5))]), c) > r * 0.1) warn('focal', 'changed', 'Radial gradients with an off-center focus (focus centered)');
		if (dist(c, [cx, cy]) > R * 0.12) warn('radialmove', 'changed', 'Radial gradients that are not centered on their shape (moved to its center)');
		if (Math.abs(Math.hypot(total[0], total[1]) - Math.hypot(total[2], total[3])) > 0.05 * mScale(total)) warn('radialstretch', 'changed', 'Stretched radial gradients (drawn round)');
		const k = r / R;
		return { fillType: 'radial', color: stops[0].hex, color2: colorAtU(stops, 1 / Math.max(k, 1e-6)),
			stops: stops.filter(q => q.u * k > 1e-3 && q.u * k < 1 - 1e-3).map(q => ({ t: q.u * k, color: q.hex })) };
	};

	// ---- what an element is painted with
	const resolvePaint = (value, st, forStroke) => {
		const v = String(value ?? '').trim();
		const url = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)\s*(.*)$/.exec(v);
		if (url) {
			const target = byId[url[1]];
			if (target && /gradient/i.test(target.localName)) return { gradient: target };
			if (target && target.localName === 'pattern') { warn('pattern', 'lost', 'Pattern fills (left empty)'); return null; }
			const fb = url[2] ? svgColor(url[2], st.color) : null;
			return fb ? { color: fb.hex, a: fb.a } : null;
		}
		const c = svgColor(v, st.color);
		if (c === undefined) { warn('color', 'changed', 'Colors that could not be read (drawn black)'); return { color: '#000000', a: 1 }; }
		return c ? { color: c.hex, a: c.a } : null;
	};

	// ---- names and groups
	const nameOf = (el, fallback) => (el.getAttribute('inkscape:label') || el.getAttribute('data-name') || el.getAttribute('id') || fallback).replace(/_x([0-9a-f]{2})_/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/_\d+_$/, '').trim() || fallback;

	// ---- elements
	const NOTHING = new Set(['defs', 'style', 'title', 'desc', 'metadata', 'lineargradient', 'radialgradient', 'clippath', 'mask', 'symbol', 'pattern', 'marker', 'filter', 'script', 'namedview', 'font', 'font-face']);

	const emit = (el, tag, st, m, ctx) => {
		const D = mmul([scale, 0, 0, scale, 0, 0], m), sc = scale * mScale(m), localTol = tol / Math.max(sc, 1e-9);
		let subs = [], special = null;
		const g = (n, def = 0) => svgLen(el.getAttribute(n), n === 'width' || n === 'cx' || n === 'x' || n === 'rx' ? vbW : vbH, def);
		if (tag === 'path') subs = svgPathToSubpaths(el.getAttribute('d') || '', localTol);
		else if (tag === 'rect') {
			const x = g('x'), y = g('y'), w = g('width'), h = g('height');
			let rx = el.hasAttribute('rx') ? g('rx') : null, ry = el.hasAttribute('ry') ? g('ry') : null;
			if (rx == null) rx = ry ?? 0; if (ry == null) ry = rx;
			rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
			if (w <= 0 || h <= 0) return;
			const skew = Math.abs(m[0] * m[2] + m[1] * m[3]) > 1e-6 * sc * sc;
			if (!skew && rx === ry) special = { kind: 'rect', x, y, w, h, r: rx };
			subs = svgPathToSubpaths(rx > 0 || ry > 0 ? `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z` : `M${x} ${y}H${x + w}V${y + h}H${x}Z`, localTol);
		} else if (tag === 'circle' || tag === 'ellipse') {
			const cx = g('cx'), cy = g('cy'), rx = tag === 'circle' ? svgLen(el.getAttribute('r'), Math.hypot(vbW, vbH) / Math.SQRT2, 0) : g('rx'), ry = tag === 'circle' ? rx : g('ry');
			if (rx <= 0 || ry <= 0) return;
			const skew = Math.abs(m[0] * m[2] + m[1] * m[3]) > 1e-6 * sc * sc;
			if (!skew) special = { kind: 'ellipse', cx, cy, rx, ry };
			subs = svgPathToSubpaths(`M${cx + rx} ${cy}A${rx} ${ry} 0 0 1 ${cx} ${cy + ry}A${rx} ${ry} 0 0 1 ${cx - rx} ${cy}A${rx} ${ry} 0 0 1 ${cx} ${cy - ry}A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}Z`, localTol);
		} else if (tag === 'line') subs = [{ pts: [[g('x1'), g('y1')], [g('x2'), g('y2')]], closed: false }];
		else if (tag === 'polyline' || tag === 'polygon') {
			const n = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(parseFloat).filter(Number.isFinite), pts = [];
			for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
			subs = [{ pts, closed: tag === 'polygon' }];
		}
		subs = subs.filter(s => s.pts.length >= 2);
		if (!subs.length) return;

		// bounding box in the element's own units (gradients are measured against it)
		const all = subs.flatMap(s => s.pts), bx0 = Math.min(...all.map(p => p[0])), bx1 = Math.max(...all.map(p => p[0])), by0 = Math.min(...all.map(p => p[1])), by1 = Math.max(...all.map(p => p[1]));
		const bb = { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 };
		const toDesign = (pts, closed) => svgSimplify(pts.map(p => mapPt(D, p)), closed, tol);

		const opacity = ctx.opacity * (st.opacity != null ? clamp(svgNum(st.opacity, 1), 0, 1) : 1);
		const name = nameOf(el, tag), group = ctx.group;
		const base = { group, free: true };
		const fillPaint = st.fill === undefined ? { color: '#000000', a: 1 } : resolvePaint(st.fill, st, false);
		const strokePaint = st.stroke !== undefined ? resolvePaint(st.stroke, st, true) : null;

		// ---- fill
		if (fillPaint && tag !== 'line') {
			const fa = opacity * clamp(svgNum(st['fill-opacity'], 1), 0, 1) * (fillPaint.a ?? 1);
			const rule = st['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero';
			let shape = null;
			const look = { opacity: Math.round(fa * 1e4) / 1e4 };
			const applyPaint = (box) => {
				if (fillPaint.gradient) {
					const gl = gradientLook(fillPaint.gradient, bb, D, box);
					if (gl) { Object.assign(look, gl); return; }
					look.color = '#808080'; return;
				}
				look.color = fillPaint.color;
			};
			if (special && special.kind === 'ellipse' && subs.length === 1) {
				const u = Math.hypot(D[0], D[1]), v = Math.hypot(D[2], D[3]), c = mapPt(D, [special.cx, special.cy]);
				const w = 2 * special.rx * u, h = 2 * special.ry * v;
				applyPaint([c[0] - w / 2, c[1] - h / 2, c[0] + w / 2, c[1] + h / 2]);
				shape = { type: 'circle', x: c[0], y: c[1], width: Math.max(w, 1e-3), height: Math.max(h, 1e-3), rotation: Math.round(Math.atan2(D[1], D[0]) * 180 / Math.PI * 1e4) / 1e4, ...look, ...base };
				points += 4;
			} else if (special && special.kind === 'rect' && !(Math.sign(D[0] * D[3] - D[1] * D[2]) < 0)) {
				const u = Math.hypot(D[0], D[1]), v = Math.hypot(D[2], D[3]), c = mapPt(D, [special.x + special.w / 2, special.y + special.h / 2]);
				const w = special.w * u, h = special.h * v;
				applyPaint([c[0] - w / 2, c[1] - h / 2, c[0] + w / 2, c[1] + h / 2]);
				shape = { type: 'square', x: c[0], y: c[1], width: w, height: h, rotation: Math.round(Math.atan2(D[1], D[0]) * 180 / Math.PI * 1e4) / 1e4, ...(special.r ? { radius: special.r * (u + v) / 2 } : {}), ...look, ...base };
				points += 4;
			} else {
				const rings = subs.map(s => toDesign(s.pts, true)).filter(r => r.length >= 3 && Math.abs(ringArea2(r)) > 1e-9);
				const regions = svgRegions(rings, rule);
				if (regions.length) {
					const pts = regions.flatMap(r => [r.outer, ...r.holes].flat()), xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
					const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
					applyPaint([x0, y0, x1, y1]);
					const W = Math.max(x1 - x0, 1e-3), H = Math.max(y1 - y0, 1e-3), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
					const frac = (ring, mx, my, w, h) => ring.map(p => ({ x: (p[0] - mx) / w, y: (p[1] - my) / h }));
					points += pts.length;
					if (regions.length === 1 && !regions[0].holes.length) shape = { type: 'custom', x: cx, y: cy, width: W, height: H, vertices: frac(regions[0].outer, cx, cy, W, H), ...look, ...base };
					else {
						const parts = regions.map(r => {
							const px = r.outer.map(p => p[0]), py = r.outer.map(p => p[1]), a0 = Math.min(...px), a1 = Math.max(...px), b0 = Math.min(...py), b1 = Math.max(...py);
							const w = Math.max(a1 - a0, 1e-3), h = Math.max(b1 - b0, 1e-3), mx = (a0 + a1) / 2, my = (b0 + b1) / 2, p = { x: mx - cx, y: my - cy, width: w, height: h, rotation: 0 };
							return r.holes.length ? { type: 'region', ...p, rings: [r.outer, ...r.holes].map((ring, i) => ({ hole: i > 0, v: frac(ring, mx, my, w, h) })) } : { type: 'custom', ...p, vertices: frac(r.outer, mx, my, w, h) };
						});
						shape = { type: 'combined', x: cx, y: cy, width: W, height: H, baseWidth: W, baseHeight: H, parts, ...look, ...base };
					}
				}
			}
			if (shape) { shape.name = name; shapes.push(shape); if (group) groupSizes[group] = (groupSizes[group] || 0) + 1; }
		}

		// ---- stroke: becomes a line shape (centered on the edge, like in SVG)
		const sw = svgLen(st['stroke-width'], vbW, 1) * sc;
		if (strokePaint && sw > 0) {
			if (strokePaint.gradient) { warn('strokegrad', 'changed', 'Gradient strokes (drawn in the first color)'); }
			const color = strokePaint.gradient ? (gradStops(strokePaint.gradient)[0] || { hex: '#000000' }).hex : strokePaint.color;
			const sa = opacity * clamp(svgNum(st['stroke-opacity'], 1), 0, 1) * (strokePaint.a ?? 1);
			const dash = st['stroke-dasharray'];
			if (dash && dash !== 'none' && !/^0[\s,]*0*$/.test(dash)) warn('dash', 'changed', 'Dashed lines (drawn solid)');
			if (/bevel|miter-clip|arcs/.test(st['stroke-linejoin'] || '')) warn('join', 'changed', 'Stroke corners other than round (drawn round)');
			const capName = st['stroke-linecap'] || 'butt';
			if (capName === 'square') warn('square', 'changed', 'Square line ends (drawn flat)');
			subs.forEach((s, i) => {
				let pts = toDesign(s.pts, s.closed);
				if (pts.length < 2) return;
				const closed = s.closed && pts.length > 2;
				if (closed) pts = [...pts, pts[0]];
				const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
				const W = Math.max(x1 - x0, 1), H = Math.max(y1 - y0, 1), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
				const line = { type: 'line', name: (fillPaint && tag !== 'line' ? name + ' stroke' : name) + (subs.length > 1 ? ' ' + (i + 1) : ''), x: cx, y: cy, width: W, height: H, lineWidth: sw,
					cap: closed || capName === 'round' ? 'round' : 'flat', color, opacity: Math.round(sa * 1e4) / 1e4, vertices: pts.map(p => ({ x: (p[0] - cx) / W, y: (p[1] - cy) / H })), ...base };
				points += pts.length; strokesMade++;
				shapes.push(line); if (group) groupSizes[group] = (groupSizes[group] || 0) + 1;
			});
		}
	};

	const walk = (node, inherited, m, ctx, depth) => {
		for (const el of node.children) {
			const tag = el.localName.toLowerCase();
			if (NOTHING.has(tag)) continue;
			const st = styleOf(el, inherited);
			if (st.display === 'none') { warn('hidden', 'info', 'Hidden elements (skipped)'); continue; }
			const em = mmul(m, svgTransform(el.getAttribute('transform')));
			const op = ctx.opacity * (st.opacity != null && (tag === 'g' || tag === 'a') ? clamp(svgNum(st.opacity, 1), 0, 1) : 1);
			if (st.filter && st.filter !== 'none') warn('filter', 'lost', 'Filters such as blur and shadows (ignored)');
			if ((st['clip-path'] && st['clip-path'] !== 'none') || (st.mask && st.mask !== 'none')) warn('clip', 'lost', 'Clipping paths and masks (shapes drawn unclipped)');
			if (st['mix-blend-mode'] && st['mix-blend-mode'] !== 'normal') warn('blend', 'lost', 'Blend modes (drawn normally)');
			if (/url/.test([st['marker-start'], st['marker-mid'], st['marker-end']].join(''))) warn('marker', 'lost', 'Line markers such as arrowheads (ignored)');
			if (tag === 'g' || tag === 'a' || tag === 'switch') {
				if (tag === 'g' && st.opacity != null && svgNum(st.opacity, 1) < 0.99) warn('groupalpha', 'changed', 'Group transparency (applied to each shape separately)');
				const gname = ctx.group || (tag !== 'g' || ctx.wrapper ? null : nameOf(el, 'group'));
				if (ctx.group && tag === 'g') warn('nested', 'changed', 'Groups inside groups (merged into the outer group)');
				walk(el, st, em, { ...ctx, opacity: tag === 'g' ? op : ctx.opacity, group: gname, wrapper: false }, depth + 1);
			} else if (tag === 'use') {
				const href = el.getAttribute('href') || el.getAttribute('xlink:href'), target = href && href[0] === '#' ? byId[href.slice(1)] : null;
				if (!target || ctx.depthUse > 8) { warn('use', 'lost', 'Reused elements that could not be found'); continue; }
				const um = mmul(em, [1, 0, 0, 1, svgLen(el.getAttribute('x'), vbW), svgLen(el.getAttribute('y'), vbH)]);
				const holder = { children: [target.localName === 'symbol' ? null : target].filter(Boolean) };
				if (target.localName === 'symbol') walk(target, st, um, { ...ctx, opacity: op, depthUse: (ctx.depthUse || 0) + 1 }, depth + 1);
				else walk(holder, st, um, { ...ctx, opacity: op, depthUse: (ctx.depthUse || 0) + 1 }, depth + 1);
			} else if (['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'].includes(tag)) {
				if (st.visibility === 'hidden' || st.visibility === 'collapse') { warn('hidden', 'info', 'Hidden elements (skipped)'); continue; }
				emit(el, tag, st, em, { ...ctx, opacity: op });
			} else if (tag === 'text' || tag === 'tspan') warn('text', 'lost', 'Text (convert it to outlines in your drawing app first)');
			else if (tag === 'image') warn('image', 'lost', 'Embedded images');
			else if (tag === 'foreignobject') warn('foreign', 'lost', 'Embedded web content');
		}
	};

	// a file that wraps everything in one layer: that layer is not made a group
	const content = [...root.children].filter(c => !NOTHING.has(c.localName.toLowerCase()));
	const wrapped = content.length === 1 && content[0].localName === 'g';
	walk(root, styleOf(root, {}), M_ID, { opacity: 1, group: null, wrapper: wrapped }, 0);

	// the origin goes to the middle of the artboard (or of the drawing, when the file has no viewBox)
	let ox = 0, oy = 0;
	if (hasVb) { ox = (vb[0] + vbW / 2) * scale; oy = (vb[1] + vbH / 2) * scale; }
	else if (shapes.length) {
		const bs = shapes.map(s => [s.x - s.width / 2, s.y - s.height / 2, s.x + s.width / 2, s.y + s.height / 2]);
		ox = (Math.min(...bs.map(b => b[0])) + Math.max(...bs.map(b => b[2]))) / 2; oy = (Math.min(...bs.map(b => b[1])) + Math.max(...bs.map(b => b[3]))) / 2;
	}
	for (const s of shapes) { s.x = Math.round((s.x - ox) * 1e4) / 1e4; s.y = Math.round((s.y - oy) * 1e4) / 1e4; }
	for (const s of shapes) if (s.group && groupSizes[s.group] < 2) delete s.group;   // a group of one is just a shape
	if (strokesMade) warn('strokes', 'info', 'Strokes (each became its own line shape)', strokesMade);
	return { shapes, warnings: Object.values(warns), points, size: [Math.round(vbW * scale * 100) / 100, Math.round(vbH * scale * 100) / 100], hasViewBox: hasVb };
}

// ------------------------------------------------------------------------------------------------ the window

function svgParse(text) {
	const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
	if (doc.getElementsByTagName('parsererror').length || !doc.documentElement || doc.documentElement.localName.toLowerCase() !== 'svg') throw new Error('this is not a readable SVG file');
	return doc;
}

// the shapes as a design, ready for the editor (names made unique, groups made)
function svgToDesignParts(result, existing) {
	const shapes = result.shapes.map(s => ({ ...s })), groups = [], names = existing ? existing.shapes : [], seen = [...names];
	const gid = {};
	for (const s of shapes) {
		const base = makeShape({ ...s });
		Object.assign(s, base, s);
		s.name = uniqueName(seen, s.name || 'shape');
		seen.push(s);
		if (s.group) {
			if (!gid[s.group]) { const g = { id: newId(), name: uniqueName([...(existing ? existing.groups : []), ...groups], s.group) }; gid[s.group] = g.id; groups.push(g); }
			s.group = gid[s.group];
		} else delete s.group;
	}
	return { shapes, groups };
}

// target: the open design to add the shapes to, or null to make a new design from the file
function startSvgImport(file, target) {
	const reader = new FileReader();
	reader.onload = () => {
		let doc;
		try { doc = svgParse(String(reader.result)); } catch (e) { return toast('Could not import: ' + e.message); }
		const baseName = file.name.replace(/\.svg$/i, '') || 'imported';
		const scaleIn = el('input', { type: 'number', min: 0.001, max: 1000, step: 0.1, value: 1 });
		const detail = el('select', {}, [['0.1', 'Fine (smallest error, most points)'], ['0.25', 'Normal'], ['0.5', 'Coarse'], ['1', 'Very coarse (fewest points)']].map(([v, t]) => el('option', { value: v }, t)));
		detail.value = '0.25';
		const nameIn = el('input', { type: 'text', value: baseName, maxlength: 40 });
		const summary = el('div', { class: 'svg-summary' }), alertBox = el('div', { class: 'svg-alert' });
		let result = null, timer = 0;

		const rebuild = () => {
			const scale = clamp(parseFloat(scaleIn.value) || 1, 0.001, 1000);
			try { result = svgBuild(doc, { scale, tolerance: parseFloat(detail.value) }); } catch (e) { result = null; summary.textContent = 'Could not read this file: ' + e.message; return; }
			let tris = '';
			try {
				const parts = svgToDesignParts(result, null), tmp = normalize({ name: 'tmp', shapes: parts.shapes.map(s => JSON.parse(JSON.stringify(s))), points: [], palette: [], groups: [] });
				tris = ' · about ' + gmlStats(tmp, {}).total.toLocaleString() + ' triangles when exported';
			} catch (e) { tris = ''; }
			summary.replaceChildren(el('div', {}, result.shapes.length + ' shapes · ' + result.points.toLocaleString() + ' points' + tris),
				el('div', { class: 'meta' }, 'Size ' + result.size[0] + ' × ' + result.size[1] + ' px' + (result.hasViewBox ? ', centered on the origin' : '')));
			const lost = result.warnings.filter(w => w.kind === 'lost'), changed = result.warnings.filter(w => w.kind === 'changed'), info = result.warnings.filter(w => w.kind === 'info');
			const list = (title, items, cls) => items.length ? el('div', { class: 'svg-warn ' + cls }, el('b', {}, title), el('ul', {}, items.map(w => el('li', {}, w.text + (w.n > 1 ? ' × ' + w.n : ''))))) : '';
			alertBox.replaceChildren(
				...(lost.length || changed.length ? [el('div', { class: 'svg-head' }, 'Some things in this file do not carry over')] : [el('div', { class: 'svg-ok' }, 'Everything in this file maps to shapes.')]),
				list('Not imported', lost, 'lost'), list('Imported differently', changed, 'changed'), list('Notes', info, 'info'));
			go.disabled = !result.shapes.length;
			if (!result.shapes.length) summary.append(el('div', { class: 'svg-head' }, 'Nothing in this file could be turned into shapes.'));
		};
		const later = () => { clearTimeout(timer); timer = setTimeout(rebuild, 150); };
		scaleIn.addEventListener('input', later); detail.addEventListener('change', rebuild);

		const doImport = () => {
			if (!result || !result.shapes.length) return;
			clearTimeout(timer);
			if (target) {
				const { shapes, groups } = svgToDesignParts(result, target);
				target.shapes.push(...shapes); target.groups.push(...groups);
				normalize(target);
				closeDialog();
				commit(); renderAll();
				setSelection(shapes.map(s => s.id)); zoomFit();
				toast('Imported ' + shapes.length + ' shapes into "' + target.name + '".');
			} else {
				let name = nameIn.value.trim() || baseName, n = name, i = 2;
				while (db.designs[n]) n = name + ' ' + i++;
				const { shapes, groups } = svgToDesignParts(result, null);
				db.designs[n] = normalize({ name: n, shapes, points: [], palette: [], groups });
				persist(); closeDialog(); renderMenu();
				toast('Imported "' + n + '" (' + shapes.length + ' shapes).');
				openDesign(n); zoomFit();
			}
		};
		const go = el('button', { class: 'primary', onclick: doImport }, target ? 'Add to this design' : 'Create design');
		openDialog([
			el('div', { class: 'modal-head' }, el('h2', {}, 'Import SVG'), el('span', { class: 'spacer' }), el('button', { onclick: closeDialog }, '✕')),
			el('div', { class: 'meta' }, file.name),
			el('div', { class: 'gml-options' },
				...(target ? [] : [el('label', {}, 'Design name', nameIn)]),
				el('label', {}, 'Scale', scaleIn),
				el('label', {}, 'Curve detail', detail)),
			summary, alertBox,
			el('p', { class: 'note' }, 'Curves become short straight pieces and shapes with their points thinned out, so the result draws fast. The imported shapes keep their exact points: they are not snapped to the pixel grid. Review the result and tidy it in the editor.'),
			el('div', { class: 'btns' }, go, el('button', { onclick: closeDialog }, 'Cancel')),
		], 'wide');
		rebuild();
	};
	reader.readAsText(file);
}
