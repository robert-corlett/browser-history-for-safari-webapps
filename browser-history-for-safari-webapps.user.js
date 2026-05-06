// ==UserScript==
// @name        Browsing History for MacOS 'Add to Dock' web apps
// @version     1.0
// @description Provides the missing browsing history functionality for the 'Add to Dock' style webapps introduced in MacOS Sonoma. Use this script with the "Userscripts" Safari extension [https://github.com/quoid/userscripts]. Install "Userscripts" from the App Store [https://itunes.apple.com/us/app/userscripts/id1463298887]. Enable the Userscripts extension in your web app's settings under Settings > Extensions. Add this script, and modify the @match parameter below to same root domain as your web app. This userscript records browsing history (URL, title, visit date & time) using GM storage APIs. All data is stored locally within the Userscripts extension sandbox and is not shared with any other domain or extension. To view history, press the keyboard shortcut (default CMD + SHIFT + H) at anytime. A panel will open showing your browsing history for that app, with options to search, navigate, or clear history. Development notes can be found at the bottom of this script.
// @match       *://*.your-webapps-domain.com/*
// @run-at      document-start
// @noframes
// @grant       GM.getValue
// @grant       GM.setValue
// @grant       GM.deleteValue
// @grant       GM.listValues
// ==/UserScript==


//
// ─── How to use ────────────────────────────────────────────────────────────
//   • Press the keyboard shortcut (default ⌘⇧H) anywhere in the web app to
//     open the history panel. Press it again or ESC to close.
//   • Type to filter by title or URL. ↑/↓ to move selection, ↵ to navigate.
//   • Click any entry to jump to it. The "Clear" button wipes all history.
//   • Replace mywebappdomain.com in @match above with your actual domain.
//   • Tweak the CONFIG block below to change shortcut, limits, or behavior.
// ───────────────────────────────────────────────────────────────────────────

(function () {
	'use strict';

	// ============ CONFIG ============================================
	const CONFIG = {
		MAX_ENTRIES: 5000,									// hard cap to avoid unbounded growth
		SHORTCUT: { key: 'h', meta: true, shift: true, ctrl: false, alt: false }, // toggle panel shortcut
		PANEL_WIDTH:   'min(950px, 92vw)',	// max width of the panel
		TIME_COLOR: '#4eff54', 		 			 // timestamp text color
		TODAY_COLOR: '#f0f646',					 // "Today" label color
		YESTERDAY_COLOR: '#e75fff',			 // "Yesterday" label color
		URL_COLOR: '#6bfcf0',			 			 // URL text color
		TITLE_COLOR: '#f2f2f7',					 // title text color
		TIME_FONTSIZE: '13.5px',						// timestamp font size
		URL_FONTSIZE: '12.5px',				 			// URL font size
		TITLE_FONTSIZE: '16px',			   			// title font size
		STORAGE_KEY:   'wh_entries',
		COUNTER_KEY:   'wh_counter',
		TRACK_SPA:     true,                // also record pushState/replaceState/hashchange
		DEDUPE_CONSECUTIVE: true,						// skip if same URL as the previous entry
		RECORD_DELAY_MS: 250								// wait this long for SPA to set <title> before saving
	};
	// ================================================================

	let lastRecordedUrl = null;
	let recording       = false;

	// ---------- Storage helpers ----------------------------------
	// We JSON-stringify ourselves because some GM implementations store
	// primitives only — this keeps behavior consistent.
	async function getEntries() {
		const v = await GM.getValue(CONFIG.STORAGE_KEY, '[]');
		if (Array.isArray(v)) return v;
		if (typeof v === 'string') {
			try { return JSON.parse(v); } catch { return []; }
		}
		return [];
	}
	async function setEntries(arr) {
		await GM.setValue(CONFIG.STORAGE_KEY, JSON.stringify(arr));
	}
	async function nextIndex() {
		const raw = await GM.getValue(CONFIG.COUNTER_KEY, '0');
		const cur = parseInt(typeof raw === 'number' ? String(raw) : raw, 10) || 0;
		const n = cur + 1;
		await GM.setValue(CONFIG.COUNTER_KEY, String(n));
		return n;
	}

	// ---------- Recording ---------------------------------------
	async function recordVisit() {
		if (recording) return;
		recording = true;
		try {
			const url   = location.href;
			const title = document.title || url;

			if (CONFIG.DEDUPE_CONSECUTIVE && lastRecordedUrl === url) return;

			const entries = await getEntries();
			const last = entries[entries.length - 1];
			if (CONFIG.DEDUPE_CONSECUTIVE && last && last.url === url) {
				lastRecordedUrl = url;
				return;
			}

			const entry = {
				index:     await nextIndex(),
				url,
				title,
				timestamp: Date.now()
			};
			entries.push(entry);

			if (entries.length > CONFIG.MAX_ENTRIES) {
				entries.splice(0, entries.length - CONFIG.MAX_ENTRIES);
			}

			await setEntries(entries);
			lastRecordedUrl = url;
		} catch (e) {
			console.error('[webapp-history] record error:', e);
		} finally {
			recording = false;
		}
	}

	function scheduleRecord() {
		const fire = () => setTimeout(recordVisit, CONFIG.RECORD_DELAY_MS);
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', fire, { once: true });
		} else {
			fire();
		}
	}

	function hookSpaNavigation() {
		if (!CONFIG.TRACK_SPA) return;
		const fire = () => setTimeout(recordVisit, CONFIG.RECORD_DELAY_MS);

		const origPush = history.pushState;
		history.pushState = function () {
			const r = origPush.apply(this, arguments); fire(); return r;
		};
		const origReplace = history.replaceState;
		history.replaceState = function () {
			const r = origReplace.apply(this, arguments); fire(); return r;
		};
		window.addEventListener('popstate', fire);
		window.addEventListener('hashchange', fire);
	}

	// ---------- Panel UI ----------------------------------------
	const ROOT_ID = 'wh-history-root';
	const panelState = { open: false, filter: '', selected: 0, items: [] };

	function buildPanel() {
		if (document.getElementById(ROOT_ID)) return;

		const css = `
			#${ROOT_ID}, #${ROOT_ID} * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; }
			#${ROOT_ID} { position: fixed; inset: 0; z-index: 2147483647; display: none; align-items: flex-start; justify-content: center; padding-top: 10vh; background: rgba(0,0,0,0.55); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
			#${ROOT_ID}.wh-open { display: flex; }
			#${ROOT_ID} .wh-panel { width: ${CONFIG.PANEL_WIDTH}; max-height: 75vh; background: #1c1c1e; color: #f2f2f7; border-radius: 14px; box-shadow: 0 25px 80px rgba(0,0,0,0.7); display: flex; flex-direction: column; overflow: hidden; border: 1px solid #2c2c2e; }
			#${ROOT_ID} .wh-header { display: flex; gap: 8px; padding: 12px; border-bottom: 1px solid #2c2c2e; align-items: center; }
			#${ROOT_ID} .wh-search { flex: 1; background: #2c2c2e; border: 1px solid transparent; color: #f2f2f7; padding: 8px 12px; border-radius: 8px; font-size: 14px; outline: none; }
			#${ROOT_ID} .wh-search:focus { border-color: #0a84ff; }
			#${ROOT_ID} .wh-search::placeholder { color: #8e8e93; }
			#${ROOT_ID} .wh-btn { background: #2c2c2e; border: 1px solid transparent; color: #f2f2f7; padding: 7px 12px; border-radius: 8px; cursor: pointer; font-size: 13px; }
			#${ROOT_ID} .wh-btn:hover { background: #3a3a3c; }
			#${ROOT_ID} .wh-close { padding: 4px 10px; font-size: 18px; line-height: 1; }
			#${ROOT_ID} .wh-list { flex: 1; overflow-y: auto; }
			#${ROOT_ID} .wh-entry { padding: 10px 16px; cursor: pointer; border-left: 3px solid transparent; }
			#${ROOT_ID} .wh-entry:hover { background: #12121e; }
			#${ROOT_ID} .wh-entry.wh-sel { background: #0a3d6e; border-left-color: #0a84ff; }
			#${ROOT_ID} .wh-title { font-size: ${CONFIG.TITLE_FONTSIZE}; color: ${CONFIG.TITLE_COLOR}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			#${ROOT_ID} .wh-url   { font-size: ${CONFIG.URL_FONTSIZE}; color: ${CONFIG.URL_COLOR}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
			#${ROOT_ID} .wh-time  { font-size: ${CONFIG.TIME_FONTSIZE}; color: ${CONFIG.TIME_COLOR}; margin-top: 2px; }
			#${ROOT_ID} .wh-time .today     { color: ${CONFIG.TODAY_COLOR}; }
			#${ROOT_ID} .wh-time .yesterday { color: ${CONFIG.YESTERDAY_COLOR}; }
			#${ROOT_ID} .wh-empty { padding: 40px; text-align: center; color: #8e8e93; font-size: 13px; }
			#${ROOT_ID} .wh-footer { display: flex; justify-content: space-between; padding: 8px 16px; border-top: 1px solid #2c2c2e; font-size: 11px; color: #8e8e93; }
			#${ROOT_ID} mark { background: rgba(255, 214, 10, 0.35); color: inherit; padding: 0 1px; border-radius: 2px; }
		`;
		const style = document.createElement('style');
		style.textContent = css;
		document.documentElement.appendChild(style);

		const root = document.createElement('div');
		root.id = ROOT_ID;
		root.innerHTML = `
			<div class="wh-panel" role="dialog" aria-label="Browsing history">
				<div class="wh-header">
					<input class="wh-search" type="text" placeholder="Search history…" autocomplete="off" spellcheck="false">
					<button class="wh-btn wh-clear" title="Clear all history">Clear</button>
					<button class="wh-btn wh-close" title="Close">×</button>
				</div>
				<div class="wh-list"></div>
				<div class="wh-footer">
					<span class="wh-count"></span>
					<span class="wh-hint">↑↓ navigate · ↵ open · Esc close</span>
				</div>
			</div>`;
		document.documentElement.appendChild(root);

		const $search = root.querySelector('.wh-search');
		const $list   = root.querySelector('.wh-list');
		const $clear  = root.querySelector('.wh-clear');
		const $close  = root.querySelector('.wh-close');

		$search.addEventListener('input', () => {
			panelState.filter   = $search.value;
			panelState.selected = 0;
			renderList();
		});

		$list.addEventListener('click', (e) => {
			const el = e.target.closest('.wh-entry');
			if (!el) return;
			const item = panelState.items[parseInt(el.dataset.idx, 10)];
			if (item) navigateTo(item.url);
		});

		$clear.addEventListener('click', async () => {
			if (!confirm('Clear all browsing history? This cannot be undone.')) return;
			await GM.deleteValue(CONFIG.STORAGE_KEY);
			await GM.deleteValue(CONFIG.COUNTER_KEY);
			lastRecordedUrl = null;
			panelState.items = [];
			panelState.selected = 0;
			renderList();
		});

		$close.addEventListener('click', closePanel);

		// Click on the dim background (not the panel itself) closes
		root.addEventListener('click', (e) => { if (e.target === root) closePanel(); });
	}

	function navigateTo(url) {
		closePanel();
		if (url === location.href) location.reload();
		else location.href = url;
	}

	// ---------- Render & format helpers ----------
	function escapeHtml(s) {
		return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
	}
	function escapeRegex(s) {
		return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
	function highlight(text, query) {
		const safe = escapeHtml(text);
		if (!query) return safe;
		const re = new RegExp(escapeRegex(query), 'gi');
		return safe.replace(re, m => `<mark>${m}</mark>`);
	}
	function formatTime(ts) {
		const d   = new Date(ts);
		const now = new Date();
		const sameDay = d.toDateString() === now.toDateString();
		const y = new Date(now); y.setDate(y.getDate() - 1);
		const isYesterday = d.toDateString() === y.toDateString();
		const time = escapeHtml(d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
		if (sameDay)     return `<span class="today">Today</span>, ${time}`;
		if (isYesterday) return `<span class="yesterday">Yesterday</span>, ${time}`;
		const dateOpts = { month: 'short', day: 'numeric' };
		if (d.getFullYear() !== now.getFullYear()) dateOpts.year = 'numeric';
		return `${escapeHtml(d.toLocaleDateString([], dateOpts))}, ${time}`;
	}

	async function renderList() {
		const root = document.getElementById(ROOT_ID);
		if (!root) return;
		const $list  = root.querySelector('.wh-list');
		const $count = root.querySelector('.wh-count');

		const all = await getEntries();
		const q   = panelState.filter.trim().toLowerCase();
		let items = all.slice().reverse(); // newest first
		if (q) {
			items = items.filter(e =>
				(e.title || '').toLowerCase().includes(q) ||
				(e.url   || '').toLowerCase().includes(q)
			);
		}
		panelState.items = items;
		if (panelState.selected >= items.length) {
			panelState.selected = Math.max(0, items.length - 1);
		}

		if (items.length === 0) {
			$list.innerHTML = `<div class="wh-empty">${q ? 'No matches.' : 'No history entries yet.'}</div>`;
		} else {
			$list.innerHTML = items.map((e, i) => `
				<div class="wh-entry ${i === panelState.selected ? 'wh-sel' : ''}" data-idx="${i}">
					<div class="wh-title">${highlight(e.title || e.url, panelState.filter)}</div>
					<div class="wh-url">${highlight(e.url, panelState.filter)}</div>
					<div class="wh-time">${formatTime(e.timestamp)}</div>
				</div>
			`).join('');
		}

		$count.textContent =
			`${items.length} ${items.length === 1 ? 'entry' : 'entries'}` +
			(q ? ` matching "${panelState.filter}"` : '');
	}

	function ensureSelectedVisible() {
		const root = document.getElementById(ROOT_ID);
		if (!root) return;
		const sel = root.querySelector('.wh-entry.wh-sel');
		if (sel) sel.scrollIntoView({ block: 'nearest' });
	}

	function openPanel() {
		buildPanel();
		const root = document.getElementById(ROOT_ID);
		root.classList.add('wh-open');
		panelState.open     = true;
		panelState.filter   = '';
		panelState.selected = 0;
		const $search = root.querySelector('.wh-search');
		$search.value = '';
		renderList().then(() => $search.focus());
	}
	function closePanel() {
		const root = document.getElementById(ROOT_ID);
		if (root) root.classList.remove('wh-open');
		panelState.open = false;
	}

	// ---------- Shortcut & keyboard handling ----------
	function matchesShortcut(e, sc) {
		return (
			e.key.toLowerCase() === sc.key.toLowerCase() &&
			!!e.metaKey  === !!sc.meta  &&
			!!e.ctrlKey  === !!sc.ctrl  &&
			!!e.shiftKey === !!sc.shift &&
			!!e.altKey   === !!sc.alt
		);
	}

	function onKeyDown(e) {
		if (matchesShortcut(e, CONFIG.SHORTCUT)) {
			e.preventDefault();
			e.stopPropagation();
			panelState.open ? closePanel() : openPanel();
			return;
		}
		if (!panelState.open) return;

		if (e.key === 'Escape') {
			e.preventDefault();
			closePanel();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (panelState.selected < panelState.items.length - 1) {
				panelState.selected++;
				renderList().then(ensureSelectedVisible);
			}
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (panelState.selected > 0) {
				panelState.selected--;
				renderList().then(ensureSelectedVisible);
			}
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const item = panelState.items[panelState.selected];
			if (item) navigateTo(item.url);
		}
	}

	function installUI() {
		if (document.body) buildPanel();
		else document.addEventListener('DOMContentLoaded', buildPanel, { once: true });
		// capture phase so the page can't swallow our shortcut
		window.addEventListener('keydown', onKeyDown, true);
	}

	// ---------- Bootstrap ----------
	scheduleRecord();
	hookSpaNavigation();
	installUI();
})();