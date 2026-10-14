'use strict';
// VectorGML - copies in a pattern (Object > Repeat).
// The selected shapes are copied as one unit into a grid, along a line (optionally turning and shrinking), or round a circle. The copies
// show on the canvas while the panel is open, so the settings can be tuned; Apply keeps them and Cancel (or selecting something else) removes them.

let repeatMode = null;   // while the panel is open: { kind, p, ids (the originals), c (their centre), size, made (the copies) }

const REPEAT_MAX = 500;  // most shapes a pattern may add

function startRepeat() {
	const list = selectedShapes();
	if (!list.length) return toast('Select the shapes to repeat first.');
	if (list.some(s => s.locked)) return toast('Unlock the shapes first.');
	discardRepeat();
	const b = unionBounds(list.map(shapeBounds)), w = b[1] - b[0], h = b[3] - b[2], c = { x: (b[0] + b[1]) / 2, y: (b[2] + b[3]) / 2 };
	const far = Math.hypot(c.x, c.y) > 5;   // a circle needs a centre apart from the shapes: the origin when the shapes are not on it
	repeatMode = {
		kind: 'grid', ids: list.map(s => s.id), c, size: [w, h], made: [], group: true,
		p: { cols: 3, rows: 3, gx: Math.round(w + 8), gy: Math.round(h + 8), count: 5, dx: Math.round(w + 8), dy: 0, rot: 0, scale: 100, num: 8, angle: 360, cx: far ? 0 : Math.round(c.x), cy: far ? 0 : Math.round(c.y + Math.max(w, h) * 1.5), turn: true },
	};
	updateRepeat();
	renderAll();
}

// removes the copies that are showing, without keeping them
function discardRepeat() {
	if (!repeatMode) return;
	const m = repeatMode;
	repeatMode = null;
	if (cur && m.made.length) { const ids = new Set(m.made.map(s => s.id)); cur.shapes = cur.shapes.filter(s => !ids.has(s.id)); }
}

// the placement of every copy: { dx, dy, rot, sc, deg } (a translation, a turn and a scale about the group's centre; or, for a circle, a turn about the circle's centre)
function repeatPlan(m) {
	const p = m.p, out = [];
	if (m.kind === 'grid') {
		for (let j = 0; j < p.rows; j++) for (let i = 0; i < p.cols; i++) if (i || j) out.push({ dx: i * p.gx, dy: j * p.gy, rot: 0, sc: 1 });
	} else if (m.kind === 'line') {
		for (let k = 1; k < p.count; k++) out.push({ dx: k * p.dx, dy: k * p.dy, rot: k * p.rot, sc: Math.pow(p.scale / 100, k) });
	} else {
		const step = p.num < 2 ? 0 : p.angle >= 360 ? p.angle / p.num : p.angle / (p.num - 1);
		for (let k = 1; k < p.num; k++) out.push({ deg: k * step });
	}
	return out;
}

const REPEAT_LIMITS = { cols: [1, 50], rows: [1, 50], count: [1, 200], num: [1, 200] };

// rebuilds the copies from the current settings
function updateRepeat() {
	const m = repeatMode;
	if (!m || !cur) return;
	const gone = new Set(m.made.map(s => s.id));
	cur.shapes = cur.shapes.filter(s => !gone.has(s.id));
	m.made = [];
	const originals = m.ids.map(id => cur.shapes.find(s => s.id === id)).filter(Boolean);
	if (!originals.length) return;
	const plan = repeatPlan(m);
	if (plan.length * originals.length > REPEAT_MAX) { m.tooMany = true; plan.length = Math.floor(REPEAT_MAX / originals.length); } else m.tooMany = false;
	const at = Math.max(...originals.map(s => cur.shapes.indexOf(s))) + 1, made = [];
	for (const t of plan) {
		for (const s0 of originals) {
			const q = JSON.parse(JSON.stringify(s0));
			q.id = newId(); delete q.mirror;
			q.points = (q.points || []).map(pt => ({ ...pt, id: newId() }));
			q.name = uniqueName([...cur.shapes, ...made], s0.name.replace(/ \d+$/, '') + ' ' + (made.length / originals.length + 2));
			if (m.kind === 'circle') {
				const a = rad(t.deg), ca = Math.cos(a), sa = Math.sin(a), dx = s0.x - m.p.cx, dy = s0.y - m.p.cy;
				q.x = r4(m.p.cx + dx * ca - dy * sa); q.y = r4(m.p.cy + dx * sa + dy * ca);
				if (m.p.turn) q.rotation = wrapDeg(s0.rotation + t.deg);
			} else {
				const a = rad(t.rot), ca = Math.cos(a), sa = Math.sin(a), dx = (s0.x - m.c.x) * t.sc, dy = (s0.y - m.c.y) * t.sc;
				q.x = r4(m.c.x + dx * ca - dy * sa + t.dx); q.y = r4(m.c.y + dx * sa + dy * ca + t.dy);
				q.rotation = wrapDeg(s0.rotation + t.rot);
				if (t.sc !== 1) q.scale = r6(s0.scale * t.sc);
			}
			made.push(q);
		}
	}
	cur.shapes.splice(at, 0, ...made);
	m.made = made;
	draw(); renderTree();
}

function applyRepeat() {
	const m = repeatMode;
	if (!m) return;
	const originals = m.ids.map(id => cur.shapes.find(s => s.id === id)).filter(Boolean), all = [...originals, ...m.made];
	if (m.group && originals.length && originals.every(s => !s.group) && m.made.length) {
		const g = { id: newId(), name: uniqueName(cur.groups, originals[0].name.replace(/ \d+$/, '') + ' pattern') };
		cur.groups.push(g);
		for (const s of all) s.group = g.id;
	}
	repeatMode = null;
	commit();
	setSelection(all.map(s => s.id));
}

function cancelRepeat() {
	discardRepeat();
	renderAll();
}

function repeatInspector(box) {
	const m = repeatMode, p = m.p, count = m.made.length;
	box.append(sectionHead('Repeat'));
	box.append(el('div', { class: 'seg' }, [['grid', 'Grid'], ['line', 'Line'], ['circle', 'Circle']].map(([k, label]) => el('button', { class: 'seg-b' + (m.kind === k ? ' on' : ''),
		title: { grid: 'Rows and columns', line: 'Along a line, optionally turning and shrinking', circle: 'Round a center point' }[k], onclick: () => { m.kind = k; updateRepeat(); renderInspector(); } }, label))));

	const info = el('div', { class: 'meta' });
	const showInfo = () => { info.textContent = count === m.made.length ? '' : ''; info.textContent = m.made.length + ' new ' + (m.made.length === 1 ? 'shape' : 'shapes') + (m.tooMany ? ' (the most a pattern may add is ' + REPEAT_MAX + ')' : ''); };
	const num = (label, key, step = 1, hint) => {
		const lim = REPEAT_LIMITS[key], i = el('input', { type: 'number', step, value: round(p[key]), title: hint || '' });
		if (lim) { i.min = lim[0]; i.max = lim[1]; }
		i.addEventListener('input', () => {
			let v = parseFloat(i.value);
			if (isNaN(v)) return;
			if (lim) v = clamp(Math.round(v), lim[0], lim[1]);
			if (key === 'scale') v = Math.max(1, v);
			p[key] = v;
			updateRepeat(); showInfo();
		});
		i.addEventListener('change', () => renderInspector());
		return field(label, i);
	};
	if (m.kind === 'grid') {
		box.append(field('Columns × rows', ...[['cols', 'Columns'], ['rows', 'Rows']].map(([key]) => {
			const lim = REPEAT_LIMITS[key], i = el('input', { type: 'number', min: lim[0], max: lim[1], step: 1, value: p[key] });
			i.addEventListener('input', () => { const v = parseFloat(i.value); if (isNaN(v)) return; p[key] = clamp(Math.round(v), lim[0], lim[1]); updateRepeat(); showInfo(); });
			return i;
		})));
		box.append(field('Step x, y', ...[['gx'], ['gy']].map(([key]) => {
			const i = el('input', { type: 'number', step: 1, value: round(p[key]), title: 'Distance between neighbours, center to center, in pixels' });
			i.addEventListener('input', () => { const v = parseFloat(i.value); if (isNaN(v)) return; p[key] = v; updateRepeat(); });
			return i;
		})));
	} else if (m.kind === 'line') {
		box.append(num('Copies', 'count', 1, 'How many in all, including the original'));
		box.append(field('Step x, y', ...[['dx'], ['dy']].map(([key]) => {
			const i = el('input', { type: 'number', step: 1, value: round(p[key]), title: 'How far each copy is from the one before, in pixels' });
			i.addEventListener('input', () => { const v = parseFloat(i.value); if (isNaN(v)) return; p[key] = v; updateRepeat(); });
			return i;
		})));
		box.append(num('Turn each', 'rot', 5, 'Degrees each copy turns more than the one before'));
		box.append(num('Scale each %', 'scale', 5, 'Each copy is this percent of the size of the one before'));
	} else {
		box.append(num('Copies', 'num', 1, 'How many in all, including the original'));
		box.append(num('Angle', 'angle', 15, '360 spreads the copies all the way round'));
		box.append(field('Center x, y', ...[['cx'], ['cy']].map(([key]) => {
			const i = el('input', { type: 'number', step: 1, value: round(p[key]) });
			i.addEventListener('input', () => { const v = parseFloat(i.value); if (isNaN(v)) return; p[key] = v; updateRepeat(); });
			return i;
		})));
		box.append(el('div', { class: 'btns' },
			el('button', { onclick: () => { p.cx = 0; p.cy = 0; updateRepeat(); renderInspector(); } }, 'Use the origin'),
			el('button', { onclick: () => { p.cx = Math.round(m.c.x); p.cy = Math.round(m.c.y); updateRepeat(); renderInspector(); }, title: 'The copies then all sit on the original' }, 'Use the selection\'s center')));
		box.append(el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: !!p.turn, onchange: (e) => { p.turn = e.target.checked; updateRepeat(); } }), ' Turn the copies as they go round'));
	}
	const ungrouped = m.ids.every(id => { const s = cur.shapes.find(x => x.id === id); return s && !s.group; });
	if (ungrouped) box.append(el('label', { class: 'check', title: 'Keep the original and its copies together as one group' }, el('input', { type: 'checkbox', checked: !!m.group, onchange: (e) => { m.group = e.target.checked; } }), ' Group the copies with the original'));
	showInfo();
	box.append(info);
	box.append(el('div', { class: 'btns' }, el('button', { class: 'primary', onclick: applyRepeat }, 'Apply'), el('button', { onclick: cancelRepeat }, 'Cancel')));
	box.append(el('div', { class: 'note' }, 'The selected shapes are copied together as one unit. The copies show on the canvas while you change the settings. Apply keeps them, and Cancel or selecting something else removes them. Each copy is a separate shape you can edit afterward. Outlines and line widths keep their size when a copy is scaled.'));
}
