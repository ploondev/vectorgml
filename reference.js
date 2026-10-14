'use strict';
// VectorGML - reference images: pictures shown behind (or over) the shapes to trace from. They are never exported.
// A design can have any number of them. The design keeps where each one sits (cur.refs: id, name, x, y, scale, opacity ...).
// The pictures themselves live in this browser's IndexedDB, under each image's id, because they are too big for the design's own storage.

const refUrls = {};        // image id -> object URL of the picture, once loaded
let refSel = null;         // the id of the selected reference image, or null
let refReplace = null;     // set while the file picker is open to replace one picture

const refList = () => (cur && cur.refs) || [];
const refById = (id) => refList().find(r => r.id === id);

function refStore(mode, run) {
	return new Promise((ok, fail) => {
		const open = indexedDB.open('designStudio.refs', 1);
		open.onupgradeneeded = () => open.result.createObjectStore('img');
		open.onerror = () => fail(open.error);
		open.onsuccess = () => {
			const tx = open.result.transaction('img', mode), req = run(tx.objectStore('img'));
			tx.oncomplete = () => { open.result.close(); ok(req && req.result); };
			tx.onerror = () => { open.result.close(); fail(tx.error); };
		};
	});
}

// shows the saved pictures of the open design (called when a design opens)
async function loadReferences() {
	if (!cur) return;
	const design = cur;
	for (const r of refList()) {
		if (refUrls[r.id]) continue;
		try {
			const blob = await refStore('readonly', s => s.get(r.id));
			if (blob) { refUrls[r.id] = URL.createObjectURL(blob); if (cur === design) draw(); }
		} catch (e) { /* no storage: the layout is kept, the picture just is not shown */ }
	}
	if (cur === design && refList().some(r => !refUrls[r.id])) toast('Some reference images are no longer stored in this browser.');
}

const isImageFile = (f) => /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(f.name);

// adds a picture as a new reference image, or (with replaceId) swaps the picture of an existing one
function setReferenceFile(file, replaceId) {
	return new Promise((done) => {
		if (!cur || !file) return done();
		if (!isImageFile(file)) { toast('That is not an image file.'); return done(); }
		const url = URL.createObjectURL(file), img = new Image(), design = cur;
		img.onload = async () => {
			const w = img.naturalWidth || 100, h = img.naturalHeight || 100, old = replaceId && refById(replaceId);
			const id = old ? old.id : newId();
			refUrls[id] = url;
			if (old) { old.scale = old.scale * Math.max(old.w, old.h) / Math.max(w, h); old.w = w; old.h = h; }   // keeps the size and place of the old picture
			else {
				const n = refList().length, fit = Math.round(320 / Math.max(w, h) * 1000) / 1000;   // a new picture fills about 320 px of the view
				(design.refs ||= []).push({ id, name: file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Reference image', x: n * 24, y: n * 24, scale: fit, opacity: 0.5, w, h });
			}
			try { await refStore('readwrite', s => s.put(file, id)); } catch (e) { toast('The picture could not be stored, so it will be gone when you reload.'); }
			if (cur === design) { select(null); refSel = id; commit(); renderAll(); }
			done();
		};
		img.onerror = () => { toast('That image could not be read.'); done(); };
		img.src = url;
	});
}

async function addReferenceFiles(files) {
	for (const f of files) await setReferenceFile(f);
}

function removeReference(id) {
	const r = refById(id);
	if (!r) return;
	cur.refs = cur.refs.filter(x => x !== r);
	if (!cur.refs.length) delete cur.refs;
	if (refSel === id) refSel = null;
	commit(); renderAll();
	toast('Removed "' + r.name + '". Undo brings it back.');   // the stored picture is kept for that
}

function selectReference(id) {
	if (!refById(id)) return;
	select(null);
	refSel = id;
	renderAll();
}

// moves a picture one place back or forward in the list (later pictures are drawn over earlier ones)
function moveReference(id, dir) {
	const list = cur.refs, i = list.findIndex(r => r.id === id), j = i + dir;
	if (i < 0 || j < 0 || j >= list.length) return;
	[list[i], list[j]] = [list[j], list[i]];
	commit(); renderAll();
}

// the pictures as SVG nodes: those behind the shapes (front = false) or over them (front = true)
function referenceNodes(front) {
	const out = [];
	for (const r of refList()) {
		const url = refUrls[r.id];
		if (r.hidden || !url || !!r.front !== front) continue;
		const w = r.w * r.scale, h = r.h * r.scale, active = refSel === r.id && !r.locked;
		const img = svg('image', { href: url, x: r.x - w / 2, y: r.y - h / 2, width: w, height: h, opacity: r.opacity, preserveAspectRatio: 'none', 'pointer-events': active ? 'all' : 'none' });
		img.dataset.refimg = r.id;
		if (active) img.style.cursor = 'move';
		out.push(img);
	}
	return out;
}

// the frame and scale handle shown around the selected picture
function referenceFrame() {
	const r = refById(refSel);
	if (!r) return null;
	const w = r.w * r.scale, h = r.h * r.scale, g = svg('g', {});
	g.append(svg('rect', { x: r.x - w / 2, y: r.y - h / 2, width: w, height: h, fill: 'none', stroke: '#ffd24d', 'stroke-width': 1.5, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
	if (!r.locked) {
		const hs = 5 / view.z, h2 = svg('rect', { x: r.x + w / 2 - hs, y: r.y + h / 2 - hs, width: hs * 2, height: hs * 2, fill: '#fff', stroke: '#ffd24d', 'stroke-width': 1.5 / view.z });
		h2.dataset.refscale = r.id; h2.style.cursor = 'nwse-resize';
		g.append(h2);
	}
	return g;
}

function referenceInspector(box) {
	const r = refById(refSel);
	if (!r) return;
	const num = (key, step, min) => numberInput(r, key, step, min);
	box.append(sectionHead('Reference image'));
	const name = el('input', { type: 'text', value: r.name, maxlength: 60 });
	name.addEventListener('change', () => { r.name = name.value.trim() || 'Reference image'; commit(); renderTree(); });
	box.append(field('Name', name));
	box.append(el('div', { class: 'ref-thumb' }, refUrls[r.id] ? el('img', { src: refUrls[r.id], alt: '' }) : el('span', { class: 'meta' }, 'The picture is not loaded')));
	box.append(field('Position', num('x'), num('y')));
	box.append(field('Scale', num('scale', 0.05, 0.01)));
	box.append(el('div', { class: 'meta' }, 'Natural size ' + r.w + ' × ' + r.h + ' px, shown at ' + round(r.w * r.scale) + ' × ' + round(r.h * r.scale) + ' px'));
	const op = el('input', { type: 'range', min: 5, max: 100, value: Math.round(r.opacity * 100) }), opn = el('input', { type: 'number', min: 5, max: 100, step: 5, value: Math.round(r.opacity * 100) });
	const setOp = (v, final) => { v = clamp(+v || 5, 5, 100); r.opacity = v / 100; op.value = opn.value = v; draw(); if (final) commit(); };
	op.addEventListener('input', () => setOp(op.value)); op.addEventListener('change', () => setOp(op.value, true));
	opn.addEventListener('input', () => setOp(opn.value)); opn.addEventListener('change', () => setOp(opn.value, true));
	box.append(field('Opacity', op, opn));
	const flag = (key, label, title) => el('label', { class: 'check', title }, el('input', { type: 'checkbox', checked: !!r[key], onchange: (e) => { if (e.target.checked) r[key] = true; else delete r[key]; commit(); renderAll(); } }), ' ' + label);
	box.append(el('div', { class: 'checks' }, flag('locked', 'Locked', 'A locked picture cannot be moved by dragging it'), flag('hidden', 'Hidden', 'Hide the picture without removing it'), flag('front', 'Over the shapes', 'Draw the picture above the shapes, for checking against it')));
	const i = cur.refs.indexOf(r);
	box.append(el('div', { class: 'btns' },
		el('button', { disabled: i >= cur.refs.length - 1, onclick: () => moveReference(r.id, 1), title: 'Draw this picture over the others' }, 'Forward'),
		el('button', { disabled: i <= 0, onclick: () => moveReference(r.id, -1), title: 'Draw this picture under the others' }, 'Backward'),
		el('button', { onclick: () => { r.x = 0; r.y = 0; commit(); renderAll(); }, title: 'Center the picture on the origin' }, 'Center')));
	box.append(el('div', { class: 'btns' },
		el('button', { onclick: () => { refReplace = r.id; $('#refFile').click(); } }, 'Replace…'),
		el('button', { class: 'danger', onclick: () => removeReference(r.id) }, 'Delete')));
	box.append(el('div', { class: 'note' }, 'A reference image is a picture to trace from. It is shown only in the editor and is never exported. It is stored in this browser, so it is not part of a .design.json file. Drag it to move it, and drag its corner handle to scale it. You can add as many as you like, and dropping image files on the canvas adds them too.'));
}

// dropping image files on the canvas
$('#canvas').addEventListener('dragover', (e) => { if (cur && [...(e.dataTransfer?.items || [])].some(i => i.kind === 'file')) e.preventDefault(); });
$('#canvas').addEventListener('drop', (e) => {
	const files = [...(e.dataTransfer?.files || [])].filter(isImageFile);
	if (!cur || !files.length) return;
	e.preventDefault();
	addReferenceFiles(files);
});
