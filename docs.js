'use strict';
// The in-app documentation: renders the text in docs-content.js (a copy of README.md) in a window.

const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// A small Markdown reader: headings, paragraphs, bullet and numbered lists, code blocks, `code` and **bold**.
function renderMarkdown(md) {
	const out = document.createDocumentFragment();
	const lines = md.split('\n');
	const inline = (text) => text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).filter(Boolean).map(part =>
		part.startsWith('`') ? el('code', {}, part.slice(1, -1))
		: part.startsWith('**') ? el('strong', {}, part.slice(2, -2))
		: part);
	const startsBlock = (l) => /^(#{1,3} |- |\d+\. |```)/.test(l);
	for (let i = 0; i < lines.length;) {
		const l = lines[i];
		if (l.startsWith('```')) {
			const code = [];
			for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
			i++;
			out.append(el('pre', {}, el('code', {}, code.join('\n'))));
		} else if (/^#{1,3} /.test(l)) {
			const [, hashes, text] = /^(#+) (.*)$/.exec(l);
			out.append(el('h' + hashes.length, { id: 'doc-' + slug(text) }, inline(text)));
			i++;
		} else if (/^(- |\d+\. )/.test(l)) {
			const list = el(l.startsWith('- ') ? 'ul' : 'ol');
			for (; i < lines.length && /^(- |\d+\. )/.test(lines[i]); i++) {
				let text = lines[i].replace(/^(- |\d+\. )/, '');
				while (i + 1 < lines.length && lines[i + 1].startsWith('  ')) text += ' ' + lines[++i].trim();
				list.append(el('li', {}, inline(text)));
			}
			out.append(list);
		} else if (!l.trim()) {
			i++;
		} else {
			const para = [];
			for (; i < lines.length && lines[i].trim() && !startsBlock(lines[i]); i++) para.push(lines[i]);
			out.append(el('p', {}, inline(para.join(' '))));
		}
	}
	return out;
}

function openDocs() {
	const body = $('#docsBody');
	body.replaceChildren();
	const content = el('div', { class: 'doc-content' });
	content.append(renderMarkdown(DOCS_MD));
	const nav = el('nav', { class: 'doc-nav' });
	for (const h of content.querySelectorAll('h2')) {
		nav.append(el('button', { onclick: () => h.scrollIntoView({ block: 'start' }) }, h.textContent));
		for (const sub of [...(function* () {
			for (let n = h.nextElementSibling; n && n.tagName !== 'H2'; n = n.nextElementSibling) if (n.tagName === 'H3') yield n;
		})()]) nav.append(el('button', { class: 'sub', onclick: () => sub.scrollIntoView({ block: 'start' }) }, sub.textContent));
	}
	body.append(
		el('div', { class: 'modal-head' }, el('h2', {}, 'Documentation'), el('span', { class: 'spacer' }), el('button', { onclick: () => { $('#docs').hidden = true; } }, '✕')),
		el('div', { class: 'doc-layout' }, nav, content));
	$('#docs').hidden = false;
	content.scrollTop = 0;
}

$('#docsMenuBtn').addEventListener('click', openDocs);
$('#docs').addEventListener('click', (e) => { if (e.target.id === 'docs') $('#docs').hidden = true; });
