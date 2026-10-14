'use strict';
// VectorGML - start-up: wires the buttons to the code in the other files.

function applySplit() { $('#side').style.gridTemplateRows = `${prefs.split}fr 6px ${1 - prefs.split}fr`; }

$('#createBtn').addEventListener('click', createDesign);
$('#newName').addEventListener('keydown', e => { if (e.key === 'Enter') createDesign(); });
$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#openFileBtn').addEventListener('click', () => openFromFile());
$('#importFile').addEventListener('change', (e) => {
	for (const f of e.target.files) importFile(f);
	e.target.value = '';
});
$('#importSvgFile').addEventListener('change', (e) => {
	const f = e.target.files[0];
	e.target.value = '';
	if (f && cur) startSvgImport(f, cur);
});
$('#refFile').addEventListener('change', (e) => {
	const files = [...e.target.files], replace = refReplace;
	e.target.value = ''; refReplace = null;
	if (!files.length || !cur) return;
	if (replace) setReferenceFile(files[0], replace); else addReferenceFiles(files);
});
$('#backBtn').addEventListener('click', closeDesign);
$('#designName').addEventListener('dblclick', (e) => {
	inlineEdit(e.currentTarget, cur.name, (v) => { if (renameDesign(cur.name, v)) $('#designName').textContent = cur.name; });
});
$('#imgBtn').addEventListener('click', openImageDialog);
$('#jsonBtn').addEventListener('click', () => { if (cur) exportDesign(cur); });
$('#undoBtn').addEventListener('click', undo);
$('#redoBtn').addEventListener('click', redo);

// status bar
$('#stGrid').addEventListener('click', () => A.toggleGrid.run());
$('#stGuides').addEventListener('click', () => A.toggleGuides.run());
$('#stSnap').addEventListener('click', () => A.snapSettings.run());
$('#stSym').addEventListener('click', () => A.toggleSymmetry.run());
$('#stPreview').addEventListener('click', () => A.togglePreview.run());
$('#stZoomIn').addEventListener('click', () => A.zoomIn.run());
$('#stZoomOut').addEventListener('click', () => A.zoomOut.run());
$('#stZoom').addEventListener('click', () => A.zoom100.run());
$('#stFit').addEventListener('click', () => A.zoomFit.run());
$('#stFile').addEventListener('click', () => saveToFile());

// preview panel
$('#preview').querySelectorAll('[data-scale]').forEach(b => b.addEventListener('click', () => { prefs.previewScale = +b.dataset.scale; savePrefs(); renderPreview(); }));
$('#pvBg').addEventListener('change', (e) => { prefs.previewBg = e.target.value; savePrefs(); renderPreview(); });
$('#pvClose').addEventListener('click', () => A.togglePreview.run());

// the divider between Properties and Layers
$('#split').addEventListener('pointerdown', (e) => {
	e.preventDefault();
	const side = $('#side').getBoundingClientRect();
	const move = (ev) => { prefs.split = clamp((ev.clientY - side.top) / side.height, 0.2, 0.8); applySplit(); };
	const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); savePrefs(); };
	window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
});

document.addEventListener('click', closeMenus);
document.addEventListener('contextmenu', (e) => { if (!e.target.closest('#canvas, #tree')) closeMenus(); });
$('#dialog').addEventListener('click', (e) => { if (e.target.id === 'dialog') closeDialog(); });
window.addEventListener('beforeunload', () => { if (cur && dirty) snapshotVersion('Auto'); });

applySplit();
buildMainMenu();
bindCanvas();
renderMenu();
