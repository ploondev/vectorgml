'use strict';
// VectorGML - core: small helpers, storage, icons and the geometry everything else relies on.
// Plain classic scripts, no build step and no server: open index.html. Load order is in index.html.
//
// Design  = { format, name, shapes: [Shape], points: [Point], palette: [Swatch], groups: [Group] }
// (free: true marks an imported shape whose points stay exactly where they are instead of snapping to whole pixels)
// Shape   = { id, name, type, x, y, width, height, scale, rotation (degrees, clockwise), color, opacity (0-1),
//             outline (pixels, 0 = none), outlineColor, swatch?, outlineSwatch?, group?, hidden?, locked?,
//             points: [Point], vertices? (polygons) | parts? (combined shapes) }
// Point   = { id, name, x, y }          design points: x,y in design space; shape points: offset from the shape's centre
// Swatch  = { id, name, color }         a named palette colour; shapes that use it follow it
// Group   = { id, name, collapsed? }    shapes with the same `group` id are listed and moved together

const STORE = 'designStudio.v1', PREFS = 'designStudio.prefs.v1', CLIP = 'designStudio.clip.v1';
const LIB = 'designStudio.lib.v1', VERS = 'designStudio.versions.v1', RECENT = 'designStudio.recent.v1';
const SVGNS = 'http://www.w3.org/2000/svg';
const $ = (sel) => document.querySelector(sel);

// ------------------------------------------------------------------------------------------------ small helpers

function el(tag, attrs = {}, ...kids) {
	const e = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (k === 'class') e.className = v;
		else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
		else if (v === true) e.setAttribute(k, '');
		else if (v !== false && v != null) e.setAttribute(k, v);
	}
	e.append(...kids.flat().filter(k => k != null && k !== false));
	return e;
}

function svg(tag, attrs = {}) {
	const e = document.createElementNS(SVGNS, tag);
	for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
	return e;
}

let toastTimer;
function toast(msg) {
	const t = $('#toast');
	t.textContent = msg; t.hidden = false;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

let idCounter = 0;
const newId = () => 'i' + (++idCounter) + Math.random().toString(36).slice(2, 6);
const round = (n) => Math.round(n * 100) / 100;
const r4 = (n) => Math.round(n * 1e4) / 1e4;
const r6 = (n) => Math.round(n * 1e6) / 1e6;
const rad = (deg) => deg * Math.PI / 180;
const wrapDeg = (d) => r4(((d + 180) % 360 + 360) % 360 - 180);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v);

// ------------------------------------------------------------------------------------------------ storage

function readJson(key, fallback) {
	try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch (e) { return fallback; }
}
function writeJson(key, value) {
	try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
}

// view settings that are remembered between sessions
const PREF_DEFAULTS = {
	grid: true, gridSnap: true, gridX: 1, gridY: 1, shapeSnap: true, rulers: true, guideSnap: true, guides: true, snapDist: 10,
	symmetry: false, labels: true, preview: false, previewScale: 2, previewBg: 'checker', split: 0.56,
	nudge: 1, nudgeBig: 10, angleStep: 15, rotateStep: 90,
};
const prefs = { ...PREF_DEFAULTS, ...readJson(PREFS, {}) };
const snapPx = () => clamp(+prefs.snapDist || 10, 2, 40);   // how close (screen pixels) the pointer must be to snap to a corner; edges and guides use 80% of it
const prefNum = (key, min, max) => clamp(+prefs[key] || PREF_DEFAULTS[key], min, max);
const savePrefs = () => writeJson(PREFS, prefs);

// ------------------------------------------------------------------------------------------------ icons

const ICONS = {
	select: '<path d="M4 2.5l8 5.8-3.6.7 2 3.8-1.6.8-2-3.8L4 12.2z" fill="currentColor"/>',
	image: '<rect x="2.5" y="3.5" width="11" height="9" rx="1.2"/><circle cx="6" cy="7" r="1.1"/><path d="M3 12l3.5-3.2 2.5 2 2-1.8L13 12"/>',
	hand: '<path d="M5.5 8.5V3.8a1 1 0 0 1 2 0V7M7.5 7V2.8a1 1 0 0 1 2 0V7M9.5 7V3.8a1 1 0 0 1 2 0v5.7c0 2.8-1.6 4.5-4 4.5-1.6 0-2.7-.7-3.6-2L2.3 9.2a1 1 0 0 1 1.6-1.2l1.6 1.7"/>',
	square: '<rect x="3" y="3" width="10" height="10" rx="1"/>',
	circle: '<circle cx="8" cy="8" r="5.2"/>',
	triangle: '<path d="M8 2.8l5.6 10H2.4z"/>',
	pentagon: '<path d="M8 2.2l5.6 4.1-2.1 6.6H4.5L2.4 6.3z"/>',
	hexagon: '<path d="M5 3h6l3 5-3 5H5L2 8z"/>',
	star: '<path d="M8 2l1.8 4 4.2.4-3.2 2.8 1 4.2L8 11.2 4.2 13.4l1-4.2L2 6.4 6.2 6z"/>',
	line: '<path d="M2.5 12.5C5 12.5 5.5 3.5 8 3.5S11 12.5 13.5 12.5"/><circle cx="2.5" cy="12.5" r="1.1" fill="currentColor"/><circle cx="13.5" cy="12.5" r="1.1" fill="currentColor"/>',
	custom: '<path d="M3 12.5l1-6 4-3.5 4.5 3-1 6z"/>',
	pen: '<path d="M2.5 13.5l.8-3.2 7.7-7.7 2.4 2.4-7.7 7.7zM9.5 4.2l2.4 2.4"/>',
	point: '<path d="M8 2.5l4.5 5.5L8 13.5 3.5 8z"/>',
	eyedrop: '<path d="M10.2 2.5l3.3 3.3-1.6 1.6-.9-.9-4.6 4.6-2.4.7.7-2.4 4.6-4.6-.9-.9z"/>',
	eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
	eyeoff: '<path d="M2 2l12 12M6.3 4A6 6 0 0 1 8 3.5C12 3.5 14.5 8 14.5 8a10 10 0 0 1-1.9 2.4M4 5.8A10 10 0 0 0 1.5 8S4 12.5 8 12.5a6 6 0 0 0 2.2-.4"/>',
	lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.2"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
	unlock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.2"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.8-1"/>',
	chev: '<path d="M6 3.5L10.5 8 6 12.5"/>',
	plus: '<path d="M8 3v10M3 8h10"/>',
	trash: '<path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>',
	dup: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.2"/><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>',
	flipH: '<path d="M8 2v12" stroke-dasharray="1.6 1.6"/><path d="M6 4.5L2.5 12H6zM10 4.5L13.5 12H10z"/>',
	flipV: '<path d="M2 8h12" stroke-dasharray="1.6 1.6"/><path d="M4.5 6L12 2.5V6zM4.5 10L12 13.5V10z"/>',
	alignLeft: '<path d="M2.5 2v12"/><rect x="4.5" y="4" width="8" height="3" rx=".6"/><rect x="4.5" y="9" width="5" height="3" rx=".6"/>',
	alignHCenter: '<path d="M8 2v12"/><rect x="3" y="4" width="10" height="3" rx=".6"/><rect x="5" y="9" width="6" height="3" rx=".6"/>',
	alignRight: '<path d="M13.5 2v12"/><rect x="3.5" y="4" width="8" height="3" rx=".6"/><rect x="6.5" y="9" width="5" height="3" rx=".6"/>',
	alignTop: '<path d="M2 2.5h12"/><rect x="4" y="4.5" width="3" height="8" rx=".6"/><rect x="9" y="4.5" width="3" height="5" rx=".6"/>',
	alignVCenter: '<path d="M2 8h12"/><rect x="4" y="3" width="3" height="10" rx=".6"/><rect x="9" y="5" width="3" height="6" rx=".6"/>',
	alignBottom: '<path d="M2 13.5h12"/><rect x="4" y="3.5" width="3" height="8" rx=".6"/><rect x="9" y="6.5" width="3" height="5" rx=".6"/>',
	distH: '<path d="M2.5 2v12M13.5 2v12"/><rect x="6.5" y="4.5" width="3" height="7" rx=".6"/>',
	distV: '<path d="M2 2.5h12M2 13.5h12"/><rect x="4.5" y="6.5" width="7" height="3" rx=".6"/>',
	forward: '<path d="M8 12.5V3.5M4.5 7L8 3.5 11.5 7"/>',
	backward: '<path d="M8 3.5v9M4.5 9L8 12.5 11.5 9"/>',
	front: '<path d="M3 2.5h10M8 14V5.5M4.5 9L8 5.5 11.5 9"/>',
	back: '<path d="M3 13.5h10M8 2V10.5M4.5 7L8 10.5 11.5 7"/>',
	group: '<path d="M2.5 5V2.5H5M11 2.5h2.5V5M13.5 11v2.5H11M5 13.5H2.5V11"/><rect x="5.5" y="5.5" width="5" height="5" rx=".8"/>',
	combine: '<rect x="2.5" y="4.5" width="7" height="7" rx="1" fill="currentColor" fill-opacity=".35"/><circle cx="10" cy="8" r="3.8" fill="currentColor" fill-opacity=".35"/>',
	vertex: '<path d="M3.5 11.5L5.5 4.5l7 2 .5 6z"/><rect x="2.5" y="10.5" width="2" height="2" fill="currentColor"/><rect x="4.5" y="3.5" width="2" height="2" fill="currentColor"/><rect x="11.5" y="5.5" width="2" height="2" fill="currentColor"/><rect x="12" y="11.5" width="2" height="2" fill="currentColor"/>',
	grid: '<path d="M2 5.5h12M2 10.5h12M5.5 2v12M10.5 2v12"/>',
	preview: '<rect x="2" y="3" width="12" height="10" rx="1.2"/><circle cx="8" cy="8" r="2"/>',
	check: '<path d="M3 8.5l3.2 3L13 4.5"/>',
	x: '<path d="M4 4l8 8M12 4l-8 8"/>',
	caret: '<path d="M4 6l4 4 4-4"/>',
	boolUnion: '<path d="M2.5 2.5h7v3h4v8h-7v-3h-4z" fill="currentColor" fill-opacity=".35"/>',
	boolSubtract: '<path d="M2.5 2.5h7v3H6.5v4h-4z" fill="currentColor" fill-opacity=".35"/><path d="M6.5 5.5h7v8h-7z" stroke-dasharray="1.6 1.6"/>',
	boolIntersect: '<path d="M2.5 2.5h7v7h-7z" stroke-dasharray="1.6 1.6"/><path d="M6.5 6.5h7v7h-7z" stroke-dasharray="1.6 1.6"/><path d="M6.5 6.5h3v3h-3z" fill="currentColor" fill-opacity=".6"/>',
	boolExclude: '<path d="M2.5 2.5h7v4h-3v3h-4z" fill="currentColor" fill-opacity=".35"/><path d="M9.5 6.5h4v7h-7v-4h3z" fill="currentColor" fill-opacity=".35"/>',
};

function icon(name) {
	const s = el('span', { class: 'ico' });
	s.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
	return s;
}

// ------------------------------------------------------------------------------------------------ shape geometry

const TYPES = ['square', 'circle', 'triangle', 'pentagon', 'hexagon', 'star'];

// Corner points of a shape, as fractions of its box: (0,0) = centre, +-0.5 = the box edges.
function baseVerts(type) {
	if (type === 'line') return [{ x: -.5, y: 0 }, { x: .5, y: 0 }];
	const r4 = (n) => Math.round(n * 1e4) / 1e4;
	if (type === 'square' || type === 'custom') return [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].map(([x, y]) => ({ x, y }));
	if (type === 'triangle') return [[0, -.5], [.5, .5], [-.5, .5]].map(([x, y]) => ({ x, y }));
	const n = type === 'pentagon' ? 5 : type === 'hexagon' ? 6 : 10, start = type === 'hexagon' ? 0 : -90;
	const raw = [];
	for (let i = 0; i < n; i++) {
		const a = (start + i * 360 / n) * Math.PI / 180, rr = type === 'star' && i % 2 ? 0.4 : 1;
		raw.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr });
	}
	const xs = raw.map(v => v.x), ys = raw.map(v => v.y);
	const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
	return raw.map(v => ({ x: r4((v.x - (x0 + x1) / 2) / (x1 - x0)), y: r4((v.y - (y0 + y1) / 2) / (y1 - y0)) }));
}


function resetVertices(s) {
	if (s.type === 'circle') { delete s.vertices; return; }
	if (s.type === 'custom' || s.type === 'line') return;
	s.vertices = baseVerts(s.type);
	gridVerts(s);
}

// The shape's box is always exactly the bounding box of its vertices (so resize handles hug the real outline).
// After any vertex change this re-measures the box and re-expresses the vertices against it; the drawing does not move.
function refit(s) {
	if (!s.vertices) return;
	const bw = s.width * s.scale, bh = s.height * s.scale;
	if (!bw || !bh) return;
	const xs = s.vertices.map(v => v.x * bw), ys = s.vertices.map(v => v.y * bh);
	const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
	const line = s.type === 'line';   // a straight line has no thickness: its box is kept at least 1 px each way
	const nw = line ? Math.max(x1 - x0, 1) : x1 - x0, nh = line ? Math.max(y1 - y0, 1) : y1 - y0;
	if (nw < 1e-6 || nh < 1e-6) return;
	const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, a = s.rotation * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
	const nbw = Math.sign(bw) * nw, nbh = Math.sign(bh) * nh, k = Math.abs(s.scale);
	s.x = Math.round((s.x + cx * c - cy * sn) * 1e4) / 1e4;
	s.y = Math.round((s.y + cx * sn + cy * c) * 1e4) / 1e4;
	s.width = Math.round(nw / k * 1e4) / 1e4; s.height = Math.round(nh / k * 1e4) / 1e4;
	s.vertices.forEach((v, i) => {
		v.x = r6((xs[i] - cx) / nbw); v.y = r6((ys[i] - cy) / nbh);
		for (const [k, from, to] of [['ix', bw, nbw], ['ox', bw, nbw], ['iy', bh, nbh], ['oy', bh, nbh]]) if (v[k] != null) v[k] = r6(v[k] * from / to);   // handles keep their size in pixels
	});
}

// Put every vertex on a whole-pixel grid line (measured from the design origin along the shape's own axes), then re-measure the box.
function gridVerts(s) {
	if (!s.vertices || s.free) return;   // free shapes keep their points exactly
	const bw = s.width * s.scale, bh = s.height * s.scale;
	if (!bw || !bh) return;
	for (const v of s.vertices) {
		v.x = r6((Math.round(s.x + v.x * bw) - s.x) / bw);
		v.y = r6((Math.round(s.y + v.y * bh) - s.y) / bh);
	}
	refit(s);
}

// Move a shape's centre so that its box edges sit on whole-pixel grid lines (odd sizes land on .5 centres).
function snapCenter(s) {
	const w = Math.abs(s.width * s.scale), h = Math.abs(s.height * s.scale), g = gridStep();
	s.x = r4(gs(s.x - w / 2, g.x) + w / 2);
	s.y = r4(gs(s.y - h / 2, g.y) + h / 2);
}

// The grid everything snaps to: the custom grid square when Snap to grid is on, whole pixels otherwise.
function gridStep() { return prefs.gridSnap ? { x: prefs.gridX > 0 ? prefs.gridX : 1, y: prefs.gridY > 0 ? prefs.gridY : 1 } : { x: 0, y: 0 }; }   // 0 = no grid: everything is placed exactly where the pointer is
const gs = (v, g) => g > 0 ? Math.round(v / g) * g : v;   // v moved to the nearest multiple of g
const gsx = (v) => r4(gs(v, gridStep().x)), gsy = (v) => r4(gs(v, gridStep().y));
// a grid that is not whole pixels puts points between pixels, so those shapes must keep their points exactly (free)
function keepGridPoints(s) { const g = gridStep(); if (s && (!g.x || !g.y || Math.abs(g.x - Math.round(g.x)) > 1e-9 || Math.abs(g.y - Math.round(g.y)) > 1e-9)) s.free = true; }
// ---- combined shapes keep their parts exactly, so circles stay true circles.
// Every shape as a list of parts in world coordinates (a plain shape is one part; a combined shape already has several).
function rawParts(s) {
	const k = Math.abs(s.scale), flip = s.scale < 0 ? 180 : 0, a = s.rotation * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
	const copy = (vs) => vs && vs.map(v => ({ ...v }));
	if (s.parts) {
		const sx = s.width / s.baseWidth, sy = s.height / s.baseHeight;
		if (Math.abs(sx - sy) > 1e-9) return s.parts.map(p => stretchPart(s, p, sx, sy));
		return s.parts.map(p => {
			const ox = p.x * s.scale * sx, oy = p.y * s.scale * sx;
			return { type: p.type, x: s.x + ox * c - oy * sn, y: s.y + ox * sn + oy * c, width: p.width * k * sx, height: p.height * k * sx, rotation: p.rotation + s.rotation + flip, vertices: copy(p.vertices), rings: p.rings, radius: p.radius, smooth: p.smooth };
		});
	}
	return [{ type: s.type, x: s.x, y: s.y, width: s.width * k, height: s.height * k, rotation: s.rotation + flip, vertices: copy(s.vertices), radius: s.radius, smooth: s.smooth, lineWidth: s.lineWidth, cap: s.cap }];
}

// A shape's parts as drawn: the same, unless the shape is clipped to another shape (s.clip = that shape's id), in which case
// it is only what lies inside the mask. n = sides per circle (the design's by default). Only a shape of the design (cur, or `design`)
// is clipped: the loose copies made while dragging use their own box.
const clipCache = new Map();
function worldParts(s, n, design) {
	const parts = rawParts(s);
	if (s.type === 'line') return lineStyled(s) ? styledLineParts(s, parts[0], typeof n === 'number' && n > 0 ? n : ((typeof cur !== 'undefined' && cur && cur.segments) || 32)) : parts;   // a dashed, tapered or arrowed line is plain polygons
	if (!s.clip) return parts;
	const d = design && design.shapes ? design : (typeof cur !== 'undefined' ? cur : null);   // (design may be an index when used as a map callback)
	if (!d || !d.shapes.includes(s)) return parts;
	const m = d.shapes.find(x => x.id === s.clip);
	if (!m || m === s || m.type === 'line') return parts;
	n = (typeof n === 'number' && n > 0 ? n : d.segments) || 32;
	const mask = rawParts(m), key = n + '|' + JSON.stringify(parts) + '|' + JSON.stringify(mask), hit = clipCache.get(s.id);
	if (hit && hit.key === key) return hit.parts;
	const region = (ps) => { let rings = null; for (const p of ps) { const r = partRings(p, n).map(x => x.pts); rings = rings ? boolOp('union', rings, r) : r; } return rings || []; };
	const out = ringsToRegions(boolOp('intersect', region(parts), region(mask)));
	clipCache.set(s.id, { key, parts: out });
	if (clipCache.size > 400) clipCache.delete(clipCache.keys().next().value);
	return out;
}

// outlines (outer rings turning one way, holes the other) -> region parts in world coordinates
function ringsToRegions(acc) {
	const outers = acc.filter(r => ringArea(r) > 0).map(r => ({ ring: r, holes: [] }));
	for (const h of acc.filter(r => ringArea(r) < 0)) {
		const mid = [(h[0][0] + h[1][0]) / 2, (h[0][1] + h[1][1]) / 2];
		const owners = outers.filter(o => insideRegion(mid, [o.ring])).sort((a, b) => ringArea(a.ring) - ringArea(b.ring));
		if (owners.length) owners[0].holes.push(h);
	}
	return outers.map(o => {
		const px = o.ring.map(p => p[0]), py = o.ring.map(p => p[1]);
		const bx0 = Math.min(...px), bx1 = Math.max(...px), by0 = Math.min(...py), by1 = Math.max(...py);
		const w = r6(Math.max(bx1 - bx0, 1e-3)), h = r6(Math.max(by1 - by0, 1e-3)), mx = (bx0 + bx1) / 2, my = (by0 + by1) / 2;
		return { type: 'region', x: r4(mx), y: r4(my), width: w, height: h, rotation: 0, rings: [o.ring, ...o.holes].map((r, i) => ({ hole: i > 0, v: r.map(p => ({ x: r6((p[0] - mx) / w), y: r6((p[1] - my) / h) })) })) };
	});
}

// One part of a stretched (unevenly scaled) combined shape, in world coordinates. A stretch skews rotated parts, so
// a polygon is baked into its stretched corners and a circle becomes the ellipse the stretch turns it into.
function stretchPart(g, p, sx, sy) {
	const ga = g.rotation * Math.PI / 180, gc = Math.cos(ga), gs = Math.sin(ga), pa = p.rotation * Math.PI / 180, pc = Math.cos(pa), ps = Math.sin(pa);
	const fx = sx * g.scale, fy = sy * g.scale;
	const at = (u, v) => {   // a point in the part's own axes -> world
		const lx = (p.x + u * pc - v * ps) * fx, ly = (p.y + u * ps + v * pc) * fy;
		return [g.x + lx * gc - ly * gs, g.y + lx * gs + ly * gc];
	};
	if (p.type === 'circle') {
		const rx = p.width / 2, ry = p.height / 2;
		const n11 = fx * pc * rx, n12 = -fx * ps * ry, n21 = fy * ps * rx, n22 = fy * pc * ry;
		const a = gc * n11 - gs * n21, b = gc * n12 - gs * n22, c = gs * n11 + gc * n21, d = gs * n12 + gc * n22;
		const E = (a + d) / 2, F = (a - d) / 2, G = (c + b) / 2, H = (c - b) / 2, Q = Math.hypot(E, H), R = Math.hypot(F, G);
		const phi = (Math.atan2(H, E) + Math.atan2(G, F)) / 2, ctr = at(0, 0);
		return { type: 'circle', x: ctr[0], y: ctr[1], width: 2 * (Q + R), height: 2 * Math.abs(Q - R), rotation: phi * 180 / Math.PI };
	}
	if (p.type === 'region') {   // a polygon with holes: bake every ring
		const rings = p.rings.map(r => ({ hole: !!r.hole, P: r.v.map(v => at(v.x * p.width, v.y * p.height)) })), all = rings.flatMap(r => r.P);
		const bx0 = Math.min(...all.map(q => q[0])), bx1 = Math.max(...all.map(q => q[0])), by0 = Math.min(...all.map(q => q[1])), by1 = Math.max(...all.map(q => q[1]));
		const bw = bx1 - bx0 || 1e-6, bh = by1 - by0 || 1e-6, bcx = (bx0 + bx1) / 2, bcy = (by0 + by1) / 2;
		return { type: 'region', x: bcx, y: bcy, width: bw, height: bh, rotation: 0, radius: p.radius, smooth: p.smooth, rings: rings.map(r => ({ hole: r.hole, v: r.P.map(q => ({ x: (q[0] - bcx) / bw, y: (q[1] - bcy) / bh })) })) };
	}
	const P = p.vertices.map(v => at(v.x * p.width, v.y * p.height));
	const xs = P.map(q => q[0]), ys = P.map(q => q[1]);
	const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), w = x1 - x0 || 1e-6, h = y1 - y0 || 1e-6;
	const o0 = at(0, 0), off = (u, v) => { const q = at(u, v); return [q[0] - o0[0], q[1] - o0[1]]; };
	return { type: p.type, x: (x0 + x1) / 2, y: (y0 + y1) / 2, width: w, height: h, rotation: 0, radius: p.radius, smooth: p.smooth, vertices: P.map((q, i) => {
		const v = p.vertices[i], nv = { ...v, x: (q[0] - (x0 + x1) / 2) / w, y: (q[1] - (y0 + y1) / 2) / h };
		if (v.ix != null || v.iy != null) { const d = off((v.ix || 0) * p.width, (v.iy || 0) * p.height); nv.ix = d[0] / w; nv.iy = d[1] / h; }
		if (v.ox != null || v.oy != null) { const d = off((v.ox || 0) * p.width, (v.oy || 0) * p.height); nv.ox = d[0] / w; nv.oy = d[1] / h; }
		return nv;
	}) };
}

// [minX, maxX, minY, maxY] of a part in world coordinates
function partBounds(p) {
	const a = p.rotation * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
	if (p.type === 'circle') {
		const rx = p.width / 2, ry = p.height / 2, ex = Math.hypot(rx * c, ry * sn), ey = Math.hypot(rx * sn, ry * c);
		return [p.x - ex, p.x + ex, p.y - ey, p.y + ey];
	}
	if (p.vertices && p.vertices.some(hasHandles)) {   // curved sides can reach past the corners: measure the real outline
		const pts = partRings(p, 16).flatMap(g => g.pts);
		return [Math.min(...pts.map(q => q[0])), Math.max(...pts.map(q => q[0])), Math.min(...pts.map(q => q[1])), Math.max(...pts.map(q => q[1]))];
	}
	const vs = p.type === 'region' ? p.rings.flatMap(r => r.v) : p.vertices;
	const xs = vs.map(v => p.x + v.x * p.width * c - v.y * p.height * sn);
	const ys = vs.map(v => p.y + v.x * p.width * sn + v.y * p.height * c);
	return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
}

// A part as outlines of points in its own frame (centred on the part, not turned): [{ pts: [[x, y], ...], hole }].
// Circles are n-sided polygons, the same ones the game draws. Rounded corners and smoothed lines are already worked out here.
function partLocal(p, n) {
	if (p.type === 'circle') {
		const pts = [];
		for (let k = 0; k < n; k++) { const t = k / n * 2 * Math.PI; pts.push([Math.cos(t) * p.width / 2, Math.sin(t) * p.height / 2]); }
		return [{ pts, hole: false }];
	}
	const r = p.radius || 0, s = p.smooth || 0;
	if (p.type === 'line') {
		const B = bezierFlatten(p.vertices.map(v => [v.x * p.width, v.y * p.height]), p.vertices.map(v => ({ s: v.s ?? s })), p.vertices.map(v => vertexHandles(v, p.width, p.height)), n, false);
		return [{ pts: curvePath(B.pts, B.info, n), hole: false, open: true }];
	}
	if (p.type === 'region') return p.rings.map(g => ({ hole: !!g.hole, pts: curveRing(g.v.map(v => [v.x * p.width, v.y * p.height]), g.v.map(() => ({ r, s })), n) }));
	const B = bezierFlatten(p.vertices.map(v => [v.x * p.width, v.y * p.height]), p.vertices.map(v => ({ r: v.r ?? r, s: v.s ?? s })), p.vertices.map(v => vertexHandles(v, p.width, p.height)), n);
	return [{ pts: curveRing(B.pts, B.info, n), hole: false }];
}

// the same in world coordinates
function partRings(p, n) {
	const a = p.rotation * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
	return partLocal(p, n).map(g => ({ hole: g.hole, open: g.open, pts: g.pts.map(([u, v]) => [p.x + u * c - v * sn, p.y + u * sn + v * c]) }));
}

// ---- a shape's centre-relative frame <-> the world
function pointWorld(p, owner) {
	if (!owner) return { x: p.x, y: p.y };
	const c = Math.cos(rad(owner.rotation)), sn = Math.sin(rad(owner.rotation));
	return { x: owner.x + p.x * c - p.y * sn, y: owner.y + p.x * sn + p.y * c };
}

// A shape's pivot: the spot it turns around in the game, as an offset from its centre in the shape's own axes (like a shape point).
function pivotOf(s) { return s.pivot || { x: 0, y: 0 }; }

// a world-space vector -> the same vector in a shape's own (unrotated) axes
function toLocal(owner, dx, dy) {
	const c = Math.cos(rad(owner.rotation)), sn = Math.sin(rad(owner.rotation));
	return { x: dx * c + dy * sn, y: -dx * sn + dy * c };
}

// [minX, maxX, minY, maxY] of a whole shape in world coordinates
function shapeBounds(s, design) {
	const b = worldParts(s, undefined, design).map(partBounds);
	if (!b.length) return [s.x, s.x, s.y, s.y];   // nothing left after a clip
	return [Math.min(...b.map(q => q[0])), Math.max(...b.map(q => q[1])), Math.min(...b.map(q => q[2])), Math.max(...b.map(q => q[3]))];
}

function unionBounds(list) {
	return [Math.min(...list.map(b => b[0])), Math.max(...list.map(b => b[1])), Math.min(...list.map(b => b[2])), Math.max(...list.map(b => b[3]))];
}

// ------------------------------------------------------------------------------------------------ palette and groups

// shapes that use a swatch always show its colour
function syncSwatches(d) {
	const by = new Map(d.palette.map(p => [p.id, p]));
	for (const s of d.shapes) {
		if (s.swatch) { if (by.has(s.swatch)) s.color = by.get(s.swatch).color; else delete s.swatch; }
		if (s.outlineSwatch) { if (by.has(s.outlineSwatch)) s.outlineColor = by.get(s.outlineSwatch).color; else delete s.outlineSwatch; }
	}
}

// Groups with fewer than two shapes dissolve, and each group's shapes are kept next to each other in the layer order.
function tidyGroups(d) {
	const known = new Set(d.groups.map(g => g.id)), count = {};
	for (const s of d.shapes) {
		if (s.group && !known.has(s.group)) delete s.group;
		if (s.group) count[s.group] = (count[s.group] || 0) + 1;
	}
	d.groups = d.groups.filter(g => count[g.id] >= 2);
	const keep = new Set(d.groups.map(g => g.id));
	for (const s of d.shapes) if (s.group && !keep.has(s.group)) delete s.group;
	const out = [], done = new Set();
	for (const s of d.shapes) {
		if (!s.group) { out.push(s); continue; }
		if (done.has(s.group)) continue;
		done.add(s.group);
		for (const t of d.shapes) if (t.group === s.group) out.push(t);
	}
	d.shapes = out;
}

// ------------------------------------------------------------------------------------------------ loading and cleaning designs

// Corner rounding (radius, in pixels) and line smoothing (0 to 1) on a shape or part, and on each of its corners.
// Anything unset or zero is removed, so shapes without rounding stay exactly as they were.
function cornerLook(o) {
	const num = (v, hi) => Number.isFinite(+v) && v !== null && v !== '' ? clamp(+v, 0, hi) : 0;
	if (num(o.radius, 1e4) > 0) o.radius = num(o.radius, 1e4); else delete o.radius;
	if (num(o.smooth, 1) > 0) o.smooth = num(o.smooth, 1); else delete o.smooth;
	for (const v of o.vertices || []) {
		if (!v || typeof v !== 'object') continue;
		if (v.r != null) v.r = num(v.r, 1e4); else delete v.r;
		if (v.s != null) v.s = num(v.s, 1); else delete v.s;
		for (const k of ['ix', 'iy', 'ox', 'oy']) { if (v[k] != null && Number.isFinite(+v[k]) && +v[k]) v[k] = +v[k]; else delete v[k]; }   // curve handles
	}
}

function normalize(d) {
	d.format = 'design-1';
	// reference images: only where each one sits is kept here; the pictures are stored apart (reference.js)
	const refs = Array.isArray(d.refs) ? d.refs : [];
	if (d.ref && typeof d.refId === 'string') refs.unshift({ ...d.ref, id: d.refId, name: 'Reference image' });   // older designs had a single one
	delete d.ref; delete d.refId;
	const seenRef = new Set();
	d.refs = refs.filter(r => r && typeof r.id === 'string' && !seenRef.has(r.id) && seenRef.add(r.id) && +r.w > 0 && +r.h > 0).map(r => ({
		id: r.id, name: String(r.name || 'Reference image').slice(0, 60), x: Number.isFinite(+r.x) ? +r.x : 0, y: Number.isFinite(+r.y) ? +r.y : 0,
		scale: clamp(+r.scale || 1, 0.01, 100), opacity: clamp(+r.opacity || 0.5, 0.05, 1), w: +r.w, h: +r.h,
		...(r.hidden ? { hidden: true } : {}), ...(r.locked ? { locked: true } : {}), ...(r.front ? { front: true } : {}) }));
	if (!d.refs.length) delete d.refs;
	d.axis = Number.isFinite(+d.axis) ? +d.axis : 0;   // x of the symmetry axis (the line a mirrored copy is made across)
	d.shapes ||= []; d.points ||= []; d.palette ||= []; d.groups ||= [];
	d.segments = clamp(Math.round((Number.isFinite(+d.segments) ? +d.segments : 32) / 4) * 4, 8, 128);   // sides of every circle, design-wide
	for (const p of d.points) { p.id ||= newId(); p.x ??= 0; p.y ??= 0; delete p.follow; }   // (older files may carry a tween target; that feature is gone)
	for (const w of d.palette) { w.id ||= newId(); w.name = String(w.name || 'color'); if (!isHex(w.color)) w.color = '#888888'; }
	for (const g of d.groups) { g.id ||= newId(); g.name = String(g.name || 'group'); }
	for (const s of d.shapes) {
		s.id ||= newId(); s.points ||= [];
		s.type = TYPES.includes(s.type) || s.type === 'custom' || s.type === 'line' || (s.type === 'combined' && Array.isArray(s.parts) && s.parts.length) ? s.type : 'square';
		s.x ??= 0; s.y ??= 0; s.width ??= 24; s.height ??= 24; s.scale ??= 1; s.rotation ??= 0; s.color = isHex(s.color) ? s.color : '#5b9cff';
		s.opacity = clamp(Number.isFinite(+s.opacity) ? +s.opacity : 1, 0, 1);
		s.outline = Math.max(0, Number.isFinite(+s.outline) ? +s.outline : 0);
		s.outlineColor = isHex(s.outlineColor) ? s.outlineColor : '#111111';
		s.fillType = ['linear', 'radial'].includes(s.fillType) ? s.fillType : 'solid';   // solid, or a gradient from color to color2
		s.color2 = isHex(s.color2) ? s.color2 : '#ffffff';
		s.gradAngle = Number.isFinite(+s.gradAngle) ? +s.gradAngle : 90;
		// extra colour stops between color (at 0) and color2 (at 1): [{ t: 0-1, color }], in order
		s.stops = (Array.isArray(s.stops) ? s.stops : []).filter(q => q && Number.isFinite(+q.t) && isHex(q.color)).map(q => ({ t: clamp(+q.t, 0.01, 0.99), color: q.color.toLowerCase() })).sort((a, b) => a.t - b.t).slice(0, 8);
		if (!s.stops.length || s.type === 'line') delete s.stops;
		// optional: this shape's own radial gradient smoothness (1-16); without it the export's default is used
		if (Number.isFinite(+s.gradDetail) && s.type !== 'line') s.gradDetail = clamp(Math.round(+s.gradDetail), 1, 16); else delete s.gradDetail;
		cornerLook(s);
		if (s.pivot && Number.isFinite(+s.pivot.x) && Number.isFinite(+s.pivot.y) && (+s.pivot.x || +s.pivot.y)) s.pivot = { x: +s.pivot.x, y: +s.pivot.y }; else delete s.pivot;
		if (s.type === 'line') {   // a line is a stroke: it has a thickness and ends, and no fill or outline
			s.lineWidth = Number.isFinite(+s.lineWidth) && +s.lineWidth > 0 ? Math.min(+s.lineWidth, 1000) : 4;
			s.cap = s.cap === 'flat' ? 'flat' : 'round';
			s.outline = 0; s.fillType = 'solid'; delete s.radius;
			// styles: dashes, tapered ends, arrowheads (linestyle.js)
			if (Array.isArray(s.dash) && s.dash.length === 2 && +s.dash[0] > 0 && +s.dash[1] > 0) s.dash = [Math.min(+s.dash[0], 1000), Math.min(+s.dash[1], 1000)]; else delete s.dash;
			for (const k of ['taperStart', 'taperEnd']) { if (Number.isFinite(+s[k]) && +s[k] > 0) s[k] = Math.min(+s[k], 0.5); else delete s[k]; }
			for (const k of ['arrowStart', 'arrowEnd']) if (!s[k]) delete s[k];
			if (Number.isFinite(+s.arrowSize) && +s.arrowSize > 0 && (s.arrowStart || s.arrowEnd)) s.arrowSize = clamp(+s.arrowSize, 1.5, 12); else delete s.arrowSize;
		} else { delete s.lineWidth; delete s.cap; delete s.dash; delete s.taperStart; delete s.taperEnd; delete s.arrowStart; delete s.arrowEnd; delete s.arrowSize; }
		if (!s.hidden) delete s.hidden;
		if (!s.free) delete s.free;   // free = an imported shape whose points are not snapped to the pixel grid
		if (!s.locked) delete s.locked;
		const ok = Array.isArray(s.vertices) && s.vertices.length >= (s.type === 'line' ? 2 : 3) && s.vertices.every(v => v && isFinite(v.x) && isFinite(v.y));
		if (s.type === 'combined') {
			delete s.vertices;
			for (const q of s.parts) { q.x ??= 0; q.y ??= 0; q.rotation ??= 0; if (q.type === 'region' && !Array.isArray(q.rings)) q.rings = []; cornerLook(q); }
			s.baseWidth ||= s.width || 1; s.baseHeight ||= s.height || 1;   // the size the parts were laid out at; width/height can now stretch away from it
		} else {
			delete s.parts;
			if (s.type === 'circle') { delete s.vertices; delete s.radius; delete s.smooth; } else { if (!ok) s.vertices = baseVerts(s.type); if (s.free) refit(s); else gridVerts(s); }
		}
		for (const p of s.points) { p.id ||= newId(); p.x ??= 0; p.y ??= 0; delete p.follow; }
	}
	for (const s of d.shapes) if (typeof s.clip !== 'string' || s.type === 'line' || !d.shapes.some(x => x.id === s.clip && x !== s && x.type !== 'line')) delete s.clip;   // a clip needs a mask shape that is still there
	// guide lines pulled out of the rulers: { axis: 'x' | 'y', pos }
	const byId = new Map(d.shapes.map(x => [x.id, x])), taken = new Set();   // symmetry links: a twin points at a shape that is not itself a twin, and each shape has one twin
	for (const s of d.shapes) {
		if (!s.mirror) { delete s.mirror; continue; }
		const src = byId.get(s.mirror);
		if (!src || src === s || src.mirror || taken.has(src.id)) delete s.mirror; else taken.add(src.id);
	}
	d.rules = (Array.isArray(d.rules) ? d.rules : []).filter(g => g && (g.axis === 'x' || g.axis === 'y') && Number.isFinite(+g.pos)).map(g => ({ axis: g.axis, pos: +g.pos })).slice(0, 200);
	if (!d.rules.length) delete d.rules;
	syncSwatches(d);
	tidyGroups(d);
	return d;
}

function loadDb() {
	try {
		const d = JSON.parse(localStorage.getItem(STORE));
		if (d && d.designs) { for (const k in d.designs) normalize(d.designs[k]); return d; }
	} catch (e) { /* fall through to empty */ }
	return { designs: {} };
}

let db = loadDb();
