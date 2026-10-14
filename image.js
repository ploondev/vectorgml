'use strict';
// VectorGML - export the design as a PNG or SVG picture (File > Export image).
// The picture is drawn by the same code that draws the canvas, so it looks exactly like the editor: outlines, gradients, opacity and curves.
// Reference images are not included.

const IMAGE_KEY = 'designStudio.image.v1';
const IMAGE_DEFAULTS = { format: 'png', scale: 1, pad: 4, bg: '', bounds: 'fit', smooth: true };

function imageOptions() {
	try { return { ...IMAGE_DEFAULTS, ...JSON.parse(localStorage.getItem(IMAGE_KEY)) }; } catch (e) { return { ...IMAGE_DEFAULTS }; }
}

// the corners of what is drawn, whole pixels, with room for outlines and thick lines
function imageBounds(list, pad, mode) {
	const bs = list.map(s => { const b = shapeBounds(s), m = s.type === 'line' ? s.lineWidth / 2 : (s.outline || 0); return [b[0] - m, b[1] + m, b[2] - m, b[3] + m]; });
	let [x0, x1, y0, y1] = unionBounds(bs);
	if (mode === 'center') { const hx = Math.max(Math.abs(x0), Math.abs(x1)), hy = Math.max(Math.abs(y0), Math.abs(y1)); [x0, x1, y0, y1] = [-hx, hx, -hy, hy]; }
	return [Math.floor(x0 - pad), Math.ceil(x1 + pad), Math.floor(y0 - pad), Math.ceil(y1 + pad)];
}

// opts: { scale, pad, bg ('' = transparent), bounds ('fit' | 'center'), smooth, onlySelected }
function buildImage(opts) {
	const picked = opts.onlySelected ? selectedShapes() : [], list = (picked.length ? picked : cur.shapes).filter(s => !s.hidden);
	if (!list.length) return null;
	const sides = opts.smooth ? 128 : cur.segments, b = imageBounds(list, opts.pad, opts.bounds), w = b[1] - b[0], h = b[3] - b[2];
	const scale = clamp(opts.scale, 0.1, Math.min(16, 8192 / Math.max(w, h)));
	const pxW = Math.max(1, Math.round(w * scale)), pxH = Math.max(1, Math.round(h * scale));
	const root = svg('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: `${b[0]} ${b[2]} ${w} ${h}`, width: pxW, height: pxH });
	if (opts.bg) root.append(svg('rect', { x: b[0], y: b[2], width: w, height: h, fill: opts.bg }));
	for (const s of list) root.append(shapeNode(s, true, sides));
	return { svg: '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(root), w, h, pxW, pxH, count: list.length };
}

function downloadBlob(file, blob) {
	const a = el('a', { href: URL.createObjectURL(blob), download: file });
	document.body.append(a); a.click(); a.remove();
	setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function svgToPng(res) {
	return new Promise((ok, fail) => {
		const url = URL.createObjectURL(new Blob([res.svg], { type: 'image/svg+xml' })), img = new Image();
		img.onload = () => {
			const cv = document.createElement('canvas');
			cv.width = res.pxW; cv.height = res.pxH;
			cv.getContext('2d').drawImage(img, 0, 0, res.pxW, res.pxH);
			URL.revokeObjectURL(url);
			cv.toBlob(b => b ? ok(b) : fail(new Error('the picture is too large')), 'image/png');
		};
		img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('the browser could not draw it')); };
		img.src = url;
	});
}

function openImageDialog() {
	if (!cur) return;
	const o = imageOptions(), hasSel = selectedShapes().length > 0;
	let sel = hasSel && !!o.onlySelected, last = null;
	const kind = el('div', { class: 'seg' }), preview = el('div', { class: 'img-preview bg-checker' }), info = el('div', { class: 'meta' });
	const scaleSel = el('select', {}, [1, 2, 3, 4, 8].map(k => el('option', { value: k }, k + '×')));
	scaleSel.value = String(o.scale in { 1: 1, 2: 1, 3: 1, 4: 1, 8: 1 } ? o.scale : 1);
	const pad = el('input', { type: 'number', min: 0, max: 512, step: 1, value: o.pad });
	const bgOn = el('input', { type: 'checkbox', checked: !!o.bg }), bgColor = el('input', { type: 'color', value: o.bg || '#ffffff' });
	const bounds = el('select', {}, [['fit', 'Fit the drawing'], ['center', 'Centered on the origin']].map(([v, t]) => el('option', { value: v }, t)));
	bounds.value = o.bounds;
	const smooth = el('select', {}, [['1', 'Smooth (128 sides)'], ['0', 'Same as the game (' + cur.segments + ' sides)']].map(([v, t]) => el('option', { value: v }, t)));
	smooth.value = o.smooth ? '1' : '0';
	const onlySel = el('input', { type: 'checkbox', checked: sel, disabled: !hasSel });

	const options = () => ({ format: o.format, scale: +scaleSel.value, pad: clamp(+pad.value || 0, 0, 512), bg: bgOn.checked ? bgColor.value : '', bounds: bounds.value, smooth: smooth.value === '1', onlySelected: onlySel.checked });
	const refresh = () => {
		const opts = options();
		try { localStorage.setItem(IMAGE_KEY, JSON.stringify({ ...opts, onlySelected: undefined })); } catch (e) { /* settings just will not be remembered */ }
		kind.replaceChildren(...[['png', 'PNG'], ['svg', 'SVG']].map(([k, t]) => el('button', { class: 'seg-b' + (o.format === k ? ' on' : ''), onclick: () => { o.format = k; refresh(); } }, t)));
		last = buildImage(opts);
		preview.replaceChildren();
		if (!last) { info.textContent = 'There is nothing to draw: the design has no visible shapes.'; return; }
		preview.style.background = opts.bg || '';
		preview.classList.toggle('bg-checker', !opts.bg);
		preview.append(el('img', { src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(last.svg), alt: '', style: 'image-rendering:auto' }));
		info.textContent = last.pxW + ' × ' + last.pxH + ' px  ·  ' + last.count + (last.count === 1 ? ' shape' : ' shapes') + (opts.format === 'svg' ? '  ·  ' + Math.round(last.svg.length / 1024 * 10) / 10 + ' KB' : '');
	};
	for (const c of [scaleSel, pad, bgOn, bgColor, bounds, smooth, onlySel]) c.addEventListener('input', refresh);

	const go = async () => {
		if (!last) return;
		const file = cur.name.replace(/[^\w-]+/g, '_') + (o.format === 'png' ? '.png' : '.svg');
		if (o.format === 'svg') { downloadText(file, last.svg, 'image/svg+xml'); toast('Saved ' + file); return; }
		try { downloadBlob(file, await svgToPng(last)); toast('Saved ' + file); } catch (e) { toast('Could not make the PNG: ' + e.message); }
	};
	openDialog([
		el('div', { class: 'modal-head' }, el('h2', {}, 'Export "' + cur.name + '" as an image'), el('span', { class: 'spacer' }), el('button', { onclick: closeDialog }, '✕')),
		kind,
		el('div', { class: 'gml-options' },
			el('label', {}, 'Size', scaleSel), el('label', {}, 'Padding (px)', pad), el('label', {}, 'Bounds', bounds), el('label', {}, 'Curves', smooth),
			el('label', { class: 'check-row' }, el('span', {}, 'Background'), el('span', { class: 'pair' }, bgOn, bgColor))),
		el('label', { class: 'check', title: hasSel ? '' : 'Select some shapes to draw only those' }, onlySel, ' Only the selected shapes'),
		preview, info,
		el('p', { class: 'note' }, 'The picture is drawn like the editor draws it: gradients, outlines, opacity and curves. Hidden shapes and reference images are left out. The edges are on whole pixels, so a 1× PNG matches the design pixel for pixel. Circles are drawn with the chosen number of sides.'),
		el('div', { class: 'btns' }, el('button', { class: 'primary', onclick: go }, 'Download'), el('button', { onclick: closeDialog }, 'Close')),
	], 'wide');
	refresh();
}
