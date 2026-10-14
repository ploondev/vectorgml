'use strict';
// GML export: turns a design into ONE self-contained GameMaker script (no other file needed).
// The generated script builds the design as plain structs, so every shape and point can be changed at runtime.
// Depends on studio.js for worldParts() and r6().

const GML_KEY = 'designStudio.gml.v1';
const GML_DEFAULTS = { prefix: 'design_', style: 'snake', gradientDetail: 4 };
const GML_RESERVED = new Set(('all noone global other self undefined true false pointer_null pointer_invalid var globalvar if else for while do '
	+ 'until repeat switch case default break continue return exit function new delete with static enum try catch finally throw not and or xor '
	+ 'div mod begin end then constructor').split(' '));

// ------------------------------------------------------------------------------------------------ names

const capWord = (w) => w[0].toUpperCase() + w.slice(1);
const nameWords = (str) => String(str ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean).map(w => w.toLowerCase());

// words -> one valid GML identifier in the chosen style
function styleWords(words, style) {
	if (!words.length) words = ['unnamed'];
	let out = style === 'camel' ? words.map((w, i) => i ? capWord(w) : w).join('')
		: style === 'pascal' ? words.map(capWord).join('')
		: words.join('_');
	if (/^\d/.test(out)) out = '_' + out;
	if (GML_RESERVED.has(out)) out += '_';
	return out;
}

// several names -> unique identifiers (two shapes both called "arm" become arm and arm_2)
function gmlIdents(names, style) {
	const used = new Set();
	return names.map(n => {
		const base = styleWords(nameWords(n), style);
		let id = base, i = 2;
		while (used.has(id)) id = base + (style === 'snake' ? '_' : '') + i++;
		used.add(id);
		return id;
	});
}

const col = (text, width = 24) => text.padEnd(width);   // lines the comments up
const gn = (v) => { const r = Math.round(v * 1e4) / 1e4; return String(Object.is(r, -0) ? 0 : r); };
const gstr = (s) => JSON.stringify(String(s));
// GameMaker colours are blue-green-red: #5b9cff -> $FF9C5B
const gmlColor = (hex) => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex); return m ? '$' + (m[3] + m[2] + m[1]).toUpperCase() : 'c_white'; };
// the editor turns clockwise, GameMaker turns counter-clockwise
const gmlAngle = (editorDeg) => { const a = ((-editorDeg + 180) % 360 + 360) % 360 - 180; return a === -180 ? 180 : Math.round(a * 1e4) / 1e4; };

// ------------------------------------------------------------------------------------------------ geometry

// Cut a simple polygon into triangles (ear clipping). Returns corner numbers, three per triangle.
function triangulate(P) {
	const n = P.length;
	if (n < 3) return [];
	const idx = [...Array(n).keys()];
	let area = 0;
	P.forEach((p, i) => { const q = P[(i + 1) % n]; area += p[0] * q[1] - q[0] * p[1]; });
	if (area < 0) idx.reverse();
	const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
	const inside = (p, a, b, c) => {
		const d1 = cross(p, a, b), d2 = cross(p, b, c), d3 = cross(p, c, a);
		return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
	};
	const out = [];
	while (idx.length > 3) {
		let cut = false;
		for (let i = 0; i < idx.length && !cut; i++) {
			const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
			if (cross(P[a], P[b], P[c]) <= 1e-9) continue;
			const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9;
			if (idx.some(j => j !== a && j !== b && j !== c && !same(P[j], P[a]) && !same(P[j], P[b]) && !same(P[j], P[c]) && inside(P[j], P[a], P[b], P[c]))) continue;
			out.push(a, b, c); idx.splice(i, 1); cut = true;
		}
		if (!cut) break;   // not a clean polygon (lines cross): fall back to a simple fan
	}
	if (idx.length === 3) out.push(...idx);
	else for (let i = 1; i + 1 < idx.length; i++) out.push(idx[0], idx[i], idx[i + 1]);
	return out;
}

// the extra gradient stops of a shape as GML: [[0.5, $FF9C5B], ...]
function gradStops(s) { return '[' + (s.fillType !== 'solid' && s.stops || []).slice().sort((a, b) => a.t - b.t).map(q => '[' + gn(q.t) + ', ' + gmlColor(q.color) + ']').join(', ') + ']'; }

// [left, top, right, bottom] of a shape measured from its own centre
function gradBoxArr(s) {
	const b = shapeBounds({ ...s, x: 0, y: 0, rotation: 0 }), pv = pivotOf(s);
	return [b[0] - pv.x, b[2] - pv.y, b[1] - pv.x, b[3] - pv.y];
}
function gradBox(s) { return '[' + gradBoxArr(s).map(gn).join(', ') + ']'; }

// A polygon with holes, cut into triangles. Every hole is joined to the outline by a bridge, then the result is ear-clipped.
// rings: [{ pts, hole, start }], start = where the ring's first corner sits in the part's list of corners. Returns corner numbers.
function triangulateRegion(rings) {
	const outer = rings.find(r => !r.hole);
	if (!outer) return [];
	const orient = (r, positive) => {
		const list = r.pts.map((p, i) => ({ p, i: r.start + i }));
		if ((ringArea(r.pts) > 0) !== positive) list.reverse();
		return list;
	};
	const edgesOf = (list) => list.map((n, i) => [n.p, list[(i + 1) % list.length].p]);
	const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
	const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9;
	const crosses = (p, q, e) => {
		if (same(e[0], p) || same(e[0], q) || same(e[1], p) || same(e[1], q)) return false;
		return cross(p, q, e[0]) * cross(p, q, e[1]) < 0 && cross(e[0], e[1], p) * cross(e[0], e[1], q) < 0;
	};
	let poly = orient(outer, true);
	const holes = rings.filter(r => r.hole).map(r => orient(r, false)).sort((x, y) => Math.max(...y.map(n => n.p[0])) - Math.max(...x.map(n => n.p[0])));
	holes.forEach((hole, hi) => {
		const obstacles = [poly, hole, ...holes.slice(hi + 1)].flatMap(edgesOf);
		let best = null;
		hole.forEach((h, a) => poly.forEach((o, b) => {
			const d = Math.hypot(h.p[0] - o.p[0], h.p[1] - o.p[1]);
			if (best && d >= best.d) return;
			const mid = [(h.p[0] + o.p[0]) / 2, (h.p[1] + o.p[1]) / 2];
			if (obstacles.some(e => crosses(h.p, o.p, e)) || !insideRegion(mid, [poly.map(n => n.p)])) return;
			best = { a, b, d };
		}));
		if (!best) return;   // cannot be reached: it is left filled in
		poly = [...poly.slice(0, best.b + 1), ...hole.slice(best.a), ...hole.slice(0, best.a), hole[best.a], poly[best.b], ...poly.slice(best.b + 1)];
	});
	return triangulate(poly.map(n => n.p)).map(k => poly[k].i);
}

// a shape's parts, measured from the shape's own centre, with scale and stretch already applied.
// Rounded corners and smoothed lines are worked out here, so a polygon's corners are the points that are actually drawn.
function gmlParts(s, n, d) {
	const pv = pivotOf(s);   // everything is measured from the pivot, which is where the shape sits and turns
	let list;
	if (s.clip && d && d.shapes.includes(s)) {   // a clipped shape: what lies inside the mask, moved from the design into the shape's own frame
		list = worldParts(s, n, d).map(p => { const l = toLocal(s, p.x - s.x, p.y - s.y); return { ...p, x: l.x, y: l.y, rotation: p.rotation - s.rotation }; });
	} else list = worldParts({ ...s, x: 0, y: 0, rotation: 0 }, n);
	return list.map(p => {
		const base = { x: p.x - pv.x, y: p.y - pv.y, angle: gmlAngle(p.rotation) };
		if (p.type === 'circle') return { ...base, kind: 'ellipse', rx: p.width / 2, ry: p.height / 2 };
		if (p.type === 'line') return { ...base, kind: 'line', corners: partLocal(p, n)[0].pts };
		const rings = partLocal(p, n);
		let start = 0;
		for (const r of rings) { r.start = start; start += r.pts.length; }
		const corners = rings.flatMap(r => r.pts);
		if (p.type === 'region') return { ...base, kind: 'polygon', corners, rings: rings.map(r => [r.start, r.pts.length, r.hole ? 1 : 0]), triangles: triangulateRegion(rings) };
		return { ...base, kind: 'polygon', corners, triangles: triangulate(corners) };
	});
}

function gmlShapeKind(s, d) {
	const m = s.clip && d && d.shapes.find(x => x.id === s.clip);
	if (m) return 'clipped to ' + m.name + ', ' + (s.parts ? 'combined' : s.type);
	if (s.parts) return 'combined shape, ' + s.parts.length + (s.parts.some(p => p.type === 'region') ? ' outline' : ' part') + (s.parts.length === 1 ? '' : 's');
	if (s.type === 'circle') return 'circle / ellipse';
	if (s.type === 'line') return 'line, ' + s.vertices.length + ' points' + (s.smooth || s.vertices.some(v => v.s) ? ', smoothed' : '') + (lineStyled(s) ? ', ' + [s.dash && 'dashed', (s.taperStart || s.taperEnd) && 'tapered', (s.arrowStart || s.arrowEnd) && 'arrowhead'].filter(Boolean).join(' + ') + ' (drawn as filled polygons)' : '');
	return (s.type === 'custom' ? 'custom polygon' : s.type) + ', ' + s.vertices.length + ' corners' + (s.radius || s.smooth || s.vertices.some(v => v.r || v.s) ? ', rounded' : '');
}

// ------------------------------------------------------------------------------------------------ the generator

function gmlDesign(d, options) {
	const o = { ...GML_DEFAULTS, ...options }, style = o.style;
	const sides = Math.round(o.circleSides || d.segments), detail = Math.max(1, Math.round(o.gradientDetail || 4));   // the default for every radial gradient; chosen in the export window; the design's own numbers are left alone
	const fn = (...tail) => styleWords([...nameWords(o.prefix), ...nameWords(d.name), ...tail.flatMap(nameWords)], style);
	const F = {
		script: fn(), create: fn('create'), draw: fn('draw'), bake: fn('bake'), bounds: fn('get', 'bounds'),
		drawBaked: fn('draw', 'baked'), unbake: fn('clear', 'baked'), setColor: fn('set', 'color'), setFlash: fn('set', 'flash'),
			shapePoint: fn('shape', 'point'), toRoom: fn('to', 'room'), get: fn('get'), exists: fn('exists'), destroy: fn('destroy'), setSwatch: fn('set', 'swatch'),
		registry: '__' + fn('registry'), matrix: '__' + fn('matrix'), multiply: '__' + fn('multiply'), tint: '__' + fn('tint'), mesh: '__' + fn('mesh'), rings: '__' + fn('rings'), stroke: '__' + fn('stroke'), strokeLine: '__' + fn('stroke_line'), vertex: '__' + fn('vertex'), begin: '__' + fn('begin'), batch: '__' + fn('batch'), paint: '__' + fn('paint_gradient'), gradColor: '__' + fn('gradient_color'), gradT: '__' + fn('gradient_t'), gradBlend: '__' + fn('gradient_blend'), paintStops: '__' + fn('paint_stops'), clip: '__' + fn('clip_band'),
	};
	const shapeIds = gmlIdents(d.shapes.map(s => s.name), style);
	const pointIds = gmlIdents(d.points.map(p => p.name), style);
	const swatchIds = gmlIdents(d.palette.map(p => p.name), style), groupIds = gmlIdents(d.groups.map(g => g.name), style);
	const swId = (id) => { const i = d.palette.findIndex(p => p.id === id); return i >= 0 ? swatchIds[i] : ''; };
	const inner = d.shapes.map(s => gmlIdents(s.points.map(p => p.name), style));

	// concrete names for the examples in the header
	const exShape = shapeIds[0] || 'head', exPoint = pointIds[0] || 'hover';
	const withPoints = d.shapes.findIndex(s => s.points.length);
	const exInnerShape = withPoints >= 0 ? shapeIds[withPoints] : exShape, exInner = withPoints >= 0 ? inner[withPoints][0] : 'eye';
	const exOther = shapeIds[1] || exShape;

	const out = [];
	const L = (...lines) => out.push(...lines);

	// ---------------------------------------------------------------- header
	const copyName = styleWords(nameWords(d.name), 'snake') + '_1';   // used in the examples inside the comments below
	const now = new Date(), two = (n) => String(n).padStart(2, '0');
	L(`// Generated on ${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`, ``);

	// ---------------------------------------------------------------- create
	L(`#region Create: builds a fresh copy of the design`, ``,
		`/// @function ${F.create}([name])`,
		`/// @description Makes a new copy of "${d.name}". Every call gives you your own copy, so changing`,
		`///              one does not change the others.`,
		`/// @param {String} [name]  Give the copy a name to draw and change it by that name later:`,
		`///                         ${F.draw}("${copyName}", x, y). Leave it out to just get the struct back.`,
		`/// @returns {Struct}  The copy itself (also available later through its name).`,
		`function ${F.create}(_name = undefined) {`,
		`\tvar _design = {`,
		`\t\tname: ${gstr(d.name)},`,
		`\t\tshapes: {},            // every shape by name, e.g. _design.shapes.${exShape}`,
		`\t\torder: [],             // the same shapes from back to front: the order they are drawn in`,
		`\t\tpoints: {},            // fixed spots in the design, e.g. _design.points.${exPoint}`,
		`\t\tgroups: {},            // shapes that belong together, e.g. _design.groups.${groupIds[0] || 'arm'} (an array of shapes)`,
		`\t\tpalette: {},           // named colours; ${F.setSwatch}() changes one and every shape using it follows`,
		`\t\tcircle_segments: ${sides},   // how many sides every circle has (more = smoother, slower)`,
		`\t\tflash_color: c_white,    // see ${F.setFlash}(): a color every shape is mixed towards (a hit flash)`,
		`\t\tflash_amount: 0,         // 0 = no flash, 1 = everything is flash_color`,
		`\t\tbake_scale: 1,           // ${F.drawBaked}(): how many times bigger than the design the saved picture is made (2 stays sharp when drawn up to 2x)`,
		`\t\tbaked: undefined,         // ${F.drawBaked}() keeps its saved picture here`,
		`\t};`, ``);

	L(`\t#region Shapes`);
	d.shapes.forEach((s, i) => {
		const parts = gmlParts(s, sides, d), pv = pivotOf(s), at = pointWorld(pv, s);   // at = where the pivot is in the design
		L(``, `\t\t#region Shape: ${s.name}  (${gmlShapeKind(s, d)})`,
			`\t\t\t_design.shapes.${shapeIds[i]} = {`,
			`\t\t\t\tname: ${gstr(s.name)},`, ``,
			`\t\t\t\t// PLACEMENT - where the shape sits in the design`,
			`\t\t\t\t${col('x: ' + gn(at.x) + ',')}// pixels right of the origin${s.pivot ? ' (the pivot)' : ''}`,
			`\t\t\t\t${col('y: ' + gn(at.y) + ',')}// pixels below the origin (negative = above it)${s.pivot ? ' (the pivot)' : ''}`,
			`\t\t\t\t${col('angle: ' + gn(gmlAngle(s.rotation)) + ',')}// turn, in degrees, counter-clockwise`,
			`\t\t\t\t${col('xscale: 1,')}// stretch sideways (1 = as designed, -1 = mirrored)`,
			`\t\t\t\t${col('yscale: 1,')}// stretch up and down`, ``,
			`\t\t\t\t// LOOK`,
			`\t\t\t\t${col('color: ' + gmlColor(s.color) + ',')}// ${s.color}  (GameMaker colours are blue-green-red)`,
			`\t\t\t\t${col('fill_type: ' + gstr(s.fillType) + ',')}// "solid", "linear" or "radial". A gradient blends from color to color2.`,
			`\t\t\t\t${col('color2: ' + gmlColor(s.color2) + ',')}// ${s.color2}  (the far end of a gradient)`,
			`\t\t\t\t${col('gradient_angle: ' + gn(s.gradAngle) + ',')}// linear only: 0 = left to right, 90 = top to bottom. It turns with the shape.`,
			`\t\t\t\t${col('gradient_detail: ' + (s.gradDetail || detail) + ',')}// radial only: how finely the triangles are split to follow the blend (more = smoother, slower)`,
			`\t\t\t\t${col('gradient_stops: ' + gradStops(s) + ',')}// extra colours between color and color2: [[position 0-1, colour], ...]`,
			`\t\t\t\t${col('gradient_box: ' + gradBox(s) + ',')}// the area the gradient spans: [left, top, right, bottom] from the shape's ${s.pivot ? 'pivot' : 'centre'}`,
			`\t\t\t\t${col('alpha: ' + gn(s.opacity) + ',')}// 0 = invisible, 1 = solid`,
			`\t\t\t\t${col('visible: ' + (s.hidden ? 'false' : 'true') + ',')}// false hides just this shape`,
			`\t\t\t\t${col('outline: ' + gn(s.outline) + ',')}// outline width in pixels (0 = none); it grows outward from the edge, with round corners`,
			`\t\t\t\t${col('outline_color: ' + gmlColor(s.outlineColor) + ',')}// ${s.outlineColor}`,
			...(s.type === 'line' ? [
				`\t\t\t\t${col('line_width: ' + gn(s.lineWidth) + ',')}// line only: how thick the line is, in pixels (it is drawn in color)`,
				`\t\t\t\t${col('line_cap: ' + gstr(s.cap) + ',')}// line only: "round" ends are half circles, "flat" ends are cut straight across`,
			] : []),
			`\t\t\t\t${col('swatch: ' + gstr(s.swatch ? swId(s.swatch) : '') + ',')}// the palette colour the fill follows ("" = none)`,
			`\t\t\t\t${col('outline_swatch: ' + gstr(s.outlineSwatch ? swId(s.outlineSwatch) : '') + ',')}// the palette colour the outline follows`, ``,
			`\t\t\t\t// POINTS ON THIS SHAPE - x, y is the offset from the shape's ${s.pivot ? 'pivot' : 'centre'}.`,
			`\t\t\t\t// They move, turn and stretch together with the shape.`);
		if (s.points.length) {
			L(`\t\t\t\tpoints: {`);
			s.points.forEach((p, k) => L(`\t\t\t\t\t${inner[i][k]}: { x: ${gn(p.x - pv.x)}, y: ${gn(p.y - pv.y)} },   // point "${p.name}"`));
			L(`\t\t\t\t},`);
		} else L(`\t\t\t\tpoints: {},   // (this shape has no points)`);
		L(``, `\t\t\t\t// GEOMETRY - what the shape is made of. Plain shapes have one part; combined shapes have several.`,
			`\t\t\t\tparts: [`);
		parts.forEach((p, k) => {
			if (p.kind === 'ellipse') {
				L(`\t\t\t\t\t{   // part ${k + 1}: an ellipse (a circle when rx and ry match)`,
					`\t\t\t\t\t\tkind: "ellipse",`,
					`\t\t\t\t\t\tx: ${gn(p.x)}, y: ${gn(p.y)}, angle: ${gn(p.angle)},   // where this part sits inside the shape`,
					`\t\t\t\t\t\trx: ${gn(p.rx)}, ry: ${gn(p.ry)},   // radius across and radius down`,
					`\t\t\t\t\t},`);
			} else if (p.kind === 'line') {
				L(`\t\t\t\t\t{   // part ${k + 1}: an open line`,
					`\t\t\t\t\t\tkind: "line",`,
					`\t\t\t\t\t\tx: ${gn(p.x)}, y: ${gn(p.y)}, angle: ${gn(p.angle)},   // where this part sits inside the shape`,
					`\t\t\t\t\t\t// The points the line passes through, in order: [x, y] of each one, measured from the part's centre.`,
					`\t\t\t\t\t\t// A smoothed line already holds its curve as a run of close points.`,
					`\t\t\t\t\t\tcorners: [`);
				p.corners.forEach((c, m) => L(`\t\t\t\t\t\t\t${col('[' + gn(c[0]) + ', ' + gn(c[1]) + '],', 16)}// point ${m}`));
				L(`\t\t\t\t\t\t],`, `\t\t\t\t\t},`);
			} else {
				L(`\t\t\t\t\t{   // part ${k + 1}: a polygon`,
					`\t\t\t\t\t\tkind: "polygon",`,
					`\t\t\t\t\t\tx: ${gn(p.x)}, y: ${gn(p.y)}, angle: ${gn(p.angle)},   // where this part sits inside the shape`,
					`\t\t\t\t\t\t// The corners: [x, y] of each one, measured from the part's centre. Edit these to reshape it.`,
					`\t\t\t\t\t\tcorners: [`);
				p.corners.forEach((c, m) => L(`\t\t\t\t\t\t\t${col('[' + gn(c[0]) + ', ' + gn(c[1]) + '],', 16)}// corner ${m}`));
				L(`\t\t\t\t\t\t],`);
				if (p.rings) L(`\t\t\t\t\t\t// The separate outlines in that list, as [first corner, how many, 1 if it cuts a hole].`,
					`\t\t\t\t\t\trings: [${p.rings.map(r => '[' + r.join(', ') + ']').join(', ')}],`);
				L(
					`\t\t\t\t\t\t// How it is filled: three corner numbers per triangle (the first corner is 0).`,
					`\t\t\t\t\t\ttriangles: [${p.triangles.map((t, m) => (m && m % 3 === 0 ? ' ' : '') + t).join(', ')}],`,
					`\t\t\t\t\t},`);
			}
		});
		L(`\t\t\t\t],`, `\t\t\t};`, `\t\t#endregion`);
	});
	L(``, `\t\t// Draw order, back to front. Reorder these lines to change what sits in front of what.`,
		`\t\t_design.order = [`);
	d.shapes.forEach((s, i) => L(`\t\t\t_design.shapes.${shapeIds[i]},`));
	L(`\t\t];`, `\t#endregion`, ``);

	L(`\t#region Points (fixed spots in the design)`);
	if (!d.points.length) L(`\t\t// (this design has no points - add some in the editor)`);
	d.points.forEach((p, i) => L(`\t\t// "${p.name}": a fixed spot. Use it to decide where something goes (or where a shape should move to).`,
		`\t\t_design.points.${pointIds[i]} = { x: ${gn(p.x)}, y: ${gn(p.y)} };`, ``));
	L(`\t#endregion`, ``,
		`\t#region Palette (named colours the shapes can share)`);
	if (!d.palette.length) L(`\t\t// (this design has no palette colours)`);
	d.palette.forEach((w, i) => L(`\t\t_design.palette.${swatchIds[i]} = ${col(gmlColor(w.color) + ';', 12)}// "${w.name}"  ${w.color}`));
	L(`\t#endregion`, ``, `\t#region Groups (shapes that belong together)`);
	if (!d.groups.length) L(`\t\t// (this design has no groups)`);
	d.groups.forEach((g, gi) => {
		const members = d.shapes.map((s, i) => s.group === g.id ? '_design.shapes.' + shapeIds[i] : null).filter(Boolean);
		L(`\t\t_design.groups.${groupIds[gi]} = [${members.join(', ')}];   // group "${g.name}"`);
	});
	L(`\t#endregion`, ``,
		`\t#region Filing it under its name`,
		`\t\tif (_name != undefined) {`,
		`\t\t\tif (!is_string(_name)) show_error("${F.create}: the name has to be a string, like \\"${copyName}\\".", true);`,
		`\t\t\tvar _all = ${F.registry}();`,
		`\t\t\tif (variable_struct_exists(_all, _name)) show_error("${F.create}: a copy named '" + _name + "' already exists. Use another name, or call ${F.destroy}('" + _name + "') first.", true);`,
		`\t\t\t_all[$ _name] = _design;`,
		`\t\t}`,
		`\t#endregion`, ``,
		`\treturn _design;`, `}`, ``, `#endregion`, ``,
		`#region Copies: finding, checking and removing them by name`, ``,
		`/// @function ${F.get}(design)`,
		`/// @description Gives you the struct behind a copy. Pass the copy's name, or the struct itself (it is handed straight back).`,
		`///              Stops the game with a message if the name was never created.`,
		`/// @param {String,Struct} design`,
		`/// @returns {Struct}`,
		`function ${F.get}(_design) {`,
		`\tif (is_struct(_design)) return _design;`,
		`\tif (is_string(_design)) {`,
		`\t\tvar _all = ${F.registry}();`,
		`\t\tif (!variable_struct_exists(_all, _design)) show_error("${F.get}: there is no copy named '" + _design + "'. Make it first with ${F.create}('" + _design + "'), usually in a Create event.", true);`,
		`\t\treturn _all[$ _design];`,
		`\t}`,
		`\tshow_error("${F.get}: expected the name of a copy (a string) or a copy's struct - for example ${F.draw}(\\"${copyName}\\", x, y).", true);`,
		`\treturn undefined;`,
		`}`, ``,
		`/// @function ${F.exists}(name)`,
		`/// @description True if a copy with this name has been created (and not destroyed).`,
		`/// @param {String} name`,
		`/// @returns {Bool}`,
		`function ${F.exists}(_name) {`,
		`\treturn is_string(_name) && variable_struct_exists(${F.registry}(), _name);`,
		`}`, ``,
		`/// @function ${F.destroy}(design)`,
		`/// @description Forgets a named copy so its name can be used again. Call it from a Clean Up event`,
		`///              (or Destroy event) so copies do not pile up. Safe to call twice.`,
		`/// @param {String,Struct} design  The copy's name, or its struct.`,
		`function ${F.destroy}(_design) {`,
		`\tvar _all = ${F.registry}();`,
		`\tif (is_string(_design)) {`,
		`\t\tif (variable_struct_exists(_all, _design)) { ${F.unbake}(_all[$ _design]); variable_struct_remove(_all, _design); }`,
		`\t\treturn;`,
		`\t}`,
		`\tvar _names = variable_struct_get_names(_all);`,
		`\tfor (var i = 0; i < array_length(_names); i++) {`,
		`\t\tif (_all[$ _names[i]] == _design) { ${F.unbake}(_design); variable_struct_remove(_all, _names[i]); }`,
		`\t}`,
		`}`, ``, `#endregion`, ``,
		`#region Colors: changing a palette colour`, ``,
		`/// @function ${F.setSwatch}(design, name, color)`,
		`/// @description Changes one palette colour of a copy. Every shape that uses it (fill or outline) follows.`,
		`///              This is how you make a second version of a design in another colour.`,
		`/// @param {String,Struct} design  The copy's name (or its struct).`,
		`/// @param {String} name           The palette colour's name, e.g. "${swatchIds[0] || 'shirt'}".`,
		`/// @param {Constant.Color} color`,
		`function ${F.setSwatch}(_design, _name, _color) {`,
		`\t_design = ${F.get}(_design);`,
		`\tif (!variable_struct_exists(_design.palette, _name)) show_error("${F.setSwatch}: this design has no palette colour named '" + string(_name) + "'.", true);`,
		`\t_design.palette[$ _name] = _color;`,
		`\tvar _names = variable_struct_get_names(_design.shapes);`,
		`\tfor (var i = 0; i < array_length(_names); i++) {`,
		`\t\tvar _shape = _design.shapes[$ _names[i]];`,
		`\t\tif (_shape.swatch == _name) _shape.color = _color;`,
		`\t\tif (_shape.outline_swatch == _name) _shape.outline_color = _color;`,
		`\t}`,
		`\t${F.unbake}(_design);`,
		`}`, ``,
		`/// @function ${F.setColor}(design, target, color, [color2])`,
		`/// @description Changes the color of one shape, of a whole group, or of several shapes. The shape stops following its palette`,
		`///              color. For a gradient this sets the first color, and color2 (if you give it) the last one.`,
		`/// @param {String,Struct} design  The copy's name (or its struct).`,
		`/// @param {String,Struct,Array} target  A shape's name, e.g. "${exShape}"; a group's name, e.g. "${groupIds[0] || 'arm'}"; a shape struct; or an array of shapes.`,
		`/// @param {Constant.Color} color`,
		`/// @param {Constant.Color} [color2]`,
		`function ${F.setColor}(_design, _target, _color, _color2 = undefined) {`,
		`\t_design = ${F.get}(_design);`,
		`\tvar _list = [];`,
		`\tif (is_array(_target)) _list = _target;`,
		`\telse if (is_struct(_target)) _list = [_target];`,
		`\telse if (is_string(_target)) {`,
		`\t\tif (variable_struct_exists(_design.shapes, _target)) _list = [_design.shapes[$ _target]];`,
		`\t\telse if (variable_struct_exists(_design.groups, _target)) _list = _design.groups[$ _target];`,
		`\t\telse show_error("${F.setColor}: this design has no shape or group named '" + _target + "'.", true);`,
		`\t}`,
		`\tfor (var i = 0; i < array_length(_list); i++) {`,
		`\t\t_list[i].color = _color;`,
		`\t\t_list[i].swatch = "";`,
		`\t\tif (_color2 != undefined) _list[i].color2 = _color2;`,
		`\t}`,
		`\t${F.unbake}(_design);`,
		`}`, ``,
		`/// @function ${F.setFlash}(design, color, amount)`,
		`/// @description Mixes every color of the design towards one color: a hit flash is a white flash, then fading amount back to 0.`,
		`///              The shapes keep their own colors underneath. Cheap with ${F.draw}(); a baked design has to bake again each time.`,
		`/// @param {String,Struct} design  The copy's name (or its struct).`,
		`/// @param {Constant.Color} color`,
		`/// @param {Real} amount  0 = no flash, 1 = everything is that color.`,
		`function ${F.setFlash}(_design, _color, _amount) {`,
		`\t_design = ${F.get}(_design);`,
		`\tvar _new = clamp(_amount, 0, 1);`,
		`\tif (_design.flash_color == _color && _design.flash_amount == _new) return;`,
		`\t_design.flash_color = _color;`,
		`\t_design.flash_amount = _new;`,
		`\t${F.unbake}(_design);`,
		`}`, ``, `#endregion`, ``);

	// ---------------------------------------------------------------- draw
	L(`#region Drawing`, ``,
		`/// @function ${F.draw}(design, [x], [y], [xscale], [yscale], [angle], [blend], [alpha])`,
		`/// @description Draws a copy of the design right now. Call it from a Draw event.`,
		`/// @param {String,Struct} design  The copy's name (or its struct).`,
		`/// @param {Real} [x]        Where the design's origin goes in the room.`,
		`/// @param {Real} [y]`,
		`/// @param {Real} [xscale]   Stretch the whole design sideways (-1 mirrors it).`,
		`/// @param {Real} [yscale]`,
		`/// @param {Real} [angle]    Turn the whole design, counter-clockwise, like image_angle.`,
		`/// @param {Constant.Color} [blend]  Tint, like image_blend (c_white = no tint).`,
		`/// @param {Real} [alpha]    See-through-ness of the whole design.`,
		`function ${F.draw}(_design, _x = 0, _y = 0, _xscale = 1, _yscale = 1, _angle = 0, _blend = c_white, _alpha = 1) {`,
		`\t_design = ${F.get}(_design);   // turns a name into the copy (or accepts the copy itself)`,
		`\tvar _old_color = draw_get_color();`,
		`\tvar _old_alpha = draw_get_alpha();`,
		`\tvar _whole = ${F.matrix}(_xscale, _yscale, _angle, _x, _y);   // where the design itself goes`,
		`\tvar _state = ${F.batch}();`,
		`\t_state.flash_color = _design.flash_color;`,
		`\t_state.flash_amount = _design.flash_amount;`, ``,
		`\tfor (var i = 0; i < array_length(_design.order); i++) {`,
		`\t\t#region Drawing a shape`,
		`\t\t\tvar _shape = _design.order[i];`,
		`\t\t\tif (!_shape.visible) continue;`,
		`\t\t\tvar _shape_alpha = _shape.alpha * _alpha;`,
		`\t\t\tdraw_set_alpha(_shape_alpha);`,
		`\t\t\t// shape position, turn and stretch, on top of the whole design's`,
		`\t\t\tvar _shape_matrix = ${F.multiply}(_whole, ${F.matrix}(_shape.xscale, _shape.yscale, _shape.angle, _shape.x, _shape.y));`, ``,
		`\t\t\t// Two passes: first the outline (a band along every edge, round at the corners), then the fill on top of it.`,
		`\t\t\tfor (var _pass = 0; _pass < 2; _pass++) {`,
		`\t\t\t\tif (_pass == 0 && _shape.outline <= 0) continue;   // no outline on this shape`,
		`\t\t\t\tvar _gradient = (_pass == 1 && _shape.fill_type != "solid");`,
		`\t\t\t\tdraw_set_color(${F.tint}((_pass == 0) ? _shape.outline_color : _shape.color, _blend));`, ``,
		`\t\t\t\tfor (var j = 0; j < array_length(_shape.parts); j++) {`,
		`\t\t\t\t\tvar _part = _shape.parts[j];`,
		`\t\t\t\t\tvar _part_matrix = ${F.matrix}(1, 1, _part.angle, _part.x, _part.y);   // part -> shape`,
		`\t\t\t\t\tvar _m = ${F.multiply}(_shape_matrix, _part_matrix);                  // part -> room`,
		`\t\t\t\t\tif (_part.kind == "line") {`,
		`\t\t\t\t\t\tif (_pass == 1) ${F.strokeLine}(_design, _part, _shape.line_width, _shape.line_cap == "round", _m);   // a line is all outline`,
		`\t\t\t\t\t\tcontinue;`,
		`\t\t\t\t\t}`,
		`\t\t\t\t\tif (_pass == 0) {`,
		`\t\t\t\t\t\t${F.stroke}(_design, _part, _shape.outline, _m);   // the outline`,
		`\t\t\t\t\t\tcontinue;`,
		`\t\t\t\t\t}`,
		`\t\t\t\t\tvar _mesh = ${F.mesh}(_design, _part);   // the points and triangles to fill`,
		`\t\t\t\t\tif (_gradient) {`,
		`\t\t\t\t\t\t${F.paint}(_shape, _part_matrix, _m, _mesh, _blend, _shape_alpha);`,
		`\t\t\t\t\t} else {`,
		`\t\t\t\t\t\tvar _points = _mesh.points;`,
		`\t\t\t\t\t\tvar _tri = _mesh.triangles;`,
		`\t\t\t\t\t\tdraw_primitive_begin(pr_trianglelist);`,
		`\t\t\t\t\t\tfor (var k = 0; k < array_length(_tri); k++) {`,
		`\t\t\t\t\t\t\tif (k > 0 && k mod 600 == 0) {   // a long list of triangles is sent in pieces`,
		`\t\t\t\t\t\t\t\tdraw_primitive_end();`,
		`\t\t\t\t\t\t\t\tdraw_primitive_begin(pr_trianglelist);`,
		`\t\t\t\t\t\t\t}`,
		`\t\t\t\t\t\t\tvar _point = _points[_tri[k]];`,
		`\t\t\t\t\t\t\tdraw_vertex(_m[0] * _point[0] + _m[2] * _point[1] + _m[4], _m[1] * _point[0] + _m[3] * _point[1] + _m[5]);`,
		`\t\t\t\t\t\t}`,
		`\t\t\t\t\t\tdraw_primitive_end();`,
		`\t\t\t\t\t}`,
		`\t\t\t\t}`,
		`\t\t\t}`,
		`\t\t#endregion`,
		`\t}`, ``,
		`\t_state.flash_amount = 0;`,
		`\tdraw_set_color(_old_color);`,
		`\tdraw_set_alpha(_old_alpha);`,
		`}`, ``, `#endregion`, ``);

	// ---------------------------------------------------------------- bake
	L(`#region Baking: turn the design into a sprite (faster to draw, but frozen)`, ``,
		`/// @function ${F.bounds}(design, [x], [y], [xscale], [yscale], [angle])`,
		`/// @description The box around everything currently visible in a copy.`,
		`/// @param {String,Struct} design  The copy's name (or its struct).`,
		`/// @returns {Struct} { left, top, right, bottom }`,
		`function ${F.bounds}(_design, _x = 0, _y = 0, _xscale = 1, _yscale = 1, _angle = 0) {`,
		`\t_design = ${F.get}(_design);`,
		`\tvar _whole = ${F.matrix}(_xscale, _yscale, _angle, _x, _y);`,
		`\tvar _left = infinity, _top = infinity, _right = -infinity, _bottom = -infinity;`,
		`\tfor (var i = 0; i < array_length(_design.order); i++) {`,
		`\t\tvar _shape = _design.order[i];`,
		`\t\tif (!_shape.visible) continue;`,
		`\t\tvar _shape_matrix = ${F.multiply}(_whole, ${F.matrix}(_shape.xscale, _shape.yscale, _shape.angle, _shape.x, _shape.y));`,
		`\t\tvar _pad = (variable_struct_exists(_shape, "line_width") ? _shape.line_width / 2 : _shape.outline) * max(abs(_xscale * _shape.xscale), abs(_yscale * _shape.yscale));   // room for the outline`,
		`\t\tfor (var j = 0; j < array_length(_shape.parts); j++) {`,
		`\t\t\tvar _part = _shape.parts[j];`,
		`\t\t\tvar _m = ${F.multiply}(_shape_matrix, ${F.matrix}(1, 1, _part.angle, _part.x, _part.y));`,
		`\t\t\tvar _ellipse = (_part.kind == "ellipse");`,
		`\t\t\tvar _count = _ellipse ? _design.circle_segments : array_length(_part.corners);`,
		`\t\t\tfor (var k = 0; k < _count; k++) {`,
		`\t\t\t\tvar _u = 0, _v = 0;`,
		`\t\t\t\tif (_ellipse) {`,
		`\t\t\t\t\t_u = dcos(k / _count * 360) * _part.rx;`,
		`\t\t\t\t\t_v = dsin(k / _count * 360) * _part.ry;`,
		`\t\t\t\t} else {`,
		`\t\t\t\t\t_u = _part.corners[k][0];`,
		`\t\t\t\t\t_v = _part.corners[k][1];`,
		`\t\t\t\t}`,
		`\t\t\t\tvar _px = _m[0] * _u + _m[2] * _v + _m[4];`,
		`\t\t\t\tvar _py = _m[1] * _u + _m[3] * _v + _m[5];`,
		`\t\t\t\t_left = min(_left, _px - _pad);  _right = max(_right, _px + _pad);`,
		`\t\t\t\t_top = min(_top, _py - _pad);    _bottom = max(_bottom, _py + _pad);`,
		`\t\t\t}`,
		`\t\t}`,
		`\t}`,
		`\tif (_left == infinity) return { left: 0, top: 0, right: 0, bottom: 0 };   // nothing visible`,
		`\treturn { left: _left, top: _top, right: _right, bottom: _bottom };`,
		`}`, ``,
		`/// @function ${F.bake}(design, [padding], [scale])`,
		`/// @description Draws the design once into a new sprite. The sprite's origin is the design's origin,`,
		`///              so draw_sprite(sprite, 0, x, y) puts it exactly where ${F.draw}(design, x, y) would.`,
		`///              Call this from a Draw event (it uses a surface). Free it later with sprite_delete().`,
		`///              Most of the time ${F.drawBaked}() is easier: it does this for you and keeps the sprite.`,
		`/// @param {String,Struct} design  The copy's name (or its struct).`,
		`/// @param {Real} [padding]  Extra empty pixels around the edge.`,
		`/// @param {Real} [scale]    Make the sprite this many times bigger than the design (draw it scaled back down to stay sharp).`,
		`/// @returns {Asset.GMSprite}`,
		`function ${F.bake}(_design, _padding = 1, _scale = 1) {`,
		`\t_design = ${F.get}(_design);`,
		`\tvar _box = ${F.bounds}(_design);`,
		`\tvar _left = floor(_box.left * _scale), _top = floor(_box.top * _scale);`,
		`\tvar _origin_x = -_left + _padding;   // where the design's origin lands inside the sprite`,
		`\tvar _origin_y = -_top + _padding;`,
		`\tvar _w = max(1, ceil(_box.right * _scale) - _left + _padding * 2);`,
		`\tvar _h = max(1, ceil(_box.bottom * _scale) - _top + _padding * 2);`, ``,
		`\tvar _surface = surface_create(_w, _h);`,
		`\tsurface_set_target(_surface);`,
		`\tdraw_clear_alpha(c_black, 0);`,
		`\t${F.draw}(_design, _origin_x, _origin_y, _scale, _scale);`,
		`\tsurface_reset_target();`, ``,
		`\tvar _sprite = sprite_create_from_surface(_surface, 0, 0, _w, _h, false, false, _origin_x, _origin_y);`,
		`\tsurface_free(_surface);`,
		`\treturn _sprite;`,
		`}`, ``,
		`/// @function ${F.drawBaked}(design, [x], [y], [xscale], [yscale], [angle], [blend], [alpha])`,
		`/// @description Like ${F.draw}(), but the design is drawn once into a sprite that is then reused, so it costs one sprite`,
		`///              instead of every triangle. Use it for anything that does not change: scenery, props, a character that is not`,
		`///              animated. The first call makes the sprite (call it from a Draw event). After you change the design (move a shape,`,
		`///              hide one, change circle_segments...) call ${F.unbake}() so the next draw makes a fresh one. ${F.setColor}(),`,
		`///              ${F.setSwatch}() and ${F.setFlash}() do that for you. Set design.bake_scale to 2 or more first for a sharper sprite.`,
		`///              The design's position, scale, angle, blend and alpha still work, because they are applied when the sprite is drawn.`,
		`/// @param {String,Struct} design  The copy's name (or its struct).`,
		`function ${F.drawBaked}(_design, _x = 0, _y = 0, _xscale = 1, _yscale = 1, _angle = 0, _blend = c_white, _alpha = 1) {`,
		`\t_design = ${F.get}(_design);`,
		`\tvar _cache = _design.baked;`,
		`\tif (_cache != undefined && _cache.scale != _design.bake_scale) { ${F.unbake}(_design); _cache = undefined; }`,
		`\tif (_cache == undefined) {`,
		`\t\tvar _target = surface_get_target();\n\t\tif (_target != -1 && _target != application_surface) { ${F.draw}(_design, _x, _y, _xscale, _yscale, _angle, _blend, _alpha); return; }   // cannot make a surface while drawing into another one: draw normally this time`,
		`\t\t_cache = { sprite: ${F.bake}(_design, 1, _design.bake_scale), scale: _design.bake_scale };`,
		`\t\t_design.baked = _cache;`,
		`\t}`,
		`\tdraw_sprite_ext(_cache.sprite, 0, _x, _y, _xscale / _cache.scale, _yscale / _cache.scale, _angle, _blend, _alpha);`,
		`}`, ``,
		`/// @function ${F.unbake}(design)`,
		`/// @description Throws away the sprite ${F.drawBaked}() made, so the next ${F.drawBaked}() makes a new one from the design as it is now.`,
		`/// @param {String,Struct} design  The copy's name (or its struct).`,
		`function ${F.unbake}(_design) {`,
		`\t_design = ${F.get}(_design);`,
		`\tif (_design.baked != undefined) {`,
		`\t\tsprite_delete(_design.baked.sprite);`,
		`\t\t_design.baked = undefined;`,
		`\t}`,
		`}`, ``, `#endregion`, ``);

	// ---------------------------------------------------------------- points
	L(`#region Points: finding where things are`, ``,
		`/// @function ${F.shapePoint}(design, shape, point_name)`,
		`/// @description Where a point on a shape is right now, in design space (it follows the shape's`,
		`///              position, turn and stretch). Use ${F.toRoom}() to turn it into room coordinates.`,
		`/// @param {String,Struct} design  The copy's name (or its struct).`,
		`/// @param {String,Struct} shape   The shape's name as a string, e.g. "${exInnerShape}" (or the shape struct).`,
		`/// @param {String} point_name     e.g. "${exInner}".`,
		`/// @returns {Struct} { x, y }`,
		`function ${F.shapePoint}(_design, _shape, _point_name) {`,
		`\t_design = ${F.get}(_design);`,
		`\tif (is_string(_shape)) {`,
		`\t\tif (!variable_struct_exists(_design.shapes, _shape)) show_error("${F.shapePoint}: this design has no shape named '" + _shape + "'.", true);`,
		`\t\t_shape = _design.shapes[$ _shape];`,
		`\t}`,
		`\tif (!variable_struct_exists(_shape.points, _point_name)) show_error("${F.shapePoint}: the shape '" + _shape.name + "' has no point named '" + _point_name + "'.", true);`,
		`\tvar _p = _shape.points[$ _point_name];`,
		`\tvar _m = ${F.matrix}(_shape.xscale, _shape.yscale, _shape.angle, _shape.x, _shape.y);`,
		`\treturn { x: _m[0] * _p.x + _m[2] * _p.y + _m[4], y: _m[1] * _p.x + _m[3] * _p.y + _m[5] };`,
		`}`, ``,
		`/// @function ${F.toRoom}(point, [x], [y], [xscale], [yscale], [angle])`,
		`/// @description Turns a point in design space (design.points.something, or the result of`,
		`///              ${F.shapePoint}) into room coordinates, for a design drawn with the same x, y, scale and angle.`,
		`/// @param {Struct} point  { x, y } in design space.`,
		`/// @returns {Struct} { x, y } in the room.`,
		`function ${F.toRoom}(_point, _x = 0, _y = 0, _xscale = 1, _yscale = 1, _angle = 0) {`,
		`\tvar _m = ${F.matrix}(_xscale, _yscale, _angle, _x, _y);`,
		`\treturn { x: _m[0] * _point.x + _m[2] * _point.y + _m[4], y: _m[1] * _point.x + _m[3] * _point.y + _m[5] };`,
		`}`, ``, `#endregion`, ``);

	// ---------------------------------------------------------------- helpers
	L(`#region Helpers (you will not need to touch these)`, ``,
		`// Every named copy of this design lives in this one struct: { name: copy }.`,
		`function ${F.registry}() {`,
		`\tstatic _all = {};`,
		`\treturn _all;`,
		`}`, ``,
		`// A "matrix" here is [a, b, c, d, tx, ty]: a point (u, v) goes to`,
		`//    x = a * u + c * v + tx      y = b * u + d * v + ty`,
		`// It stretches first, then turns (counter-clockwise), then moves.`,
		`function ${F.matrix}(_xscale, _yscale, _angle, _x, _y) {`,
		`\tvar _c = dcos(_angle), _s = dsin(_angle);`,
		`\treturn [_c * _xscale, -_s * _xscale, _s * _yscale, _c * _yscale, _x, _y];`,
		`}`, ``,
		`// Does _first, then _second.  (_second is the outer one.)`,
		`function ${F.multiply}(_second, _first) {`,
		`\treturn [`,
		`\t\t_second[0] * _first[0] + _second[2] * _first[1],`,
		`\t\t_second[1] * _first[0] + _second[3] * _first[1],`,
		`\t\t_second[0] * _first[2] + _second[2] * _first[3],`,
		`\t\t_second[1] * _first[2] + _second[3] * _first[3],`,
		`\t\t_second[0] * _first[4] + _second[2] * _first[5] + _second[4],`,
		`\t\t_second[1] * _first[4] + _second[3] * _first[5] + _second[5],`,
		`\t];`,
		`}`, ``,
		`// The outlines that make up one part, as [[points, is_hole], ...]. A circle is an n-sided polygon.`,
		`function ${F.rings}(_design, _part) {`,
		`\tif (_part.kind == "ellipse") {`,
		`\t\tvar _n = _design.circle_segments;`,
		`\t\tvar _ring = array_create(_n);`,
		`\t\tfor (var k = 0; k < _n; k++) _ring[k] = [dcos(k / _n * 360) * _part.rx, dsin(k / _n * 360) * _part.ry];`,
		`\t\treturn [[_ring, false]];`,
		`\t}`,
		`\tvar _list = _part[$ "rings"];`,
		`\tif (_list == undefined) return [[_part.corners, false]];`,
		`\tvar _out = array_create(array_length(_list));`,
		`\tfor (var r = 0; r < array_length(_list); r++) {`,
		`\t\tvar _points = array_create(_list[r][1]);`,
		`\t\tfor (var k = 0; k < _list[r][1]; k++) _points[k] = _part.corners[_list[r][0] + k];`,
		`\t\t_out[r] = [_points, _list[r][2] == 1];`,
		`\t}`,
		`\treturn _out;`,
		`}`, ``,
		`// The triangles to fill for one part of a shape: { points, triangles }. A circle becomes a fan of triangles.`,
		`function ${F.mesh}(_design, _part) {`,
		`\tif (_part.kind != "ellipse") return { points: _part.corners, triangles: _part.triangles };`,
		`\tvar _ring = ${F.rings}(_design, _part)[0][0];`,
		`\tvar _n = array_length(_ring);`,
		`\tvar _points = array_create(_n + 1);`,
		`\tvar _triangles = array_create(_n * 3);`,
		`\t_points[0] = [0, 0];`,
		`\tfor (var k = 0; k < _n; k++) {`,
		`\t\t_points[k + 1] = _ring[k];`,
		`\t\t_triangles[k * 3] = 0;`,
		`\t\t_triangles[k * 3 + 1] = k + 1;`,
		`\t\t_triangles[k * 3 + 2] = (k + 1) % _n + 1;`,
		`\t}`,
		`\treturn { points: _points, triangles: _triangles };`,
		`}`, ``,
		`// Counts the points sent in the current batch of triangles.`,
		`function ${F.batch}() {`,
		`\tstatic _state = { count: 0, flash_color: c_white, flash_amount: 0 };`,
		`\treturn _state;`,
		`}`, ``,
		`// Starts a batch of triangles.`,
		`function ${F.begin}() {`,
		`\t${F.batch}().count = 0;`,
		`\tdraw_primitive_begin(pr_trianglelist);`,
		`}`, ``,
		`// Sends one point of a part through the matrix _m and into the triangle being drawn. A long batch is cut`,
		`// into pieces between triangles, because the graphics system only takes so many points at once.`,
		`function ${F.vertex}(_m, _x, _y) {`,
		`\tvar _batch = ${F.batch}();`,
		`\tif (_batch.count >= 600 && _batch.count mod 3 == 0) {`,
		`\t\tdraw_primitive_end();`,
		`\t\tdraw_primitive_begin(pr_trianglelist);`,
		`\t\t_batch.count = 0;`,
		`\t}`,
		`\tdraw_vertex(_m[0] * _x + _m[2] * _y + _m[4], _m[1] * _x + _m[3] * _y + _m[5]);`,
		`\t_batch.count++;`,
		`}`, ``,
		`// Draws the outline of one part, _w pixels wide, on the outside of its edge: a band along every edge, and a round`,
		`// wedge at every corner that points outward. A hole's outline grows into the hole.`,
		`function ${F.stroke}(_design, _part, _w, _m) {`,
		`\tvar _rings = ${F.rings}(_design, _part);`,
		`\t${F.begin}();`,
		`\tfor (var r = 0; r < array_length(_rings); r++) {`,
		`\t\tvar _points = _rings[r][0];`,
		`\t\tvar _n = array_length(_points);`,
		`\t\tvar _flip = _rings[r][1] ? -1 : 1;`,
		`\t\tvar _area = 0;`,
		`\t\tfor (var i = 0; i < _n; i++) {`,
		`\t\t\tvar _a = _points[i], _b = _points[(i + 1) % _n];`,
		`\t\t\t_area += _a[0] * _b[1] - _b[0] * _a[1];`,
		`\t\t}`,
		`\t\tvar _side = ((_area > 0) ? 1 : -1) * _flip;   // which way is "out" depends on the direction the corners go round`,
		`\t\tfor (var i = 0; i < _n; i++) {`,
		`\t\t\tvar _before = _points[(i + _n - 1) % _n], _p = _points[i], _q = _points[(i + 1) % _n];`,
		`\t\t\tvar _dx = _q[0] - _p[0], _dy = _q[1] - _p[1], _len = point_distance(0, 0, _dx, _dy);`,
		`\t\t\tvar _ex = _p[0] - _before[0], _ey = _p[1] - _before[1], _elen = point_distance(0, 0, _ex, _ey);`,
		`\t\t\tif (_len < 0.0001 || _elen < 0.0001) continue;`,
		`\t\t\tvar _nx = _dy / _len * _side, _ny = -_dx / _len * _side;   // out of this edge`,
		`\t\t\t// the band along the edge from _p to _q`,
		`\t\t\t${F.vertex}(_m, _p[0], _p[1]);`,
		`\t\t\t${F.vertex}(_m, _q[0], _q[1]);`,
		`\t\t\t${F.vertex}(_m, _q[0] + _nx * _w, _q[1] + _ny * _w);`,
		`\t\t\t${F.vertex}(_m, _p[0], _p[1]);`,
		`\t\t\t${F.vertex}(_m, _q[0] + _nx * _w, _q[1] + _ny * _w);`,
		`\t\t\t${F.vertex}(_m, _p[0] + _nx * _w, _p[1] + _ny * _w);`,
		`\t\t\t// the round corner at _p: a fan from the direction out of the edge before it to the direction out of this one`,
		`\t\t\tif ((_ex * _dy - _ey * _dx) * _area * _flip <= 0) continue;   // an inside corner: the two bands already overlap there`,
		`\t\t\tvar _mx = _ey / _elen * _side, _my = -_ex / _elen * _side;   // out of the edge before`,
		`\t\t\tvar _a1 = arctan2(_my, _mx);`,
		`\t\t\tvar _da = arctan2(_ny, _nx) - _a1;`,
		`\t\t\tif (_da > pi) _da -= 2 * pi;`,
		`\t\t\tif (_da < -pi) _da += 2 * pi;`,
		`\t\t\tvar _steps = max(1, ceil(abs(_da) / (2 * pi) * _design.circle_segments));`,
		`\t\t\tfor (var k = 0; k < _steps; k++) {`,
		`\t\t\t\tvar _s1 = _a1 + _da * k / _steps, _s2 = _a1 + _da * (k + 1) / _steps;`,
		`\t\t\t\t${F.vertex}(_m, _p[0], _p[1]);`,
		`\t\t\t\t${F.vertex}(_m, _p[0] + cos(_s1) * _w, _p[1] + sin(_s1) * _w);`,
		`\t\t\t\t${F.vertex}(_m, _p[0] + cos(_s2) * _w, _p[1] + sin(_s2) * _w);`,
		`\t\t\t}`,
		`\t\t}`,
		`\t}`,
		`\tdraw_primitive_end();`,
		`}`, ``,
		`// Draws an open line _w pixels thick through the points of a part: a band along every piece, a round wedge on the`,
		`// outside of every bend, and (when _round is true) a half circle at each end. A flat end is cut straight across.`,
		`function ${F.strokeLine}(_design, _part, _w, _round, _m) {`,
		`\tvar _points = _part.corners;`,
		`\tvar _count = array_length(_points);`,
		`\tif (_count < 2) return;`,
		`\tvar _half = _w / 2;`,
		`\tvar _steps = max(2, ceil(_design.circle_segments / 2));   // pieces in a half circle`,
		`\t${F.begin}();`,
		`\tfor (var i = 0; i < _count - 1; i++) {`,
		`\t\tvar _p = _points[i], _q = _points[i + 1];`,
		`\t\tvar _dx = _q[0] - _p[0], _dy = _q[1] - _p[1], _len = point_distance(0, 0, _dx, _dy);`,
		`\t\tif (_len < 0.0001) continue;`,
		`\t\tvar _nx = _dy / _len * _half, _ny = -_dx / _len * _half;   // sideways, half the thickness`,
		`\t\t// the band along this piece`,
		`\t\t${F.vertex}(_m, _p[0] + _nx, _p[1] + _ny);`,
		`\t\t${F.vertex}(_m, _q[0] + _nx, _q[1] + _ny);`,
		`\t\t${F.vertex}(_m, _q[0] - _nx, _q[1] - _ny);`,
		`\t\t${F.vertex}(_m, _p[0] + _nx, _p[1] + _ny);`,
		`\t\t${F.vertex}(_m, _q[0] - _nx, _q[1] - _ny);`,
		`\t\t${F.vertex}(_m, _p[0] - _nx, _p[1] - _ny);`,
		`\t\t// the bend at _q, where this piece meets the next: fill the gap on the outside of the turn`,
		`\t\tif (i < _count - 2) {`,
		`\t\t\tvar _r = _points[i + 2];`,
		`\t\t\tvar _ex = _r[0] - _q[0], _ey = _r[1] - _q[1], _elen = point_distance(0, 0, _ex, _ey);`,
		`\t\t\tif (_elen >= 0.0001) {`,
		`\t\t\t\tvar _side = ((_dx * _ey - _dy * _ex) > 0) ? 1 : -1;`,
		`\t\t\t\tvar _a1 = arctan2(_ny * _side, _nx * _side);`,
		`\t\t\t\tvar _da = arctan2(-_ex / _elen * _side, _ey / _elen * _side) - _a1;`,
		`\t\t\t\tif (_da > pi) _da -= 2 * pi;`,
		`\t\t\t\tif (_da < -pi) _da += 2 * pi;`,
		`\t\t\t\tvar _k = max(1, ceil(abs(_da) / (2 * pi) * _design.circle_segments));`,
		`\t\t\t\tfor (var k = 0; k < _k; k++) {`,
		`\t\t\t\t\tvar _s1 = _a1 + _da * k / _k, _s2 = _a1 + _da * (k + 1) / _k;`,
		`\t\t\t\t\t${F.vertex}(_m, _q[0], _q[1]);`,
		`\t\t\t\t\t${F.vertex}(_m, _q[0] + cos(_s1) * _half, _q[1] + sin(_s1) * _half);`,
		`\t\t\t\t\t${F.vertex}(_m, _q[0] + cos(_s2) * _half, _q[1] + sin(_s2) * _half);`,
		`\t\t\t\t}`,
		`\t\t\t}`,
		`\t\t}`,
		`\t}`,
		`\tif (_round) {`,
		`\t\t// half circles on the two ends, facing away from the line`,
		`\t\tfor (var _end = 0; _end < 2; _end++) {`,
		`\t\t\tvar _c = (_end == 0) ? _points[0] : _points[_count - 1];`,
		`\t\t\tvar _o = (_end == 0) ? _points[1] : _points[_count - 2];`,
		`\t\t\tvar _fx = (_end == 0) ? _o[0] - _c[0] : _c[0] - _o[0], _fy = (_end == 0) ? _o[1] - _c[1] : _c[1] - _o[1];   // along the line, in drawing direction`,
		`\t\t\tvar _flen = point_distance(0, 0, _fx, _fy);`,
		`\t\t\tif (_flen < 0.0001) continue;`,
		`\t\t\tvar _b1 = arctan2(-_fx / _flen, _fy / _flen);   // sideways`,
		`\t\t\tvar _bd = (_end == 0) ? -pi : pi;   // the start swings round behind the line, the end round in front of it`,
		`\t\t\tfor (var k = 0; k < _steps; k++) {`,
		`\t\t\t\tvar _s1 = _b1 + _bd * k / _steps, _s2 = _b1 + _bd * (k + 1) / _steps;`,
		`\t\t\t\t${F.vertex}(_m, _c[0], _c[1]);`,
		`\t\t\t\t${F.vertex}(_m, _c[0] + cos(_s1) * _half, _c[1] + sin(_s1) * _half);`,
		`\t\t\t\t${F.vertex}(_m, _c[0] + cos(_s2) * _half, _c[1] + sin(_s2) * _half);`,
		`\t\t\t}`,
		`\t\t}`,
		`\t}`,
		`\tdraw_primitive_end();`,
		`}`, ``,
		`// How far along the gradient a point of a shape is: 0 at the start, 1 at the end (_x, _y are measured from the shape's pivot, or its centre when it has none).`,
		`function ${F.gradT}(_shape, _x, _y) {`,
		`\tvar _box = _shape.gradient_box;   // [left, top, right, bottom]`,
		`\tvar _cx = (_box[0] + _box[2]) / 2, _cy = (_box[1] + _box[3]) / 2;`,
		`\tif (_shape.fill_type == "radial") {`,
		`\t\treturn point_distance(_cx, _cy, _x, _y) / max(point_distance(_box[0], _box[1], _box[2], _box[3]) / 2, 0.0001);`,
		`\t}`,
		`\tvar _dx = dcos(_shape.gradient_angle), _dy = dsin(_shape.gradient_angle);`,
		`\tvar _half = max(((_box[2] - _box[0]) * abs(_dx) + (_box[3] - _box[1]) * abs(_dy)) / 2, 0.0001);`,
		`\treturn ((_x - _cx) * _dx + (_y - _cy) * _dy) / (_half * 2) + 0.5;`,
		`}`, ``,
		`// The colour at position _t of a shape's gradient: from color, through gradient_stops, to color2.`,
		`function ${F.gradBlend}(_shape, _t) {`,
		`\t_t = clamp(_t, 0, 1);`,
		`\tvar _from = 0, _from_color = _shape.color;`,
		`\tfor (var i = 0; i < array_length(_shape.gradient_stops); i++) {`,
		`\t\tvar _stop = _shape.gradient_stops[i];`,
		`\t\tif (_t <= _stop[0]) return merge_color(_from_color, _stop[1], (_t - _from) / max(_stop[0] - _from, 0.0001));`,
		`\t\t_from = _stop[0]; _from_color = _stop[1];`,
		`\t}`,
		`\treturn merge_color(_from_color, _shape.color2, (_t - _from) / max(1 - _from, 0.0001));`,
		`}`, ``,
		`// The gradient colour at a point of a shape.`,
		`function ${F.gradColor}(_shape, _x, _y) {`,
		`\treturn ${F.gradBlend}(_shape, ${F.gradT}(_shape, _x, _y));`,
		`}`, ``,
		`// Cuts a polygon (a list of [x, y, t]) down to the piece where t is between _low and _high.`,
		`function ${F.clip}(_poly, _low, _high) {`,
		`\tfor (var _pass = 0; _pass < 2; _pass++) {`,
		`\t\tvar _limit = (_pass == 0) ? _low : _high, _side = (_pass == 0) ? 1 : -1;   // keep t >= _low, then t <= _high`,
		`\t\tvar _out = [], _n = array_length(_poly);`,
		`\t\tfor (var i = 0; i < _n; i++) {`,
		`\t\t\tvar _a = _poly[i], _b = _poly[(i + 1) % _n];`,
		`\t\t\tvar _da = (_a[2] - _limit) * _side, _db = (_b[2] - _limit) * _side;`,
		`\t\t\tif (_da >= 0) array_push(_out, _a);`,
		`\t\t\tif ((_da >= 0) != (_db >= 0)) {`,
		`\t\t\t\tvar _f = _da / (_da - _db);`,
		`\t\t\t\tarray_push(_out, [_a[0] + (_b[0] - _a[0]) * _f, _a[1] + (_b[1] - _a[1]) * _f, _limit]);`,
		`\t\t\t}`,
		`\t\t}`,
		`\t\t_poly = _out;`,
		`\t\tif (array_length(_poly) < 3) return [];`,
		`\t}`,
		`\treturn _poly;`,
		`}`, ``,
		`// Draws a part with a gradient. A radial gradient splits every triangle into gradient_detail x gradient_detail small ones and`,
		`// gives each corner its own colour. A linear gradient with extra stops is cut exactly at every stop. A plain two-colour linear`,
		`// gradient needs no cutting at all.`,
		`function ${F.paint}(_shape, _part_matrix, _m, _mesh, _blend, _alpha) {`,
		`\tif (_shape.fill_type != "radial" && array_length(_shape.gradient_stops) > 0) { ${F.paintStops}(_shape, _part_matrix, _m, _mesh, _blend, _alpha); return; }`,
		`\tvar _n = (_shape.fill_type == "radial") ? max(1, _shape.gradient_detail) : 1;`,
		`\tvar _points = _mesh.points, _tri = _mesh.triangles;`,
		`\tdraw_primitive_begin(pr_trianglelist);`,
		`\tvar _sent = 0;   // points sent so far in this batch`,
		`\tfor (var t = 0; t < array_length(_tri); t += 3) {`,
		`\t\tvar _a = _points[_tri[t]], _b = _points[_tri[t + 1]], _c = _points[_tri[t + 2]];`,
		`\t\tfor (var i = 0; i < _n; i++) {`,
		`\t\t\tfor (var j = 0; j < _n - i; j++) {`,
		`\t\t\t\t// one small triangle, and (except along the edge) the one beside it`,
		`\t\t\t\tvar _corners = [[i, j], [i + 1, j], [i, j + 1]];`,
		`\t\t\t\tif (i + j < _n - 1) _corners = array_concat(_corners, [[i + 1, j], [i + 1, j + 1], [i, j + 1]]);`,
		`\t\t\t\tif (_sent >= 600) {   // a long batch is cut into pieces, because the graphics system only takes so many points at once`,
		`\t\t\t\t\tdraw_primitive_end();`,
		`\t\t\t\t\tdraw_primitive_begin(pr_trianglelist);`,
		`\t\t\t\t\t_sent = 0;`,
		`\t\t\t\t}`,
		`\t\t\t\t_sent += array_length(_corners);`,
		`\t\t\t\tfor (var c = 0; c < array_length(_corners); c++) {`,
		`\t\t\t\t\tvar _u = _corners[c][0] / _n, _v = _corners[c][1] / _n;`,
		`\t\t\t\t\tvar _x = _a[0] + (_b[0] - _a[0]) * _u + (_c[0] - _a[0]) * _v;`,
		`\t\t\t\t\tvar _y = _a[1] + (_b[1] - _a[1]) * _u + (_c[1] - _a[1]) * _v;`,
		`\t\t\t\t\tvar _lx = _part_matrix[0] * _x + _part_matrix[2] * _y + _part_matrix[4];`,
		`\t\t\t\t\tvar _ly = _part_matrix[1] * _x + _part_matrix[3] * _y + _part_matrix[5];`,
		`\t\t\t\t\tdraw_vertex_color(_m[0] * _x + _m[2] * _y + _m[4], _m[1] * _x + _m[3] * _y + _m[5], ${F.tint}(${F.gradColor}(_shape, _lx, _ly), _blend), _alpha);`,
		`\t\t\t\t}`,
		`\t\t\t}`,
		`\t\t}`,
		`\t}`,
		`\tdraw_primitive_end();`,
		`}`, ``,
		`// A linear gradient with extra stops. Every triangle is cut where the gradient reaches a stop, so each piece blends between`,
		`// just two colours and the corner colours are exact.`,
		`function ${F.paintStops}(_shape, _part_matrix, _m, _mesh, _blend, _alpha) {`,
		`\tvar _edges = [-1000000];`,
		`\tfor (var i = 0; i < array_length(_shape.gradient_stops); i++) array_push(_edges, _shape.gradient_stops[i][0]);`,
		`\tarray_push(_edges, 1000000);`,
		`\tvar _points = _mesh.points, _tri = _mesh.triangles;`,
		`\tdraw_primitive_begin(pr_trianglelist);`,
		`\tvar _sent = 0;`,
		`\tfor (var t = 0; t < array_length(_tri); t += 3) {`,
		`\t\tvar _poly = [];`,
		`\t\tfor (var c = 0; c < 3; c++) {`,
		`\t\t\tvar _p = _points[_tri[t + c]];`,
		`\t\t\tvar _lx = _part_matrix[0] * _p[0] + _part_matrix[2] * _p[1] + _part_matrix[4];`,
		`\t\t\tvar _ly = _part_matrix[1] * _p[0] + _part_matrix[3] * _p[1] + _part_matrix[5];`,
		`\t\t\tarray_push(_poly, [_p[0], _p[1], ${F.gradT}(_shape, _lx, _ly)]);`,
		`\t\t}`,
		`\t\tfor (var _band = 0; _band < array_length(_edges) - 1; _band++) {`,
		`\t\t\tvar _piece = ${F.clip}(_poly, _edges[_band], _edges[_band + 1]);`,
		`\t\t\tvar _count = array_length(_piece);`,
		`\t\t\tif (_count < 3) continue;`,
		`\t\t\tif (_sent >= 600) {`,
		`\t\t\t\tdraw_primitive_end();`,
		`\t\t\t\tdraw_primitive_begin(pr_trianglelist);`,
		`\t\t\t\t_sent = 0;`,
		`\t\t\t}`,
		`\t\t\tfor (var k = 1; k < _count - 1; k++) {`,
		`\t\t\t\tvar _corner = [_piece[0], _piece[k], _piece[k + 1]];`,
		`\t\t\t\tfor (var c = 0; c < 3; c++) {`,
		`\t\t\t\t\tvar _v = _corner[c];`,
		`\t\t\t\t\tdraw_vertex_color(_m[0] * _v[0] + _m[2] * _v[1] + _m[4], _m[1] * _v[0] + _m[3] * _v[1] + _m[5], ${F.tint}(${F.gradBlend}(_shape, _v[2]), _blend), _alpha);`,
		`\t\t\t\t}`,
		`\t\t\t\t_sent += 3;`,
		`\t\t\t}`,
		`\t\t}`,
		`\t}`,
		`\tdraw_primitive_end();`,
		`}`, ``,
		`// Tints a colour like image_blend does (multiplies the red, green and blue), then mixes in the design's flash.`,
		`function ${F.tint}(_color, _blend) {`,
		`\tif (_blend != c_white) {`,
		`\t\t_color = make_color_rgb(`,
		`\t\t\tcolor_get_red(_color) * color_get_red(_blend) / 255,`,
		`\t\t\tcolor_get_green(_color) * color_get_green(_blend) / 255,`,
		`\t\t\tcolor_get_blue(_color) * color_get_blue(_blend) / 255`,
		`\t\t);`,
		`\t}`,
		`\tvar _state = ${F.batch}();`,
		`\tif (_state.flash_amount > 0) _color = merge_color(_color, _state.flash_color, _state.flash_amount);`,
		`\treturn _color;`,
		`}`, ``, `#endregion`, ``);

	return { code: out.join('\n'), script: F.script };
}

// ------------------------------------------------------------------------------------------------ cost
// How many triangles one draw of the design sends to the graphics card. The exported script counts them the same way, so the
// export window can show what a choice of circle sides or gradient smoothness costs before anything is exported.

// the pieces a polygon is cut into by a gradient's stops (the same cut the script makes); returns how many triangles result
function stopCuts(mesh, part, s) {
	const box = gradBoxArr(s), cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2, a = s.gradAngle * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
	const half = Math.max(((box[2] - box[0]) * Math.abs(dx) + (box[3] - box[1]) * Math.abs(dy)) / 2, 1e-4);
	const pa = part.angle * Math.PI / 180, pc = Math.cos(pa), ps = Math.sin(pa);
	const T = ([x, y]) => { const lx = pc * x + ps * y + part.x, ly = -ps * x + pc * y + part.y; return ((lx - cx) * dx + (ly - cy) * dy) / (half * 2) + 0.5; };
	const edges = [-1e6, ...s.stops.map(q => q.t).sort((a, b) => a - b), 1e6];
	let count = 0;
	for (let t = 0; t < mesh.triangles.length; t += 3) {
		const poly0 = [0, 1, 2].map(c => { const p = mesh.points[mesh.triangles[t + c]]; return [p[0], p[1], T(p)]; });
		for (let b = 0; b < edges.length - 1; b++) {
			let poly = poly0;
			for (let pass = 0; pass < 2 && poly.length >= 3; pass++) {
				const limit = pass ? edges[b + 1] : edges[b], side = pass ? -1 : 1, out = [];
				poly.forEach((p, i) => {
					const q = poly[(i + 1) % poly.length], dp = (p[2] - limit) * side, dq = (q[2] - limit) * side;
					if (dp >= 0) out.push(p);
					if ((dp >= 0) !== (dq >= 0)) { const f = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, limit]); }
				});
				poly = out;
			}
			if (poly.length >= 3) count += poly.length - 2;
		}
	}
	return count;
}

// triangles in the outline of one ring: a band (2) per edge, plus a round wedge at every corner that points outward
function ringOutlineTris(pts, hole, sides) {
	const n = pts.length;
	let area = 0;
	pts.forEach((p, i) => { const q = pts[(i + 1) % n]; area += p[0] * q[1] - q[0] * p[1]; });
	const flip = hole ? -1 : 1;
	let tris = 0;
	for (let i = 0; i < n; i++) {
		const b = pts[(i + n - 1) % n], p = pts[i], q = pts[(i + 1) % n], ex = p[0] - b[0], ey = p[1] - b[1], dx = q[0] - p[0], dy = q[1] - p[1];
		if (Math.hypot(dx, dy) < 1e-4 || Math.hypot(ex, ey) < 1e-4) continue;
		tris += 2;
		const cross = ex * dy - ey * dx;
		if (cross * area * flip > 0) tris += Math.max(1, Math.ceil(Math.abs(Math.atan2(cross, ex * dx + ey * dy)) / (2 * Math.PI) * sides));
	}
	return tris;
}

// triangles in a thick line: a band per piece, a wedge on every bend, and half circles on round ends
function lineTris(pts, round, sides) {
	let tris = 0;
	for (let i = 0; i < pts.length - 1; i++) {
		if (Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) < 1e-4) continue;
		tris += 2;
		if (i < pts.length - 2) {
			const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1], ex = pts[i + 2][0] - pts[i + 1][0], ey = pts[i + 2][1] - pts[i + 1][1];
			if (Math.hypot(ex, ey) >= 1e-4) tris += Math.max(1, Math.ceil(Math.abs(Math.atan2(dx * ey - dy * ex, dx * ex + dy * ey)) / (2 * Math.PI) * sides));
		}
	}
	return tris + (round ? 2 * Math.max(2, Math.ceil(sides / 2)) : 0);
}

// opts = { circleSides, gradientDetail } -> { total, shapes: [{ name, fill, outline, total, note }] }
function gmlStats(d, opts) {
	const sides = Math.round(opts.circleSides || d.segments), def = Math.max(1, Math.round(opts.gradientDetail || 4));
	const shapes = d.shapes.map(s => {
		const row = { name: s.name, fill: 0, outline: 0, total: 0, note: '', hidden: !!s.hidden };
		if (s.hidden) return row;
		const grad = s.fillType !== 'solid', detail = s.gradDetail || def;
		for (const p of gmlParts(s, sides, d)) {
			if (p.kind === 'line') { row.outline += lineTris(p.corners, s.cap === 'round', sides); continue; }
			const ellipse = p.kind === 'ellipse';
			const ring = ellipse ? Array.from({ length: sides }, (_, k) => [Math.cos(k / sides * 2 * Math.PI) * p.rx, Math.sin(k / sides * 2 * Math.PI) * p.ry]) : null;
			const mesh = ellipse ? { points: [[0, 0], ...ring], triangles: ring.flatMap((_, k) => [0, k + 1, (k + 1) % sides + 1]) } : { points: p.corners, triangles: p.triangles };
			let tris = mesh.triangles.length / 3;
			if (grad && s.fillType === 'radial') tris *= detail * detail;
			else if (grad && s.stops) tris = stopCuts(mesh, p, s);
			row.fill += tris;
			if (s.outline > 0) {
				const rings = ellipse ? [[ring, false]] : (p.rings || [[0, p.corners.length, 0]]).map(r => [p.corners.slice(r[0], r[0] + r[1]), !!r[2]]);
				for (const [pts, hole] of rings) row.outline += ringOutlineTris(pts, hole, sides);
			}
		}
		row.total = row.fill + row.outline;
		if (grad && s.fillType === 'radial') row.note = 'radial gradient, ' + detail + ' × ' + detail + ' per triangle';
		else if (grad && s.stops) row.note = 'gradient with ' + (s.stops.length + 2) + ' colors';
		return row;
	});
	return { total: shapes.reduce((n, r) => n + r.total, 0), shapes, sides, detail: def };
}

// ------------------------------------------------------------------------------------------------ export window

function loadGmlOptions() {
	try { return { ...GML_DEFAULTS, ...JSON.parse(localStorage.getItem(GML_KEY)) }; } catch (e) { return { ...GML_DEFAULTS }; }
}

function downloadText(file, text, mime = 'text/plain') {
	const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: mime })), download: file });
	document.body.append(a); a.click(); a.remove();
	setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function openGmlDialog(d) {
	const body = $('#gmlBody');
	body.replaceChildren();
	const o = loadGmlOptions();
	const prefix = el('input', { type: 'text', maxlength: 30, value: o.prefix, placeholder: '(none)' });
	const style = el('select', {}, [['snake', 'snake_case   design_player_draw'], ['camel', 'camelCase   designPlayerDraw'], ['pascal', 'PascalCase   DesignPlayerDraw']]
		.map(([v, t]) => el('option', { value: v }, t)));
	style.value = o.style;
	// circle sides and gradient smoothness are chosen here, for this export only; the design itself keeps its own numbers
	const sidesR = el('input', { type: 'range', min: 8, max: 128, step: 4, value: d.segments }), sidesN = el('input', { type: 'number', min: 8, max: 128, step: 4, value: d.segments });
	const detailR = el('input', { type: 'range', min: 1, max: 16, step: 1, value: o.gradientDetail }), detailN = el('input', { type: 'number', min: 1, max: 16, step: 1, value: o.gradientDetail });
	const own = d.shapes.filter(s => s.gradDetail && s.fillType === 'radial').length;
	const copies = el('input', { type: 'number', min: 1, max: 9999, step: 1, value: 1 });
	const code = el('textarea', { readonly: true, spellcheck: 'false' });
	const info = el('span', { class: 'meta' });
	const cost = el('div', { class: 'gml-cost' });
	let last = null, timer = 0;

	const options = () => ({ prefix: prefix.value, style: style.value, circleSides: clamp(Math.round((+sidesN.value || d.segments) / 4) * 4, 8, 128), gradientDetail: clamp(Math.round(+detailN.value || 4), 1, 16) });
	const showCost = () => {
		const opts = options(), st = gmlStats(d, opts), n = Math.max(1, Math.round(+copies.value || 1));
		const grade = st.total <= 1500 ? ['Light', 'ok'] : st.total <= 6000 ? ['Moderate', 'mid'] : ['Heavy', 'bad'];
		const top = st.shapes.filter(r => r.total).sort((a, b) => b.total - a.total).slice(0, 5);
		const tips = [];
		const big = top[0];
		if (big && st.total > 1500 && big.total / st.total > 0.4 && top.length > 1) tips.push('"' + big.name + '" is ' + Math.round(big.total / st.total * 100) + '% of the cost' + (big.note ? ' (' + big.note + ')' : '') + '.');
		if (st.shapes.some(r => r.note.startsWith('radial')) && st.detail > 4) tips.push('Lower gradient smoothness to make radial gradients cheaper. Linear gradients cost far less.');
		if (st.sides > 32 && d.shapes.some(s => s.type === 'circle' || s.outline > 0)) tips.push('Circles and rounded outlines use the circle sides. 24 to 32 looks smooth at most sizes.');
		if (st.total > 1500) tips.push('A design that does not change can be drawn once into a sprite with the bake function, which makes the cost a one-time one.');
		cost.replaceChildren(
			el('div', { class: 'cost-head' }, el('span', { class: 'cost-total' }, st.total.toLocaleString() + ' triangles'), el('span', { class: 'cost-grade ' + grade[1] }, grade[0]), el('span', { class: 'meta' }, 'per draw of one copy')),
			el('div', { class: 'cost-copies' }, el('label', {}, copies, ' copies on screen'), el('span', { class: 'meta' }, '= ' + (st.total * n).toLocaleString() + ' triangles per frame')),
			...top.map(r => el('div', { class: 'cost-row' }, el('span', { class: 'cost-name' }, r.name), el('span', { class: 'cost-bar' }, el('i', { style: 'width:' + Math.max(2, r.total / top[0].total * 100) + '%' })),
				el('span', { class: 'cost-n' }, r.total.toLocaleString()), el('span', { class: 'meta cost-note' }, r.note || (r.outline && !r.fill ? 'line' : r.outline ? 'with outline' : '')))),
			...(st.shapes.some(r => r.hidden) ? [el('div', { class: 'meta' }, 'Hidden shapes are not drawn and cost nothing.')] : []),
			...tips.map(t => el('div', { class: 'cost-tip' }, t)),
			el('div', { class: 'meta' }, 'Counts are exact for the script below. The Light, Moderate and Heavy labels are rules of thumb, not timings: the script draws with GML code every frame, so test on your slowest target.'));
	};
	const refresh = () => {
		const opts = options();
		try { localStorage.setItem(GML_KEY, JSON.stringify({ prefix: opts.prefix, style: opts.style, gradientDetail: opts.gradientDetail })); } catch (e) { /* settings just will not be remembered */ }
		last = gmlDesign(d, opts);
		code.value = last.code;
		info.textContent = 'Script name: ' + last.script + '   ·   ' + last.code.split('\n').length + ' lines';
		showCost();
	};
	const later = () => { clearTimeout(timer); timer = setTimeout(refresh, 120); };
	for (const c of [prefix, style]) c.addEventListener('input', refresh);
	const pair = (r, n) => { r.addEventListener('input', () => { n.value = r.value; later(); }); n.addEventListener('input', () => { r.value = n.value; later(); }); };
	pair(sidesR, sidesN); pair(detailR, detailN);
	copies.addEventListener('input', showCost);

	const copy = async () => {
		try { await navigator.clipboard.writeText(last.code); }
		catch (e) { code.select(); document.execCommand('copy'); }
		toast('Copied - paste it into a new Script asset in GameMaker.');
	};
	body.append(
		el('div', { class: 'modal-head' }, el('h2', {}, 'Export "' + d.name + '" as GML'), el('span', { class: 'spacer' }), el('button', { onclick: () => { clearTimeout(timer); $('#gml').hidden = true; } }, '✕')),
		el('div', { class: 'gml-options' },
			el('label', {}, 'Name prefix', prefix),
			el('label', {}, 'Naming style', style),
		),
		el('div', { class: 'gml-options' },
			el('label', {}, 'Circle sides', el('span', { class: 'pair' }, sidesR, sidesN)),
			el('label', {}, 'Gradient smoothness (default)', el('span', { class: 'pair' }, detailR, detailN)),
		),
		el('p', { class: 'note' }, 'Circle sides set how round circles and rounded corners are drawn. Gradient smoothness is how finely a radial gradient is split to follow its blend, and is the default for every radial gradient' + (own ? ' except the ' + own + (own === 1 ? ' shape' : ' shapes') + ' with their own setting' : '') + '. More is smoother and costs more. These numbers apply to this export only; the design keeps its own. The prefix and style set the names of the script, its functions, and your shapes and points.'),
		cost,
		code,
		el('div', { class: 'btns' },
			el('button', { class: 'primary', onclick: copy }, 'Copy code'),
			el('button', { onclick: () => { downloadText(last.script + '.gml', last.code); toast('Saved ' + last.script + '.gml'); } }, 'Download .gml'),
			info),
	);
	refresh();
	$('#gml').hidden = false;
}

$('#gmlBtn').addEventListener('click', () => openGmlDialog(cur));
$('#gml').addEventListener('click', (e) => { if (e.target.id === 'gml') $('#gml').hidden = true; });
