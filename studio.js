'use strict';
// VectorGML - editor state, and every operation that changes a design.
// (core.js has the helpers and geometry; ui.js the panels and menus; canvas.js the drawing and mouse; files.js saving.)

const SHAPE_COLOR = { square: '#5b9cff', circle: '#ef6f5b', triangle: '#f2c14e', pentagon: '#9b7be0', hexagon: '#3fbf8f', star: '#f0a23a', custom: '#8aa0b8', line: '#e6e9ef', combined: '#8aa0b8' };
const SHAPE_SIZE = { pentagon: [24, 23], hexagon: [24, 21], star: [24, 23] };   // keeps the regular ones from looking stretched
const SHAPE_ICON = { square: 'square', circle: 'circle', triangle: 'triangle', pentagon: 'pentagon', hexagon: 'hexagon', star: 'star', custom: 'custom', line: 'line', combined: 'combine' };

// ------------------------------------------------------------------------------------------------ editor state

let cur = null;                       // design being edited
let sel = null;                       // id of the selected shape or point
let multi = new Set();                // ids of the shapes picked together (two or more)
let hist = [], hi = -1;               // undo history (JSON snapshots)
const view = { tx: 0, ty: 0, z: 3 };  // screen = world * z + t
let drag = null;
let tool = 'select';                  // select | hand | a shape type | pen | point | eyedrop
let lastShape = 'square';             // what the toolbar's shape button draws
let eyeTarget = 'fill';               // which colour the eyedropper fills in: fill | outline
let pivotMode = false;                 // true while the pivot marker can be dragged
let vertexMode = null;                // id of the shape whose vertices are being edited
const vsel = new Set();               // selected vertex indexes while editing
let vSnapshot = null;                 // the shape's vertices when editing began (for the cancel button)
let addingVertex = false;             // vertex editor: clicking a side adds a vertex
let drawMode = null;                  // while drawing a custom polygon: { pts: [[x,y]...], at: [x,y] under the cursor }
let renaming = null;                  // id of the layer row being renamed
let dnd = null;                       // id of the layer row being dragged
let spaceDown = false;                // holding Space turns a drag into a pan
let guides = [];                      // smart-guide lines shown while dragging: { axis: 'x'|'y', pos }
let marquee = null;                   // selection rectangle being dragged: { x0, y0, x1, y1 }
let ghost = null;                     // outline of the shape being drawn with a shape tool
let originGhost = null;               // where the origin will land while it is being dragged
let cursorAt = null;                  // pointer position in design space
let clip = null;                      // last copied shapes
let pasteCount = 0;                   // so repeated pastes step across the canvas
let dirty = false;                    // edited since the last version snapshot

function find(id) {
	if (!cur || !id) return null;
	for (const p of cur.points) if (p.id === id) return { kind: 'point', obj: p, owner: null };
	for (const s of cur.shapes) {
		if (s.id === id) return { kind: 'shape', obj: s };
		for (const p of s.points) if (p.id === id) return { kind: 'point', obj: p, owner: s };
	}
	return null;
}

function listOf(it) { return it.kind === 'shape' ? cur.shapes : (it.owner ? it.owner.points : cur.points); }

function uniqueName(list, want, self) {
	const base = (want || '').trim() || 'unnamed';
	let name = base, i = 2;
	while (list.some(o => o !== self && o.name === name)) name = base + '_' + i++;
	return name;
}

// ------------------------------------------------------------------------------------------------ history

function persist() {
	if (!writeJson(STORE, db)) toast('Could not save to browser storage - use File > Save to file.');
	if (typeof scheduleFileSave === 'function') scheduleFileSave();
}

function commit() {
	syncMirrors(cur);
	db.designs[cur.name] = cur;
	persist();
	dirty = true;
	const s = JSON.stringify(cur);
	if (s === hist[hi]) return;
	hist = hist.slice(0, hi + 1);
	hist.push(s); hi = hist.length - 1;
	if (hist.length > 100) { hist.shift(); hi--; }
	updateUndoButtons();
}

function restore() {
	cur = JSON.parse(hist[hi]);
	db.designs[cur.name] = cur;
	persist();
	if (!find(sel)) sel = null;
	multi = new Set([...multi].filter(id => cur.shapes.some(s => s.id === id)));   // keep the selection through undo and redo
	if (multi.size < 2) multi.clear();
	resetModes(); tool = 'select';
	renderAll();
}

function undo() { discardRepeat(); if (hi > 0) { hi--; restore(); } }
function redo() { discardRepeat(); if (hi < hist.length - 1) { hi++; restore(); } }
function updateUndoButtons() { $('#undoBtn').disabled = hi <= 0; $('#redoBtn').disabled = hi >= hist.length - 1; }

// ------------------------------------------------------------------------------------------------ selection

function selectedShapes() {
	if (!cur) return [];
	if (multi.size >= 2) return cur.shapes.filter(s => multi.has(s.id));
	const it = find(sel);
	return it && it.kind === 'shape' ? [it.obj] : [];
}

// a shape's group-mates, or just the shape itself
function unitOf(id) {
	const it = find(id);
	if (!it || it.kind !== 'shape' || !it.obj.group) return [id];
	return cur.shapes.filter(s => s.group === it.obj.group).map(s => s.id);
}

function resetModes() { discardRepeat(); refSel = null; pivotMode = false; vertexMode = null; vsel.clear(); addingVertex = false; drawMode = null; }

function select(id) {
	resetModes(); multi.clear(); sel = id;
	if (tool !== 'select' && tool !== 'hand') tool = 'select';
	renderAll();
}

function setSelection(ids) {
	resetModes();
	if (tool !== 'select' && tool !== 'hand') tool = 'select';
	if (ids.length >= 2) { multi = new Set(ids); sel = ids[ids.length - 1]; }
	else { multi.clear(); sel = ids[0] || null; }
	renderAll();
}

function selectUnit(id) { setSelection(unitOf(id)); }

// shift-click on the canvas: add or remove a shape (with its group) from the selection
function toggleUnit(id) {
	const ids = unitOf(id), now = selectedShapes().map(s => s.id);
	const all = ids.every(i => now.includes(i));
	setSelection(all ? now.filter(i => !ids.includes(i)) : [...now, ...ids.filter(i => !now.includes(i))]);
}

function selectAll() { setSelection(cur.shapes.filter(s => !s.hidden && !s.locked).map(s => s.id)); }

function setTool(t) {
	if (vertexMode) exitVertex(false);
	drawMode = null; addingVertex = false;
	tool = t;
	if (TYPES.includes(t)) lastShape = t;
	if (t === 'pen' || t === 'line') { sel = null; multi.clear(); drawMode = { pts: [], h: [], at: null, line: t === 'line' }; }
	renderAll();
}

// ------------------------------------------------------------------------------------------------ making things

function makeShape(props) {
	return Object.assign({
		id: newId(), name: '', type: 'square', x: 0, y: 0, width: 24, height: 24, scale: 1, rotation: 0,
		color: '#5b9cff', opacity: 1, outline: 0, outlineColor: '#111111', fillType: 'solid', color2: '#ffffff', gradAngle: 90, points: [],
	}, props);
}

// box = { x, y, w, h } (centre and size) when drawn by dragging; without it the shape lands in the middle of the view
function addShape(type, box) {
	const s = makeShape({ name: uniqueName(cur.shapes, type), type, color: SHAPE_COLOR[type] });
	if (box) Object.assign(s, { x: box.x, y: box.y, width: box.w, height: box.h });
	else {
		[s.width, s.height] = SHAPE_SIZE[type] || [24, 24];
		const c = viewCenter();
		s.x = gsx(c.x); s.y = gsy(c.y);
		snapCenter(s);
	}
	keepGridPoints(s);
	resetVertices(s);
	cur.shapes.push(s);
	const twin = symTwin(s);
	if (twin) cur.shapes.push(twin);
	tool = 'select';
	commit();
	if (twin) setSelection([s.id, twin.id]); else select(s.id);
}

// owner = a shape, or null for a design-level point; at = a position in the design (otherwise the centre)
function addPoint(owner, at) {
	const list = owner ? owner.points : cur.points;
	const p = { id: newId(), name: uniqueName(list, 'point'), x: 0, y: 0 };
	if (at) {
		if (owner) { const l = toLocal(owner, at.x - owner.x, at.y - owner.y); p.x = round(l.x); p.y = round(l.y); }
		else { p.x = Math.round(at.x); p.y = Math.round(at.y); }
	}
	list.push(p);
	tool = 'select';
	commit(); select(p.id);
}

function addPointToSelection() {
	const s = selectedShapes();
	if (s.length === 1) addPoint(s[0]); else addPoint(null);
}

function deleteSelected() {
	if (refSel) return removeReference(refSel);
	if (multi.size >= 2) {
		cur.shapes = cur.shapes.filter(s => !multi.has(s.id));
		multi.clear(); sel = null;
		tidyGroups(cur); commit(); renderAll();
		return;
	}
	const it = find(sel);
	if (!it) return;
	const list = listOf(it);
	list.splice(list.indexOf(it.obj), 1);
	sel = null;
	tidyGroups(cur); commit(); renderAll();
}

// ---- copy, paste, duplicate

function packShapes(shapes) {
	const gids = new Set(shapes.map(s => s.group).filter(Boolean));
	return {
		from: cur.name,
		shapes: JSON.parse(JSON.stringify(shapes)),
		groups: JSON.parse(JSON.stringify(cur.groups.filter(g => gids.has(g.id)))),
	};
}

// puts copies of a pack into the design, moved by (dx, dy), and selects them
function insertPacked(pack, dx, dy) {
	const gmap = {}, made = [], idmap = {};
	for (const g of pack.groups || []) {
		const ng = { ...g, id: newId(), name: uniqueName(cur.groups, g.name) };
		gmap[g.id] = ng.id; cur.groups.push(ng);
	}
	for (const s of pack.shapes) {
		const n = JSON.parse(JSON.stringify(s));
		n.id = newId(); n.name = uniqueName(cur.shapes, s.name); idmap[s.id] = n.id;
		n.x = r4(n.x + dx); n.y = r4(n.y + dy);
		n.points = (n.points || []).map(p => ({ ...p, id: newId() }));
		if (n.group) { if (gmap[n.group]) n.group = gmap[n.group]; else delete n.group; }
		if (n.swatch && !cur.palette.some(w => w.id === n.swatch)) delete n.swatch;
		if (n.outlineSwatch && !cur.palette.some(w => w.id === n.outlineSwatch)) delete n.outlineSwatch;
		cur.shapes.push(n); made.push(n);
	}
	for (const n of made) {   // a pair copied together stays a pair; a lone twin becomes an ordinary shape
		if (n.mirror) { if (idmap[n.mirror]) n.mirror = idmap[n.mirror]; else delete n.mirror; }
		if (n.clip && idmap[n.clip]) n.clip = idmap[n.clip];
	}
	tidyGroups(cur);
	commit(); setSelection(made.map(s => s.id));
}

function copySelection() {
	const shapes = selectedShapes();
	if (!shapes.length) return;
	clip = packShapes(shapes); pasteCount = 0;
	writeJson(CLIP, clip);
	toast('Copied ' + shapes.length + (shapes.length === 1 ? ' shape' : ' shapes'));
}

function cutSelection() { if (selectedShapes().length) { copySelection(); deleteSelected(); } }

function pasteClipboard() {
	const c = clip || readJson(CLIP, null);
	if (!c || !c.shapes || !c.shapes.length) return toast('Nothing to paste. Copy some shapes first.');
	pasteCount++;
	const off = c.from === cur.name ? 8 * pasteCount : 0;   // into the same design: step aside so the copy is visible
	insertPacked(c, off, off);
}

function duplicateSelection() {
	const shapes = selectedShapes();
	if (shapes.length) return insertPacked(packShapes(shapes), 8, 8);
	const it = find(sel);
	if (it && it.kind === 'point') {
		const list = listOf(it), p = { ...it.obj, id: newId(), name: uniqueName(list, it.obj.name), x: it.obj.x + 4, y: it.obj.y + 4 };
		list.push(p); commit(); select(p.id);
	}
}

// ---- the library: shapes you keep around to reuse in any design
function saveToLibrary(name) {
	const shapes = selectedShapes();
	if (!shapes.length) return toast('Select some shapes first.');
	const lib = readJson(LIB, []);
	lib.push({ id: newId(), name: name || shapes[0].name, pack: packShapes(shapes) });
	writeJson(LIB, lib);
	toast('Saved to library: ' + (name || shapes[0].name));
}

function insertFromLibrary(id) {
	const item = readJson(LIB, []).find(l => l.id === id);
	if (!item) return;
	const pack = JSON.parse(JSON.stringify(item.pack));
	const b = unionBounds(pack.shapes.map(shapeBounds)), c = viewCenter();
	insertPacked(pack, Math.round(c.x - (b[0] + b[1]) / 2), Math.round(c.y - (b[2] + b[3]) / 2));
}

function deleteFromLibrary(id) { writeJson(LIB, readJson(LIB, []).filter(l => l.id !== id)); }

// ---- layer order

function reorder(mode) {
	const ids = new Set(selectedShapes().map(s => s.id));
	if (!ids.size) return;
	let a = cur.shapes;
	if (mode === 'front') a = [...a.filter(s => !ids.has(s.id)), ...a.filter(s => ids.has(s.id))];
	else if (mode === 'back') a = [...a.filter(s => ids.has(s.id)), ...a.filter(s => !ids.has(s.id))];
	else if (mode === 'forward') { for (let i = a.length - 2; i >= 0; i--) if (ids.has(a[i].id) && !ids.has(a[i + 1].id)) [a[i], a[i + 1]] = [a[i + 1], a[i]]; }
	else { for (let i = 1; i < a.length; i++) if (ids.has(a[i].id) && !ids.has(a[i - 1].id)) [a[i], a[i - 1]] = [a[i - 1], a[i]]; }
	cur.shapes = a;
	tidyGroups(cur); commit(); renderAll();
}

// hide / lock: turns the flag on for everything selected, or off if it is already on for all of it
function toggleFlag(flag) {
	const shapes = selectedShapes();
	if (!shapes.length) return;
	setFlag(shapes, flag, !shapes.every(s => s[flag]));
}

function setFlag(shapes, flag, on) {
	for (const s of shapes) { if (on) s[flag] = true; else delete s[flag]; }
	commit(); renderAll();
}

// ---- flip, align, distribute

// Mirrors the geometry in the shape's own axes; the rotation turns the other way so the result is a true mirror image.
function flipShape(s, axis) {
	const h = axis === 'h', f = (v) => {
		const o = { ...v };
		if (h) { o.x = -v.x; if (v.ix != null) o.ix = -v.ix; if (v.ox != null) o.ox = -v.ox; }
		else { o.y = -v.y; if (v.iy != null) o.iy = -v.iy; if (v.oy != null) o.oy = -v.oy; }
		return o;
	};
	if (s.vertices) s.vertices = s.vertices.map(f);
	if (s.parts) {
		for (const p of s.parts) {
			if (h) p.x = -p.x; else p.y = -p.y;
			p.rotation = wrapDeg(-p.rotation);
			if (p.vertices) p.vertices = p.vertices.map(f);
			if (p.rings) p.rings = p.rings.map(r => ({ hole: r.hole, v: r.v.map(f) }));
		}
	}
	for (const p of s.points) { if (h) p.x = -p.x; else p.y = -p.y; }
	if (s.pivot) { if (h) s.pivot.x = -s.pivot.x; else s.pivot.y = -s.pivot.y; }
	if (s.fillType === 'linear') s.gradAngle = wrapDeg(h ? 180 - s.gradAngle : -s.gradAngle);   // the blend turns with the mirror
	s.rotation = wrapDeg(-s.rotation);
}

function flipSelection(axis) {
	const shapes = selectedShapes();
	if (!shapes.length) return;
	const b = unionBounds(shapes.map(shapeBounds)), cx = (b[0] + b[1]) / 2, cy = (b[2] + b[3]) / 2;
	for (const s of shapes) {
		flipShape(s, axis);
		if (shapes.length > 1) { if (axis === 'h') s.x = r4(2 * cx - s.x); else s.y = r4(2 * cy - s.y); }
		gridVerts(s);
	}
	commit(); renderAll();
}

function moveShapes(shapes, dx, dy) { for (const s of shapes) { s.x = r4(s.x + dx); s.y = r4(s.y + dy); } }

// One shape lines up with the origin; several line up with each other.
function alignSelection(kind) {
	const shapes = selectedShapes();
	if (!shapes.length) return;
	const bs = shapes.map(shapeBounds), ref = shapes.length === 1 ? [0, 0, 0, 0] : unionBounds(bs);
	shapes.forEach((s, i) => {
		const b = bs[i];
		let dx = 0, dy = 0;
		if (kind === 'left') dx = ref[0] - b[0];
		else if (kind === 'right') dx = ref[1] - b[1];
		else if (kind === 'hcenter') dx = (ref[0] + ref[1]) / 2 - (b[0] + b[1]) / 2;
		else if (kind === 'top') dy = ref[2] - b[2];
		else if (kind === 'bottom') dy = ref[3] - b[3];
		else if (kind === 'vcenter') dy = (ref[2] + ref[3]) / 2 - (b[2] + b[3]) / 2;
		moveShapes([s], Math.round(dx), Math.round(dy));
	});
	commit(); renderAll();
}

// equal gaps between three or more shapes; the outer two stay where they are
function distributeSelection(axis) {
	const shapes = selectedShapes();
	if (shapes.length < 3) return toast('Select three or more shapes to distribute them.');
	const k = axis === 'h' ? 0 : 2, items = shapes.map(s => ({ s, b: shapeBounds(s) })).sort((p, q) => (p.b[k] + p.b[k + 1]) - (q.b[k] + q.b[k + 1]));
	const first = items[0].b[k], last = items[items.length - 1].b[k + 1];
	const sizes = items.reduce((n, it) => n + it.b[k + 1] - it.b[k], 0), gap = (last - first - sizes) / (items.length - 1);
	let at = first;
	for (const it of items) {
		const d = Math.round(at - it.b[k]);
		if (axis === 'h') moveShapes([it.s], d, 0); else moveShapes([it.s], 0, d);
		at += it.b[k + 1] - it.b[k] + gap;
	}
	commit(); renderAll();
}

// ---- groups: shapes that are listed together and move together (they stay separate shapes)

function groupSelection() {
	const shapes = selectedShapes();
	if (shapes.length < 2) return toast('Select two or more shapes to group them.');
	const g = { id: newId(), name: uniqueName(cur.groups, 'group') };
	cur.groups.push(g);
	for (const s of shapes) s.group = g.id;
	tidyGroups(cur);
	commit(); setSelection(shapes.map(s => s.id));
}

function ungroupSelection() {
	const ids = new Set(selectedShapes().map(s => s.group).filter(Boolean));
	if (!ids.size) return;
	for (const s of cur.shapes) if (ids.has(s.group)) delete s.group;
	tidyGroups(cur);
	commit(); renderAll();
}

function deleteGroup(g) {
	cur.shapes = cur.shapes.filter(s => s.group !== g.id);
	tidyGroups(cur); sel = null; multi.clear();
	commit(); renderAll();
}

// the look of a shape (fill, gradient, opacity, outline) onto another
function copyStyle(from, to) {
	for (const k of ['color', 'opacity', 'outline', 'outlineColor', 'fillType', 'color2', 'gradAngle']) to[k] = from[k];
	for (const k of ['swatch', 'outlineSwatch']) { if (from[k]) to[k] = from[k]; else delete to[k]; }
	if (from.stops) to.stops = from.stops.map(q => ({ ...q })); else delete to.stops;
	if (from.gradDetail) to.gradDetail = from.gradDetail; else delete to.gradDetail;
}

// points ride along when shapes are merged, re-expressed against the new shape
function carryPoints(shapes, ns, cx, cy) {
	for (const sh of shapes) for (const pt of sh.points) {
		const at = pointWorld(pt, sh);
		ns.points.push({ ...pt, id: newId(), name: uniqueName(ns.points, pt.name), x: r4(at.x - cx), y: r4(at.y - cy) });
	}
}

// ---- boolean operations: the result is one shape made of true polygons (with holes where needed)

// a shape as outlines in world coordinates (its parts merged)
function shapeRegion(s, n) {
	let rings = null;
	for (const p of worldParts(s, n)) {
		const r = partRings(p, n).map(x => x.pts);
		rings = rings ? boolOp('union', rings, r) : r;
	}
	return rings;
}

// op: union | subtract | intersect | xor. The back-most selected shape is the one the others act on.
function booleanSelected(op) {
	const shapes = selectedShapes();
	if (shapes.length < 2) return toast('Select two or more shapes first.');
	if (shapes.some(x => x.type === 'line')) return toast('Lines cannot be used in boolean operations.');
	const n = cur.segments;
	let acc = shapeRegion(shapes[0], n);
	for (const s of shapes.slice(1)) acc = boolOp(op, acc, shapeRegion(s, n));
	if (!acc.length) return toast('Nothing is left of those shapes.');
	const outers = acc.filter(r => ringArea(r) > 0).map(r => ({ ring: r, holes: [] }));
	for (const h of acc.filter(r => ringArea(r) < 0)) {
		const mid = [(h[0][0] + h[1][0]) / 2, (h[0][1] + h[1][1]) / 2];
		const owners = outers.filter(o => insideRegion(mid, [o.ring])).sort((a, b) => ringArea(a.ring) - ringArea(b.ring));
		if (owners.length) owners[0].holes.push(h);
	}
	if (!outers.length) return toast('Nothing is left of those shapes.');
	const all = acc.flat(), xs = all.map(p => p[0]), ys = all.map(p => p[1]);
	const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
	const cx = r4((x0 + x1) / 2), cy = r4((y0 + y1) / 2), base = shapes[0], ids = new Set(shapes.map(s => s.id));
	const parts = outers.map(o => {
		const px = o.ring.map(p => p[0]), py = o.ring.map(p => p[1]);
		const bx0 = Math.min(...px), bx1 = Math.max(...px), by0 = Math.min(...py), by1 = Math.max(...py);
		const w = r6(Math.max(bx1 - bx0, 1e-3)), h = r6(Math.max(by1 - by0, 1e-3)), mx = (bx0 + bx1) / 2, my = (by0 + by1) / 2;
		return {
			type: 'region', x: r4(mx - cx), y: r4(my - cy), width: w, height: h, rotation: 0,
			rings: [o.ring, ...o.holes].map((r, i) => ({ hole: i > 0, v: r.map(p => ({ x: r6((p[0] - mx) / w), y: r6((p[1] - my) / h) })) })),
		};
	});
	const W = r4(Math.max(x1 - x0, 1e-3)), H = r4(Math.max(y1 - y0, 1e-3));
	const ns = makeShape({ type: 'combined', x: cx, y: cy, width: W, height: H, baseWidth: W, baseHeight: H, parts });
	copyStyle(base, ns);
	carryPoints(shapes, ns, cx, cy);
	const idx = cur.shapes.indexOf(base);
	cur.shapes = cur.shapes.filter(s => !ids.has(s.id));
	ns.name = uniqueName(cur.shapes, { union: 'union', subtract: 'subtract', intersect: 'intersect', xor: 'exclude' }[op]);
	cur.shapes.splice(idx, 0, ns);
	tidyGroups(cur);
	commit(); select(ns.id);
}

// ---- clipping: a shape that shows only where it lies inside another shape (a shadow that cannot spill over its object)
const clippable = (s) => s.type !== 'line';

// the front-most of two selected shapes is clipped to the other one
function clipToShape() {
	const shapes = selectedShapes();
	if (shapes.length !== 2 || !shapes.every(clippable)) return toast('Select two shapes (not lines): the front one is clipped to the one behind it.');
	const [mask, top] = cur.shapes.indexOf(shapes[0]) < cur.shapes.indexOf(shapes[1]) ? [shapes[0], shapes[1]] : [shapes[1], shapes[0]];
	setClip(top, mask.id);
}

function setClip(s, maskId) {
	if (maskId) s.clip = maskId; else delete s.clip;
	normalize(cur);
	commit(); renderAll();
}

function releaseClip() {
	const list = selectedShapes().filter(x => x.clip);
	if (!list.length) return;
	for (const x of list) delete x.clip;
	commit(); renderAll();
}

// the number of sides every circle is drawn with, for the whole design
function setSegments(n) {
	cur.segments = clamp(Math.round(n / 4) * 4, 8, 128);
	commit(); renderAll();
}

// ---- corners: rounding and smoothing
// radius (pixels) and smooth (0 to 1) sit on the shape, or on each part of a combined shape. A circle has no corners.

const cornerOwners = (s) => s.parts ? s.parts.filter(p => p.type !== 'circle') : s.type === 'circle' ? [] : [s];
const hasCorners = (s) => cornerOwners(s).length > 0;

// the value shared by every selected shape's corners, or null when they differ
function cornerValue(shapes, key) {
	const list = shapes.flatMap(cornerOwners);
	if (!list.length) return 0;
	return list.every(o => (o[key] || 0) === (list[0][key] || 0)) ? (list[0][key] || 0) : null;
}

function setCorners(shapes, key, v) {
	for (const s of shapes) for (const o of cornerOwners(s)) {
		if (key === 'radius' && o.type === 'line') continue;   // a line has no corners to round, only curves
		if (v > 0) o[key] = v; else delete o[key];
	}
}

// one-step versions for the Object menu: pick a sensible amount, then fine-tune it in the Corners section of Properties
function roundSelected() {
	const shapes = selectedShapes().filter(x => hasCorners(x) && x.type !== 'line');
	if (!shapes.length) return toast('Select a shape with corners first.');
	for (const s of shapes) {
		const b = shapeBounds(s), r = Math.max(2, Math.round(Math.min(b[1] - b[0], b[3] - b[2]) * 0.15));
		setCorners([s], 'radius', r);
	}
	commit(); renderAll();
}

function smoothSelected() {
	const shapes = selectedShapes().filter(hasCorners);
	if (!shapes.length) return toast('Select a shape with corners first.');
	setCorners(shapes, 'smooth', cornerValue(shapes, 'smooth') > 0 ? 0 : 0.5);
	commit(); renderAll();
}

function sharpSelected() {
	const shapes = selectedShapes().filter(hasCorners);
	for (const s of shapes) for (const o of cornerOwners(s)) { delete o.radius; delete o.smooth; for (const v of o.vertices || []) { delete v.r; delete v.s; } }
	commit(); renderAll();
}

// the selected corners while editing a shape's vertices: their own radius / smoothing, or back to the shape's
function setVertexLook(s, key, v) {   // key: r | s
	for (const i of vsel) { const q = s.vertices[i]; if (!q) continue; if (v == null) delete q[key]; else q[key] = v; }
}

// ---- curves: corners become smooth Bezier points (with handles) and back
// A smooth point's handles lie along the line between its two neighbours, a sixth of the way there: the same curve smoothing makes.
function makeCurved(s, idxs) {
	const n = s.vertices.length, bw = s.width * s.scale, bh = s.height * s.scale, closed = s.type !== 'line';
	if (!bw || !bh || n < 2) return;
	const P = s.vertices.map(v => [v.x * bw, v.y * bh]);
	for (const i of idxs) {
		const v = s.vertices[i];
		if (!v) continue;
		const prev = closed ? P[(i + n - 1) % n] : P[Math.max(i - 1, 0)], next = closed ? P[(i + 1) % n] : P[Math.min(i + 1, n - 1)];
		const f = (v.s ?? s.smooth) > 0 ? (v.s ?? s.smooth) : 1, tx = (next[0] - prev[0]) / 6 * f / bw, ty = (next[1] - prev[1]) / 6 * f / bh;
		const first = !closed && i === 0, last = !closed && i === n - 1;
		if (!first) { v.ix = r6(-tx); v.iy = r6(-ty); } else { delete v.ix; delete v.iy; }
		if (!last) { v.ox = r6(tx); v.oy = r6(ty); } else { delete v.ox; delete v.oy; }
		delete v.s; delete v.r;
	}
}
function makeCorner(s, idxs) { for (const i of idxs) { const v = s.vertices[i]; if (v) { delete v.ix; delete v.iy; delete v.ox; delete v.oy; } } }

// the selected corners while editing, or every corner of the selected shapes
function curveSelected(toCurve) {
	if (vertexMode) {
		const it = find(vertexMode);
		if (!it || !vsel.size) return;
		(toCurve ? makeCurved : makeCorner)(it.obj, [...vsel]);
	} else {
		for (const s of selectedShapes()) {
			if (!s.vertices || s.locked || s.type === 'circle') continue;
			const all = s.vertices.map((_, i) => i);
			if (toCurve) { makeCurved(s, all); delete s.smooth; } else makeCorner(s, all);
		}
	}
	commit(); renderAll();
}

// ---- combine: several shapes become one solid shape; the parts are kept, so circles stay true circles

function combineSelected() {
	const shapes = selectedShapes();
	if (shapes.length < 2) return toast('Select two or more shapes to combine them.');
	if (shapes.some(x => x.type === 'line')) return toast('Lines cannot be combined.');
	const ids = new Set(shapes.map(s => s.id));
	const world = shapes.flatMap(x => worldParts(x));
	const b = world.map(partBounds);
	const x0 = Math.min(...b.map(q => q[0])), x1 = Math.max(...b.map(q => q[1]));
	const y0 = Math.min(...b.map(q => q[2])), y1 = Math.max(...b.map(q => q[3]));
	const cx = r4((x0 + x1) / 2), cy = r4((y0 + y1) / 2), top = shapes[shapes.length - 1];
	const ns = makeShape({
		type: 'combined', x: cx, y: cy, width: r4(x1 - x0), height: r4(y1 - y0), baseWidth: r4(x1 - x0), baseHeight: r4(y1 - y0),
		parts: world.map(p => ({
			type: p.type, x: r4(p.x - cx), y: r4(p.y - cy), width: r4(p.width), height: r4(p.height), rotation: wrapDeg(p.rotation),
			...(p.vertices ? { vertices: p.vertices } : {}), ...(p.rings ? { rings: p.rings } : {}),
			...(p.radius ? { radius: p.radius } : {}), ...(p.smooth ? { smooth: p.smooth } : {}),
		})),
	});
	copyStyle(top, ns);
	carryPoints(shapes, ns, cx, cy);
	const idx = cur.shapes.indexOf(shapes[0]);
	cur.shapes = cur.shapes.filter(s => !ids.has(s.id));
	ns.name = uniqueName(cur.shapes, 'combined');
	cur.shapes.splice(idx, 0, ns);
	tidyGroups(cur);
	commit(); select(ns.id);
}

// turn a combined shape back into its separate parts
function uncombineSelected() {
	const it = find(sel);
	if (!it || it.kind !== 'shape' || !it.obj.parts) return;
	const g = it.obj, idx = cur.shapes.indexOf(g);
	if (g.parts.some(p => p.type === 'region')) return toast('This came from a boolean operation and cannot be split back. Undo it instead.');
	cur.shapes.splice(idx, 1);
	const made = [];
	for (const p of rawParts(g)) {
		const sh = makeShape({
			name: uniqueName([...cur.shapes, ...made], p.type), type: p.type, x: r4(p.x), y: r4(p.y), width: r4(p.width), height: r4(p.height),
			rotation: wrapDeg(p.rotation),
		});
		copyStyle(g, sh);
		if (g.group) sh.group = g.group;
		if (g.hidden) sh.hidden = true;
		if (p.vertices) sh.vertices = p.vertices;
		if (p.radius) sh.radius = p.radius;
		if (p.smooth) sh.smooth = p.smooth;
		made.push(sh);
	}
	cur.shapes.splice(idx, 0, ...made);
	for (const pt of g.points) {   // keep the points: they go to the first part
		const at = pointWorld(pt, g), f = made[0], a = rad(f.rotation), dx = at.x - f.x, dy = at.y - f.y;
		f.points.push({ ...pt, id: newId(), x: r4(dx * Math.cos(a) + dy * Math.sin(a)), y: r4(-dx * Math.sin(a) + dy * Math.cos(a)) });
	}
	tidyGroups(cur);
	commit(); setSelection(made.map(s => s.id));
}

// ---- pivot: where a shape turns in the game
function setPivot(s, x, y) {
	x = r4(x); y = r4(y);
	if (x || y) s.pivot = { x, y }; else delete s.pivot;
}
// Turns a shape about its pivot: the pivot stays where it is and the shape's centre swings around it.
function setRotation(s, r, at) {
	at ||= pointWorld(pivotOf(s), s);
	s.rotation = r;
	const q = pointWorld(pivotOf(s), s);
	s.x += at.x - q.x; s.y += at.y - q.y;
}
// ---- symmetry: a mirror image of a shape across the design's symmetry axis (a vertical line at x = cur.axis)
// A twin made by symmetry drawing or Duplicate mirrored stays linked: twin.mirror = the id of its source. Edit either one and the other follows
// (syncMirrors). Name, group, points, hidden, locked and clip are the twin's own.
const mirrorSkip = new Set(['id', 'name', 'group', 'points', 'hidden', 'locked', 'mirror', 'clip']);
const mirrorSig = new Map();   // shape id -> what it looked like when the pair was last made to match (not saved)
function mirrorSigOf(s, axis) {
	const o = {};
	for (const k of Object.keys(s).sort()) if (!mirrorSkip.has(k)) o[k] = s[k];
	return JSON.stringify([o, axis || 0]);
}

// a mirrored copy of a shape's own fields (no name or id)
function mirrorGeometry(s, axis) {
	const t = JSON.parse(JSON.stringify(s));
	flipShape(t, 'h');
	t.x = r4(2 * axis - s.x);
	return t;
}

function mirrorShape(s) {
	const t = mirrorGeometry(s, cur.axis || 0);
	t.id = newId(); t.name = uniqueName(cur.shapes, s.name + ' mirror');
	t.points = (t.points || []).map(p => ({ ...p, id: newId() }));
	if (s.mirror || cur.shapes.some(x => x.mirror === s.id)) delete t.mirror; else t.mirror = s.id;   // a shape has one twin, and a twin has none of its own
	return t;
}

// the id of the shape that mirrors this one (or that this one mirrors)
function twinIdOf(d, id) {
	const a = d.shapes.find(x => x.mirror === id);
	if (a) return a.id;
	const b = d.shapes.find(x => x.id === id);
	return (b && b.mirror) || null;
}

// makes every linked pair match. The source drives, unless only the twin was edited since the last time.
function syncMirrors(d) {
	if (!d || !d.shapes.some(x => x.mirror)) return;
	const axis = d.axis || 0;
	for (const t of d.shapes) {
		if (!t.mirror) continue;
		const src = d.shapes.find(x => x.id === t.mirror);
		if (!src) continue;
		const ss = mirrorSigOf(src, axis), ts = mirrorSigOf(t, axis), ps = mirrorSig.get(src.id), pt = mirrorSig.get(t.id);
		let from = src, to = t;
		if (ps !== undefined && pt !== undefined && ss === ps && ts !== pt) { from = t; to = src; }
		const m = mirrorGeometry(from, axis);
		if (mirrorSigOf(m, axis) !== mirrorSigOf(to, axis)) {
			for (const k of Object.keys(to)) if (!mirrorSkip.has(k)) delete to[k];
			for (const k of Object.keys(m)) if (!mirrorSkip.has(k)) to[k] = m[k];
		}
		if (from.clip) to.clip = twinIdOf(d, from.clip) || from.clip; else delete to.clip;
		mirrorSig.set(src.id, mirrorSigOf(src, axis)); mirrorSig.set(t.id, mirrorSigOf(t, axis));
	}
}

function unlinkMirror() {
	const list = selectedShapes(), ids = new Set(list.map(x => x.id));
	let n = 0;
	for (const x of cur.shapes) if (x.mirror && (ids.has(x.id) || ids.has(x.mirror))) { delete x.mirror; n++; }
	if (!n) return;
	commit(); renderAll();
	toast('Unlinked. The two shapes are separate now.');
}

// While symmetry drawing is on, a new shape gets a twin on the other side of the axis. A plain shape that sits on the axis is already symmetric.
function symTwin(s) {
	if (!prefs.symmetry) return null;
	if (TYPES.includes(s.type) && !s.rotation && Math.abs(s.x - (cur.axis || 0)) < 0.5) return null;
	return mirrorShape(s);
}

function mirrorCopySelected() {
	const list = selectedShapes();
	if (!list.length) return;
	const twins = list.map(mirrorShape);
	cur.shapes.push(...twins);
	commit(); setSelection([...list, ...twins].map(s => s.id));
}

// Turns shapes together, clockwise by deg, about the point c: each shape's centre swings round it and the shape turns by the same angle.
// base = [{ x, y, rotation }] the shapes' starting values (so a drag can start from them every time).
function turnAbout(list, base, c, deg) {
	const a = rad(deg), ca = Math.cos(a), sa = Math.sin(a);
	list.forEach((s, i) => {
		const b = base[i];
		s.x = r4(c.x + (b.x - c.x) * ca - (b.y - c.y) * sa);
		s.y = r4(c.y + (b.x - c.x) * sa + (b.y - c.y) * ca);
		s.rotation = wrapDeg(b.rotation + deg);
	});
}

// Rotates the selection by deg: one shape turns about its pivot, several turn together about the middle of the selection.
function rotateSelection(deg) {
	const list = selectedShapes().filter(s => !s.locked);
	if (!list.length) return;
	if (list.length === 1) setRotation(list[0], wrapDeg(list[0].rotation + deg));
	else {
		const b = unionBounds(list.map(shapeBounds));
		turnAbout(list, list.map(s => ({ x: s.x, y: s.y, rotation: s.rotation })), { x: (b[0] + b[1]) / 2, y: (b[2] + b[3]) / 2 }, deg);
	}
	commit(); renderAll();
}

// Moves a point onto another shape, or makes it a design point (shapeId = ''). It stays where it is on the canvas.
function attachPoint(it, shapeId) {
	const pt = it.obj, from = it.owner, to = shapeId ? cur.shapes.find(s => s.id === shapeId) : null;
	if (from === to || (shapeId && !to)) return;
	const w = pointWorld(pt, from), list = to ? to.points : cur.points;
	const old = from ? from.points : cur.points;
	old.splice(old.indexOf(pt), 1);
	if (to) { const l = toLocal(to, w.x - to.x, w.y - to.y); pt.x = r4(l.x); pt.y = r4(l.y); } else { pt.x = r4(w.x); pt.y = r4(w.y); }
	pt.name = uniqueName(list, pt.name, pt);
	list.push(pt);
	commit(); renderAll();
}
function pivotFromPoint(s, pt) { setPivot(s, pt.x, pt.y); commit(); renderAll(); toast('"' + pt.name + '" is now the pivot of ' + s.name + '.'); }

// ---- drawing a custom polygon: click points; clicking the first point again closes the outline into a filled shape.
// A line is drawn the same way but stays open: click points, then press Enter, click the last point again, or double-click to finish.

function cancelDraw() { setTool('select'); }

// a vertex of a shape being drawn: its place in the box, and the handles pulled out while placing it (ho = { ox, oy } in pixels)
function penVertex(x, y, cx, cy, w, h, ho) {
	const v = { x: r6((x - cx) / w), y: r6((y - cy) / h) };
	if (ho && (ho.ox || ho.oy)) { v.ox = r6(ho.ox / w); v.oy = r6(ho.oy / h); v.ix = -v.ox; v.iy = -v.oy; }
	return v;
}

function finishDraw() {
	if (!drawMode) return;
	const line = drawMode.line;
	if (drawMode.pts.length < (line ? 2 : 3)) return;
	const P = drawMode.pts, xs = P.map(q => q[0]), ys = P.map(q => q[1]);
	const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
	const w = Math.max(x1 - x0, line ? 1 : 0), h = Math.max(y1 - y0, line ? 1 : 0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
	if (!line && (w <= 0 || h <= 0)) return toast('That outline is flat - it needs some area.');
	if (line) {
		const sh = makeShape({
			name: uniqueName(cur.shapes, 'line'), type: 'line', x: cx, y: cy, width: w, height: h, color: SHAPE_COLOR.line, lineWidth: 4, cap: 'round',
			vertices: P.map(([x, y], i) => penVertex(x, y, cx, cy, w, h, drawMode.h[i])),
		});
		if (P.some(q => !Number.isInteger(q[0]) || !Number.isInteger(q[1]))) sh.free = true;   // points snapped to other shapes keep their exact place
		drawMode = null; tool = 'select';
		cur.shapes.push(sh);
		const twin = symTwin(sh);
		if (twin) cur.shapes.push(twin);
		commit();
		if (twin) setSelection([sh.id, twin.id]); else select(sh.id);
		return;
	}
	const sh = makeShape({
		name: uniqueName(cur.shapes, 'polygon'), type: 'custom', x: cx, y: cy, width: w, height: h, color: SHAPE_COLOR.custom,
		vertices: P.map(([x, y], i) => penVertex(x, y, cx, cy, w, h, drawMode.h[i])),
	});
	if (P.some(q => !Number.isInteger(q[0]) || !Number.isInteger(q[1]))) sh.free = true;
	drawMode = null; tool = 'select';
	cur.shapes.push(sh);
	const twin = symTwin(sh);
	if (twin) cur.shapes.push(twin);
	commit();
	if (twin) setSelection([sh.id, twin.id]); else select(sh.id);
}

// a click (or a click and drag, which pulls out the point's curve handles) places a point; pull = { at: [x, y], ox, oy }
function drawClick(e, pull) {
	const w = pull ? { x: pull.at[0], y: pull.at[1] } : toWorld(e), P = pull ? pull.at : penSnap(e).p, pts = drawMode.pts;
	if (!drawMode.line && pts.length >= 3 && Math.hypot((pts[0][0] - w.x) * view.z, (pts[0][1] - w.y) * view.z) < 10) return finishDraw();
	const end = pts[pts.length - 1];
	if (drawMode.line && pts.length >= 2 && Math.hypot((end[0] - w.x) * view.z, (end[1] - w.y) * view.z) < 10) return finishDraw();   // clicking the last point again ends the line
	const last = pts[pts.length - 1];
	if (last && last[0] === P[0] && last[1] === P[1]) return;
	pts.push(P);
	drawMode.h.push(pull && (pull.ox || pull.oy) ? { ox: pull.ox, oy: pull.oy } : null);
	renderMenubar(); draw();
}

// ---- vertex editing: the shape's corner points become draggable (shift = pick several)

function enterVertex() {
	const s = selectedShapes();
	if (s.length !== 1) return;
	const o = s[0];
	if (o.parts) return toast('Uncombine this shape to edit its parts.');
	if (o.locked) return toast('This shape is locked.');
	vertexMode = o.id; vsel.clear(); addingVertex = false;
	vSnapshot = JSON.stringify(o.type === 'circle' ? { x: o.x, y: o.y, width: o.width, height: o.height, rotation: o.rotation } : o.vertices);
	renderMenubar(); draw();
}

function exitVertex(cancel) {
	const it = find(vertexMode);
	if (it && cancel) {
		if (it.obj.type === 'circle') Object.assign(it.obj, JSON.parse(vSnapshot)); else it.obj.vertices = JSON.parse(vSnapshot);
		commit();
	}
	vertexMode = null; vsel.clear(); addingVertex = false;
	renderMenubar(); renderInspector(); draw();
}

function insertVertex(s, i, at) {
	const bw = s.width * s.scale || 1, bh = s.height * s.scale || 1;
	const l = toLocal(s, at.x - s.x, at.y - s.y);
	const A = s.vertices[i], B = s.vertices[(i + 1) % s.vertices.length];
	const ax = A.x * bw, ay = A.y * bh, dx = B.x * bw - ax, dy = B.y * bh - ay;
	const t = Math.max(0, Math.min(1, ((l.x - ax) * dx + (l.y - ay) * dy) / (dx * dx + dy * dy || 1)));
	if (hasHandles(A) || hasHandles(B)) {   // a curved side is split where it is, so the shape does not change
		const P0 = [ax, ay], P1 = [ax + (A.ox || 0) * bw, ay + (A.oy || 0) * bh], P3 = [B.x * bw, B.y * bh], P2 = [P3[0] + (B.ix || 0) * bw, P3[1] + (B.iy || 0) * bh];
		const mid = (p, q) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
		const a = mid(P0, P1), b = mid(P1, P2), c = mid(P2, P3), d = mid(a, b), e = mid(b, c), Q = mid(d, e);
		A.ox = r6((a[0] - P0[0]) / bw); A.oy = r6((a[1] - P0[1]) / bh);
		B.ix = r6((c[0] - P3[0]) / bw); B.iy = r6((c[1] - P3[1]) / bh);
		s.vertices.splice(i + 1, 0, { x: r6(Q[0] / bw), y: r6(Q[1] / bh), ix: r6((d[0] - Q[0]) / bw), iy: r6((d[1] - Q[1]) / bh), ox: r6((e[0] - Q[0]) / bw), oy: r6((e[1] - Q[1]) / bh) });
		vsel.clear(); vsel.add(i + 1);
		commit(); draw();
		return;
	}
	const nx = Math.round(s.x + ax + dx * t) - s.x, ny = Math.round(s.y + ay + dy * t) - s.y;
	s.vertices.splice(i + 1, 0, { x: r6(nx / bw), y: r6(ny / bh) });
	vsel.clear(); vsel.add(i + 1);
	commit(); draw();
}

function deleteVertices() {
	const it = find(vertexMode);
	if (!it || !vsel.size) return;
	const rest = it.obj.vertices.filter((_, i) => !vsel.has(i));
	if (rest.length < (it.obj.type === 'line' ? 2 : 3)) return toast(it.obj.type === 'line' ? 'A line needs at least 2 points.' : 'A shape needs at least 3 corners.');
	it.obj.vertices = rest; vsel.clear();
	refit(it.obj); commit(); renderInspector(); draw();
}

// ---- palette

function rememberColor(hex) { writeJson(RECENT, [hex, ...readJson(RECENT, []).filter(c => c !== hex)].slice(0, 10)); }

function addSwatch(color, name) {
	const w = { id: newId(), name: uniqueName(cur.palette, name || 'color'), color };
	cur.palette.push(w);
	commit(); renderAll();
	return w;
}

function deleteSwatch(w) {
	cur.palette = cur.palette.filter(p => p !== w);
	for (const s of cur.shapes) {
		if (s.swatch === w.id) delete s.swatch;
		if (s.outlineSwatch === w.id) delete s.outlineSwatch;
	}
	commit(); renderAll();
}

// make the shapes follow a swatch (which = 'fill' or 'outline')
function applySwatch(shapes, w, which) {
	const [ck, sk] = which === 'outline' ? ['outlineColor', 'outlineSwatch'] : ['color', 'swatch'];
	for (const s of shapes) { s[ck] = w.color; s[sk] = w.id; }
	commit(); renderAll();
}

// ---- origin: the point (0,0) your game positions. Moving it slides the whole design under it.

function setOrigin(px, py) {
	px = Math.round(px); py = Math.round(py);
	if (!px && !py) return;
	for (const s of cur.shapes) { s.x = r4(s.x - px); s.y = r4(s.y - py); }
	for (const p of cur.points) { p.x = r4(p.x - px); p.y = r4(p.y - py); }
	view.tx += px * view.z; view.ty += py * view.z;   // the picture stays put; the axes move
	commit(); renderAll();
}

function contentBounds() {
	const list = cur.shapes.filter(s => !s.hidden).map(shapeBounds);
	return list.length ? unionBounds(list) : null;
}

// fx, fy in 0..1: where on the design's bounding box the origin goes (0,1 = bottom left, .5,1 = bottom centre)
function originPreset(fx, fy) {
	const b = contentBounds();
	if (!b) return toast('Add a shape first.');
	setOrigin(b[0] + (b[1] - b[0]) * fx, b[2] + (b[3] - b[2]) * fy);
}

// ------------------------------------------------------------------------------------------------ screens

function show(which) {
	$('#menu').hidden = which !== 'menu';
	$('#editor').hidden = which !== 'editor';
}

function openDesign(name) {
	cur = normalize(db.designs[name]);
	sel = null; multi.clear(); resetModes(); renaming = null; tool = 'select'; guides = []; marquee = null; ghost = null; dirty = false;
	hist = [JSON.stringify(cur)]; hi = 0;
	show('editor');
	const box = $('#canvas').getBoundingClientRect();
	view.z = 3; view.tx = box.width / 2; view.ty = box.height / 2;
	renderAll();
	loadReferences();
	if (typeof onDesignOpened === 'function') onDesignOpened();
}

function closeDesign() {
	if (cur && typeof onDesignClosing === 'function') onDesignClosing();
	cur = null;
	show('menu');
	renderMenu();
}

function renderAll() {
	if (!cur) return;
	const n = $('#designName');
	if (!n.hidden) n.textContent = cur.name;
	updateUndoButtons();
	renderTree(); renderInspector(); renderMenubar(); renderToolbar(); draw();
}

// ------------------------------------------------------------------------------------------------ the design list

function createDesign() {
	const input = $('#newName');
	const name = input.value.trim();
	if (!name) return toast('Give the design a name first.');
	if (db.designs[name]) return toast('A design called "' + name + '" already exists.');
	db.designs[name] = normalize({ name, shapes: [], points: [] });
	persist();
	input.value = '';
	openDesign(name);
}

function thumb(d) {
	const list = d.shapes.filter(s => !s.hidden), box = el('div', { class: 'thumb' });
	if (!list.length) return box;
	const b = unionBounds(list.map(x => shapeBounds(x, d))), pad = 3, w = b[1] - b[0] + pad * 2, h = b[3] - b[2] + pad * 2;
	const root = svg('svg', { viewBox: `${b[0] - pad} ${b[2] - pad} ${w} ${h}`, preserveAspectRatio: 'xMidYMid meet' });
	for (const s of list) root.append(shapeNode(s, true, d.segments, d));
	box.append(root);
	return box;
}

function renderMenu() {
	const list = $('#designList');
	list.replaceChildren();
	const names = Object.keys(db.designs).sort((a, b) => a.localeCompare(b));
	if (!names.length) list.append(el('p', { class: 'empty' }, 'No designs yet. Name one above and press Create.'));
	for (const name of names) {
		const d = db.designs[name];
		const pts = d.points.length + d.shapes.reduce((n, s) => n + s.points.length, 0);
		list.append(el('div', { class: 'design' },
			thumb(d),
			el('div', { class: 'design-info' }, nameButton(name), el('span', { class: 'meta' }, d.shapes.length + ' shapes · ' + pts + ' points')),
			el('span', { class: 'spacer' }),
			el('button', { onclick: () => openDesign(name) }, 'Edit'),
			el('button', { class: 'primary', onclick: () => openGmlDialog(d) }, 'Export GML'),
			el('button', { onclick: () => exportDesign(d) }, 'Export JSON'),
			deleteButton(name),
		));
	}
}

// click opens the design, double-click renames it (the open waits a moment so a double-click does not open it first)
function nameButton(name) {
	let timer;
	return el('button', {
		class: 'name', title: 'Click to open, double-click to rename',
		onclick: () => { clearTimeout(timer); timer = setTimeout(() => openDesign(name), 250); },
		ondblclick: (e) => {
			clearTimeout(timer);
			inlineEdit(e.currentTarget, name, (v) => { renameDesign(name, v); renderMenu(); });
		},
	}, name);
}

// swaps a label for a text box in place; Enter or clicking away applies, Esc cancels
function inlineEdit(node, value, apply) {
	const input = el('input', { type: 'text', class: 'inline-name', maxlength: 40, value });
	node.hidden = true;
	node.after(input);
	input.focus(); input.select();
	let done = false;
	const finish = (ok) => {
		if (done) return;
		done = true;
		input.remove(); node.hidden = false;
		if (ok) apply(input.value);
	};
	input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); e.stopPropagation(); });
	input.addEventListener('blur', () => finish(true));
}

function renameDesign(oldName, value) {
	const name = value.trim();
	if (!name || name === oldName) return false;
	if (db.designs[name]) { toast('A design called "' + name + '" already exists.'); return false; }
	const d = db.designs[oldName];
	delete db.designs[oldName];
	d.name = name;
	db.designs[name] = d;
	if (cur === d) hist = hist.map(h => JSON.stringify({ ...JSON.parse(h), name }));   // undo must not bring the old name back
	if (typeof onDesignRenamed === 'function') onDesignRenamed(oldName, name);
	persist();
	return true;
}

// two clicks to delete, so there is no dialog to get in the way
function deleteButton(name) {
	const b = el('button', { class: 'danger' }, 'Delete');
	let timer;
	b.addEventListener('click', () => {
		if (!b.classList.contains('armed')) {
			b.classList.add('armed'); b.textContent = 'Really?';
			timer = setTimeout(() => { b.classList.remove('armed'); b.textContent = 'Delete'; }, 3000);
			return;
		}
		clearTimeout(timer);
		delete db.designs[name];
		persist(); renderMenu();
	});
	return b;
}

// ------------------------------------------------------------------------------------------------ export / import

const ABOUT = 'Units are pixels, +y points down, (0,0) is the entity position. Shapes draw in list order (first = at the back). '
	+ 'A shape is centred on x,y and its box measures width*scale by height*scale (a negative scale flips it). '
	+ 'type "circle" is an ellipse inside that box (a circle can be stretched: it is then simply an ellipse with a rotation). type "combined" is several shapes merged into one solid colour: '
	+ 'its "parts" (each a circle or a polygon, with x,y = centre offset from the shape centre, width,height in pixels and rotation in degrees, all before the combined shape\'s own scale) are all drawn in the shape\'s colour; the combined shape\'s scale multiplies the offsets and sizes, "stretch" (x and y) then stretches them further along the shape\'s own x and y axes (a rotated part is skewed by that), and finally the shape\'s rotation turns everything about its centre. Every other type is a polygon: "vertices" lists its corners in order, each as a fraction of the box '
	+ '(corner pixel = centre + (vx*width*scale, vy*height*scale), before rotation), so edited corners are already included. '
	+ 'rotation is in degrees, clockwise, about the shape centre. A point on a shape has x,y as an offset from the shape centre '
	+ '(unscaled, before rotation), so it moves and rotates with the shape. '
	+ 'An optional pivot {x,y} (same units as a shape point) is the spot the shape turns around in the game; without one it turns about its centre. '
	+ 'Design points are fixed spots in the design. '
	+ 'opacity is 0 to 1. outline is a width in pixels (0 = none) that grows outward from the shape\'s edge, in outlineColor. '
	+ 'fill is "linear" or "radial" when a shape has a gradient from color to color2 (gradientAngle is the direction in degrees, 0 = left to right, 90 = top to bottom, turning with the shape). gradientStops [{at 0-1, color}] are extra colours between color (at 0) and color2 (at 1). gradientSmoothness (1-16, optional) is how finely a radial gradient is drawn in the game. '
	+ 'type "line" is an open path: "vertices" are its points in order, lineWidth is its thickness in pixels, cap is "round" or "flat" for the two ends, color is the line colour and smooth curves it. '
	+ 'cornerRadius (pixels) rounds every corner of a shape or part, and smooth (0 to 1) turns the line through its corners into a curve; a single vertex can carry its own cornerRadius or smooth. Both are already worked out in the exported script. A vertex may also have handleIn and handleOut {x,y} (fractions of the box, as an offset from the vertex): the side next to a handle is a cubic Bezier curve, already cut into straight pieces in the exported script. '
	+ 'circleSides is how many sides every circle is drawn with. A line may also have dash [on, off], taperStart and taperEnd (0-0.5 of its length), arrowStart, arrowEnd and arrowSize (in line widths); the exported script draws such a line as plain filled polygons. A shape may have mirrorOf (the name of another shape): it is then kept as the mirror image of that shape across symmetryAxis by the editor. A shape may have clipTo (the name of another shape): it is then drawn only where it lies inside that shape, and its points already describe the cut. guideLines are the editor ruler guides and can be ignored. A part of type "region" is a polygon with holes: its "rings" list outlines, each a list of corners as fractions of the part\'s box, with hole true for the ones that cut a hole. '
	+ '"swatch" and "outlineSwatch" name the palette colour a shape follows (its color is already that colour). "group" names the group a shape belongs to. hidden and locked are editor flags.';

// a corner as written to a file: its position, and its own radius / smoothing if it has them
const outV = (v) => ({ x: v.x, y: v.y, ...(v.r != null ? { cornerRadius: v.r } : {}), ...(v.s != null ? { smooth: v.s } : {}), ...(hasHandles(v) ? { handleIn: { x: v.ix || 0, y: v.iy || 0 }, handleOut: { x: v.ox || 0, y: v.oy || 0 } } : {}) });
// ... and back
const inV = (v) => { const o = { x: v.x, y: v.y }; if (v.cornerRadius != null) o.r = v.cornerRadius; if (v.smooth != null) o.s = v.smooth; if (v.handleIn) { o.ix = v.handleIn.x; o.iy = v.handleIn.y; } if (v.handleOut) { o.ox = v.handleOut.x; o.oy = v.handleOut.y; } return o; };

function exportObject(d) {
	const pt = (p) => ({ name: p.name, x: p.x, y: p.y });
	const swName = (id) => (d.palette.find(p => p.id === id) || {}).name;
	const grName = (id) => (d.groups.find(g => g.id === id) || {}).name;
	return {
		format: 'design-1',
		name: d.name,
		about: ABOUT,
		circleSides: d.segments,
		...(d.axis ? { symmetryAxis: d.axis } : {}),
		...(d.rules ? { guideLines: d.rules.map(g => ({ axis: g.axis, at: g.pos })) } : {}),
		palette: d.palette.map(p => ({ name: p.name, color: p.color })),
		groups: d.groups.map(g => ({ name: g.name })),
		shapes: d.shapes.map(s => ({
			name: s.name, type: s.type, x: s.x, y: s.y, width: s.width, height: s.height, scale: s.scale, rotation: s.rotation, color: s.color,
			opacity: s.opacity, outline: s.outline, outlineColor: s.outlineColor,
			...(s.fillType !== 'solid' ? { fill: s.fillType, color2: s.color2, gradientAngle: s.gradAngle, ...(s.stops ? { gradientStops: s.stops.map(q => ({ at: q.t, color: q.color })) } : {}), ...(s.gradDetail ? { gradientSmoothness: s.gradDetail } : {}) } : {}),
			...(s.swatch ? { swatch: swName(s.swatch) } : {}),
			...(s.outlineSwatch ? { outlineSwatch: swName(s.outlineSwatch) } : {}),
			...(s.group ? { group: grName(s.group) } : {}),
			...(s.hidden ? { hidden: true } : {}),
			...(s.free ? { free: true } : {}),
			...(s.mirror && d.shapes.find(x => x.id === s.mirror) ? { mirrorOf: d.shapes.find(x => x.id === s.mirror).name } : {}),
			...(s.clip && d.shapes.find(x => x.id === s.clip) ? { clipTo: d.shapes.find(x => x.id === s.clip).name } : {}),
			...(s.pivot ? { pivot: { x: s.pivot.x, y: s.pivot.y } } : {}),
			...(s.locked ? { locked: true } : {}),
			...(s.type === 'line' ? { lineWidth: s.lineWidth, cap: s.cap, ...(s.dash ? { dash: s.dash } : {}), ...(s.taperStart ? { taperStart: s.taperStart } : {}), ...(s.taperEnd ? { taperEnd: s.taperEnd } : {}), ...(s.arrowStart ? { arrowStart: true } : {}), ...(s.arrowEnd ? { arrowEnd: true } : {}), ...(s.arrowSize ? { arrowSize: s.arrowSize } : {}) } : {}),
			...(s.radius ? { cornerRadius: s.radius } : {}), ...(s.smooth ? { smooth: s.smooth } : {}),
			...(s.vertices ? { vertices: s.vertices.map(outV) } : {}),
			...(s.parts ? { stretch: { x: r6(s.width / s.baseWidth), y: r6(s.height / s.baseHeight) } } : {}),
			...(s.parts ? { parts: s.parts.map(q => ({ type: q.type, x: q.x, y: q.y, width: q.width, height: q.height, rotation: q.rotation, ...(q.radius ? { cornerRadius: q.radius } : {}), ...(q.smooth ? { smooth: q.smooth } : {}), ...(q.vertices ? { vertices: q.vertices.map(outV) } : {}), ...(q.rings ? { rings: q.rings.map(r => ({ hole: !!r.hole, v: r.v.map(v => ({ x: v.x, y: v.y })) })) } : {}) })) } : {}),
			points: s.points.map(pt),
		})),
		points: d.points.map(pt),
	};
}

// a design file (as written by exportObject) -> a design
function designFromObject(o, name) {
	if (!o || !Array.isArray(o.shapes)) throw new Error('not a design file');
	const palette = (o.palette || []).map(p => ({ id: newId(), name: p.name, color: p.color }));
	const groups = (o.groups || []).map(g => ({ id: newId(), name: g.name }));
	const byName = (list, n) => (list.find(x => x.name === n) || {}).id;
	const shapes = o.shapes.map(s => {
		const c = { ...s };
			if (c.cornerRadius != null) c.radius = c.cornerRadius;
			delete c.cornerRadius;
			if (c.vertices) c.vertices = c.vertices.map(inV);
			if (c.parts) c.parts = c.parts.map(q => { const o = { ...q }; if (o.cornerRadius != null) o.radius = o.cornerRadius; delete o.cornerRadius; if (o.vertices) o.vertices = o.vertices.map(inV); return o; });
		if (c.stretch) { c.baseWidth = c.width / (c.stretch.x || 1); c.baseHeight = c.height / (c.stretch.y || 1); }
		delete c.stretch;
		if (c.fill) { c.fillType = c.fill; c.gradAngle = c.gradientAngle; }
		if (Array.isArray(c.gradientStops)) c.stops = c.gradientStops.map(q => ({ t: q.at, color: q.color }));
		delete c.gradientStops;
		if (c.gradientSmoothness != null) c.gradDetail = c.gradientSmoothness;
		delete c.gradientSmoothness;
		delete c.fill; delete c.gradientAngle;
		for (const [key, list] of [['swatch', palette], ['outlineSwatch', palette], ['group', groups]]) {
			const id = c[key] && byName(list, c[key]);
			if (id) c[key] = id; else delete c[key];
		}
		return c;
	});
	const rules = Array.isArray(o.guideLines) ? o.guideLines.map(g => ({ axis: g.axis, pos: g.at })) : [];
	const names = new Map();
	shapes.forEach((c, i) => { c.id = newId(); names.set(c.name, c.id); });
	shapes.forEach(c => { if (c.mirrorOf != null) { if (names.has(c.mirrorOf)) c.mirror = names.get(c.mirrorOf); delete c.mirrorOf; } });
	shapes.forEach(c => { if (c.clipTo != null) { if (names.has(c.clipTo)) c.clip = names.get(c.clipTo); delete c.clipTo; } });
	return normalize({ name, shapes, points: o.points || [], palette, groups, segments: o.circleSides, axis: o.symmetryAxis, rules });
}

function exportDesign(d) {
	const file = d.name.replace(/[^\w-]+/g, '_') + '.design.json';
	downloadText(file, JSON.stringify(exportObject(d), null, 2), 'application/json');
	toast('Exported ' + file);
}

function importFile(file) {
	if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml') return startSvgImport(file, null);
	const reader = new FileReader();
	reader.onload = () => {
		try {
			const o = JSON.parse(reader.result);
			let name = String(o.name || file.name.replace(/\.design\.json$|\.json$/, '')), n = name, i = 2;
			while (db.designs[n]) n = name + ' ' + i++;
			db.designs[n] = designFromObject(o, n);
			persist(); renderMenu();
			toast('Imported "' + n + '"');
		} catch (e) { toast('Could not import: ' + e.message); }
	};
	reader.readAsText(file);
}
