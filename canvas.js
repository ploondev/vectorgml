'use strict';
// VectorGML - the canvas: drawing shapes and handles, and everything the mouse and keyboard do on it.

const HANDLES = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
const ACCENT = '#5b9cff';

function toWorld(e) {
	const r = $('#canvas').getBoundingClientRect();
	return { x: (e.clientX - r.left - view.tx) / view.z, y: (e.clientY - r.top - view.ty) / view.z };
}

function viewCenter() {
	const c = $('#canvas');
	return { x: (c.clientWidth / 2 - view.tx) / view.z, y: (c.clientHeight / 2 - view.ty) / view.z };
}

// ------------------------------------------------------------------------------------------------ shapes as SVG

// one part in world coordinates. Circles are n-sided polygons, the same ones the game draws.
function partNode(p, n) {
	const rings = partRings(p, n);
	if (p.type === 'region') return svg('path', { d: rings.map(r => 'M' + r.pts.map(q => q[0] + ',' + q[1]).join('L') + 'Z').join(''), 'fill-rule': 'evenodd' });
	return svg('polygon', { points: rings[0].pts.map(q => q[0] + ',' + q[1]).join(' ') });
}

let gradCount = 0;

// the fill of a shape: its color, or a gradient (added to defs) that follows the shape's own turn
function fillFor(s, defs) {
	if (s.fillType === 'solid') return s.color;
	const b = shapeBounds({ ...s, x: 0, y: 0, rotation: 0 }), w = b[1] - b[0], h = b[3] - b[2], cx = s.x + (b[0] + b[1]) / 2, cy = s.y + (b[2] + b[3]) / 2;
	const id = 'grad' + (++gradCount), turn = `rotate(${s.rotation} ${s.x} ${s.y})`;
	let g;
	if (s.fillType === 'linear') {
		const a = rad(s.gradAngle), dx = Math.cos(a), dy = Math.sin(a), half = Math.max((w * Math.abs(dx) + h * Math.abs(dy)) / 2, 1e-3);
		g = svg('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1: cx - dx * half, y1: cy - dy * half, x2: cx + dx * half, y2: cy + dy * half, gradientTransform: turn });
	} else {
		g = svg('radialGradient', { id, gradientUnits: 'userSpaceOnUse', cx, cy, r: Math.max(Math.hypot(w, h) / 2, 1e-3), gradientTransform: turn });
	}
	g.append(svg('stop', { offset: 0, 'stop-color': s.color }), ...(s.stops || []).map(q => svg('stop', { offset: q.t, 'stop-color': q.color })), svg('stop', { offset: 1, 'stop-color': s.color2 }));
	defs.append(g);
	return `url(#${id})`;
}

// The shape exactly as it will be exported: the outline is drawn first, grown outward from the edge, then the fill on top.
// plain = no editing hooks (used by the preview and the thumbnails).
function shapeNode(s, plain, segs, design) {
	const n = segs || (cur && cur.segments) || 32;
	const g = svg('g'), parts = worldParts(s, n, design), op = s.opacity ?? 1, defs = svg('defs');
	if (s.type === 'line') {   // a stroke: the path through its points, with a thickness and round or flat ends (or, with a style, plain polygons)
		const pts = partRings(rawParts(s)[0], n)[0].pts.map(q => q.join(',')).join(' ');
		if (lineStyled(s)) for (const p of parts) { const f = partNode(p, n); f.setAttribute('fill', s.color); if (op < 1) f.setAttribute('opacity', op); g.append(f); }
		else g.append(svg('polyline', { points: pts, fill: 'none', stroke: s.color, 'stroke-width': s.lineWidth, 'stroke-linecap': s.cap === 'flat' ? 'butt' : 'round', 'stroke-linejoin': 'round', opacity: op }));
		if (!plain) g.append(svg('polyline', { points: pts, fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(s.lineWidth, 8), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': 'stroke' }));   // a thin line is still easy to grab
	}
	const fill = s.type === 'line' ? null : fillFor(s, defs);
	if (defs.childNodes.length) g.append(defs);
	if (s.type !== 'line' && s.outline > 0) {
		for (const p of parts) {
			const o = partNode(p, n);
			for (const [k, v] of Object.entries({ fill: s.outlineColor, stroke: s.outlineColor, 'stroke-width': s.outline * 2, 'stroke-linejoin': 'round', opacity: op })) o.setAttribute(k, v);
			g.append(o);
		}
	}
	if (s.type !== 'line') for (const p of parts) {
		const f = partNode(p, n);
		f.setAttribute('fill', fill);
		if (op < 1) f.setAttribute('opacity', op);
		g.append(f);
	}
	if (!plain) {
		g.dataset.id = s.id;
		g.style.cursor = s.locked ? 'default' : 'move';
		if (s.locked) g.style.pointerEvents = 'none';
	}
	return g;
}

// ------------------------------------------------------------------------------------------------ drawing the canvas

// the rulers along the top and left edge; dragging from one pulls out a guide line
function drawRulers(W, H, tx, ty, z) {
	const rg = $('#rulers');
	rg.replaceChildren();
	if (!prefs.rulers) return;
	const T = 18, steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
	const step = steps.find(s => s * z >= 70) || 50000, m = step / Math.pow(10, Math.floor(Math.log10(step))), minor = step / (m === 1 ? 10 : m === 2 ? 4 : 5), showMinor = minor * z >= 5;
	const bgAttrs = { fill: '#1b1e24', stroke: '#2d313a', 'stroke-width': 1 };
	const top = svg('rect', { x: T, y: 0, width: Math.max(0, W - T), height: T, ...bgAttrs }), left = svg('rect', { x: 0, y: T, width: T, height: Math.max(0, H - T), ...bgAttrs });
	top.dataset.ruler = 'top'; left.dataset.ruler = 'left';
	rg.append(top, left, svg('rect', { x: 0, y: 0, width: T, height: T, ...bgAttrs }));
	const major = (v) => Math.abs(v / step - Math.round(v / step)) < 1e-6;
	let dTop = '', dLeft = '';
	const labels = [];
	const from = (lo, hi, push) => { for (let v = Math.ceil(lo / (showMinor ? minor : step)) * (showMinor ? minor : step); v <= hi; v += (showMinor ? minor : step)) push(v); };
	from((T - tx) / z, (W - tx) / z, (v) => {
		const sx = Math.round(tx + v * z) + .5, big = major(v);
		dTop += `M${sx} ${T}V${big ? T - 11 : T - 5}`;
		if (big) { const t = svg('text', { x: sx + 3, y: 10 }); t.textContent = String(Math.round(v * 100) / 100); labels.push(t); }
	});
	from((T - ty) / z, (H - ty) / z, (v) => {
		const sy = Math.round(ty + v * z) + .5, big = major(v);
		dLeft += `M${T} ${sy}H${big ? T - 11 : T - 5}`;
		if (big) { const t = svg('text', { x: 9, y: sy - 3, transform: `rotate(-90 9 ${sy - 3})` }); t.textContent = String(Math.round(v * 100) / 100); labels.push(t); }
	});
	rg.append(svg('path', { d: dTop + dLeft, stroke: '#6b7381', 'stroke-width': 1, fill: 'none', 'pointer-events': 'none' }));
	for (const t of labels) rg.append(t);
	rg.append(svg('rect', { x: 0, y: 0, width: T, height: T, fill: '#1b1e24', stroke: '#2d313a', 'pointer-events': 'none' }));
}

function draw() {
	if (!cur) return;
	if (!drag && !drawMode) guides = [];   // smart guide lines only exist while something is being dragged or drawn
	syncMirrors(cur);   // a linked twin follows its shape while it is dragged
	const canvas = $('#canvas'), g = $('#world');
	const W = canvas.clientWidth, H = canvas.clientHeight, { tx, ty, z } = view;
	g.setAttribute('transform', `translate(${tx} ${ty}) scale(${z})`);
	g.replaceChildren();
	const px = (n) => n / z;   // screen pixels -> world units, for things that should stay the same size on screen
	const line = { fill: 'none', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' };

	// grid
	const x0 = -tx / z, x1 = (W - tx) / z, y0 = -ty / z, y1 = (H - ty) / z;
	if (prefs.grid) {
		const gx = prefs.gridX > 0 ? prefs.gridX : 1, gy = prefs.gridY > 0 ? prefs.gridY : 1;
		let sx, sy;
		if (gx === 1 && gy === 1) sx = sy = [1, 2, 4, 8, 16, 32, 64, 128, 256].find(s => s * z >= 14) || 256;
		else { sx = gx; sy = gy; while (sx * z < 6) sx *= 2; while (sy * z < 6) sy *= 2; }   // a custom grid keeps its size but thins out when zoomed far out
		let d = '';
		for (let x = Math.ceil(x0 / sx) * sx; x <= x1; x += sx) d += `M${r4(x)} ${y0}V${y1}`;
		for (let y = Math.ceil(y0 / sy) * sy; y <= y1; y += sy) d += `M${x0} ${r4(y)}H${x1}`;
		g.append(svg('path', { d, stroke: '#23262d', 'stroke-width': 1, ...line }));
	}
	g.append(svg('path', { d: `M0 ${y0}V${y1}M${x0} 0H${x1}`, stroke: '#3d4350', 'stroke-width': 1, ...line }));
	const showRules = prefs.rulers && cur.rules, grabRules = showRules && tool === 'select' && !drawMode && !vertexMode;
	if (grabRules) cur.rules.forEach((gl, i) => {   // the part of a guide line that can be grabbed sits under the shapes
		const hit = svg('path', { d: gl.axis === 'x' ? `M${gl.pos} ${y0}V${y1}` : `M${x0} ${gl.pos}H${x1}`, stroke: 'transparent', 'stroke-width': 7, fill: 'none', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'stroke' });
		hit.dataset.rule = i; hit.style.cursor = gl.axis === 'x' ? 'ew-resize' : 'ns-resize';
		g.append(hit);
	});

	// shapes
	for (const n of referenceNodes(false)) g.append(n);
	for (const s of cur.shapes) if (!s.hidden) g.append(shapeNode(s));
	for (const n of referenceNodes(true)) g.append(n);
	const refFrame = referenceFrame();
	if (refFrame) g.append(refFrame);

	// selection box, resize handles, rotate handle
	const picked = selectedShapes().filter(s => !s.hidden);
	if (multi.size >= 2) {
		for (const s of picked) {
			g.append(svg('rect', {
				x: s.x - Math.abs(s.width * s.scale) / 2, y: s.y - Math.abs(s.height * s.scale) / 2, width: Math.abs(s.width * s.scale), height: Math.abs(s.height * s.scale),
				transform: `rotate(${s.rotation} ${s.x} ${s.y})`, stroke: ACCENT, 'stroke-width': 1, 'stroke-dasharray': '3 3', ...line, 'stroke-opacity': .7,
			}));
		}
		if (picked.length) {
			const b = unionBounds(picked.map(shapeBounds));
			g.append(svg('rect', { x: b[0], y: b[2], width: b[1] - b[0], height: b[3] - b[2], stroke: ACCENT, 'stroke-width': 1.5, ...line }));
			if (!picked.some(s => s.locked)) {   // the handle above the box turns every selected shape together
				const mx = (b[0] + b[1]) / 2;
				g.append(svg('line', { x1: mx, y1: b[2], x2: mx, y2: b[2] - px(24), stroke: ACCENT, 'stroke-width': 1.5, ...line }));
				const rot = svg('circle', { cx: mx, cy: b[2] - px(24), r: px(6), fill: '#fff', stroke: ACCENT, 'stroke-width': px(1.5) });
				rot.dataset.mhandle = 'rot'; rot.style.cursor = 'grab';
				g.append(rot);
			}
			if (!picked.some(s => s.locked)) for (const [hx, hy] of HANDLES.filter(h => h[0] && h[1])) {   // corners scale the whole selection evenly
				const hs = px(4.5);
				const r = svg('rect', { x: (hx < 0 ? b[0] : b[1]) - hs, y: (hy < 0 ? b[2] : b[3]) - hs, width: hs * 2, height: hs * 2, fill: '#fff', stroke: ACCENT, 'stroke-width': px(1.5) });
				r.dataset.mhandle = hx + ',' + hy; r.style.cursor = hx * hy > 0 ? 'nwse-resize' : 'nesw-resize';
				g.append(r);
			}
		}
	} else if (picked.length === 1) {
		const s = picked[0], w = Math.abs(s.width * s.scale), h = Math.abs(s.height * s.scale);
		const grp = svg('g', { transform: `rotate(${s.rotation} ${s.x} ${s.y})` });
		if (vertexMode === s.id) {
			const bw = s.width * s.scale, bh = s.height * s.scale;
			const outline = s.type === 'circle'
				? svg('polygon', { points: partRings({ type: 'circle', x: s.x, y: s.y, width: Math.abs(bw), height: Math.abs(bh), rotation: 0 }, cur.segments)[0].pts.map(q => q.join(',')).join(' ') })
				: svg(s.type === 'line' ? 'polyline' : 'polygon', { points: s.vertices.some(hasHandles)
					? partRings(rawParts({ ...s, rotation: 0 })[0], cur.segments)[0].pts.map(q => q.join(',')).join(' ')
					: s.vertices.map(v => `${s.x + v.x * bw},${s.y + v.y * bh}`).join(' ') });
			for (const [k, v] of Object.entries({ fill: 'none', stroke: ACCENT, 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' })) outline.setAttribute(k, v);
			grp.append(outline);
			if (s.type === 'circle') {   // a circle's "vertices" are two stretch points
				for (const [which, dir] of [['top', -1], ['bottom', 1]]) {
					const r = px(5);
					const q = svg('rect', { x: s.x - r, y: s.y + dir * Math.abs(bh) / 2 - r, width: r * 2, height: r * 2, fill: '#fff', stroke: ACCENT, 'stroke-width': px(1.5) });
					q.dataset.stretch = which; q.style.cursor = 'ns-resize';
					grp.append(q);
				}
			}
			if (addingVertex && s.vertices) {
				s.vertices.forEach((v, i) => {
					if (s.type === 'line' && i === s.vertices.length - 1) return;   // a line is open: no side from the last point back to the first
					const b = s.vertices[(i + 1) % s.vertices.length];
					const ln = svg('line', {
						x1: s.x + v.x * bw, y1: s.y + v.y * bh, x2: s.x + b.x * bw, y2: s.y + b.y * bh,
						stroke: '#ffd24d', 'stroke-opacity': .3, 'stroke-width': px(10), 'stroke-linecap': 'round', 'pointer-events': 'stroke',
					});
					ln.dataset.edge = i; ln.style.cursor = 'copy';
					grp.append(ln);
				});
			}
			(s.vertices || []).forEach((v, i) => {
				const r = px(5), on = vsel.has(i), cx = s.x + v.x * bw, cy = s.y + v.y * bh;
				const look = { fill: on ? ACCENT : '#fff', stroke: on ? '#fff' : ACCENT, 'stroke-width': px(1.5) };
				const q = hasHandles(v) ? svg('circle', { cx, cy, r: r * 1.05, ...look }) : svg('rect', { x: cx - r, y: cy - r, width: r * 2, height: r * 2, ...look });   // a curved point is round
				q.dataset.vert = i; q.style.cursor = 'move';
				grp.append(q);
			});
			(s.vertices || []).forEach((v, i) => {   // the handles of the selected curved points
				if (!vsel.has(i) || !hasHandles(v)) return;
				const cx = s.x + v.x * bw, cy = s.y + v.y * bh;
				for (const [which, hx, hy] of [['in', v.ix || 0, v.iy || 0], ['out', v.ox || 0, v.oy || 0]]) {
					if (!hx && !hy) continue;
					const ex = cx + hx * bw, ey = cy + hy * bh;
					grp.append(svg('line', { x1: cx, y1: cy, x2: ex, y2: ey, stroke: ACCENT, 'stroke-width': px(1), 'pointer-events': 'none' }));
					const d = svg('circle', { cx: ex, cy: ey, r: px(4), fill: '#fff', stroke: ACCENT, 'stroke-width': px(1.5) });
					d.dataset.vhandle = which + ':' + i; d.style.cursor = 'move';
					grp.append(d);
				}
			});
			g.append(grp);
		} else {
			grp.append(svg('rect', { x: s.x - w / 2, y: s.y - h / 2, width: w, height: h, stroke: ACCENT, 'stroke-width': 1.5, 'stroke-dasharray': '4 3', ...line }));
			if (!s.locked) {
				grp.append(svg('line', { x1: s.x, y1: s.y - h / 2, x2: s.x, y2: s.y - h / 2 - px(24), stroke: ACCENT, 'stroke-width': 1.5, ...line }));
				const rot = svg('circle', { cx: s.x, cy: s.y - h / 2 - px(24), r: px(6), fill: '#fff', stroke: ACCENT, 'stroke-width': px(1.5) });
				rot.dataset.handle = 'rot'; rot.style.cursor = 'grab';
				grp.append(rot);
				const hs = px(4.5);
				for (const [hx, hy] of HANDLES) {
					const r = svg('rect', { x: s.x + hx * w / 2 - hs, y: s.y + hy * h / 2 - hs, width: hs * 2, height: hs * 2, fill: '#fff', stroke: ACCENT, 'stroke-width': px(1.5) });
					r.dataset.handle = hx + ',' + hy;
					r.style.cursor = !hx ? 'ns-resize' : !hy ? 'ew-resize' : hx * hy > 0 ? 'nwse-resize' : 'nesw-resize';
					grp.append(r);
				}
			}
			g.append(grp);
		}
	}

	// points
	const marker = (p, owner) => {
		const pos = pointWorld(p, owner), color = owner ? '#19c3b1' : '#ff4d8d', on = sel === p.id;
		if (on && owner) g.append(svg('line', { x1: pos.x, y1: pos.y, x2: owner.x, y2: owner.y, stroke: color, 'stroke-width': px(1), 'stroke-dasharray': `${px(3)} ${px(3)}`, 'pointer-events': 'none' }));   // a selected point is linked to its shape's centre
		g.append(svg('circle', { cx: pos.x, cy: pos.y, r: px(on ? 6 : 4.5), fill: color, stroke: on ? '#fff' : '#000', 'stroke-width': px(on ? 2 : 1.2), 'pointer-events': 'none' }));
		if (prefs.labels || on) {
			const label = svg('text', {
				x: pos.x + px(8), y: pos.y - px(7), fill: '#fff', stroke: '#000', 'stroke-width': px(3),
				'font-size': px(11), 'paint-order': 'stroke', 'pointer-events': 'none',
			});
			label.textContent = p.name;
			g.append(label);
		}
		const hit = svg('circle', { cx: pos.x, cy: pos.y, r: px(10), fill: 'transparent' });
		hit.dataset.id = p.id; hit.style.cursor = 'move';
		g.append(hit);
	};
	for (const s of cur.shapes) if (!s.hidden) for (const p of s.points) marker(p, s);
	for (const p of cur.points) marker(p, null);
	if (!vertexMode) for (const s of picked) {   // the pivot of each selected shape; it can be dragged while "Move pivot" is on
		const at = pointWorld(pivotOf(s), s), on = pivotMode && picked.length === 1 && !s.locked, r = px(on ? 7 : 4.5);
		g.append(svg('circle', { cx: at.x, cy: at.y, r, fill: on ? '#a06bff55' : 'none', stroke: '#a06bff', 'stroke-width': px(1.8), 'pointer-events': 'none' }));
		g.append(svg('path', { d: `M${at.x - r * 1.6} ${at.y}H${at.x + r * 1.6}M${at.x} ${at.y - r * 1.6}V${at.y + r * 1.6}`, stroke: '#a06bff', 'stroke-width': px(1.2), fill: 'none', 'pointer-events': 'none' }));
		if (on) { const hit = svg('circle', { cx: at.x, cy: at.y, r: px(12), fill: 'transparent' }); hit.dataset.pivot = s.id; hit.style.cursor = 'move'; g.append(hit); }
	}

	// the origin: the point (0,0) the game positions
	{
		const r = px(6), on = originGhost;
		const ring = svg('circle', { cx: 0, cy: 0, r, fill: 'transparent', stroke: '#f0a23a', 'stroke-width': px(1.5) });
		ring.dataset.origin = '1'; ring.style.cursor = 'move';
		g.append(ring);
		g.append(svg('path', { d: `M${-px(10)} 0H${px(10)}M0 ${-px(10)}V${px(10)}`, stroke: '#f0a23a', 'stroke-width': 1, ...line }));
		if (on) {
			g.append(svg('path', { d: `M${on.x - px(12)} ${on.y}H${on.x + px(12)}M${on.x} ${on.y - px(12)}V${on.y + px(12)}`, stroke: '#ffd24d', 'stroke-width': 1.5, ...line }));
			g.append(svg('circle', { cx: on.x, cy: on.y, r: px(7), fill: 'none', stroke: '#ffd24d', 'stroke-width': px(1.5), 'pointer-events': 'none' }));
		}
	}

	// the centre a circular pattern turns round
	if (repeatMode && repeatMode.kind === 'circle') {
		const cx = repeatMode.p.cx, cy = repeatMode.p.cy, r = px(9);
		g.append(svg('path', { d: `M${cx - r} ${cy}H${cx + r}M${cx} ${cy - r}V${cy + r}`, stroke: '#f472b6', 'stroke-width': 1.5, ...line }));
		g.append(svg('circle', { cx, cy, r: px(5), fill: 'none', stroke: '#f472b6', 'stroke-width': 1.5, ...line }));
	}

	// the symmetry axis
	if (prefs.symmetry) {
		const ax = cur.axis || 0;
		g.append(svg('path', { d: `M${ax} ${y0}V${y1}`, stroke: '#f472b6', 'stroke-width': 1, 'stroke-dasharray': '6 4', ...line, 'stroke-opacity': .8 }));
	}

	// guide lines pulled out of the rulers
	if (showRules) cur.rules.forEach((gl, i) => {
		if (drag && drag.type === 'guide' && drag.idx === i && drag.remove) return;
		g.append(svg('path', { d: gl.axis === 'x' ? `M${gl.pos} ${y0}V${y1}` : `M${x0} ${gl.pos}H${x1}`, stroke: '#2fd6d6', 'stroke-width': 1, 'stroke-opacity': .85, ...line }));
	});

	// smart guides
	for (const gd of guides) {
		g.append(svg('path', { d: gd.axis === 'x' ? `M${gd.pos} ${y0}V${y1}` : `M${x0} ${gd.pos}H${x1}`, stroke: '#ff4d8d', 'stroke-width': 1, ...line }));
	}

	// the shape being drawn with a shape tool
	if (ghost) {
		const w = Math.max(1, Math.abs(ghost.x1 - ghost.x0)), h = Math.max(1, Math.abs(ghost.y1 - ghost.y0)), cx = (ghost.x0 + ghost.x1) / 2, cy = (ghost.y0 + ghost.y1) / 2;
		const e = ghost.type === 'circle'
			? svg('ellipse', { cx, cy, rx: w / 2, ry: h / 2 })
			: svg('polygon', { points: baseVerts(ghost.type).map(v => `${cx + v.x * w},${cy + v.y * h}`).join(' ') });
		for (const [k, v] of Object.entries({ fill: ACCENT, 'fill-opacity': .25, stroke: ACCENT, 'stroke-width': 1.5, ...line })) e.setAttribute(k, v);
		g.append(e);
		if (prefs.symmetry) {
			const mx = 2 * (cur.axis || 0) - cx, e2 = ghost.type === 'circle' ? svg('ellipse', { cx: mx, cy, rx: w / 2, ry: h / 2 }) : svg('polygon', { points: baseVerts(ghost.type).map(v => `${mx - v.x * w},${cy + v.y * h}`).join(' ') });
			for (const [k, v] of Object.entries({ fill: '#f472b6', 'fill-opacity': .15, stroke: '#f472b6', 'stroke-width': 1.5, 'stroke-dasharray': '4 3', ...line })) e2.setAttribute(k, v);
			g.append(e2);
		}
		const t = svg('text', { x: cx, y: cy + h / 2 + px(16), 'text-anchor': 'middle', fill: '#fff', stroke: '#000', 'stroke-width': px(3), 'font-size': px(11), 'paint-order': 'stroke', 'pointer-events': 'none' });
		t.textContent = Math.round(w) + ' × ' + Math.round(h);
		g.append(t);
	}

	// the selection rectangle
	if (marquee) {
		g.append(svg('rect', {
			x: Math.min(marquee.x0, marquee.x1), y: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0),
			fill: ACCENT, 'fill-opacity': .12, stroke: ACCENT, 'stroke-width': 1, ...line,
		}));
	}

	// polygon being drawn with the pen
	const cv = $('#canvas');
	cv.classList.toggle('drawing', !!drawMode || tool === 'point' || TYPES.includes(tool));
	cv.classList.toggle('hand', tool === 'hand' || spaceDown);
	cv.classList.toggle('eyedrop', tool === 'eyedrop');
	const snapAt = drawMode ? drawMode.snap : snapMark;
	if (snapAt) {   // a corner or edge the point will snap to
		const sn = snapAt;
		if (sn.edge) g.append(svg('rect', { x: sn[0] - px(4), y: sn[1] - px(4), width: px(8), height: px(8), transform: `rotate(45 ${sn[0]} ${sn[1]})`, fill: '#ffd24d', stroke: '#16181d', 'stroke-width': 1, ...line }));   // on an edge: a diamond
		else g.append(svg('circle', { cx: sn[0], cy: sn[1], r: px(8), fill: '#ffd24d33', stroke: '#ffd24d', 'stroke-width': 1.5, ...line }));   // on a corner: a ring
	}
	if (drawMode) {
		const P = drawMode.pts, pull = drawMode.pull, closable = P.length >= 3 && !drawMode.line;
		const H = [...drawMode.h, ...(pull ? [{ ox: pull.ox, oy: pull.oy }] : [])], pend = pull ? pull.at : drawMode.at;   // the point being placed, with the handles being pulled
		const raw = pend ? [...P, pend] : P;
		const ln = bezierFlatten(raw, raw.map(() => ({ r: 0, s: 0 })), raw.map((_, i) => H[i] ? { ix: -H[i].ox, iy: -H[i].oy, ox: H[i].ox, oy: H[i].oy } : null), 32, false).pts;
		if (ln.length >= 2) {
			g.append(svg('polyline', {
				points: ln.map(q => q.join(',')).join(' '), fill: closable ? '#5b9cff33' : 'none', stroke: ACCENT, 'stroke-width': 1.5,
				'stroke-dasharray': '5 3', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none',
			}));
		}
		if (prefs.symmetry && ln.length >= 2) {
			const a2 = 2 * (cur.axis || 0);
			g.append(svg('polyline', { points: ln.map(q => (a2 - q[0]) + ',' + q[1]).join(' '), fill: closable ? '#f472b622' : 'none', stroke: '#f472b6', 'stroke-width': 1.5, 'stroke-dasharray': '5 3', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
		}
		if (pull && (pull.ox || pull.oy)) for (const sg of [1, -1]) {   // the handles being pulled
			g.append(svg('line', { x1: pull.at[0], y1: pull.at[1], x2: pull.at[0] + sg * pull.ox, y2: pull.at[1] + sg * pull.oy, stroke: ACCENT, 'stroke-width': px(1), 'pointer-events': 'none' }));
			g.append(svg('circle', { cx: pull.at[0] + sg * pull.ox, cy: pull.at[1] + sg * pull.oy, r: px(3.5), fill: '#fff', stroke: ACCENT, 'stroke-width': px(1.5), 'pointer-events': 'none' }));
		}
		P.forEach((q, i) => g.append(svg('circle', {
			cx: q[0], cy: q[1], r: px(i === 0 && closable ? 7 : 4), fill: i === 0 ? '#ffd24d' : '#fff', stroke: ACCENT, 'stroke-width': px(1.5), 'pointer-events': 'none',
		})));
	}

	if (!cur.shapes.length && !cur.points.length && !drawMode) {
		const t = svg('text', { x: 0, y: px(-34), 'text-anchor': 'middle', fill: '#6b717c', 'font-size': px(13), 'pointer-events': 'none' });
		t.textContent = 'Pick a shape tool on the left and drag on the canvas';
		g.append(t);
	}
	renderStatus();
	renderPreview();
	drawRulers(W, H, tx, ty, z);
}

// ------------------------------------------------------------------------------------------------ zoom

function zoomTo(z, mx, my) {
	const c = $('#canvas');
	if (mx == null) { mx = c.clientWidth / 2; my = c.clientHeight / 2; }
	const wx = (mx - view.tx) / view.z, wy = (my - view.ty) / view.z;
	view.z = clamp(z, 0.1, 64);
	view.tx = mx - wx * view.z; view.ty = my - wy * view.z;
	draw();
}

function zoomToBounds(b) {
	const c = $('#canvas'), pad = 60;
	if (!b) { view.z = 3; view.tx = c.clientWidth / 2; view.ty = c.clientHeight / 2; return draw(); }
	const w = Math.max(b[1] - b[0], 8), h = Math.max(b[3] - b[2], 8);
	view.z = clamp(Math.min((c.clientWidth - pad * 2) / w, (c.clientHeight - pad * 2) / h), 0.1, 32);
	view.tx = c.clientWidth / 2 - (b[0] + b[1]) / 2 * view.z; view.ty = c.clientHeight / 2 - (b[2] + b[3]) / 2 * view.z;
	draw();
}

function zoomFit() {
	const b = contentBounds();
	const pts = cur.points.map(p => [p.x, p.x, p.y, p.y]);
	zoomToBounds(b || pts.length ? unionBounds([...(b ? [b] : []), ...pts, [0, 0, 0, 0]]) : null);
}

function zoomSelection() {
	const s = selectedShapes();
	if (s.length) zoomToBounds(unionBounds(s.map(shapeBounds)));
	else zoomFit();
}

// ------------------------------------------------------------------------------------------------ pointer handling

// Smart guides: the dragged selection's edges and centre snap to other shapes' edges and centres (and to the origin).
function snapToGuides(items, dx, dy) {
	guides = [];
	const useRules = prefs.guideSnap && prefs.rulers && cur.rules;
	if (!prefs.guides && !useRules) return { dx, dy };
	const mine = new Set(items.map(i => i.obj.id));
	const sb = unionBounds(items.map(i => { const c = { ...i.obj, x: i.x + dx, y: i.y + dy }; return shapeBounds(c); }));
	const xs = [], ys = [];
	if (prefs.guides) {
		xs.push(0); ys.push(0);
		for (const s of cur.shapes) {
			if (mine.has(s.id) || s.hidden) continue;
			const b = shapeBounds(s);
			xs.push(b[0], (b[0] + b[1]) / 2, b[1]); ys.push(b[2], (b[2] + b[3]) / 2, b[3]);
		}
	}
	if (useRules) for (const g of cur.rules) (g.axis === 'x' ? xs : ys).push(g.pos);
	const thr = snapPx() * 0.6 / view.z, best = (mine3, cands) => {
		let out = null;
		for (const m of mine3) for (const c of cands) { const d = c - m; if (Math.abs(d) <= thr && (!out || Math.abs(d) < Math.abs(out))) out = d; }
		return out;
	};
	const mx = [sb[0], (sb[0] + sb[1]) / 2, sb[1]], my = [sb[2], (sb[2] + sb[3]) / 2, sb[3]];
	const sx = best(mx, xs), sy = best(my, ys);
	if (sx != null) dx += sx;
	if (sy != null) dy += sy;
	for (const m of mx) for (const c of xs) if (sx != null && Math.abs(m + sx - c) < 0.01) guides.push({ axis: 'x', pos: c });
	for (const m of my) for (const c of ys) if (sy != null && Math.abs(m + sy - c) < 0.01) guides.push({ axis: 'y', pos: c });
	return { dx, dy };
}

// the box a shape tool is drawing: whole-pixel edges, Shift = square, Alt = from the centre
function ghostBox(e, a) {
	const w = toWorld(e), off = snapOff(e);
	const at = (p) => { const sp = snapPoint(p, snapList, off); return { x: sp.x != null ? r4(sp.x) : gsx(p.x), y: sp.y != null ? r4(sp.y) : gsy(p.y), kind: sp.kind }; };
	const e1 = at(w), e0 = at(a);
	snapMark = e1.kind ? markOf(e1.x, e1.y, e1.kind) : null;
	let x1 = e1.x, y1 = e1.y, x0 = e0.x, y0 = e0.y;
	if (e.shiftKey) { const m = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); x1 = x0 + (x1 < x0 ? -m : m); y1 = y0 + (y1 < y0 ? -m : m); }
	if (e.altKey) { x0 = 2 * x0 - x1; y0 = 2 * y0 - y1; }
	return { type: tool, x0, y0, x1, y1 };
}

function pickColorFrom(src) {
	const targets = selectedShapes();
	if (!targets.length) { tool = 'select'; renderAll(); return toast('Select the shapes to recolor first, then pick.'); }
	const [ck, sk] = COLOR_KEYS[eyeTarget] || COLOR_KEYS.fill;
	for (const s of targets) {
		s[ck] = src.color;
		if (sk) { if (src.swatch) s[sk] = src.swatch; else delete s[sk]; }
	}
	rememberColor(src.color);
	tool = 'select';
	commit(); renderAll();
}

// ---- snapping to other shapes and guide lines
// Drawing a polygon or a line, and dragging a shape, a corner point or a new shape's corner, snap the point to (in this order):
//   1. a corner of a visible shape (the outline points you can see, including rounded corners and curves) within 10 screen px,
//   2. the nearest spot on an edge of a visible shape within 8 screen px,
//   3. a guide line pulled out of a ruler (each direction on its own),
//   4. the grid (whole pixels, or the custom grid size), or exactly where the pointer is when Snap to grid is off.
// Corners and edges beat guide lines and the grid. Alt skips it while drawing a polygon; Ctrl or Cmd skips it for the other drags.
let snapList = null;   // the corners and edges that a drag in progress may snap to
let snapMark = null;   // where the pointer snapped to, to draw: [x, y] with .edge
const snapOff = (e) => e.metaKey || e.ctrlKey;
const markOf = (x, y, kind) => Object.assign([x, y], { edge: kind !== 'corner' });

function penCandidates(skip) {
	const pts = [], segs = [];
	for (const s of cur.shapes) {
		if (s.hidden || (skip && skip.has(s.id))) continue;
		for (const p of worldParts(s, cur.segments)) for (const r of partRings(p, cur.segments)) {
			const q = r.pts, n = q.length;
			for (const a of q) pts.push(a);
			for (let i = 0; i < (r.open ? n - 1 : n); i++) { const a = q[i], b = q[(i + 1) % n]; if (a[0] !== b[0] || a[1] !== b[1]) segs.push([a[0], a[1], b[0], b[1]]); }
		}
	}
	return { pts, segs };
}

// -> { x, y, kind }: the new position (null on a direction that did not snap), and what it snapped to: 'corner' | 'edge' | 'guide' | null
function snapPoint(w, list, off) {
	const none = { x: null, y: null, kind: null };
	if (off) return none;
	if (prefs.shapeSnap && list) {
		let best = null, bd = snapPx() / view.z;
		for (const q of list.pts) { const d = Math.hypot(q[0] - w.x, q[1] - w.y); if (d < bd) { bd = d; best = q; } }
		if (best) return { x: best[0], y: best[1], kind: 'corner' };
		let eb = null, ed = snapPx() * 0.8 / view.z;
		for (const [ax, ay, bx, by] of list.segs) {
			const dx = bx - ax, dy = by - ay, t = clamp(((w.x - ax) * dx + (w.y - ay) * dy) / (dx * dx + dy * dy), 0, 1), qx = ax + t * dx, qy = ay + t * dy, d = Math.hypot(qx - w.x, qy - w.y);
			if (d < ed) { ed = d; eb = [qx, qy]; }
		}
		if (eb) return { x: eb[0], y: eb[1], kind: 'edge' };
	}
	if (prefs.guideSnap && prefs.rulers && cur.rules) {
		let x = null, y = null, dx = snapPx() * 0.8 / view.z, dy = dx;
		for (const g of cur.rules) {
			if (g.axis === 'x' && Math.abs(g.pos - w.x) < dx) { dx = Math.abs(g.pos - w.x); x = g.pos; }
			if (g.axis === 'y' && Math.abs(g.pos - w.y) < dy) { dy = Math.abs(g.pos - w.y); y = g.pos; }
		}
		if (x != null || y != null) return { x, y, kind: 'guide' };
	}
	return none;
}

// Freehand (no grid): the point lines up with the corners of the same shape that are level with it or straight above or below it.
// pts = [[x, y]] in the design. -> { x, y, lines } where x / y is the position to use (null when nothing lines up) and lines are the guide lines to show.
function alignTo(w, pts) {
	let x = null, y = null, dx = snapPx() * 0.8 / view.z, dy = dx;
	for (const p of pts) {
		if (Math.abs(p[0] - w.x) < dx) { dx = Math.abs(p[0] - w.x); x = p[0]; }
		if (Math.abs(p[1] - w.y) < dy) { dy = Math.abs(p[1] - w.y); y = p[1]; }
	}
	return { x, y, lines: [...(x != null ? [{ axis: 'x', pos: x }] : []), ...(y != null ? [{ axis: 'y', pos: y }] : [])] };
}
const alignOn = (e) => !prefs.gridSnap && prefs.guides && !snapOff(e) && !e.altKey;

function penSnap(e) {   // -> { p: [x, y], snapped, edge, align }
	const w = toWorld(e), list = (drawMode.cand ||= penCandidates()), sp = snapPoint(w, list, e.altKey), G = gridStep(), grid = prefs.gridSnap && !e.altKey;
	const al = alignOn(e) && sp.kind !== 'corner' && sp.kind !== 'edge' && drawMode.pts.length ? alignTo(w, drawMode.pts) : null;
	const sx = sp.x ?? (al && al.x), sy = sp.y ?? (al && al.y);
	const x = sx != null ? r4(sx) : grid ? r4(gs(w.x, G.x)) : r4(w.x), y = sy != null ? r4(sy) : grid ? r4(gs(w.y, G.y)) : r4(w.y);
	return { p: [x, y], snapped: sp.kind !== null, edge: sp.kind !== 'corner', align: al ? al.lines.filter(g => (g.axis === 'x' ? sp.x : sp.y) == null) : [] };
}

// the shapes' points, as seen by a drag that moves them (a few dozen are enough)
function movingPoints(items) {
	const pts = [];
	for (const it of items) for (const p of worldParts(it.obj, cur.segments)) for (const r of partRings(p, cur.segments)) for (const q of r.pts) pts.push(q);
	if (pts.length <= 60) return pts;
	const k = Math.ceil(pts.length / 60);
	return pts.filter((_, i) => i % k === 0);
}

// moving points (already shifted by dx, dy) onto a corner or an edge of another shape: -> { dx, dy, kind, at } or null
function snapMove(pts, list, dx, dy) {
	if (!prefs.shapeSnap || !list || !pts) return null;
	const thr = snapPx() * 0.8 / view.z;
	let best = null;
	for (const p of pts) {
		const px = p[0] + dx, py = p[1] + dy;
		for (const q of list.pts) { const d = Math.hypot(q[0] - px, q[1] - py); if (d < thr * 1.25 && (!best || d < best.d)) best = { d, cx: q[0] - px, cy: q[1] - py, at: q }; }
	}
	if (best) return { dx: dx + best.cx, dy: dy + best.cy, kind: 'corner', at: best.at };
	for (const p of pts) {
		const px = p[0] + dx, py = p[1] + dy;
		for (const [ax, ay, bx, by] of list.segs) {
			if (px < Math.min(ax, bx) - thr || px > Math.max(ax, bx) + thr || py < Math.min(ay, by) - thr || py > Math.max(ay, by) + thr) continue;
			const ex = bx - ax, ey = by - ay, t = clamp(((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey), 0, 1), qx = ax + t * ex, qy = ay + t * ey, d = Math.hypot(qx - px, qy - py);
			if (d < thr && (!best || d < best.d)) best = { d, cx: qx - px, cy: qy - py, at: [qx, qy] };
		}
	}
	return best ? { dx: dx + best.cx, dy: dy + best.cy, kind: 'edge', at: best.at } : null;
}

function bindCanvas() {
	const canvas = $('#canvas');

	canvas.addEventListener('pointerdown', (e) => {
		document.activeElement?.blur();
		closeMenus();
		const down = toWorld(e);

		// panning: middle button, Space held, or the hand tool
		if (e.button === 1 || (e.button === 0 && (spaceDown || tool === 'hand'))) {
			drag = { type: 'pan', sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty, moved: false };
			e.preventDefault();
			return;
		}
		if (e.button !== 0) return;

		const ruler = e.target.closest('[data-ruler]'), rule = !drawMode && tool === 'select' && !vertexMode && e.target.closest('[data-rule]');
		if (ruler) { drag = { type: 'guide', axis: ruler.dataset.ruler === 'left' ? 'x' : 'y', idx: -1, moved: false }; e.preventDefault(); return; }
		if (rule && cur.rules && cur.rules[+rule.dataset.rule]) { const i = +rule.dataset.rule; drag = { type: 'guide', axis: cur.rules[i].axis, idx: i, moved: false }; e.preventDefault(); return; }

		if (drawMode) {   // a click places a point; click and drag pulls out its curve handles (pan with Space or the middle button)
			drag = { type: 'pen', down: penSnap(e).p, sx: e.clientX, sy: e.clientY, pulled: false, moved: false };
			e.preventDefault();
			return;
		}
		if (TYPES.includes(tool)) {
			snapList = penCandidates();
			drag = { type: 'create', start: down, sx: e.clientX, sy: e.clientY, moved: false };
			ghost = { type: tool, x0: gsx(down.x), y0: gsy(down.y), x1: gsx(down.x), y1: gsy(down.y) };
			e.preventDefault();
			return;
		}
		if (tool === 'point') {
			const hit = e.target.closest('[data-id]'), it = hit && find(hit.dataset.id);
			addPoint(it && it.kind === 'shape' ? it.obj : null, down);
			e.preventDefault();
			return;
		}
		if (tool === 'eyedrop') {
			const hit = e.target.closest('[data-id]'), it = hit && find(hit.dataset.id);
			if (it && it.kind === 'shape') pickColorFrom(it.obj); else toast('Click a shape to take its color.');
			e.preventDefault();
			return;
		}

		const hit = e.target.closest('[data-id]'), handle = e.target.closest('[data-handle]'), mhandle = e.target.closest('[data-mhandle]');
		const picked = selectedShapes()[0];
		const vert = vertexMode && e.target.closest('[data-vert]');
		const edge = vertexMode && addingVertex && e.target.closest('[data-edge]');
		const stretch = vertexMode && e.target.closest('[data-stretch]');
		const selRefObj = refById(refSel), refOK = selRefObj && !selRefObj.locked;
		const refScale = refOK && e.target.closest('[data-refscale]'), refMove = refOK && e.target.closest('[data-refimg]') && e.target.closest('[data-refimg]').dataset.refimg === refSel;
		const pv = !vertexMode && pivotMode && e.target.closest('[data-pivot]');
		if (refScale) {
			drag = { type: 'refscale', r: selRefObj, scale0: selRefObj.scale, d0: Math.max(Math.hypot(down.x - selRefObj.x, down.y - selRefObj.y), 1e-3), moved: false };
		} else if (refMove) {
			drag = { type: 'refmove', r: selRefObj, start: down, x: selRefObj.x, y: selRefObj.y, moved: false };
		} else if (pv && picked && !picked.locked) {
			drag = { type: 'pivot', s: picked, moved: false };
		} else if (vertexMode && e.target.closest('[data-vhandle]')) {
			const [which, idx] = e.target.closest('[data-vhandle]').dataset.vhandle.split(':');
			drag = { type: 'vhandle', s: picked, i: +idx, which, alt: e.altKey, moved: false };
		} else if (vert && e.altKey && picked && !picked.vertices.some((_, k) => k === +vert.dataset.vert && hasHandles(picked.vertices[k]))) {
			const i = +vert.dataset.vert;   // Alt-drag from a corner pulls curve handles out of it
			vsel.clear(); vsel.add(i);
			const v0 = picked.vertices[i];
			v0.ix = v0.iy = v0.ox = v0.oy = 0;
			drag = { type: 'vhandle', s: picked, i, which: 'out', alt: false, mirror: true, moved: false };
		} else if (vert) {
			const i = +vert.dataset.vert, s = picked;
			if (e.shiftKey) { if (vsel.has(i)) vsel.delete(i); else vsel.add(i); }
			else if (!vsel.has(i)) { vsel.clear(); vsel.add(i); }
			draw(); renderInspector();
			if (vsel.has(i)) {
				snapList = penCandidates(new Set([s.id]));
				drag = { type: 'verts', s, start: down, orig: [...vsel].map(k => [k, { x: s.vertices[k].x, y: s.vertices[k].y }]), moved: false };
			}
		} else if (stretch) {
			const s = picked, hb = Math.abs(s.height * s.scale) / 2, a = rad(s.rotation);
			const end = (dir) => ({ x: s.x - dir * hb * Math.sin(a), y: s.y + dir * hb * Math.cos(a) });
			drag = { type: 'stretch', s, which: stretch.dataset.stretch, top: end(-1), bottom: end(1), start: down, moved: false };
		} else if (edge) {
			insertVertex(picked, +edge.dataset.edge, down);
		} else if (handle && picked && !picked.locked) {
			const s = picked;
			drag = {
				type: handle.dataset.handle === 'rot' ? 'rotate' : (s.parts && handle.dataset.handle.split(',').every(Number)) ? 'gscale' : 'resize', s, scale0: s.scale, h: handle.dataset.handle.split(',').map(Number),
				x: s.x, y: s.y, w: Math.abs(s.width * s.scale), ht: Math.abs(s.height * s.scale), moved: false, rot0: s.rotation, from: pointWorld(pivotOf(s), s), a0: Math.atan2(down.y - pointWorld(pivotOf(s), s).y, down.x - pointWorld(pivotOf(s), s).x),
				vo: s.vertices && s.vertices.map(v => ({ ...v })),
			};
		} else if (mhandle && mhandle.dataset.mhandle === 'rot') {
			const list = selectedShapes(), b = unionBounds(list.map(shapeBounds)), c = { x: (b[0] + b[1]) / 2, y: (b[2] + b[3]) / 2 };
			drag = { type: 'mrotate', list, base: list.map(s => ({ x: s.x, y: s.y, rotation: s.rotation })), c, a0: Math.atan2(down.y - c.y, down.x - c.x), moved: false };
		} else if (mhandle) {
			const items = selectedShapes(), b = unionBounds(items.map(shapeBounds)), [hx, hy] = mhandle.dataset.mhandle.split(',').map(Number);
			drag = {
				type: 'mscale', b, hx, hy, anchor: { x: hx < 0 ? b[1] : b[0], y: hy < 0 ? b[3] : b[2] },
				items: items.map(s => ({ obj: s, x: s.x, y: s.y, width: s.width, height: s.height, v: s.vertices && s.vertices.map(v => ({ ...v })), pts: s.points.map(p => ({ p, x: p.x, y: p.y })) })), moved: false,
			};
		} else if (e.target.closest('[data-origin]') && !hit) {
			drag = { type: 'origin', moved: false };
			originGhost = { x: 0, y: 0 };
		} else if (hit && (vertexMode ? hit.dataset.id !== vertexMode : true)) {
			const it = find(hit.dataset.id);
			if (!it) return;
			if (it.kind === 'shape' && e.shiftKey && !vertexMode) { toggleUnit(it.obj.id); e.preventDefault(); return; }
			if (it.kind === 'point') {
				select(it.obj.id);
				drag = { type: 'item', it, start: down, x: it.obj.x, y: it.obj.y, moved: false };
			} else {
				const already = selectedShapes().some(s => s.id === it.obj.id);
				if (!already) selectUnit(it.obj.id);
				let items = selectedShapes();
				if (e.altKey) {   // Alt-drag: drag a copy
					insertPacked(packShapes(items), 0, 0);
					items = selectedShapes();
				}
				const moving = items.filter(s => !s.locked).map(s => ({ obj: s, x: s.x, y: s.y }));
				snapList = penCandidates(new Set(moving.map(m => m.obj.id)));
				drag = { type: 'move', items: moving, mpts: movingPoints(moving), start: down, moved: false };
			}
		} else {
			if (vertexMode) { if (!e.shiftKey) { vsel.clear(); draw(); renderInspector(); } drag = { type: 'pan', sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty, moved: false }; }
			else {
				const base = e.shiftKey ? selectedShapes().map(s => s.id) : [];
				if (!e.shiftKey) select(null);
				drag = { type: 'marquee', start: down, base, moved: false };
			}
		}
		e.preventDefault();
	});

	canvas.addEventListener('pointermove', (e) => {
		cursorAt = toWorld(e);
		renderCursor();
	});

	window.addEventListener('pointermove', (e) => {
		if (drawMode) {
			const sp = penSnap(e);
			guides = sp.align; drawMode.at = sp.p; drawMode.snap = sp.snapped ? Object.assign([...sp.p], { edge: !!sp.edge }) : null;
			if (!drag) { draw(); return; }
		}
		if (!drag) return;
		if (drag.type === 'pen') {
			if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) drag.pulled = true;
			if (drag.pulled) { const w = toWorld(e); drawMode.pull = { at: drag.down, ox: Math.round((w.x - drag.down[0]) * 10) / 10, oy: Math.round((w.y - drag.down[1]) * 10) / 10 }; }
		} else if (drag.type === 'guide') {   // pulling a guide line out of a ruler, or moving one; back onto the ruler it came from deletes it
			const w = toWorld(e), r = canvas.getBoundingClientRect(), RT = 18;
			let pos = drag.axis === 'x' ? w.x : w.y;
			pos = e.shiftKey ? r4(pos) : drag.axis === 'x' ? gsx(pos) : gsy(pos);
			if (drag.idx < 0) { (cur.rules ||= []).push({ axis: drag.axis, pos }); drag.idx = cur.rules.length - 1; }
			cur.rules[drag.idx].pos = pos;
			drag.remove = drag.axis === 'x' ? e.clientX - r.left < RT : e.clientY - r.top < RT;
			drag.moved = true;
			if (selectedShapes().length === 0 && !refSel) renderInspector();
		} else if (drag.type === 'pan') {
			if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3) drag.panned = true;
			view.tx = drag.tx + e.clientX - drag.sx; view.ty = drag.ty + e.clientY - drag.sy;
		} else if (drag.type === 'create') {
			if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) drag.moved = true;
			ghost = ghostBox(e, drag.start);
		} else if (drag.type === 'marquee') {
			const w = toWorld(e);
			if (!drag.moved && Math.hypot((w.x - drag.start.x) * view.z, (w.y - drag.start.y) * view.z) < 4) return;
			drag.moved = true;
			marquee = { x0: drag.start.x, y0: drag.start.y, x1: w.x, y1: w.y };
			const mx0 = Math.min(marquee.x0, marquee.x1), mx1 = Math.max(marquee.x0, marquee.x1), my0 = Math.min(marquee.y0, marquee.y1), my1 = Math.max(marquee.y0, marquee.y1);
			const hitIds = new Set(drag.base);
			for (const s of cur.shapes) {
				if (s.hidden || s.locked) continue;
				const b = shapeBounds(s);
				if (b[1] >= mx0 && b[0] <= mx1 && b[3] >= my0 && b[2] <= my1) for (const id of unitOf(s.id)) hitIds.add(id);
			}
			const ids = cur.shapes.filter(s => hitIds.has(s.id)).map(s => s.id), now = selectedShapes().map(s => s.id);
			if (ids.join() !== now.join()) setSelection(ids);
		} else if (drag.type === 'origin') {
			const w = toWorld(e);
			originGhost = { x: gsx(w.x), y: gsy(w.y) };
			drag.moved = true;
		} else if (drag.type === 'verts') {
			const w = toWorld(e), s = drag.s, bw = s.width * s.scale || 1, bh = s.height * s.scale || 1;
			const l = toLocal(s, w.x - drag.start.x, w.y - drag.start.y), [, ao] = drag.orig[0], ow = pointWorld({ x: ao.x * bw, y: ao.y * bh }, s);
			const want = { x: ow.x + w.x - drag.start.x, y: ow.y + w.y - drag.start.y }, sp = snapPoint(want, snapList, snapOff(e));
			let al = null;   // freehand: line up with the other corners of this shape
			if (alignOn(e) && sp.kind !== 'corner' && sp.kind !== 'edge') {
				const moving = new Set(drag.orig.map(q => q[0]));
				al = alignTo(want, s.vertices.map((v, i) => moving.has(i) ? null : pointWorld({ x: v.x * bw, y: v.y * bh }, s)).filter(Boolean).map(p => [p.x, p.y]));
				if (al.x == null && al.y == null) al = null;
			}
			guides = al ? al.lines.filter(g => (g.axis === 'x' ? sp.x : sp.y) == null) : [];
			if (sp.kind || al) {   // the first corner picked lands on a corner or edge of another shape, on a guide line, or in line with the shape's other corners; the others move with it
				const T = { x: sp.x ?? (al && al.x) ?? want.x, y: sp.y ?? (al && al.y) ?? want.y }, ld = toLocal(s, T.x - ow.x, T.y - ow.y);
				for (const [i, o] of drag.orig) { s.vertices[i].x = r6((o.x * bw + ld.x) / bw); s.vertices[i].y = r6((o.y * bh + ld.y) / bh); }
				s.free = true;
				snapMark = sp.kind ? markOf(T.x, T.y, sp.kind) : null;
			} else {
				snapMark = null;
				for (const [i, o] of drag.orig) {   // every vertex lands on a grid line
					s.vertices[i].x = r6((gsx(s.x + o.x * bw + l.x) - s.x) / bw);
					s.vertices[i].y = r6((gsy(s.y + o.y * bh + l.y) - s.y) / bh);
				}
				keepGridPoints(s);
			}
			drag.moved = true;
		} else if (drag.type === 'stretch') {
			// the dragged end follows the pointer (on the grid), the other end stays; the circle re-fits between them
			const w = toWorld(e), s = drag.s, from = drag[drag.which];
			const moving = { x: gsx(from.x + w.x - drag.start.x), y: gsy(from.y + w.y - drag.start.y) };
			const top = drag.which === 'top' ? moving : drag.top, bottom = drag.which === 'bottom' ? moving : drag.bottom;
			const dx = bottom.x - top.x, dy = bottom.y - top.y, len = Math.hypot(dx, dy);
			if (len >= 1) {
				s.x = (top.x + bottom.x) / 2; s.y = (top.y + bottom.y) / 2;
				s.height = Math.round(len / (Math.abs(s.scale) || 1) * 1e4) / 1e4;
				s.rotation = Math.round(Math.atan2(-dx, dy) * 180 / Math.PI * 100) / 100;
			}
			drag.moved = true;
			renderInspector();
		} else if (drag.type === 'gscale') {
			// combined shapes scale evenly; the corner opposite the handle stays put
			const w = toWorld(e), s = drag.s, [hx, hy] = drag.h;
			const l = toLocal(s, w.x - drag.x, w.y - drag.y);
			const A = [-hx * drag.w / 2, -hy * drag.ht / 2], D = [hx * drag.w, hy * drag.ht];
			const f0 = Math.max(0.05, ((l.x - A[0]) * D[0] + (l.y - A[1]) * D[1]) / (D[0] * D[0] + D[1] * D[1]));
			let ns = Math.round(drag.scale0 * f0 * 100) / 100;
			if (Math.abs(ns) < 0.01) ns = Math.sign(drag.scale0) * 0.01;
			const f = ns / drag.scale0, c = Math.cos(rad(s.rotation)), sn = Math.sin(rad(s.rotation));
			s.scale = ns;
			s.x = Math.round((drag.x + A[0] * (1 - f) * c - A[1] * (1 - f) * sn) * 1e4) / 1e4;
			s.y = Math.round((drag.y + A[0] * (1 - f) * sn + A[1] * (1 - f) * c) * 1e4) / 1e4;
			drag.moved = true;
			renderInspector();
		} else if (drag.type === 'mscale') {
			// the whole selection scales evenly about the opposite corner; sizes and positions snap back onto whole pixels
			const w = toWorld(e), b = drag.b, bw = b[1] - b[0], bh = b[3] - b[2];
			const f = clamp(Math.max((w.x - drag.anchor.x) * drag.hx / bw, (w.y - drag.anchor.y) * drag.hy / bh), 0.05, 50);
			for (const it of drag.items) {
				const s = it.obj;
				s.width = Math.max(1, Math.round(it.width * f)); s.height = Math.max(1, Math.round(it.height * f));
				s.x = Math.round((drag.anchor.x + (it.x - drag.anchor.x) * f) * 2) / 2; s.y = Math.round((drag.anchor.y + (it.y - drag.anchor.y) * f) * 2) / 2;
				if (it.v) s.vertices = it.v.map(v => ({ ...v }));
				for (const q of it.pts) { q.p.x = Math.round(q.x * f); q.p.y = Math.round(q.y * f); }
				gridVerts(s);
			}
			drag.moved = true;
			renderInspector();
		} else if (drag.type === 'rotate') {
			const w = toWorld(e), s = drag.s;
			const P = drag.from;   // the pivot stays put while the shape turns about it
			let r = s.pivot ? drag.rot0 + (Math.atan2(w.y - P.y, w.x - P.x) - drag.a0) * 180 / Math.PI : Math.atan2(w.y - s.y, w.x - s.x) * 180 / Math.PI + 90;
			r = e.shiftKey ? Math.round(r / prefNum('angleStep', 1, 90)) * prefNum('angleStep', 1, 90) : Math.round(r);
			r = ((r + 180) % 360 + 360) % 360 - 180;
			if (s.pivot) { s.x = drag.x; s.y = drag.y; s.rotation = drag.rot0; setRotation(s, r, P); } else s.rotation = r;
			drag.moved = true;
			renderInspector();
		} else if (drag.type === 'resize') {
			// the dragged edge follows the pointer, the opposite edge stays put (all measured in the shape's own axes).
			// Shift on a corner keeps the proportions; Alt resizes from the centre.
			const w = toWorld(e), s = drag.s, [hx, hy] = drag.h, k = Math.abs(s.scale) || 1;
			const l = toLocal(s, w.x - drag.x, w.y - drag.y), fromCenter = e.altKey;
			let nw = s.width, nh = s.height;
			const G = gridStep();
			if (hx) nw = Math.max(G.x || 1, gs(hx * (fromCenter ? 2 * l.x : l.x + hx * drag.w / 2) / k, G.x));
			if (hy) nh = Math.max(G.y || 1, gs(hy * (fromCenter ? 2 * l.y : l.y + hy * drag.ht / 2) / k, G.y));
			if (e.shiftKey && hx && hy) {
				const f = Math.max(nw * k / drag.w, nh * k / drag.ht);
				nw = Math.max(G.x || 1, gs(drag.w / k * f, G.x)); nh = Math.max(G.y || 1, gs(drag.ht / k * f, G.y));
			}
			let cx = 0, cy = 0;
			if (hx) { s.width = nw; if (!fromCenter) cx = -hx * drag.w / 2 + hx * nw * k / 2; }
			if (hy) { s.height = nh; if (!fromCenter) cy = -hy * drag.ht / 2 + hy * nh * k / 2; }
			const c = Math.cos(rad(s.rotation)), sn = Math.sin(rad(s.rotation));
			s.x = r4(gs(drag.x + cx * c - cy * sn, G.x / 2));
			s.y = r4(gs(drag.y + cx * sn + cy * c, G.y / 2));
			keepGridPoints(s);
			const nbw = s.width * s.scale, nbh = s.height * s.scale;
			if (drag.vo && nbw && nbh) {   // corners scale with the box, then snap back onto the grid (imported shapes keep their points)
				s.vertices = s.free ? drag.vo.map(v => ({ ...v })) : drag.vo.map(v => ({ ...v, x: r6((gsx(s.x + v.x * nbw) - s.x) / nbw), y: r6((gsy(s.y + v.y * nbh) - s.y) / nbh) }));
			}
			drag.moved = true;
			renderInspector();
		} else if (drag.type === 'move') {
			const w = toWorld(e);
			let dx = w.x - drag.start.x, dy = w.y - drag.start.y;
			if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }   // Shift locks to one axis
			dx = gsx(dx); dy = gsy(dy);
			const sm = snapOff(e) ? null : snapMove(drag.mpts, snapList, dx, dy);   // onto a corner or an edge of another shape
			if (sm) { dx = sm.dx; dy = sm.dy; guides = []; snapMark = markOf(sm.at[0], sm.at[1], sm.kind); }
			else { snapMark = null; ({ dx, dy } = snapToGuides(drag.items, dx, dy)); }
			for (const it of drag.items) {
				it.obj.x = it.x + dx; it.obj.y = it.y + dy;
				if (drag.items.length === 1 && !sm) snapCenter(it.obj);
				if (!prefs.gridSnap) keepGridPoints(it.obj);   // freehand: the shape may sit between pixels
			}
			drag.moved = true;
			renderInspector(); renderTree();
		} else if (drag.type === 'mrotate') {
			const w = toWorld(e);
			let deg = (Math.atan2(w.y - drag.c.y, w.x - drag.c.x) - drag.a0) * 180 / Math.PI;
			deg = e.shiftKey ? Math.round(deg / prefNum('angleStep', 1, 90)) * prefNum('angleStep', 1, 90) : Math.round(deg * 10) / 10;   // Shift turns in steps (15 degrees by default)
			turnAbout(drag.list, drag.base, drag.c, deg);
			drag.moved = true;
			renderInspector();
		} else if (drag.type === 'vhandle') {   // a curve handle: the other handle of the point turns to stay opposite, unless Alt is held
			const w = toWorld(e), s = drag.s, v = s.vertices[drag.i], bw = s.width * s.scale, bh = s.height * s.scale;
			if (!v || !bw || !bh) return;
			const l = toLocal(s, w.x - s.x, w.y - s.y), ox = l.x - v.x * bw, oy = l.y - v.y * bh, len = Math.hypot(ox, oy);
			const mine = drag.which === 'out' ? ['ox', 'oy'] : ['ix', 'iy'], other = drag.which === 'out' ? ['ix', 'iy'] : ['ox', 'oy'];
			v[mine[0]] = r6(ox / bw); v[mine[1]] = r6(oy / bh);
			if (!(e.altKey || drag.alt) && len > 1e-6) {
				const keep = drag.mirror ? len : (drag.keep ??= Math.hypot((v[other[0]] || 0) * bw, (v[other[1]] || 0) * bh) || len);
				v[other[0]] = r6(-ox / len * keep / bw); v[other[1]] = r6(-oy / len * keep / bh);
			}
			drag.moved = true;
		} else if (drag.type === 'refmove') {
			const w = toWorld(e);
			drag.r.x = Math.round(drag.x + w.x - drag.start.x); drag.r.y = Math.round(drag.y + w.y - drag.start.y);
			drag.moved = true;
			renderInspector();
		} else if (drag.type === 'refscale') {
			const w = toWorld(e);
			drag.r.scale = clamp(Math.round(drag.scale0 * Math.hypot(w.x - drag.r.x, w.y - drag.r.y) / drag.d0 * 1000) / 1000, 0.01, 100);
			drag.moved = true;
			renderInspector();
		} else if (drag.type === 'pivot') {
			const w = toWorld(e), s = drag.s, l = toLocal(s, w.x - s.x, w.y - s.y);
			if (Math.hypot(l.x, l.y) < 6 / view.z) setPivot(s, 0, 0); else setPivot(s, gsx(l.x), gsy(l.y));   // close to the centre snaps back to it
			drag.moved = true;
			renderInspector();
		} else {   // a single point
			const w = toWorld(e), o = drag.it.owner;
			let dx = w.x - drag.start.x, dy = w.y - drag.start.y;
			if (o) ({ x: dx, y: dy } = toLocal(o, dx, dy));   // shape points are offsets in the shape's own axes
			const ob = drag.it.obj;
			if (o) { ob.x = r4(gsx(o.x + drag.x + dx) - o.x); ob.y = r4(gsy(o.y + drag.y + dy) - o.y); }   // grid line, not just whole offsets
			else { ob.x = gsx(drag.x + dx); ob.y = gsy(drag.y + dy); }
			drag.moved = true;
			renderInspector(); renderTree();
		}
		draw();
	});

	window.addEventListener('pointerup', (e) => {
		if (!drag) return;
		const d = drag;
		drag = null;
		snapList = null; snapMark = null;
		if (d.type === 'guide') {
			if (d.idx >= 0 && cur.rules) {
				if (d.remove) { cur.rules.splice(d.idx, 1); if (!cur.rules.length) delete cur.rules; }
				if (d.moved) commit();
			}
			renderAll();
			return;
		}
		if (drawMode && d.type === 'pen') { const pull = drawMode.pull; drawMode.pull = null; drawClick(e, d.pulled ? { at: d.down, ox: pull ? pull.ox : 0, oy: pull ? pull.oy : 0 } : null); }
		if (d.type === 'create') {
			ghost = null;
			const box = ghostBox(e, d.start);
			if (d.moved && Math.abs(box.x1 - box.x0) >= 1 && Math.abs(box.y1 - box.y0) >= 1) {
				const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1), y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
				addShape(tool, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 });
			} else {   // a plain click drops the shape at its normal size, centred on the click
				const [w, h] = SHAPE_SIZE[tool] || [24, 24];
				const c = toWorld(e), s = { x: gsx(c.x), y: gsy(c.y), width: w, height: h, scale: 1 };
				snapCenter(s);
				addShape(tool, { x: s.x, y: s.y, w, h });
			}
			return;
		}
		if (d.type === 'marquee') {
			marquee = null; draw();
		} else if (d.type === 'origin') {
			const o = originGhost; originGhost = null;
			if (d.moved && o) setOrigin(o.x, o.y); else draw();
		} else if (d.moved && (d.type === 'verts' || d.type === 'resize')) {
			refit(d.s); renderInspector(); draw();
		}
		if (d.moved && d.type !== 'pan' && d.type !== 'marquee' && d.type !== 'origin') commit();
		if (d.type === 'move' && guides.length) { guides = []; draw(); }
	});

	canvas.addEventListener('dblclick', (e) => {
		if (drawMode || tool !== 'select') return;
		const hit = e.target.closest('[data-id]'), it = hit && find(hit.dataset.id);
		if (it && it.kind === 'shape') { select(it.obj.id); enterVertex(); }
	});

	canvas.addEventListener('contextmenu', (e) => {
		e.preventDefault();
		if (drawMode || vertexMode) return;
		const hit = e.target.closest('[data-id]'), it = hit && find(hit.dataset.id);
		if (it && it.kind === 'shape' && !selectedShapes().some(s => s.id === it.obj.id)) selectUnit(it.obj.id);
		else if (it && it.kind === 'point') select(it.obj.id);
		showMenu(it ? CTX_SHAPE : CTX_EMPTY, e.clientX, e.clientY);
	});

	// A mouse wheel zooms. Two fingers on a trackpad pan (and pinching zooms). Trackpads send small, frequent deltas,
	// so once one is seen every wheel event for a moment is treated as a trackpad.
	let padUntil = 0;
	canvas.addEventListener('wheel', (e) => {
		e.preventDefault();
		const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
		const pinch = e.ctrlKey || e.metaKey;
		if (!pinch && e.deltaMode === 0 && (Math.abs(e.deltaY) < 40 || e.deltaX !== 0 || !Number.isInteger(e.deltaY))) padUntil = performance.now() + 500;
		if (!pinch && performance.now() < padUntil) {
			view.tx -= e.deltaX; view.ty -= e.deltaY;
			draw();
			return;
		}
		// a trackpad pinch arrives as a wheel event with ctrlKey set and tiny deltas, so it gets a much bigger multiplier
		const dy = clamp(e.deltaY, -80, 80);
		zoomTo(view.z * Math.exp(-dy * (e.ctrlKey ? 0.02 : 0.0015)), mx, my);
	}, { passive: false });

	// Safari reports pinches as gesture events instead
	let gz = 1;
	canvas.addEventListener('gesturestart', (e) => { e.preventDefault(); gz = view.z; });
	canvas.addEventListener('gesturechange', (e) => {
		e.preventDefault();
		const r = canvas.getBoundingClientRect();
		zoomTo(gz * Math.pow(e.scale, 1.8), e.clientX - r.left, e.clientY - r.top);
	});

	new ResizeObserver(draw).observe(canvas);
}

// ------------------------------------------------------------------------------------------------ keyboard

window.addEventListener('keydown', (e) => {
	const open = document.querySelector('.overlay:not([hidden])');
	if (e.key === 'Escape' && open) { open.hidden = true; return; }
	if (open) return;
	if (!cur) return;
	const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
	if (e.code === 'Space' && !typing) {
		e.preventDefault();
		if (!spaceDown) { spaceDown = true; $('#canvas').classList.add('hand'); }
		return;
	}
	const combo = comboOf(e), a = KEYMAP[combo];
	if (a && (combo === 'mod+z' || combo === 'mod+shift+z' || combo === 'mod+y')) {   // undo works even while a box is focused
		e.preventDefault();
		document.activeElement?.blur();
		a.run();
		return;
	}
	if (typing) return;
	if (drawMode) {
		const key = e.key.toLowerCase();
		if (key === 'escape') cancelDraw();
		else if (key === 'enter') finishDraw();
		else if (key === 'backspace' || key === 'delete') { e.preventDefault(); drawMode.pts.pop(); drawMode.h.pop(); renderMenubar(); draw(); }
		return;
	}
	if (vertexMode) {
		const key = e.key.toLowerCase();
		if (key === 'escape') exitVertex(true);
		else if (key === 'enter') exitVertex(false);
		else if (key === 'delete' || key === 'backspace') { e.preventDefault(); deleteVertices(); }
		else if (a && VIEW_ONLY.has(a.id)) { e.preventDefault(); a.run(); }
		return;
	}
	if (combo === 'escape' && tool !== 'select') { setTool('select'); return; }
	if (a) {
		if (a.on()) { e.preventDefault(); a.run(); }
		else if (combo === 'delete' || combo === 'backspace') e.preventDefault();
		return;
	}
	if (e.key.startsWith('Arrow')) {
		const shapes = selectedShapes(), it = find(sel);
		if (!shapes.length && !it) return;
		e.preventDefault();
		const n = e.shiftKey ? prefNum('nudgeBig', 0.1, 1000) : prefNum('nudge', 0.1, 1000);
		let dx = e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0, dy = e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0;
		if (shapes.length) moveShapes(shapes.filter(s => !s.locked), dx, dy);
		else {
			if (it.owner) ({ x: dx, y: dy } = toLocal(it.owner, dx, dy));
			it.obj.x = round(it.obj.x + dx); it.obj.y = round(it.obj.y + dy);
		}
		commit(); renderInspector(); draw();
	}
});

window.addEventListener('keyup', (e) => {
	if (e.code === 'Space' && spaceDown) { spaceDown = false; $('#canvas').classList.toggle('hand', tool === 'hand'); }
});
window.addEventListener('blur', () => { spaceDown = false; });
