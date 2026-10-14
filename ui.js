'use strict';
// VectorGML - the interface around the canvas: actions and shortcuts, menus, toolbar, panels, status bar, preview.

// ------------------------------------------------------------------------------------------------ actions and shortcuts
// Every command is an action. Menus, buttons, tooltips and the shortcut list are all built from this one table.

const A = {};
function act(id, label, keys, run, on, extra) { A[id] = { id, label, keys: keys || '', run, on: on || (() => true), ...extra }; }

const hasShapes = () => !!cur && selectedShapes().length > 0;
const hasSel = () => hasShapes() || (!!cur && !!find(sel));
const manyShapes = () => !!cur && selectedShapes().length >= 2;
const oneShape = () => !!cur && selectedShapes().length === 1;
const MAC = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
const cap = (t) => t[0].toUpperCase() + t.slice(1);
const SHAPE_KEYS = { square: 'r', circle: 'o', triangle: '3', pentagon: '5', hexagon: '6', star: 's' };
const VIEW_ONLY = new Set(['zoomIn', 'zoomOut', 'zoomFit', 'zoomSel', 'zoom100', 'toggleGrid', 'toggleGuides', 'toggleSymmetry', 'toggleLabels', 'togglePreview', 'toggleGridSnap', 'toggleShapeSnap', 'snapSettings', 'toggleRulers', 'toggleGuideSnap']);

// file
act('toDesigns', 'All designs', '', closeDesign);
act('newDesign', 'New design…', '', () => { closeDesign(); $('#newName').focus(); });
act('save', 'Save to file…', 'mod+s', () => saveToFile());
act('openFile', 'Open file…', 'mod+o', () => openFromFile());
act('saveVersion', 'Save version', 'mod+shift+s', saveVersionNow);
act('versions', 'Version history…', '', openVersions);
act('unlink', 'Stop saving to file', '', () => unlinkFile(), () => !!fileLink);
act('addReference', 'Add reference images…', '', () => { refReplace = null; $('#refFile').click(); });
act('importSvg', 'Import SVG…', '', () => $('#importSvgFile').click());
act('exportImage', 'Export image…', '', () => openImageDialog());
act('exportJson', 'Export JSON', '', () => exportDesign(cur));
act('exportGml', 'Export GML…', 'mod+shift+e', () => openGmlDialog(cur));

// edit
act('undo', 'Undo', 'mod+z', undo, () => hi > 0);
act('redo', 'Redo', 'mod+shift+z|mod+y', redo, () => hi < hist.length - 1);
act('cut', 'Cut', 'mod+x', cutSelection, hasShapes);
act('copy', 'Copy', 'mod+c', copySelection, hasShapes);
act('paste', 'Paste', 'mod+v', pasteClipboard);
act('duplicate', 'Duplicate', 'mod+d', duplicateSelection, hasSel);
act('delete', 'Delete', 'delete|backspace', deleteSelected, hasSel);
act('selectAll', 'Select all', 'mod+a', selectAll);
act('deselect', 'Deselect', 'escape', () => select(null), hasSel);
act('rename', 'Rename', 'f2', () => { if (sel) { renaming = sel; renderTree(); } }, () => !!sel && !!find(sel));
act('saveLibrary', 'Save selection to library…', '', () => askName('Save to library', selectedShapes()[0].name, (n) => saveToLibrary(n)), hasShapes);

// object
act('editCorners', 'Edit Vertex', 'enter', enterVertex, () => oneShape() && !selectedShapes()[0].parts && !selectedShapes()[0].locked);
act('group', 'Group', 'mod+g', groupSelection, manyShapes);
act('ungroup', 'Ungroup', 'mod+shift+g', ungroupSelection, () => selectedShapes().some(s => s.group));
act('combine', 'Combine into one solid shape', 'mod+e', combineSelected, manyShapes);
act('boolUnion', 'Union', '', () => booleanSelected('union'), manyShapes);
act('boolSubtract', 'Subtract', '', () => booleanSelected('subtract'), manyShapes);
act('boolIntersect', 'Intersect', '', () => booleanSelected('intersect'), manyShapes);
act('clipTo', 'Clip to shape', '', clipToShape, () => !!cur && selectedShapes().length === 2 && selectedShapes().every(clippable));
act('releaseClip', 'Release clip', '', releaseClip, () => !!cur && selectedShapes().some(x => x.clip));
act('boolExclude', 'Exclude', '', () => booleanSelected('xor'), manyShapes);
const splittable = (s) => !!s.parts && !s.parts.some(p => p.type === 'region');   // a boolean result cannot be split back
act('roundCorners', 'Round corners', '', roundSelected, () => selectedShapes().some(hasCorners));
act('smoothLines', 'Smooth lines (on / off)', '', smoothSelected, () => selectedShapes().some(hasCorners));
act('toCurves', 'Convert to curves', '', () => curveSelected(true), () => selectedShapes().some(x => x.vertices && x.type !== 'circle'));
act('toCorners', 'Remove curve handles', '', () => curveSelected(false), () => selectedShapes().some(x => x.vertices && x.vertices.some(hasHandles)));
act('sharpCorners', 'Sharp corners', '', sharpSelected, () => selectedShapes().some(hasCorners));
act('uncombine', 'Uncombine', '', uncombineSelected, () => oneShape() && splittable(selectedShapes()[0]));
act('flipH', 'Flip horizontal', 'shift+h', () => flipSelection('h'), hasShapes);
act('flipV', 'Flip vertical', 'shift+v', () => flipSelection('v'), hasShapes);
act('mirrorCopy', 'Duplicate mirrored', '', mirrorCopySelected, hasShapes);
act('unlinkMirror', 'Unlink mirror', '', unlinkMirror, () => !!cur && selectedShapes().some(x => x.mirror || cur.shapes.some(y => y.mirror === x.id)));
act('repeat', 'Repeat in a pattern…', '', () => startRepeat(), hasShapes);
act('rotateCW', 'Rotate clockwise', '', () => rotateSelection(prefNum('rotateStep', 1, 180)), hasShapes);
act('rotateCCW', 'Rotate counter-clockwise', '', () => rotateSelection(-prefNum('rotateStep', 1, 180)), hasShapes);
act('alignLeft', 'Align left', 'alt+a', () => alignSelection('left'), hasShapes);
act('alignHCenter', 'Align horizontal centers', 'alt+h', () => alignSelection('hcenter'), hasShapes);
act('alignRight', 'Align right', 'alt+d', () => alignSelection('right'), hasShapes);
act('alignTop', 'Align top', 'alt+w', () => alignSelection('top'), hasShapes);
act('alignVCenter', 'Align vertical centers', 'alt+v', () => alignSelection('vcenter'), hasShapes);
act('alignBottom', 'Align bottom', 'alt+s', () => alignSelection('bottom'), hasShapes);
act('distributeH', 'Distribute horizontally', 'alt+shift+h', () => distributeSelection('h'), () => selectedShapes().length >= 3);
act('distributeV', 'Distribute vertically', 'alt+shift+v', () => distributeSelection('v'), () => selectedShapes().length >= 3);
act('front', 'Bring to front', 'mod+shift+]', () => reorder('front'), hasShapes);
act('forward', 'Bring forward', 'mod+]', () => reorder('forward'), hasShapes);
act('backward', 'Send backward', 'mod+[', () => reorder('backward'), hasShapes);
act('back', 'Send to back', 'mod+shift+[', () => reorder('back'), hasShapes);
act('hide', 'Hide / show', 'mod+shift+h', () => toggleFlag('hidden'), hasShapes);
act('lock', 'Lock / unlock', 'mod+shift+l', () => toggleFlag('locked'), hasShapes);
act('addPoint', 'Add point', 'alt+p', addPointToSelection);

// view
act('zoomIn', 'Zoom in', '=', () => zoomTo(view.z * 1.4));
act('zoomOut', 'Zoom out', '-', () => zoomTo(view.z / 1.4));
act('zoomFit', 'Zoom to fit', 'shift+1', () => zoomFit());
act('zoomSel', 'Zoom to selection', 'shift+2', () => zoomSelection());
act('zoom100', 'Zoom to 100%', 'shift+0', () => zoomTo(1));
act('toggleGrid', 'Pixel grid', 'shift+g', () => { prefs.grid = !prefs.grid; savePrefs(); draw(); }, null, { checked: () => prefs.grid });
act('toggleGridSnap', 'Snap to grid when drawing', '', () => { prefs.gridSnap = !prefs.gridSnap; savePrefs(); renderStatus(); }, null, { checked: () => prefs.gridSnap });
act('toggleShapeSnap', 'Snap to edges and corners when drawing', '', () => { prefs.shapeSnap = !prefs.shapeSnap; savePrefs(); renderStatus(); }, null, { checked: () => prefs.shapeSnap });
act('snapSettings', 'Snapping settings…', '', () => openSettings('snap'));
act('settings', 'Settings…', 'mod+,', () => openSettings());
act('toggleRulers', 'Rulers and guide lines', '', () => { prefs.rulers = !prefs.rulers; savePrefs(); draw(); }, null, { checked: () => prefs.rulers });
act('toggleGuideSnap', 'Snap to guide lines', '', () => { prefs.guideSnap = !prefs.guideSnap; savePrefs(); renderStatus(); }, null, { checked: () => prefs.guideSnap });
act('toggleGuides', 'Smart guides', '', () => { prefs.guides = !prefs.guides; savePrefs(); renderStatus(); }, null, { checked: () => prefs.guides });
act('toggleSymmetry', 'Symmetry drawing', 'shift+y', () => { prefs.symmetry = !prefs.symmetry; savePrefs(); renderStatus(); draw(); }, null, { checked: () => prefs.symmetry });
act('toggleLabels', 'Point labels', '', () => { prefs.labels = !prefs.labels; savePrefs(); draw(); }, null, { checked: () => prefs.labels });
act('togglePreview', 'Preview', 'shift+p', () => { prefs.preview = !prefs.preview; savePrefs(); renderPreview(); renderStatus(); }, null, { checked: () => prefs.preview });

// tools
act('tSelect', 'Move', 'v', () => setTool('select'));
act('tHand', 'Hand (pan)', 'h', () => setTool('hand'));
for (const t of TYPES) act('t' + cap(t), cap(t), SHAPE_KEYS[t], () => setTool(t));
act('tPen', 'Custom polygon', 'p', () => setTool('pen'));
act('tLine', 'Line', 'l', () => setTool('line'));
act('tPoint', 'Point', 't', () => setTool('point'));
act('tEyedrop', 'Color picker', 'i', () => { eyeTarget = 'fill'; setTool('eyedrop'); });

// help
act('docs', 'Documentation', '', () => openDocs());
act('shortcuts', 'Keyboard shortcuts', '?', openShortcuts);

function normKeys(str) {
	const t = str.toLowerCase().split('+'), k = t.pop();
	return [t.includes('mod') && 'mod', t.includes('alt') && 'alt', t.includes('shift') && 'shift', k].filter(Boolean).join('+');
}

// the key combination of a keyboard event, in the same form as an action's keys
function comboOf(e) {
	let k;
	if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3).toLowerCase();
	else if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
	else if (e.code === 'BracketLeft') k = '[';
	else if (e.code === 'BracketRight') k = ']';
	else if (e.key === '+' || e.code === 'Equal') k = '=';
	else if (e.code === 'Minus') k = '-';
	else k = e.key.toLowerCase();
	const plain = k === '=' || k === '-' || k === '?';
	return [(e.metaKey || e.ctrlKey) && 'mod', e.altKey && 'alt', e.shiftKey && !plain && 'shift', k].filter(Boolean).join('+');
}

const KEYMAP = {};
for (const a of Object.values(A)) for (const k of a.keys.split('|').filter(Boolean)) KEYMAP[normKeys(k)] = a;

function fmtKeys(keys) {
	if (!keys) return '';
	const parts = keys.split('|')[0].split('+'), k = parts.pop();
	const key = { delete: 'Del', backspace: 'Del', enter: 'Enter', escape: 'Esc', f2: 'F2' }[k] || (k.length === 1 ? k.toUpperCase() : k);
	if (MAC) return parts.map(p => ({ mod: '⌘', alt: '⌥', shift: '⇧' })[p]).join('') + key;
	return [...parts.map(p => ({ mod: 'Ctrl', alt: 'Alt', shift: 'Shift' })[p]), key].join('+');
}

// ------------------------------------------------------------------------------------------------ menus

const ALIGN_ITEMS = ['alignLeft', 'alignHCenter', 'alignRight', 'alignTop', 'alignVCenter', 'alignBottom'];
const ARRANGE_ITEMS = ['front', 'forward', 'backward', 'back'];
const BOOL_ITEMS = ['boolUnion', 'boolSubtract', 'boolIntersect', 'boolExclude'];

function libraryItems() {
	const lib = readJson(LIB, []);
	if (!lib.length) return [{ label: '(nothing saved yet)', on: () => false, run() {} }];
	return lib.map(l => ({ label: l.name, run: () => insertFromLibrary(l.id), del: () => deleteFromLibrary(l.id) }));
}

const MENUS = [
	{ label: 'File', items: ['toDesigns', 'newDesign', '-', 'save', 'openFile', '-', 'saveVersion', 'versions', 'unlink', '-', 'importSvg', 'addReference', '-', 'exportImage', 'exportJson', 'exportGml', '-', 'settings'] },
	{ label: 'Edit', items: ['undo', 'redo', '-', 'cut', 'copy', 'paste', 'duplicate', 'delete', '-', 'selectAll', 'deselect', 'rename', '-', 'saveLibrary', { label: 'Library', dyn: libraryItems }] },
	{ label: 'Object', items: ['editCorners', '-', 'group', 'ungroup', 'combine', 'uncombine', { label: 'Boolean', items: BOOL_ITEMS }, 'clipTo', 'releaseClip', { label: 'Corners', items: ['roundCorners', 'smoothLines', 'sharpCorners', '-', 'toCurves', 'toCorners'] }, '-', 'flipH', 'flipV', 'rotateCW', 'rotateCCW', 'mirrorCopy', 'unlinkMirror', 'repeat', '-',
		{ label: 'Align', items: ALIGN_ITEMS }, { label: 'Distribute', items: ['distributeH', 'distributeV'] }, { label: 'Arrange', items: ARRANGE_ITEMS }, '-', 'hide', 'lock', '-', 'addPoint'] },
	{ label: 'View', items: ['zoomIn', 'zoomOut', 'zoomFit', 'zoomSel', 'zoom100', '-', 'toggleGrid', 'toggleGridSnap', 'toggleShapeSnap', 'toggleGuideSnap', 'snapSettings', 'toggleRulers', 'toggleGuides', 'toggleSymmetry', 'toggleLabels', 'togglePreview'] },
	{ label: 'Help', items: ['docs', 'shortcuts'] },
];

const CTX_SHAPE = ['cut', 'copy', 'paste', 'duplicate', '-', 'group', 'ungroup', 'combine', 'uncombine', '-', 'flipH', 'flipV', { label: 'Arrange', items: ARRANGE_ITEMS }, '-', 'hide', 'lock', '-', 'delete'];
const CTX_EMPTY = ['paste', 'selectAll', '-', 'zoomFit', 'togglePreview'];

function menuBox(items, cls) {
	const box = el('div', { class: 'dropdown menu-pop ' + (cls || '') });
	for (const it of items) {
		if (it === '-') { box.append(el('div', { class: 'sep' })); continue; }
		const def = typeof it === 'string' ? A[it] : it;
		if (def.items || def.dyn) {
			box.append(el('div', { class: 'mi-wrap' }, el('button', { class: 'mi' }, el('span', { class: 'mi-check' }), el('span', { class: 'mi-label' }, def.label), el('span', { class: 'mi-keys' }, '▸')),
				menuBox(def.items || def.dyn(), 'submenu')));
			continue;
		}
		const enabled = def.on ? !!def.on() : true;
		box.append(el('button', { class: 'mi' + (def.danger ? ' danger' : ''), disabled: !enabled, onclick: (e) => { e.stopPropagation(); closeMenus(); def.run(); } },
			el('span', { class: 'mi-check' }, def.checked && def.checked() ? '✓' : ''), el('span', { class: 'mi-label' }, def.label), el('span', { class: 'mi-keys' }, fmtKeys(def.keys)),
			def.del && el('span', { class: 'mi-del', title: 'Remove from the library', onclick: (e) => { e.stopPropagation(); def.del(); closeMenus(); } }, '✕')));
	}
	return box;
}

let openTop = null;
function closeMenus() {
	document.querySelectorAll('body > .menu-pop').forEach(m => m.remove());
	document.querySelectorAll('#mainmenu .top.open').forEach(b => b.classList.remove('open'));
	openTop = null;
}

function showTop(btn, menu) {
	closeMenus();
	const box = menuBox(menu.items, 'top-drop'), r = btn.getBoundingClientRect();
	box.style.left = r.left + 'px'; box.style.top = r.bottom + 2 + 'px';
	document.body.append(box);
	btn.classList.add('open'); openTop = btn;
}

function buildMainMenu() {
	const nav = $('#mainmenu');
	nav.replaceChildren();
	for (const m of MENUS) {
		const b = el('button', { class: 'top' }, m.label);
		b.addEventListener('click', (e) => { e.stopPropagation(); if (openTop === b) closeMenus(); else showTop(b, m); });
		b.addEventListener('pointerenter', () => { if (openTop && openTop !== b) showTop(b, m); });
		nav.append(b);
	}
}

// a menu at the pointer (right-click)
function showMenu(items, x, y) {
	closeMenus();
	const box = menuBox(items, 'ctxmenu');
	box.style.left = x + 'px'; box.style.top = y + 'px';
	document.body.append(box);
	const r = box.getBoundingClientRect();
	box.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 6)) + 'px';
	box.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 6)) + 'px';
}

// ------------------------------------------------------------------------------------------------ dialogs

function openDialog(nodes, cls) {
	const b = $('#dialogBody');
	b.className = 'modal ' + (cls || '');
	b.replaceChildren(...nodes);
	$('#dialog').hidden = false;
}
function closeDialog() { $('#dialog').hidden = true; }

function askName(title, value, ok) {
	const input = el('input', { type: 'text', value, maxlength: 40 });
	const go = () => { const v = input.value.trim(); if (!v) return; closeDialog(); ok(v); };
	input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); else if (e.key === 'Escape') closeDialog(); e.stopPropagation(); });
	openDialog([el('div', { class: 'modal-head' }, el('h2', {}, title)), input,
		el('div', { class: 'btns' }, el('button', { class: 'primary', onclick: go }, 'Save'), el('button', { onclick: closeDialog }, 'Cancel'))], 'small');
	input.focus(); input.select();
}

function openShortcuts() {
	const sections = [
		['Tools', [...['tSelect', 'tHand'], ...TYPES.map(t => 't' + cap(t)), 'tPen', 'tPoint', 'tEyedrop']],
		['Edit', ['undo', 'redo', 'cut', 'copy', 'paste', 'duplicate', 'delete', 'selectAll', 'deselect', 'rename']],
		['Object', ['editCorners', 'group', 'ungroup', 'combine', 'flipH', 'flipV', ...ALIGN_ITEMS, 'distributeH', 'distributeV', ...ARRANGE_ITEMS, 'hide', 'lock']],
		['View', ['zoomIn', 'zoomOut', 'zoomFit', 'zoomSel', 'zoom100', 'toggleGrid', 'toggleSymmetry', 'togglePreview']],
		['File', ['save', 'openFile', 'saveVersion', 'exportGml']],
	];
	const extra = [['Mouse', [['Drag on empty canvas', 'Select several shapes'], ['Shift-click', 'Add or remove from the selection'], ['Alt-drag a shape', 'Drag a copy'],
		['Shift-drag', 'Keep to one direction'], ['Space-drag or middle button', 'Pan'], ['Scroll / pinch', 'Zoom (trackpad: two fingers pan)'], ['Double-click a shape', 'Edit its corners'],
		['Shift while resizing a corner', 'Keep proportions'], ['Alt while resizing', 'Resize from the center'], ['Shift while rotating', 'Snap to 15°']]]];
	const body = [el('div', { class: 'modal-head' }, el('h2', {}, 'Keyboard shortcuts'), el('span', { class: 'spacer' }), el('button', { onclick: closeDialog }, '✕'))];
	const grid = el('div', { class: 'keys-grid' });
	for (const [title, ids] of sections) {
		grid.append(el('div', { class: 'keys-sec' }, el('h3', {}, title), ids.map(id => el('div', { class: 'key-row' }, el('span', {}, A[id].label), el('kbd', {}, fmtKeys(A[id].keys))))));
	}
	for (const [title, rows] of extra) {
		grid.append(el('div', { class: 'keys-sec' }, el('h3', {}, title), rows.map(([k, v]) => el('div', { class: 'key-row' }, el('span', {}, v), el('kbd', {}, k)))));
	}
	body.push(grid);
	openDialog(body, 'wide');
}

// ------------------------------------------------------------------------------------------------ small widgets

function iconBtn(name, title, run, opts = {}) {
	return el('button', { class: 'ib' + (opts.active ? ' active' : '') + (opts.cls ? ' ' + opts.cls : ''), title, disabled: opts.disabled, onclick: (e) => { e.stopPropagation(); run(e); } }, icon(name));
}

// a button wired to an action, with its shortcut in the tooltip
function actionBtn(id, iconName) {
	const a = A[id], on = a.on();
	return iconBtn(iconName || id, a.label + (a.keys ? '  (' + fmtKeys(a.keys) + ')' : ''), a.run, { disabled: !on });
}

function sectionHead(title, ...buttons) {
	return el('div', { class: 'head' }, el('span', { class: 'spacer' }, title), buttons);
}

function field(label, ...inputs) {
	return el('div', { class: 'field' }, el('label', {}, label), inputs.length > 1 ? el('div', { class: 'pair' }, inputs) : inputs[0]);
}

// a number box that edits the same property of one or several objects
function numberInput(objs, key, step = 1, min) {
	objs = [].concat(objs);
	const i = el('input', { type: 'number', step, min });
	i.value = round(objs[0][key]);
	i.addEventListener('input', () => {
		const v = parseFloat(i.value);
		if (isNaN(v) || (min != null && v < min)) return;
		for (const o of objs) o[key] = v;
		renderTree(); draw();
	});
	i.addEventListener('change', () => { commit(); renderInspector(); });
	return i;
}

function applyName(it, value) {
	it.obj.name = uniqueName(listOf(it), value, it.obj);
	commit();
}

function nameInput(it) {
	const i = el('input', { type: 'text' });
	i.value = it.obj.name;
	i.addEventListener('change', () => { applyName(it, i.value); renderAll(); });
	return i;
}

// ------------------------------------------------------------------------------------------------ toolbar

// Every toolbar button names itself on hover. A button that stands for several tools opens a menu of them when clicked.
const TOOL_ACTION = { select: 'tSelect', hand: 'tHand', pen: 'tPen', line: 'tLine', point: 'tPoint', eyedrop: 'tEyedrop', ...Object.fromEntries(TYPES.map(t => [t, 't' + cap(t)])) };
const TOOL_GROUPS = [
	{ name: 'Move', tools: ['select', 'hand'] },
	{ name: 'Shapes', tools: [...TYPES, 'pen'] },
	{ name: 'Point', tools: ['point'] },
	{ name: 'Line', tools: ['line'] },
	{ name: 'Color picker', tools: ['eyedrop'] },
];
const groupLast = {};   // the tool each button last showed

function toolIcon(t) { return t; }

function renderToolbar() {
	const bar = $('#toolbar');
	bar.replaceChildren();
	TOOL_GROUPS.forEach((g, gi) => {
		const active = g.tools.includes(tool) ? tool : null;
		if (active) groupLast[gi] = active;
		const shown = groupLast[gi] || g.tools[0], a = A[TOOL_ACTION[shown]], several = g.tools.length > 1;
		const tip = several ? g.name + ': ' + a.label + (a.keys ? '  ' + fmtKeys(a.keys) : '') : a.label + (a.keys ? '  ' + fmtKeys(a.keys) : '');
		const btn = el('button', { class: 'tool' + (active ? ' active' : '') + (several ? ' has-menu' : ''), 'data-tip': tip, 'aria-label': tip, onclick: (e) => {
			e.stopPropagation();
			const wasOpen = !!document.querySelector('body > .menu-pop.flyout');
			closeMenus();
			if (!several) return a.run();
			if (wasOpen) return;
			const box = el('div', { class: 'dropdown menu-pop flyout' }, el('div', { class: 'menu-title' }, g.name), g.tools.map(t => {
				const ta = A[TOOL_ACTION[t]];
				return el('button', { class: 'mi' + (tool === t ? ' current' : ''), onclick: (ev) => { ev.stopPropagation(); closeMenus(); groupLast[gi] = t; ta.run(); } },
					el('span', { class: 'mi-check' }, icon(toolIcon(t))), el('span', { class: 'mi-label' }, ta.label), el('span', { class: 'mi-keys' }, fmtKeys(ta.keys)));
			}));
			const r = e.currentTarget.getBoundingClientRect();
			box.style.left = r.right + 4 + 'px'; box.style.top = r.top - 4 + 'px';
			document.body.append(box);
		} }, icon(toolIcon(shown)));
		bar.append(btn);
		if (gi === 0 || gi === 3) bar.append(el('div', { class: 'tsep' }));
	});
}

// ------------------------------------------------------------------------------------------------ status bar

function renderCursor() {
	$('#stCursor').textContent = cursorAt ? 'x ' + Math.round(cursorAt.x) + '   y ' + Math.round(cursorAt.y) : '';
}

function selectionInfo() {
	const shapes = selectedShapes();
	if (shapes.length) {
		const b = unionBounds(shapes.map(shapeBounds)), size = round(b[1] - b[0]) + ' × ' + round(b[3] - b[2]) + ' px';
		return (shapes.length === 1 ? shapes[0].name : shapes.length + ' shapes') + '  ·  ' + size;
	}
	const it = find(sel);
	if (it && it.kind === 'point') return 'Point ' + it.obj.name + '  ·  ' + round(it.obj.x) + ', ' + round(it.obj.y);
	const b = contentBounds();
	return b ? 'Design  ·  ' + round(b[1] - b[0]) + ' × ' + round(b[3] - b[2]) + ' px  ·  ' + cur.shapes.length + ' shapes' : 'Empty design';
}

function hintText() {
	if (drawMode && drawMode.line) return 'Click to add points (they snap to nearby corners, edges and the grid; hold Alt to place freely), or click and drag to pull out a curve · Enter, a double-click or a click on the last point finishes · Backspace removes the last · Esc cancels';
	if (drawMode) return 'Click to add corners (they snap to corners and edges of other shapes, then the grid; hold Alt to place freely), or click and drag to pull out a curve · click the first point or press Enter to close · Backspace removes the last · Esc cancels';
	if (vertexMode) return 'Drag corners · Shift-click picks several · + Vertex adds on a side · Enter keeps, Esc discards';
	if (TYPES.includes(tool)) return 'Drag to draw a ' + tool + ' · Shift keeps it square · Alt draws from the center · a click drops it at normal size';
	if (tool === 'point') return 'Click to place a point · click on a shape to attach the point to that shape';
	if (tool === 'eyedrop') return 'Click a shape to copy its color onto the selection · Esc cancels';
	if (tool === 'hand') return 'Drag to pan';
	return selectedShapes().length ? 'Drag to move · Alt-drag copies · Shift-click adds · arrow keys nudge · double-click edits corners'
		: 'Drag to select · Space-drag pans · scroll or pinch to zoom · press ? for all shortcuts';
}

function renderStatus() {
	if (!cur) return;
	$('#stInfo').textContent = selectionInfo();
	$('#stHint').textContent = hintText();
	$('#stZoom').textContent = Math.round(view.z * 100) + '%';
	$('#stGrid').classList.toggle('active', prefs.grid);
	$('#stGuides').classList.toggle('active', prefs.guides);
	$('#stSnap').classList.toggle('active', prefs.shapeSnap || prefs.gridSnap);
	$('#stSym').classList.toggle('active', prefs.symmetry);
	$('#stPreview').classList.toggle('active', prefs.preview);
	const f = $('#stFile'), st = fileStatus();
	f.hidden = !st;
	if (st) { f.textContent = st.text; f.className = 'file ' + st.cls; f.title = st.tip; }
	renderCursor();
}

// ------------------------------------------------------------------------------------------------ contextual bar (over the canvas)

function barBtn(iconName, label, title, run, opts = {}) {
	return el('button', { class: 'bar-btn' + (opts.primary ? ' primary' : '') + (opts.active ? ' active' : ''), title, disabled: opts.disabled, onclick: (e) => { e.stopPropagation(); run(e); } },
		iconName && icon(iconName), label && el('span', {}, label));
}

function renderMenubar() {
	const bar = $('#menubar'), shapes = selectedShapes();
	bar.replaceChildren();
	if (drawMode) {
		const n = drawMode.pts.length, line = drawMode.line;
		bar.append(el('span', { class: 'bar-label' }, line ? 'Line: click points (' + n + ')' : n < 3 ? 'Drawing: click points (' + n + ')' : 'Click the first point to close'),
			barBtn('x', '', 'Cancel (Esc)', cancelDraw), barBtn('check', '', line ? 'Finish the line (Enter)' : 'Close the outline (Enter)', finishDraw, { primary: true, disabled: n < (line ? 2 : 3) }));
	} else if (vertexMode) {
		const s = find(vertexMode), circle = s && s.obj.type === 'circle';
		bar.append(el('span', { class: 'bar-label', title: circle ? 'Drag the top or bottom point: the circle stretches to fit between them' : '' }, circle ? 'Stretch points' : 'Editing corners'),
			!circle && barBtn('plus', '+ Vertex', 'Then click a side of the shape to add a vertex there. Delete removes the selected vertices.', () => { addingVertex = !addingVertex; renderMenubar(); draw(); }, { active: addingVertex }),
			barBtn('x', '', 'Cancel (Esc)', () => exitVertex(true)), barBtn('check', '', 'Done (Enter)', () => exitVertex(false), { primary: true }));
	} else if (shapes.length && tool === 'select') {
		const one = shapes.length === 1, s = shapes[0];
		if (one && s.parts && !splittable(s)) { /* a boolean result: nothing to split */ }
		else if (one && s.parts) bar.append(barBtn('combine', 'Uncombine', 'Split back into the separate shapes', uncombineSelected));
		else if (one) bar.append(barBtn('vertex', 'Edit Vertex', s.type === 'circle' ? 'Stretch the circle with its top and bottom points (Enter)' : 'Move the corner points of this shape (Enter)', enterVertex, { disabled: !!s.locked }));
		else bar.append(barBtn('group', 'Group', 'Keep these shapes together (' + fmtKeys('mod+g') + ')', groupSelection), barBtn('combine', 'Combine', 'Merge into one solid shape (' + fmtKeys('mod+e') + ')', combineSelected),
			barBtn('boolSubtract', 'Boolean', 'Union, subtract, intersect or exclude', (e) => { const r = e.currentTarget.getBoundingClientRect(); showMenu(BOOL_ITEMS, r.left, r.bottom + 4); }));
		if (shapes.some(x => x.group) && one) bar.append(barBtn('group', 'Ungroup', 'Release this shape from its group', ungroupSelection));
		bar.append(el('span', { class: 'bsep' }), actionBtn('flipH'), actionBtn('flipV'), actionBtn('duplicate'), actionBtn('delete', 'trash'));
	}
	bar.hidden = !bar.childNodes.length;
}

// ------------------------------------------------------------------------------------------------ layers

let layerOrder = [], lastClick = {}, anchorId = null;

function renameInput(obj, apply) {
	const i = el('input', { type: 'text', class: 'rename' });
	i.value = obj.name;
	let done = false;
	const finish = (ok) => {
		if (done) return;
		done = true; renaming = null;
		if (ok && i.value.trim() && i.value.trim() !== obj.name) apply(i.value);
		renderAll();
	};
	i.addEventListener('click', (e) => e.stopPropagation());
	i.addEventListener('dblclick', (e) => e.stopPropagation());
	i.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); e.stopPropagation(); });
	i.addEventListener('blur', () => finish(true));
	return i;
}

function layerBtn(name, title, on, run, always) {
	return el('button', { class: 'lyr' + (on ? ' on' : '') + (always ? ' always' : ''), title, onclick: (e) => { e.stopPropagation(); run(); } }, icon(name));
}

function inSelection(id) { return sel === id || multi.has(id); }

function rangeSelect(id) {
	const a = layerOrder.indexOf(anchorId), b = layerOrder.indexOf(id);
	if (a < 0 || b < 0) return select(id);
	setSelection(layerOrder.slice(Math.min(a, b), Math.max(a, b) + 1));
}

function toggleLayer(id) {
	const now = selectedShapes().map(s => s.id);
	setSelection(now.includes(id) ? now.filter(i => i !== id) : [...now, id]);
}

// one layer row: click selects, double-click renames, right-click opens a menu, drag reorders
function treeRow(obj, isShape, cls, iconNode, ...extra) {
	const isRenaming = renaming === obj.id;
	const row = el('div', { class: cls + (inSelection(obj.id) ? ' sel' : ''),
		onclick: (e) => {
			const now = performance.now();
			if (lastClick.id === obj.id && now - lastClick.t < 380) { lastClick = {}; renaming = obj.id; renderTree(); return; }
			lastClick = { id: obj.id, t: now };
			if (isShape && e.shiftKey && anchorId) rangeSelect(obj.id);
			else if (isShape && (e.metaKey || e.ctrlKey)) { anchorId = obj.id; toggleLayer(obj.id); }
			else { anchorId = obj.id; select(obj.id); }
		},
		oncontextmenu: (e) => {
			e.preventDefault(); e.stopPropagation();
			if (!inSelection(obj.id)) select(obj.id);
			showMenu(isShape ? [A.rename, '-', ...CTX_SHAPE] : [A.rename, 'duplicate', '-', 'delete'], e.clientX, e.clientY);
		} },
		iconNode, isRenaming ? renameInput(obj, (v) => { const it = find(obj.id); if (it) applyName(it, v); }) : el('span', { class: 'label' }, obj.name), ...extra);
	if (!isRenaming) dragRow(row, obj.id);
	return row;
}

function shapeRows(t, s, nested) {
	layerOrder.push(s.id);
	const dot = el('span', { class: 'icon', style: 'color:' + s.color }, icon(SHAPE_ICON[s.type]));
	t.append(treeRow(s, true, 'row' + (nested ? ' nested' : '') + (s.hidden ? ' off' : ''), dot,
		(s.mirror || cur.shapes.some(x => x.mirror === s.id)) && el('span', { class: 'meta', title: 'Linked mirror image: changing one changes the other', style: 'padding:0 4px' }, '⇋'),
		el('button', { class: 'add', title: 'Add a point to this shape', onclick: (e) => { e.stopPropagation(); addPoint(s); } }, '+ point'),
		layerBtn(s.locked ? 'lock' : 'unlock', s.locked ? 'Unlock' : 'Lock', s.locked, () => setFlag([s], 'locked', !s.locked), s.locked),
		layerBtn(s.hidden ? 'eyeoff' : 'eye', s.hidden ? 'Show' : 'Hide', s.hidden, () => setFlag([s], 'hidden', !s.hidden), s.hidden)));
	for (const p of s.points) t.append(pointRow(p, true, nested));
}

function groupRow(g, members) {
	const allHidden = members.every(m => m.hidden), allLocked = members.every(m => m.locked), isRenaming = renaming === g.id;
	const row = el('div', { class: 'row grp' + (members.every(m => inSelection(m.id)) ? ' sel' : ''),
		onclick: () => {
			const now = performance.now();
			if (lastClick.id === g.id && now - lastClick.t < 380) { lastClick = {}; renaming = g.id; renderTree(); return; }
			lastClick = { id: g.id, t: now };
			anchorId = members[0].id; setSelection(members.map(m => m.id));
		},
		oncontextmenu: (e) => {
			e.preventDefault(); e.stopPropagation();
			setSelection(members.map(m => m.id));
			showMenu([{ label: 'Rename', run: () => { renaming = g.id; renderTree(); } }, 'ungroup', 'duplicate', '-', 'hide', 'lock', '-', { label: 'Delete group and shapes', danger: true, run: () => deleteGroup(g) }], e.clientX, e.clientY);
		} },
		el('button', { class: 'lyr always chev' + (g.collapsed ? '' : ' open'), title: g.collapsed ? 'Expand' : 'Collapse', onclick: (e) => { e.stopPropagation(); g.collapsed = !g.collapsed; commit(); renderTree(); } }, icon('chev')),
		el('span', { class: 'icon' }, icon('group')),
		isRenaming ? renameInput(g, (v) => { g.name = uniqueName(cur.groups, v, g); commit(); }) : el('span', { class: 'label' }, g.name),
		layerBtn(allLocked ? 'lock' : 'unlock', allLocked ? 'Unlock group' : 'Lock group', allLocked, () => setFlag(members, 'locked', !allLocked), allLocked),
		layerBtn(allHidden ? 'eyeoff' : 'eye', allHidden ? 'Show group' : 'Hide group', allHidden, () => setFlag(members, 'hidden', !allHidden), allHidden));
	return row;
}

function pointRow(p, nested, deep) {
	return treeRow(p, false, 'row' + (nested ? ' sub' : '') + (deep ? ' deep' : ''),
		el('span', { class: 'icon', style: 'color:' + (nested ? 'var(--pt-shape)' : 'var(--pt-design)') }, icon('point')), );
}

function shapeMenuButton() {
	const btn = el('button', { class: 'plus', title: 'Add a shape in the middle of the view', onclick: (e) => {
		e.stopPropagation();
		const wasOpen = !!document.querySelector('body > .menu-pop.addmenu');
		closeMenus();
		if (wasOpen) return;
		const box = el('div', { class: 'dropdown menu-pop addmenu' }, TYPES.map(t => el('button', { class: 'mi', onclick: (ev) => { ev.stopPropagation(); closeMenus(); addShape(t); } },
			el('span', { class: 'mi-check' }, icon(t)), el('span', { class: 'mi-label' }, cap(t)))),
			el('button', { class: 'mi', onclick: (ev) => { ev.stopPropagation(); closeMenus(); setTool('pen'); } }, el('span', { class: 'mi-check' }, icon('pen')), el('span', { class: 'mi-label' }, 'Custom Polygon')),
			el('button', { class: 'mi', onclick: (ev) => { ev.stopPropagation(); closeMenus(); setTool('line'); } }, el('span', { class: 'mi-check' }, icon('line')), el('span', { class: 'mi-label' }, 'Line')));
		const r = e.currentTarget.getBoundingClientRect();
		box.style.right = innerWidth - r.right + 'px'; box.style.top = r.bottom + 4 + 'px'; box.style.left = 'auto';
		document.body.append(box);
	} }, '+');
	return btn;
}

function renderTree() {
	const t = $('#tree');
	t.replaceChildren();
	layerOrder = [];
	t.append(sectionHead('Ordering', shapeMenuButton()));
	if (!cur.shapes.length) t.append(el('div', { class: 'none' }, 'No shapes yet. Pick a shape tool on the left and drag on the canvas.'));
	const done = new Set();
	for (let i = cur.shapes.length - 1; i >= 0; i--) {   // front-most layer first, like most design tools
		const s = cur.shapes[i];
		if (!s.group) { shapeRows(t, s, false); continue; }
		if (done.has(s.group)) continue;
		done.add(s.group);
		const g = cur.groups.find(x => x.id === s.group), members = cur.shapes.filter(x => x.group === g.id).reverse();
		t.append(groupRow(g, members));
		if (g.collapsed) members.forEach(m => layerOrder.push(m.id)); else for (const m of members) shapeRows(t, m, true);
	}
	t.append(sectionHead('Design points', el('button', { onclick: () => addPoint(null), title: 'Add a point to the whole design' }, '+ point')));
	if (!cur.points.length) t.append(el('div', { class: 'none' }, 'No points yet'));
	for (const p of cur.points) t.append(pointRow(p, false));
	t.append(sectionHead('Reference images', el('button', { onclick: () => { refReplace = null; $('#refFile').click(); }, title: 'Add pictures to trace from. They are never exported.' }, '+ image')));
	if (!refList().length) t.append(el('div', { class: 'none' }, 'No reference images'));
	for (const r of refList()) {
		t.append(el('div', { class: 'row' + (refSel === r.id ? ' sel' : '') + (r.hidden ? ' off' : ''), onclick: () => selectReference(r.id) },
			el('span', { class: 'icon' }, icon('image')), el('span', { class: 'label' }, r.name),
			layerBtn(r.locked ? 'lock' : 'unlock', r.locked ? 'Unlock' : 'Lock', r.locked, () => { if (r.locked) delete r.locked; else r.locked = true; commit(); renderAll(); }, r.locked),
			layerBtn(r.hidden ? 'eyeoff' : 'eye', r.hidden ? 'Show' : 'Hide', r.hidden, () => { if (r.hidden) delete r.hidden; else r.hidden = true; commit(); renderAll(); }, r.hidden),
			layerBtn('trash', 'Delete this reference image', false, () => removeReference(r.id), false)));
	}
	const r = t.querySelector('input.rename');
	if (r) { r.focus(); r.select(); }
}

// rows can be dragged to reorder, but only within their own list (shapes, one shape's points, or the design points).
// The ordering list shows the front-most shape first, so dropping above a row puts the shape in front of it.
function dragRow(row, id) {
	row.draggable = true;
	row.addEventListener('dragstart', (e) => { dnd = id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); });
	row.addEventListener('dragend', () => { dnd = null; clearDropMarks(); });
	const target = () => {
		const a = find(dnd), b = find(id);
		return a && b && a.obj !== b.obj && listOf(a) === listOf(b) ? { a, b } : null;
	};
	const isAfter = (e) => e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
	row.addEventListener('dragover', (e) => {
		if (!target()) return;
		e.preventDefault();
		clearDropMarks();
		row.classList.add(isAfter(e) ? 'drop-after' : 'drop-before');
	});
	row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
	row.addEventListener('drop', (e) => {
		const t = target();
		if (!t) return;
		e.preventDefault();
		const list = listOf(t.a), after = isAfter(e), shapes = t.a.kind === 'shape', later = shapes ? !after : after;   // lower on screen = further back
		list.splice(list.indexOf(t.a.obj), 1);
		list.splice(list.indexOf(t.b.obj) + (later ? 1 : 0), 0, t.a.obj);
		if (shapes) { if (t.b.obj.group) t.a.obj.group = t.b.obj.group; else delete t.a.obj.group; }   // dropped among a group's shapes = joins it
		dnd = null;
		tidyGroups(cur); commit(); renderAll();
	});
}

function clearDropMarks() { document.querySelectorAll('.drop-before, .drop-after').forEach(r => r.classList.remove('drop-before', 'drop-after')); }

// ------------------------------------------------------------------------------------------------ properties panel

// which: fill, fill2 (the far end of a gradient) or outline
const COLOR_KEYS = { fill: ['color', 'swatch'], fill2: ['color2', null], outline: ['outlineColor', 'outlineSwatch'] };

function colorInputs(shapes, which) {
	const [key, skey] = COLOR_KEYS[which];
	const c = el('input', { type: 'color' }), t = el('input', { type: 'text', maxlength: 7, spellcheck: 'false' });
	c.value = t.value = shapes[0][key];
	const set = (hex, final) => {
		for (const s of shapes) { s[key] = hex; if (skey) delete s[skey]; }
		draw();
		if (final) { rememberColor(hex); commit(); renderAll(); }
	};
	c.addEventListener('input', () => { t.value = c.value; set(c.value, false); });
	c.addEventListener('change', () => set(c.value, true));
	t.addEventListener('input', () => { if (isHex(t.value)) { c.value = t.value.toLowerCase(); set(c.value, false); } });
	t.addEventListener('change', () => { if (isHex(t.value)) set(t.value.toLowerCase(), true); else t.value = shapes[0][key]; });
	const pick = iconBtn('eyedrop', 'Pick a color from a shape on the canvas', () => { eyeTarget = which; setTool('eyedrop'); });
	return [c, t, pick];
}

// the extra colour stops of a gradient: a preview bar, and a row for each stop between From and To
function mixHex(a, b, f) {
	const p = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
	return '#' + [0, 1, 2].map(i => Math.round(p(a, i) + (p(b, i) - p(a, i)) * f).toString(16).padStart(2, '0')).join('');
}
function gradientCss(s) {
	const list = [[0, s.color], ...(s.stops || []).map(q => [q.t, q.color]), [1, s.color2]].map(([t, c]) => c + ' ' + round(t * 100) + '%').join(', ');
	return s.fillType === 'radial' ? `radial-gradient(circle, ${list})` : `linear-gradient(90deg, ${list})`;
}
function colorAt(s, t) {
	const all = [{ t: 0, color: s.color }, ...(s.stops || []), { t: 1, color: s.color2 }];
	for (let i = 1; i < all.length; i++) if (t <= all[i].t) return mixHex(all[i - 1].color, all[i].color, (t - all[i - 1].t) / Math.max(all[i].t - all[i - 1].t, 1e-6));
	return s.color2;
}
function stopsEditor(box, s) {
	const bar = el('div', { class: 'grad-bar', style: 'background:' + gradientCss(s), title: 'Click to add a color stop' });
	const addAt = (t) => {
		if ((s.stops || []).length >= 8) return toast('A gradient can have up to 8 extra stops.');
		t = clamp(Math.round(t * 100) / 100, 0.01, 0.99);
		(s.stops ||= []).push({ t, color: colorAt(s, t) });
		s.stops.sort((a, b) => a.t - b.t);
		commit(); renderAll();
	};
	bar.addEventListener('click', (e) => { const r = bar.getBoundingClientRect(); addAt((e.clientX - r.left) / r.width); });
	for (const q of s.stops || []) bar.append(el('span', { class: 'grad-tick', style: 'left:' + q.t * 100 + '%' }));
	box.append(field('Stops', bar));
	(s.stops || []).forEach((q, i) => {
		const pos = el('input', { type: 'number', min: 1, max: 99, step: 1, value: round(q.t * 100), title: 'Where the stop sits, in percent' });
		pos.addEventListener('input', () => { const v = parseFloat(pos.value); if (isNaN(v)) return; q.t = clamp(v / 100, 0.01, 0.99); bar.style.background = gradientCss(s); draw(); });
		pos.addEventListener('change', () => { s.stops.sort((a, b) => a.t - b.t); commit(); renderAll(); });
		const c = el('input', { type: 'color', value: q.color });
		c.addEventListener('input', () => { q.color = c.value; bar.style.background = gradientCss(s); draw(); });
		c.addEventListener('change', () => { commit(); renderAll(); });
		const del = iconBtn('trash', 'Remove this stop', () => { s.stops.splice(i, 1); commit(); renderAll(); });
		box.append(field('Stop ' + (i + 1), pos, c, del));
	});
	box.append(el('div', { class: 'btns' }, el('button', { onclick: () => {
		const all = [0, ...(s.stops || []).map(q => q.t), 1]; let at = 0.5, gap = 0;   // the middle of the widest gap
		for (let i = 1; i < all.length; i++) if (all[i] - all[i - 1] > gap) { gap = all[i] - all[i - 1]; at = (all[i] + all[i - 1]) / 2; }
		addAt(at);
	} }, '+ Stop')));
}

// swatch chips (the design's palette) and recently used colours
function chipRow(shapes, which) {
	const [key, skey] = COLOR_KEYS[which], row = el('div', { class: 'chips' });
	for (const w of cur.palette) {
		row.append(el('button', { class: 'chip' + (shapes.every(s => s[skey] === w.id) ? ' on' : ''), style: 'background:' + w.color, title: w.name + ' (palette color: changing it updates every shape that uses it)',
			onclick: () => applySwatch(shapes, w, which) }));
	}
	row.append(el('button', { class: 'chip add', title: 'Save this color to the palette', onclick: () => askName('New palette color', 'color', (n) => {
		const w = addSwatch(shapes[0][key], n);
		applySwatch(shapes, w, which);
	}) }, '+'));
	const recent = readJson(RECENT, []);
	if (recent.length) {
		row.append(el('span', { class: 'chip-gap' }));
		for (const hex of recent.slice(0, 8)) {
			row.append(el('button', { class: 'chip small', style: 'background:' + hex, title: hex, onclick: () => {
				for (const s of shapes) { s[key] = hex; delete s[skey]; }
				commit(); renderAll();
			} }));
		}
	}
	return row;
}

function boundsInput(shapes, axis) {
	const b = unionBounds(shapes.map(shapeBounds)), i = el('input', { type: 'number', step: 1 }), k = axis === 'x' ? 0 : 2;
	let cv = (b[k] + b[k + 1]) / 2;
	i.value = round(cv);
	i.addEventListener('input', () => {
		const v = parseFloat(i.value);
		if (isNaN(v)) return;
		moveShapes(shapes, axis === 'x' ? v - cv : 0, axis === 'y' ? v - cv : 0);
		cv = v; renderTree(); draw();
	});
	i.addEventListener('change', () => { commit(); renderInspector(); });
	return i;
}

// Corners: rounding and smoothing for the whole shape, and (while editing vertices) for the selected corners alone
// Properties of a line: color, thickness, how much it curves, and whether its ends are round or cut straight
function lineInspector(box, shapes, one) {
	const s = shapes[0];
	box.append(sectionHead('Line'));
	box.append(field('Color', ...colorInputs(shapes, 'fill')));
	box.append(chipRow(shapes, 'fill'));
	box.append(field('Width', numberInput(shapes, 'lineWidth', 1, 0.5)));

	// smoothing in percent, for the whole line or (while editing points) for the selected points
	const smoothRow = (label, value, set) => {
		const si = el('input', { type: 'range', min: 0, max: 100, step: 5, value: Math.round(value * 100) }), sn = el('input', { type: 'number', min: 0, max: 100, step: 5, value: Math.round(value * 100) });
		const apply = (v, final) => { v = clamp(+v || 0, 0, 100); si.value = sn.value = v; set(v / 100); renderTree(); draw(); renderPreview(); if (final) commit(); };
		si.addEventListener('input', () => apply(si.value)); si.addEventListener('change', () => apply(si.value, true));
		sn.addEventListener('input', () => apply(sn.value)); sn.addEventListener('change', () => apply(sn.value, true));
		return field(label, si, sn);
	};
	const mixed = shapes.every(x => (x.smooth || 0) === (s.smooth || 0)) ? (s.smooth || 0) : 0;
	box.append(smoothRow('Smooth', mixed, (v) => { for (const x of shapes) { if (v > 0) x.smooth = v; else delete x.smooth; } }));

	// styles: dashes, tapered ends and arrowheads
	box.append(sectionHead('Line style'));
	const dashed = shapes.every(x => x.dash), onField = (idx) => {
		const i = el('input', { type: 'number', min: 0.5, step: 1, value: s.dash ? s.dash[idx] : LINE_DASH_DEFAULT[idx], disabled: !dashed });
		i.addEventListener('input', () => { const v = parseFloat(i.value); if (!(v >= 0.5)) return; for (const x of shapes) if (x.dash) x.dash[idx] = Math.min(v, 1000); draw(); renderPreview(); });
		i.addEventListener('change', () => commit());
		return i;
	};
	box.append(el('label', { class: 'check', title: 'Draw the line as dashes' }, el('input', { type: 'checkbox', checked: dashed, onchange: (e) => { for (const x of shapes) { if (e.target.checked) x.dash = [...LINE_DASH_DEFAULT]; else delete x.dash; } commit(); renderAll(); } }), ' Dashed'));
	if (dashed) box.append(field('Dash, gap', onField(0), onField(1)));
	const taperRow = (label, key, title) => {
		const val = Math.round((s[key] || 0) * 200), si = el('input', { type: 'range', min: 0, max: 100, step: 5, value: val, title }), sn = el('input', { type: 'number', min: 0, max: 100, step: 5, value: val, title });
		const apply = (v, final) => { v = clamp(+v || 0, 0, 100); si.value = sn.value = v; for (const x of shapes) { if (v > 0) x[key] = v / 200; else delete x[key]; } draw(); renderPreview(); if (final) commit(); };
		si.addEventListener('input', () => apply(si.value)); si.addEventListener('change', () => apply(si.value, true));
		sn.addEventListener('input', () => apply(sn.value)); sn.addEventListener('change', () => apply(sn.value, true));
		return field(label, si, sn);
	};
	box.append(taperRow('Taper start %', 'taperStart', 'The line grows from a point over this much of its length (100 = the first half)'));
	box.append(taperRow('Taper end %', 'taperEnd', 'The line shrinks to a point over this much of its length (100 = the last half)'));
	const arrow = (key, label) => el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: shapes.every(x => x[key]), onchange: (e) => { for (const x of shapes) { if (e.target.checked) x[key] = true; else delete x[key]; } commit(); renderAll(); } }), ' ' + label);
	box.append(el('div', { class: 'checks' }, arrow('arrowStart', 'Arrow at start'), arrow('arrowEnd', 'Arrow at end')));
	if (shapes.some(x => x.arrowStart || x.arrowEnd)) {
		const ai = el('input', { type: 'number', min: 1.5, max: 12, step: 0.5, value: s.arrowSize || ARROW_SIZE_DEFAULT, title: 'The width of the arrowhead, in line widths' });
		ai.addEventListener('input', () => { const v = parseFloat(ai.value); if (!(v > 0)) return; for (const x of shapes) x.arrowSize = clamp(v, 1.5, 12); draw(); renderPreview(); });
		ai.addEventListener('change', () => commit());
		box.append(field('Arrow size', ai));
	}
	if (shapes.some(x => lineStyled(x))) box.append(el('div', { class: 'note' }, 'A line with dashes, tapered ends or arrowheads is exported as filled polygons, so the game draws exactly what you see. Round or flat ends still apply to every dash. Circle sides (in the export window) set how round the ends are.'));

	box.append(el('div', { class: 'seg' }, [['round', 'Round ends'], ['flat', 'Flat ends']].map(([k, label]) => el('button', { class: 'seg-b' + (shapes.every(x => x.cap === k) ? ' on' : ''),
		title: k === 'round' ? 'Each end is a half circle, like a pen' : 'Each end is cut straight across',
		onclick: () => { for (const x of shapes) x.cap = k; commit(); renderAll(); } }, label))));

	const op = el('input', { type: 'range', min: 0, max: 100, value: Math.round(s.opacity * 100) }), opn = el('input', { type: 'number', min: 0, max: 100, step: 5, value: Math.round(s.opacity * 100) });
	const setOp = (v, final) => { v = clamp(+v || 0, 0, 100); for (const x of shapes) x.opacity = v / 100; op.value = opn.value = v; draw(); if (final) commit(); };
	op.addEventListener('input', () => setOp(op.value)); op.addEventListener('change', () => setOp(op.value, true));
	opn.addEventListener('input', () => setOp(opn.value)); opn.addEventListener('change', () => setOp(opn.value, true));
	box.append(field('Opacity', op, opn));

	if (one && vertexMode === s.id) {
		const picked = [...vsel].filter(i => s.vertices[i]);
		box.append(sectionHead(picked.length === 1 ? 'Selected point' : picked.length ? picked.length + ' selected points' : 'Selected points'));
		if (!picked.length) box.append(el('div', { class: 'note' }, 'Click a point on the canvas (Shift adds more) to curve it more or less than the rest of the line.'));
		else {
			const vs = picked.map(i => s.vertices[i].s), same = vs.every(v => v === vs[0]);
			box.append(smoothRow('Smooth', same ? (vs[0] ?? s.smooth ?? 0) : 0, (v) => setVertexLook(s, 's', v)));
			box.append(el('div', { class: 'btns' }, el('button', { onclick: () => { setVertexLook(s, 's', null); commit(); renderAll(); }, title: 'These points follow the line\'s smoothing again' }, 'Use the line\'s value')));
			curveButtons(box, s);
		}
	}
	box.append(el('div', { class: 'note' }, 'Smooth curves the line through its points. Double-click the line, or press Enter, to move its points. With Edit Vertex on, + Vertex adds a point on the line.'));
}

// Corner / Curved for the corners selected while editing a shape's points
function curveButtons(box, s) {
	if (!vsel.size) return;
	const picked = [...vsel].map(i => s.vertices[i]).filter(Boolean), curved = picked.every(hasHandles);
	box.append(el('div', { class: 'seg' }, [['corner', 'Corner'], ['curved', 'Curved']].map(([k, label]) => el('button', { class: 'seg-b' + ((k === 'curved') === curved && (curved || picked.every(v => !hasHandles(v))) ? ' on' : ''),
		title: k === 'curved' ? 'Give the point handles that curve the sides next to it' : 'Remove the point\'s handles so its sides are straight again',
		onclick: () => curveSelected(k === 'curved') }, label))));
	box.append(el('div', { class: 'note' }, 'A curved point has two handles. Drag a handle to bend the curve; the other handle turns with it. Hold Alt to move one handle on its own. Alt-drag a corner to pull handles out of it.'));
}

function cornersSection(box, shapes) {
	const withCorners = shapes.filter(hasCorners);
	if (!withCorners.length) return;
	const s = withCorners[0], vmode = withCorners.length === 1 && vertexMode === s.id && s.vertices;
	box.append(sectionHead('Corners'));

	// a pair of boxes: radius in pixels, smoothing in percent. get/set work on whatever is being edited.
	const pair = (label, get, set) => {
		const r = get('r'), q = get('s');
		const ri = el('input', { type: 'number', min: 0, step: 1, placeholder: r == null ? 'mixed' : '' }), si = el('input', { type: 'range', min: 0, max: 100, step: 5 }), sn = el('input', { type: 'number', min: 0, max: 100, step: 5, placeholder: q == null ? 'mixed' : '' });
		if (r != null) ri.value = round(r);
		if (q != null) si.value = sn.value = Math.round(q * 100);
		const live = () => { renderTree(); draw(); renderPreview(); };
		ri.addEventListener('input', () => { const v = parseFloat(ri.value); if (!isNaN(v) && v >= 0) { set('r', v); live(); } });
		ri.addEventListener('change', () => { commit(); renderInspector(); });
		const setS = (v, final) => { v = clamp(+v || 0, 0, 100); si.value = sn.value = v; set('s', v / 100); live(); if (final) commit(); };
		si.addEventListener('input', () => setS(si.value)); si.addEventListener('change', () => setS(si.value, true));
		sn.addEventListener('input', () => setS(sn.value)); sn.addEventListener('change', () => setS(sn.value, true));
		return [field(label.r, ri), field(label.s, si, sn)];
	};

	box.append(...pair({ r: 'Radius', s: 'Smooth' },
		(k) => cornerValue(withCorners, k === 'r' ? 'radius' : 'smooth'),
		(k, v) => setCorners(withCorners, k === 'r' ? 'radius' : 'smooth', v)));
	box.append(el('div', { class: 'note' }, 'Radius rounds every sharp corner into an arc. Smooth turns the line through the corners into a curve. The arcs use the design\'s Circle sides.'));

	if (vmode) {
		const picked = [...vsel].filter(i => s.vertices[i]);
		box.append(sectionHead(picked.length ? (picked.length === 1 ? 'Selected corner' : picked.length + ' selected corners') : 'Selected corners'));
		if (!picked.length) { box.append(el('div', { class: 'note' }, 'Click a corner on the canvas (Shift adds more) to give it its own radius or smoothing.')); return; }
		const mine = (k) => { const vs = picked.map(i => s.vertices[i][k]); return vs.every(v => v === vs[0]) ? (vs[0] ?? (k === 'r' ? s.radius : s.smooth) ?? 0) : null; };
		box.append(...pair({ r: 'Radius', s: 'Smooth' }, mine, (k, v) => setVertexLook(s, k, v)));
		box.append(el('div', { class: 'btns' }, el('button', { onclick: () => { setVertexLook(s, 'r', null); setVertexLook(s, 's', null); commit(); renderAll(); }, title: 'These corners follow the shape\'s radius and smoothing again' }, 'Use the shape\'s values')));
		curveButtons(box, s);
	}
}

function shapeInspector(box, shapes) {
	const one = shapes.length === 1, s = shapes[0];

	box.append(el('div', { class: 'tools-row', title: one ? 'With one shape selected, these line it up with the origin' : 'Line the selected shapes up with each other' },
		ALIGN_ITEMS.map(id => actionBtn(id)), el('span', { class: 'bsep' }), actionBtn('distributeH', 'distH'), actionBtn('distributeV', 'distV'),
		el('span', { class: 'bsep' }), actionBtn('flipH'), actionBtn('flipV')));

	box.append(sectionHead(one ? 'Shape' : shapes.length + ' shapes'));
	if (one) {
		box.append(field('Name', nameInput({ obj: s, kind: 'shape' })));
		box.append(field('Type', el('input', { type: 'text', value: s.parts ? 'combined' : s.type, disabled: true, title: 'A shape keeps its type. Add a new shape to use a different one.' })));
		box.append(field('Position', numberInput(s, 'x'), numberInput(s, 'y')));
		box.append(field('Width', numberInput(s, 'width', 1, 1)));
		box.append(field('Height', numberInput(s, 'height', 1, 1)));
		box.append(field('Scale', numberInput(s, 'scale', 0.1)));
		box.append(field('Rotation', numberInput({ get rotation() { return s.rotation; }, set rotation(v) { setRotation(s, v); } }, 'rotation', 5)));
		const pv = { get x() { return pivotOf(s).x; }, set x(v) { setPivot(s, v, pivotOf(s).y); }, get y() { return pivotOf(s).y; }, set y(v) { setPivot(s, pivotOf(s).x, v); } };
		box.append(field('Pivot', numberInput(pv, 'x'), numberInput(pv, 'y')));
		box.append(el('div', { class: 'btns' },
			el('button', { class: pivotMode ? 'on' : '', title: 'Drag the purple pivot on the canvas. Close to the center it snaps back to the center.', onclick: () => { pivotMode = !pivotMode; renderAll(); } }, pivotMode ? 'Done moving pivot' : 'Move pivot'),
			el('button', { disabled: !s.pivot, onclick: () => { setPivot(s, 0, 0); commit(); renderAll(); } }, 'Reset to center')));
		box.append(el('div', { class: 'note' }, 'The pivot is the spot this shape turns around, such as a shoulder or hinge, both here and in the game. In the exported script the shape\'s x and y are the pivot\'s position, and its points are measured from it. To use a point as the pivot, select the point and press Use as pivot.'));
	} else {
		box.append(field('Center', boundsInput(shapes, 'x'), boundsInput(shapes, 'y')));
		const b = unionBounds(shapes.map(shapeBounds));
		box.append(field('Size', el('span', { class: 'ro' }, round(b[1] - b[0]) + ' × ' + round(b[3] - b[2]) + ' px')));
	}

	if (shapes.every(x => x.type === 'line')) { lineInspector(box, shapes, one); return shapeTail(box, shapes, one); }
	cornersSection(box, shapes);

	box.append(sectionHead('Fill'));
	const kinds = el('div', { class: 'seg' }, ['solid', 'linear', 'radial'].map(t => el('button', { class: 'seg-b' + (shapes.every(x => x.fillType === t) ? ' on' : ''),
		title: t === 'solid' ? 'One color' : t === 'linear' ? 'Blend from one color to another in a direction' : 'Blend from the center outward',
		onclick: () => { for (const x of shapes) x.fillType = t; commit(); renderAll(); } }, cap(t))));
	box.append(kinds);
	const grad = s.fillType !== 'solid';
	box.append(field(grad ? 'From' : 'Color', ...colorInputs(shapes, 'fill')));
	if (grad) {
		box.append(field('To', ...colorInputs(shapes, 'fill2')));
		if (s.fillType === 'linear') box.append(field('Angle', numberInput(shapes, 'gradAngle', 15)));
		if (one) stopsEditor(box, s);
		if (s.fillType === 'radial') {   // advanced: this shape's own smoothness
			const own = shapes.every(x => x.gradDetail === s.gradDetail) ? s.gradDetail : undefined;
			const d = el('input', { type: 'number', min: 1, max: 16, step: 1, placeholder: 'default', value: own || '', title: 'How finely this radial gradient is drawn in the game, 1 to 16. Leave empty to use the default chosen at export.' });
			d.addEventListener('input', () => {
				const v = parseFloat(d.value);
				for (const x of shapes) { if (isNaN(v)) delete x.gradDetail; else x.gradDetail = clamp(Math.round(v), 1, 16); }
			});
			d.addEventListener('change', () => { commit(); renderInspector(); });
			box.append(el('details', { class: 'adv', open: !!own }, el('summary', {}, 'Advanced'),
				field('Detail', d, el('button', { disabled: !shapes.some(x => x.gradDetail), onclick: () => { for (const x of shapes) delete x.gradDetail; commit(); renderAll(); } }, 'Use default')),
				el('div', { class: 'note' }, 'How finely this radial gradient is drawn in the game. Higher is smoother and costs more. Empty uses the default chosen when you export. A shape with only a few large triangles, like a hexagon, needs more than a shape made of many small ones.')));
		}
	}
	box.append(chipRow(shapes, 'fill'));
	const op = el('input', { type: 'range', min: 0, max: 100, value: Math.round(s.opacity * 100) }), opn = el('input', { type: 'number', min: 0, max: 100, step: 5, value: Math.round(s.opacity * 100) });
	const setOp = (v, final) => { v = clamp(+v || 0, 0, 100); for (const x of shapes) x.opacity = v / 100; op.value = opn.value = v; draw(); if (final) commit(); };
	op.addEventListener('input', () => setOp(op.value)); op.addEventListener('change', () => setOp(op.value, true));
	opn.addEventListener('input', () => setOp(opn.value)); opn.addEventListener('change', () => setOp(opn.value, true));
	box.append(field('Opacity', op, opn));

	box.append(sectionHead('Outline'));
	box.append(field('Width', numberInput(shapes, 'outline', 1, 0)));
	if (s.outline > 0 || shapes.some(x => x.outline > 0)) {
		box.append(field('Color', ...colorInputs(shapes, 'outline')));
		box.append(chipRow(shapes, 'outline'));
	}

	shapeTail(box, shapes, one);
}

// Boolean, Arrange and the buttons at the bottom of the Properties panel
function shapeTail(box, shapes, one) {
	const s = shapes[0], lines = shapes.every(x => x.type === 'line');
	if (!one && !lines) {
		box.append(sectionHead('Boolean'));
		box.append(el('div', { class: 'tools-row' }, ...BOOL_ITEMS.map(id => actionBtn(id)), el('span', { class: 'note inline' }, 'The back-most shape is the one the others act on.')));
	}
	if (one && (s.mirror || cur.shapes.some(x => x.mirror === s.id))) {
		const other = cur.shapes.find(x => x.id === s.mirror) || cur.shapes.find(x => x.mirror === s.id);
		box.append(sectionHead('Mirror'));
		box.append(el('div', { class: 'note' }, 'Linked to "' + other.name + '" across the symmetry axis (x = ' + round(cur.axis || 0) + '). Change either shape and the other follows: shape, size, rotation, color and gradient. Name, group, points, hidden, locked and clip stay separate.'));
		box.append(el('div', { class: 'btns' }, el('button', { onclick: unlinkMirror }, 'Unlink')));
	}
	if (one && clippable(s)) {
		const masks = cur.shapes.filter(x => x !== s && clippable(x)), sel = el('select', { title: 'This shape is only drawn where it lies inside the chosen shape' }, [el('option', { value: '' }, 'Nothing (not clipped)'), ...masks.map(x => el('option', { value: x.id }, x.name))]);
		sel.value = s.clip || '';
		sel.addEventListener('change', () => setClip(s, sel.value));
		box.append(sectionHead('Clip'));
		box.append(field('Only inside', sel));
		if (s.clip) box.append(el('div', { class: 'note' }, 'This shape is cut to the outline of the shape above, in the editor and in the exported script, so a shadow cannot spill over its object. The outline and the fill both follow the cut edge. Move or reshape the mask and the cut follows. The gradient still spans the whole shape. Circles in the cut are drawn with the design\'s circle sides.'));
	}
	box.append(sectionHead('Arrange'));
	box.append(el('div', { class: 'tools-row' }, ...ARRANGE_ITEMS.map(id => actionBtn(id)), el('span', { class: 'bsep' }),
		iconBtn(shapes.every(x => x.hidden) ? 'eyeoff' : 'eye', 'Hide / show  (' + fmtKeys('mod+shift+h') + ')', () => toggleFlag('hidden'), { active: shapes.every(x => x.hidden) }),
		iconBtn(shapes.every(x => x.locked) ? 'lock' : 'unlock', 'Lock / unlock  (' + fmtKeys('mod+shift+l') + ')', () => toggleFlag('locked'), { active: shapes.every(x => x.locked) })));
	box.append(el('div', { class: 'btns' },
		!one && el('button', { onclick: groupSelection, title: fmtKeys('mod+g') }, 'Group'),
		shapes.some(x => x.group) && el('button', { onclick: ungroupSelection, title: fmtKeys('mod+shift+g') }, 'Ungroup'),
		!one && !lines && el('button', { onclick: combineSelected, title: 'Merge into one solid shape (' + fmtKeys('mod+e') + ')' }, 'Combine'),
		one && splittable(s) && el('button', { onclick: uncombineSelected, title: 'Split back into separate shapes' }, 'Uncombine'),
		one && el('button', { onclick: () => addPoint(s) }, '+ point'),
		el('button', { onclick: duplicateSelection }, 'Duplicate'),
		el('button', { class: 'danger', onclick: deleteSelected }, 'Delete')));
	if (one && s.parts) box.append(el('div', { class: 'note' }, splittable(s) ? 'A combined shape draws all its parts in one colour. Edge handles stretch it, corner handles scale it evenly; Uncombine to edit the parts.' : 'The result of a boolean operation. Edge handles stretch it, corner handles scale it evenly. Undo to get the original shapes back.'));
	if (s.outline > 0) box.append(el('div', { class: 'note' }, 'The outline grows outward from the shape\'s edge and has rounded corners.'));
}

function pointInspector(box, it) {
	const o = it.obj;
	box.append(sectionHead(it.owner ? 'Point on ' + it.owner.name : 'Design point'));
	box.append(field('Name', nameInput(it)));
	const where = el('select', { title: 'The shape this point rides on. Choose Design to make it a fixed point of the whole design.' },
		el('option', { value: '' }, 'Design (no shape)'), ...[...cur.shapes].reverse().map(s => el('option', { value: s.id }, s.name)));
	where.value = it.owner ? it.owner.id : '';
	where.addEventListener('change', () => attachPoint(it, where.value));
	box.append(field('Attached to', where));
	box.append(field(it.owner ? 'Offset' : 'Position', numberInput(o, 'x'), numberInput(o, 'y')));
	box.append(el('div', { class: 'note' }, it.owner
		? 'Offset is from the shape\'s centre in the editor (in the game it is measured from the shape\'s pivot). The point moves and turns with its shape.'
		: 'A fixed spot in the design. Your code can read it by name. Attach it to a shape to make it move with that shape.'));
	box.append(el('div', { class: 'btns' }, ...(it.owner ? [el('button', { title: 'Make this point the spot its shape turns around', onclick: () => pivotFromPoint(it.owner, o) }, 'Use as pivot')] : []), el('button', { onclick: duplicateSelection }, 'Duplicate'), el('button', { class: 'danger', onclick: deleteSelected }, 'Delete')));
}

function designInspector(box) {
	const b = contentBounds();
	box.append(sectionHead('Design'));
	box.append(field('Name', el('span', { class: 'ro' }, cur.name)));
	box.append(field('Size', el('span', { class: 'ro' }, b ? round(b[1] - b[0]) + ' × ' + round(b[3] - b[2]) + ' px' : '-')));

	const sides = el('input', { type: 'range', min: 8, max: 128, step: 4, value: cur.segments }), sidesN = el('input', { type: 'number', min: 8, max: 128, step: 4, value: cur.segments });
	const setSides = (v, final) => { v = clamp(Math.round((+v || 32) / 4) * 4, 8, 128); cur.segments = v; sides.value = sidesN.value = v; draw(); if (final) commit(); };
	sides.addEventListener('input', () => setSides(sides.value)); sides.addEventListener('change', () => setSides(sides.value, true));
	sidesN.addEventListener('input', () => setSides(sidesN.value)); sidesN.addEventListener('change', () => setSides(sidesN.value, true));
	box.append(field('Circle sides', sides, sidesN));
	box.append(el('div', { class: 'note' }, 'Every circle is a polygon with this many sides, here and in the game. Shapes made with Union, Subtract, Intersect or Exclude keep the number of sides they had when they were made.'));

	box.append(field('Symmetry axis', numberInput(cur, 'axis')));
	box.append(el('div', { class: 'note' }, 'With Symmetry in the status bar on, every shape you draw also gets a mirror image across this vertical line (x = the axis, 0 is the origin). Object > Duplicate mirrored does the same for the selected shapes at any time. The two shapes stay linked: change either one and the other follows. Object > Unlink mirror separates them.'));

	box.append(sectionHead('Guide lines', el('button', { title: 'Add a vertical guide line at the origin', onclick: () => { (cur.rules ||= []).push({ axis: 'x', pos: 0 }); commit(); renderAll(); } }, '+ vertical'), el('button', { title: 'Add a horizontal guide line at the origin', onclick: () => { (cur.rules ||= []).push({ axis: 'y', pos: 0 }); commit(); renderAll(); } }, '+ horizontal')));
	if (!cur.rules) box.append(el('div', { class: 'note' }, 'Drag down from the top ruler, or right from the left ruler, to pull out a guide line. Drag it back onto the ruler to delete it. Shapes, points and corners snap to guide lines (see Snap in the status bar), and they are never exported.'));
	else {
		cur.rules.forEach((gl, i) => box.append(field(gl.axis === 'x' ? 'Vertical x' : 'Horizontal y', numberInput(gl, 'pos'), el('button', { title: 'Delete this guide line', onclick: () => { cur.rules.splice(i, 1); if (!cur.rules.length) delete cur.rules; commit(); renderAll(); } }, '✕'))));
		box.append(el('div', { class: 'btns' }, el('button', { onclick: () => { delete cur.rules; commit(); renderAll(); } }, 'Delete all guide lines')));
	}

	box.append(sectionHead('Origin'));
	const grid = el('div', { class: 'origin-grid', title: 'Slide the design so the origin lands on this spot of its bounding box' });
	for (const fy of [0, 0.5, 1]) for (const fx of [0, 0.5, 1]) {
		grid.append(el('button', { class: 'og', title: ['top', 'middle', 'bottom'][fy * 2] + ' ' + ['left', 'center', 'right'][fx * 2], onclick: () => originPreset(fx, fy) }));
	}
	box.append(el('div', { class: 'origin-row' }, grid, el('div', { class: 'note' }, 'The origin (0, 0) is the point your game positions, and the orange cross on the canvas. Pick a spot on the design, such as the bottom center for a character\'s feet, or drag the cross.')));

	box.append(sectionHead('Palette', el('button', { onclick: () => addSwatch('#5b9cff'), title: 'Add a palette color' }, '+ color')));
	if (!cur.palette.length) box.append(el('div', { class: 'note' }, 'Palette colors are named colors shapes can share. Change one and every shape using it follows. In the game you can swap a color by name too, which is how you make a blue version of a design.'));
	for (const w of cur.palette) {
		const c = el('input', { type: 'color', value: w.color }), n = el('input', { type: 'text', value: w.name }), uses = cur.shapes.filter(s => s.swatch === w.id || s.outlineSwatch === w.id).length;
		c.addEventListener('input', () => { w.color = c.value; syncSwatches(cur); renderTree(); draw(); });
		c.addEventListener('change', () => { commit(); });
		n.addEventListener('change', () => { w.name = uniqueName(cur.palette, n.value, w); n.value = w.name; commit(); });
		box.append(el('div', { class: 'swatch-row' }, c, n, el('span', { class: 'meta', title: 'Shapes using this color' }, uses), iconBtn('trash', 'Delete this palette color (shapes keep their current color)', () => deleteSwatch(w))));
	}
	box.append(el('div', { class: 'note' }, 'Select a shape to edit it. Press ? for every shortcut.'));
}

function renderInspector() {
	const box = $('#inspector');
	box.replaceChildren();
	const shapes = selectedShapes();
	if (refSel && refById(refSel)) return referenceInspector(box);
	if (repeatMode) return repeatInspector(box);
	if (shapes.length) return shapeInspector(box, shapes);
	const it = find(sel);
	if (it && it.kind === 'point') return pointInspector(box, it);
	designInspector(box);
}

// ------------------------------------------------------------------------------------------------ preview

// the design at the size it will have in the game
function renderPreview() {
	const box = $('#preview');
	box.hidden = !prefs.preview || !cur;
	if (box.hidden) return;
	const body = $('#pvBody'), list = cur.shapes.filter(s => !s.hidden), sc = prefs.previewScale;
	body.className = 'pv-body bg-' + prefs.previewBg;
	body.replaceChildren();
	box.querySelectorAll('[data-scale]').forEach(b => b.classList.toggle('active', +b.dataset.scale === sc));
	$('#pvBg').value = prefs.previewBg;
	if (!list.length) { body.append(el('div', { class: 'none' }, 'Nothing to show yet')); $('#pvInfo').textContent = ''; return; }
	const b = unionBounds(list.map(shapeBounds)), pad = 4, w = b[1] - b[0] + pad * 2, h = b[3] - b[2] + pad * 2;
	const root = svg('svg', { viewBox: `${b[0] - pad} ${b[2] - pad} ${w} ${h}`, width: Math.ceil(w * sc), height: Math.ceil(h * sc) });
	root.style.maxWidth = '100%'; root.style.maxHeight = '100%';
	for (const s of list) root.append(shapeNode(s, true));
	if (b[0] - pad <= 0 && b[1] + pad >= 0 && b[2] - pad <= 0 && b[3] + pad >= 0) {   // the origin, small
		root.append(svg('circle', { cx: 0, cy: 0, r: 1.2 / Math.max(1, sc / 2), fill: 'none', stroke: '#f0a23a', 'stroke-width': 0.5 }));
	}
	body.append(root);
	$('#pvInfo').textContent = round(b[1] - b[0]) + ' × ' + round(b[3] - b[2]) + ' px at ' + sc + '×';
}


// ------------------------------------------------------------------------------------------------ settings
// Every option the editor remembers (prefs) in one window. Changes apply at once. Export options are in the export windows and are remembered there.
function openSettings(focus) {
	const apply = () => { savePrefs(); draw(); renderStatus(); renderPreview(); renderInspector(); };
	const chk = (key, label, title) => el('label', { class: 'check', title }, el('input', { type: 'checkbox', checked: !!prefs[key], onchange: (e) => { prefs[key] = e.target.checked; apply(); render(); } }), ' ' + label);
	const num = (key, label, min, max, step, title) => {
		const i = el('input', { type: 'number', min, max, step, value: prefs[key], title: title || '' });
		i.addEventListener('input', () => { const v = parseFloat(i.value); if (!(v >= min && v <= max)) return; prefs[key] = Math.round(v * 100) / 100; apply(); });
		return el('label', { title: title || '' }, label, i);
	};
	const sel = (key, label, options, cast) => {
		const s = el('select', {}, options.map(([v, t]) => el('option', { value: v }, t)));
		s.value = String(prefs[key]);
		s.addEventListener('change', () => { prefs[key] = cast ? cast(s.value) : s.value; apply(); });
		return el('label', {}, label, s);
	};
	const sec = (title, ...nodes) => el('div', { class: 'set-sec' }, el('h3', {}, title), ...nodes);
	const body = el('div', { class: 'settings' });
	const render = () => {
		body.replaceChildren(
			sec('Snapping',
				el('div', { class: 'checks' },
					chk('shapeSnap', 'Snap to corners and edges of other shapes', 'Drawing polygons and lines, moving shapes, dragging corner points and drawing new shapes. A yellow ring marks a corner, a diamond an edge. Ctrl or Cmd skips it while dragging, Alt while drawing a polygon.'),
					chk('guideSnap', 'Snap to guide lines', 'Guide lines come from the rulers'),
					chk('gridSnap', 'Snap to the grid', 'Off means freehand: points, corners, shapes and sizes land exactly where you put them, apart from corners, edges and guide lines'),
					chk('guides', 'Smart guides while dragging', 'Pink lines when what you drag lines up with another shape or the origin. In freehand (grid snap off) corner points and polygon points also line up with the other corners of their own shape.')),
				el('div', { class: 'gml-options' }, num('snapDist', 'Snap distance (screen px)', 2, 40, 1, 'How close the pointer has to be to snap to a corner. Edges and guides use 80% of this.'),
					num('gridX', 'Grid square width', 0.1, 512, 1), num('gridY', 'Grid square height', 0.1, 512, 1),
					el('button', { onclick: () => { prefs.gridX = 1; prefs.gridY = 1; apply(); render(); } }, 'Reset grid size'))),
			sec('View',
				el('div', { class: 'checks' },
					chk('grid', 'Show the grid', 'View > Pixel grid (Shift+G)'),
					chk('rulers', 'Show rulers and guide lines'),
					chk('labels', 'Show point labels', 'The names next to points on the canvas'),
					chk('preview', 'Show the game-size preview', 'Shift+P')),
				el('div', { class: 'gml-options' },
					sel('previewScale', 'Preview size', [[1, '1×'], [2, '2×'], [3, '3×'], [4, '4×']], Number),
					sel('previewBg', 'Preview background', [['checker', 'Checker'], ['dark', 'Dark'], ['light', 'Light'], ['green', 'Grass'], ['sky', 'Sky']]))),
			sec('Drawing',
				el('div', { class: 'checks' }, chk('symmetry', 'Symmetry drawing', 'Everything you draw also appears mirrored across the symmetry axis (set in Properties with nothing selected). Shift+Y'))),
			sec('Keyboard and rotation',
				el('div', { class: 'gml-options' },
					num('nudge', 'Arrow key nudge (px)', 0.1, 1000, 1), num('nudgeBig', 'Shift + arrow nudge (px)', 0.1, 1000, 1),
					num('angleStep', 'Shift-turn step (degrees)', 1, 90, 1, 'Dragging the rotate handle with Shift held'),
					num('rotateStep', 'Rotate button step (degrees)', 1, 180, 1, 'Object > Rotate clockwise and counter-clockwise'))),
			sec('Reset',
				el('div', { class: 'btns' },
					el('button', { onclick: () => { for (const k of Object.keys(PREF_DEFAULTS)) if (k !== 'split') prefs[k] = PREF_DEFAULTS[k]; apply(); render(); toast('Settings are back to their defaults.'); } }, 'Reset all settings'),
					el('button', { onclick: () => { try { localStorage.removeItem(GML_KEY); localStorage.removeItem(IMAGE_KEY); } catch (e) { /* nothing to forget */ } toast('The export windows will start from their defaults again.'); } }, 'Forget export settings')),
				el('p', { class: 'note' }, 'Settings are remembered in this browser. Your designs are not touched.')));
		if (focus) { const s = body.querySelector('.set-sec'); if (s && focus === 'snap') s.scrollIntoView(); }
	};
	render();
	openDialog([
		el('div', { class: 'modal-head' }, el('h2', {}, 'Settings'), el('span', { class: 'spacer' }), el('button', { onclick: closeDialog }, '✕')),
		body,
		el('div', { class: 'btns' }, el('button', { class: 'primary', onclick: closeDialog }, 'Done')),
	], 'wide');
}
const openSnapDialog = () => openSettings('snap');
