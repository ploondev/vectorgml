'use strict';
// VectorGML - keeping work safe: version history, and an optional file on disk that updates as you work.
// (Designs always live in the browser's storage too. The file is a second copy you control.)

// ------------------------------------------------------------------------------------------------ version history

function versionsOf(name) { return readJson(VERS, {})[name] || []; }

// Remembers the design as it is now. Automatic ones are dropped first when the list is full.
function snapshotVersion(label, onlyIfChanged = true) {
	if (!cur) return false;
	const all = readJson(VERS, {}), list = all[cur.name] || [], json = JSON.stringify(cur);
	if (onlyIfChanged && list.length && list[list.length - 1].json === json) return false;
	list.push({ t: Date.now(), label: label || 'Auto', json });
	while (list.length > 20) { const i = list.findIndex(v => v.label === 'Auto'); list.splice(i >= 0 ? i : 0, 1); }
	all[cur.name] = list;
	if (!writeJson(VERS, all)) { list.splice(0, Math.ceil(list.length / 2)); writeJson(VERS, all); }
	dirty = false;
	return true;
}

function restoreVersion(v) {
	const d = normalize(JSON.parse(v.json));
	d.name = cur.name;
	cur = d;
	resetModes(); multi.clear(); sel = null;
	commit(); renderAll();   // goes into the undo history, so restoring can be undone
	toast('Restored the version from ' + new Date(v.t).toLocaleString());
}

function ago(t) {
	const s = Math.max(0, (Date.now() - t) / 1000);
	if (s < 60) return 'just now';
	if (s < 3600) return Math.round(s / 60) + ' min ago';
	if (s < 86400) return Math.round(s / 3600) + ' h ago';
	return new Date(t).toLocaleDateString();
}

function openVersions() {
	const list = versionsOf(cur.name).slice().reverse();
	const body = [el('div', { class: 'modal-head' }, el('h2', {}, 'Version history'), el('span', { class: 'spacer' }), el('button', { onclick: closeDialog }, '✕'))];
	body.push(el('p', { class: 'note' }, 'Snapshots are taken when you open a design, every few minutes while you work, and when you choose File > Save version. Restoring one can be undone.'));
	if (!list.length) body.push(el('p', { class: 'empty' }, 'No versions yet.'));
	const rows = el('div', { class: 'ver-list' });
	for (const v of list) {
		const d = JSON.parse(v.json);
		rows.append(el('div', { class: 'ver' },
			thumb(d),
			el('div', { class: 'design-info' }, el('b', {}, v.label), el('span', { class: 'meta' }, ago(v.t) + ' · ' + d.shapes.length + ' shapes')),
			el('span', { class: 'spacer' }),
			el('button', { onclick: () => { closeDialog(); restoreVersion(v); } }, 'Restore')));
	}
	body.push(rows);
	openDialog(body, 'wide');
}

function saveVersionNow() {
	snapshotVersion('Saved', false);
	toast('Version saved. File > Version history lists them.');
}

// ------------------------------------------------------------------------------------------------ a file on disk

const fsOK = typeof window.showSaveFilePicker === 'function' && typeof window.showOpenFilePicker === 'function';
const FILE_TYPES = [{ description: 'VectorGML file', accept: { 'application/json': ['.json'] } }];
let fileLink = null;   // { handle, state: 'ready' | 'paused' | 'error', saved }
let fileTimer = null, autoTimer = null;

function fileNameOf(d) { return d.name.replace(/[^\w-]+/g, '_') + '.design.json'; }

function idb() {
	return new Promise((res, rej) => {
		const r = indexedDB.open('designStudio.files', 1);
		r.onupgradeneeded = () => r.result.createObjectStore('handles');
		r.onsuccess = () => res(r.result);
		r.onerror = () => rej(r.error);
	});
}
async function idbDo(mode, fn) {
	const dbx = await idb();
	return new Promise((res, rej) => {
		const store = dbx.transaction('handles', mode).objectStore('handles'), req = fn(store);
		req.onsuccess = () => res(req.result);
		req.onerror = () => rej(req.error);
	});
}
const idbGet = (key) => idbDo('readonly', s => s.get(key));
const idbSet = (key, val) => idbDo('readwrite', s => s.put(val, key));
const idbDel = (key) => idbDo('readwrite', s => s.delete(key));

async function writeLinked() {
	const w = await fileLink.handle.createWritable();
	await w.write(JSON.stringify(exportObject(cur), null, 2));
	await w.close();
	fileLink.saved = Date.now(); fileLink.state = 'ready';
	renderStatus();
}

// called after every change: quietly rewrites the linked files
function scheduleFileSave() {
	if (!cur || !fileLink || fileLink.state !== 'ready') return;
	clearTimeout(fileTimer);
	fileTimer = setTimeout(async () => {
		if (fileLink && fileLink.state === 'ready') { try { await writeLinked(); } catch (e) { fileLink.state = 'error'; renderStatus(); } }
	}, 900);
}

async function saveToFile() {
	if (!fsOK) { exportDesign(cur); return toast('This browser cannot keep a file up to date, so it was downloaded instead.'); }
	try {
		if (!fileLink) {
			const handle = await window.showSaveFilePicker({ suggestedName: fileNameOf(cur), types: FILE_TYPES });
			fileLink = { handle, state: 'ready' };
			await idbSet(cur.name, handle);
		} else if (fileLink.state !== 'ready') {
			if (await fileLink.handle.requestPermission({ mode: 'readwrite' }) !== 'granted') return toast('Permission to write the file was not given.');
		}
		await writeLinked();
		toast('Saved to ' + fileLink.handle.name + '. It updates as you work.');
	} catch (e) {
		if (e && e.name !== 'AbortError') { toast('Could not save the file: ' + e.message); if (fileLink) { fileLink.state = 'error'; renderStatus(); } }
	}
}

async function unlinkFile() {
	fileLink = null;
	try { await idbDel(cur.name); } catch (e) { /* nothing stored */ }
	renderStatus();
	toast('Stopped saving to the file. The design is still stored in the browser.');
}

async function openFromFile() {
	if (!fsOK) { $('#importFile').click(); return; }
	try {
		const [handle] = await window.showOpenFilePicker({ types: FILE_TYPES });
		const file = await handle.getFile(), o = JSON.parse(await file.text());
		const base = String(o.name || file.name.replace(/\.design\.json$|\.json$/, '')); let n = base, i = 2;
		while (db.designs[n]) n = base + ' ' + i++;
		db.designs[n] = designFromObject(o, n);
		persist();
		await idbSet(n, handle);
		openDesign(n);
	} catch (e) {
		if (e && e.name !== 'AbortError') toast('Could not open the file: ' + e.message);
	}
}

async function restoreLink() {
	const name = cur.name;
	try {
		const handle = await idbGet(name);
		if (handle && cur && cur.name === name) {
			const perm = await handle.queryPermission({ mode: 'readwrite' });
			fileLink = { handle, state: perm === 'granted' ? 'ready' : 'paused' };
		}
		renderStatus();
	} catch (e) { /* no stored link, or this browser has no file access */ }
}

function fileStatus() {
	if (!fileLink) return null;
	if (fileLink.state === 'ready') return { text: '● ' + fileLink.handle.name + (fileLink.saved ? ' · saved ' + new Date(fileLink.saved).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''), cls: 'ok', tip: 'This file is rewritten after every change. Click to save now.' };
	if (fileLink.state === 'paused') return { text: '○ ' + fileLink.handle.name + ' · click to reconnect', cls: 'warn', tip: 'The browser needs your permission again before it can write this file.' };
	return { text: '▲ ' + fileLink.handle.name + ' · could not save', cls: 'bad', tip: 'Click to try again.' };
}

// ------------------------------------------------------------------------------------------------ hooks called by the editor

function onDesignOpened() {
	fileLink = null;
	snapshotVersion('Auto');
	clearInterval(autoTimer);
	autoTimer = setInterval(() => { if (cur && dirty) snapshotVersion('Auto'); }, 5 * 60 * 1000);
	if (fsOK) restoreLink();
}

function onDesignClosing() {
	if (dirty) snapshotVersion('Auto');
	clearInterval(autoTimer); clearTimeout(fileTimer);
	fileLink = null;
}

function onDesignRenamed(oldName, name) {
	const all = readJson(VERS, {});
	if (all[oldName]) { all[name] = all[oldName]; delete all[oldName]; writeJson(VERS, all); }
	if (fsOK) idbGet(oldName).then(h => h && idbSet(name, h).then(() => idbDel(oldName))).catch(() => {});
}

// ask the browser not to clear stored designs when space runs low
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
