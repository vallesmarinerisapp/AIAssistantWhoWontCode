// static/scripts.js

// Client-side logic for AI Code Assistant who won't write code
// Implements File System Access API interactions, file list, preview, and chat flow.

(() => {
  // Configuration
  const DEFAULT_MAX_CHARS_PER_FILE = 50000;
  const SAMPLE_READ_BYTES = 1024;
  const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build']);
  const ALLOWED_EXTENSIONS = new Set([
    '.py', '.js', '.ts', '.java', '.go', '.md', '.txt',
    'Dockerfile', 'package.json', 'pyproject.toml', 'requirements.txt'
  ]);

  // In-memory session state
  const state = {
    selectedFiles: [], // { path, handle, name, size, mime, included, contentCached?, truncated? }
    conversation: [] // { role: 'user'|'assistant', text, timestamp }
  };

  // DOM references (IDs expected to exist in index.html)
  const el = {
    openFolderBtn: document.getElementById('openFolderBtn'),
    includeRepoCheckbox: document.getElementById('includeRepoCheckbox'),
    selectFilesBtn: document.getElementById('selectFilesBtn'),
    clearSelectionBtn: document.getElementById('clearSelectionBtn'),
    readWholeRepoBtn: document.getElementById('readWholeRepoBtn'),
    fileList: document.getElementById('fileList'),
    chatContainer: document.getElementById('chatContainer'),
    messageInput: document.getElementById('messageInput'),
    sendBtn: document.getElementById('sendBtn'),
    spinner: document.getElementById('spinner'),
    previewPane: document.getElementById('previewPane'),
    toneSelect: document.getElementById('toneSelect'),
    requestTiming: document.getElementById('requestTiming'),
    allowPseudoCheckbox: document.getElementById('allowPseudoCheckbox')
  };

  // Fallback-safe getters for elements that may not be present
  for (const key of Object.keys(el)) {
    if (!el[key]) {
      // create minimal placeholders for a few used elements like spinner/requestTiming if not present
      if (key === 'spinner') {
        const s = document.createElement('div');
        s.id = 'spinner';
        s.classList.add('hidden');
        document.body.appendChild(s);
        el.spinner = s;
      } else if (key === 'requestTiming') {
        const r = document.createElement('div');
        r.id = 'requestTiming';
        r.classList.add('small');
        document.body.appendChild(r);
        el.requestTiming = r;
      } else {
        // other elements we'll handle with guards
        el[key] = null;
      }
    }
  }

  // Utility helpers
  const nowISO = () => new Date().toISOString();
  const fmtBytes = (n) => {
    if (n === undefined || n === null) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round((n / 1024) * 10) / 10} KB`;
    return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;
  };

  function supportsFileSystemAccess() {
    return typeof window.showDirectoryPicker === 'function' || typeof window.showOpenFilePicker === 'function';
  }

  // Read file content with truncation and binary detection
  async function readFileContent(handle, maxChars = DEFAULT_MAX_CHARS_PER_FILE) {
    try {
      const file = await handle.getFile();
      // Rough binary detection: read first SAMPLE_READ_BYTES and check for null bytes
      let truncated = false;
      try {
        const headBlob = file.slice(0, SAMPLE_READ_BYTES);
        const headBuf = await headBlob.arrayBuffer();
        const view = new Uint8Array(headBuf);
        for (let i = 0; i < view.length; i++) {
          if (view[i] === 0) {
            // null byte detected => binary
            return { content: null, truncated: false, isBinary: true, size: file.size };
          }
        }
      } catch (e) {
        console.error('Binary detection failed: ' + e);
        // continue and try to read text
      }

      // Read full text
      let text = await file.text();
      if (text.length > maxChars) {
        truncated = true;
        text = text.slice(0, maxChars);
      }
      return { content: text, truncated, isBinary: false, size: file.size };
    } catch (err) {
      console.error('readFileContent failed: ' + err);
      return { content: null, truncated: false, isBinary: false, size: null, error: String(err) };
    }
  }

  // Traverse directory recursively and populate selectedFiles
  async function traverseDirectory(dirHandle, options = { basePath: '', includeRepo: true }) {
    const basePath = options.basePath || '';
    const includeRepo = Boolean(options.includeRepo);
    const queue = [{ handle: dirHandle, path: basePath }];
    const foundFiles = [];

    while (queue.length) {
      const { handle, path } = queue.shift();
      try {
        for await (const [name, entryHandle] of handle.entries()) {
          try {
            const entryPath = path ? `${path}/${name}` : name;

            if (entryHandle.kind === 'directory') {
              if (!includeRepo && IGNORED_DIRS.has(name)) {
                // skip traversal of ignored dir
                continue;
              }
              queue.push({ handle: entryHandle, path: entryPath });
            } else if (entryHandle.kind === 'file') {
              // filter by extension / name
              const lowerName = name.toLowerCase();
              const ext = (() => {
                if (name === 'Dockerfile') return 'Dockerfile';
                if (name === 'package.json') return 'package.json';
                if (name === 'pyproject.toml') return 'pyproject.toml';
                if (name === 'requirements.txt') return 'requirements.txt';
                const idx = lowerName.lastIndexOf('.');
                return idx >= 0 ? lowerName.slice(idx) : '';
              })();

              if (!ALLOWED_EXTENSIONS.has(ext)) {
                // skip unsupported extension
                continue;
              }

              // get file handle and metadata
              let fileHandle = entryHandle;
              try {
                const file = await fileHandle.getFile();
                const size = file.size;
                const mime = file.type || '';
                foundFiles.push({
                  path: entryPath,
                  handle: fileHandle,
                  name,
                  size,
                  mime,
                  included: includeRepo, // if includeRepo flag true mean auto-include, else default false
                  contentCached: null,
                  truncated: false
                });
              } catch (e) {
                console.error('Error accessing file handle for ' + entryPath + ': ' + e);
              }
            }
          } catch (e) {
            console.error('Error iterating entry in dirTraversal: ' + e);
          }
        }
      } catch (e) {
        console.error('Error reading directory entries: ' + e);
      }
    }

    return foundFiles;
  }

  // Allows user to pick a directory and populate file list
  async function pickDirectory() {
    if (!supportsFileSystemAccess()) {
      alert('File System Access API is not supported in this browser.');
      return;
    }
    try {
      const dirHandle = await window.showDirectoryPicker();
      const includeRepo = el.includeRepoCheckbox ? el.includeRepoCheckbox.checked : true;
      const files = await traverseDirectory(dirHandle, { basePath: dirHandle.name || '', includeRepo });
      // Merge with existing selectedFiles (preserve handles if duplicates)
      // We'll replace current selection for simplicity
      state.selectedFiles = files;
      renderFileList();
    } catch (err) {
      console.error('Directory pick failed: ' + err);
    }
  }

  // Allows user to pick individual files (alternative)
  async function pickFiles() {
    if (!supportsFileSystemAccess() || typeof window.showOpenFilePicker !== 'function') {
      alert('File picker not available in this browser.');
      return;
    }
    try {
      const handles = await window.showOpenFilePicker({ multiple: true });
      for (const handle of handles) {
        try {
          const file = await handle.getFile();
          const name = file.name;
          const size = file.size;
          const mime = file.type || '';
          const ext = (() => {
            if (name === 'Dockerfile') return 'Dockerfile';
            if (name === 'package.json') return 'package.json';
            if (name === 'pyproject.toml') return 'pyproject.toml';
            if (name === 'requirements.txt') return 'requirements.txt';
            const idx = name.toLowerCase().lastIndexOf('.');
            return idx >= 0 ? name.toLowerCase().slice(idx) : '';
          })();

          if (!ALLOWED_EXTENSIONS.has(ext)) {
            console.log('Skipping unsupported file type: ' + name);
            continue;
          }

          const path = name;
          state.selectedFiles.push({
            path,
            handle,
            name,
            size,
            mime,
            included: true,
            contentCached: null,
            truncated: false
          });
        } catch (e) {
          console.error('Error processing picked file: ' + e);
        }
      }
      renderFileList();
    } catch (err) {
      console.error('File pick failed: ' + err);
    }
  }

  // Render the file list UI
  function renderFileList() {
    if (!el.fileList) return;
    el.fileList.innerHTML = '';
    if (!state.selectedFiles.length) {
      const p = document.createElement('div');
      p.className = 'annotations';
      p.innerText = 'No files selected. Click "Open Folder" to choose a repository.';
      el.fileList.appendChild(p);
      return;
    }

    for (const f of state.selectedFiles) {
      const row = document.createElement('div');
      row.className = 'file-row' + (f.included ? ' included' : '');
      row.tabIndex = 0;

      // icon
      const icon = document.createElement('div');
      icon.className = 'icon';
      icon.innerText = f.name && f.name[0] ? f.name[0].toUpperCase() : 'F';

      // meta
      const meta = document.createElement('div');
      meta.className = 'meta';
      const pathEl = document.createElement('div');
      pathEl.className = 'path';
      pathEl.innerText = f.path;
      pathEl.style.cursor = 'pointer';
      pathEl.addEventListener('click', (e) => {
        e.stopPropagation();
        openPreview(f.path);
      });

      const small = document.createElement('div');
      small.className = 'small';
      small.innerText = `${f.name} • ${fmtBytes(f.size)}`;

      meta.appendChild(pathEl);
      meta.appendChild(small);

      const badges = document.createElement('div');
      badges.className = 'badges';

      if (f.truncated) {
        const badge = document.createElement('div');
        badge.className = 'badge truncated';
        badge.innerText = 'TRUNCATED';
        badges.appendChild(badge);

        const fullBtn = document.createElement('button');
        fullBtn.className = 'btn secondary';
        fullBtn.innerText = 'Fetch full';
        fullBtn.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          const proceed = confirm('Fetching full file may include large content and increase token usage. Continue?');
          if (!proceed) return;
          showSpinner(true);
          try {
            const res = await f.handle.getFile();
            // full read
            const fullText = await res.text();
            f.contentCached = fullText;
            f.truncated = false;
            renderFileList();
            // If this preview is currently open, refresh it
            const current = getCurrentPreviewPath();
            if (current === f.path) openPreview(f.path, /*forceRefresh=*/true);
          } catch (e) {
            console.error('Fetching full file failed: ' + e);
            alert('Failed to fetch full file: ' + e);
          } finally {
            showSpinner(false);
          }
        });
        badges.appendChild(fullBtn);
      }

      // include checkbox
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!f.included;
      cb.addEventListener('change', (ev) => {
        f.included = cb.checked;
        row.classList.toggle('included', cb.checked);
      });

      const rightCol = document.createElement('div');
      rightCol.style.display = 'flex';
      rightCol.style.flexDirection = 'column';
      rightCol.style.alignItems = 'flex-end';
      rightCol.style.gap = '6px';
      rightCol.appendChild(cb);
      rightCol.appendChild(badges);

      row.appendChild(icon);
      row.appendChild(meta);
      row.appendChild(rightCol);

      // clicking row opens preview
      row.addEventListener('click', () => openPreview(f.path));

      el.fileList.appendChild(row);
    }
  }

  function getCurrentPreviewPath() {
    const cur = el.previewPane && el.previewPane.dataset ? el.previewPane.dataset.currentPath : null;
    return cur || null;
  }

  // Open preview pane for a given file path
  async function openPreview(filePath, forceRefresh = false) {
    if (!el.previewPane) return;
    const f = state.selectedFiles.find((x) => x.path === filePath || x.name === filePath);
    if (!f) {
      // show not found
      el.previewPane.innerHTML = `<div class="annotations">File not found in selection: ${filePath}</div>`;
      return;
    }

    el.previewPane.dataset.currentPath = f.path;

    // Build header and actions
    el.previewPane.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'preview-header';
    const title = document.createElement('div');
    title.className = 'preview-title';
    title.innerText = f.path;
    const actions = document.createElement('div');
    actions.className = 'preview-actions';
    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'btn secondary';
    refreshBtn.innerText = 'Refresh';
    refreshBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await loadAndShowFile(f, true);
    });
    actions.appendChild(refreshBtn);
    header.appendChild(title);
    header.appendChild(actions);

    const previewContent = document.createElement('div');
    previewContent.className = 'preview-content';
    const gutter = document.createElement('div');
    gutter.className = 'gutter';
    gutter.innerText = '';
    const pre = document.createElement('pre');
    pre.innerText = 'Loading...';

    previewContent.appendChild(gutter);
    previewContent.appendChild(pre);

    const footer = document.createElement('div');
    footer.className = 'preview-footer';
    footer.innerText = '';

    el.previewPane.appendChild(header);
    el.previewPane.appendChild(previewContent);
    el.previewPane.appendChild(footer);

    // Load file content (cached or fetch)
    await loadAndShowFile(f, forceRefresh);
  }

  async function loadAndShowFile(f, forceRefresh = false) {
    if (!el.previewPane) return;
    const pre = el.previewPane.querySelector('pre');
    const gutter = el.previewPane.querySelector('.gutter');
    const footer = el.previewPane.querySelector('.preview-footer');
    if (!pre || !gutter || !footer) return;

    if (f.contentCached && !forceRefresh) {
      // show cached
      showPreviewText(f.path, f.contentCached, f.truncated, f.size, pre, gutter, footer);
      return;
    }

    showSpinner(true);
    try {
      const res = await readFileContent(f.handle, DEFAULT_MAX_CHARS_PER_FILE);
      if (res.isBinary) {
        pre.innerText = '[Binary file cannot be previewed]';
        gutter.innerText = '';
        footer.innerText = `Size: ${fmtBytes(res.size)}`;
        f.contentCached = null;
        f.truncated = false;
        return;
      }
      if (res.error) {
        pre.innerText = '[Error reading file: ' + res.error + ']';
        gutter.innerText = '';
        footer.innerText = `Size: ${fmtBytes(res.size)}`;
        return;
      }
      f.contentCached = res.content;
      f.truncated = !!res.truncated;
      showPreviewText(f.path, f.contentCached, f.truncated, res.size, pre, gutter, footer);
      renderFileList(); // update truncated badge state
    } catch (e) {
      console.error('Error loading file for preview: ' + e);
      pre.innerText = '[Error loading file preview]';
    } finally {
      showSpinner(false);
    }
  }

  function showPreviewText(path, text, truncated, size, preEl, gutterEl, footerEl) {
    const lines = (text || '').split(/\r\n|\n/);
    preEl.innerText = text || '';
    // build line numbers in gutter (simple)
    let gutterText = '';
    const maxLines = Math.min(lines.length, 10000); // guard
    for (let i = 0; i < maxLines; i++) {
      gutterText += (i + 1) + '\n';
    }
    gutterEl.innerText = gutterText;
    footerEl.innerHTML = `Size: ${fmtBytes(size)} ${truncated ? '<span class="preview-truncated">TRUNCATED</span>' : ''}`;
  }

  // Read whole repo action: mark all files included (respect ignored)
  function readWholeRepoAction() {
    for (const f of state.selectedFiles) {
      f.included = true;
    }
    renderFileList();
  }

  // Clear selection
  function clearSelection() {
    state.selectedFiles = [];
    renderFileList();
    if (el.previewPane) el.previewPane.innerHTML = '<div class="annotations">No file selected.</div>';
  }

  // Send chat query to backend API
  async function sendChat() {
    if (!el.messageInput || !el.chatContainer) return;
    const query = el.messageInput.value.trim();
    if (!query) return;
    // Add user message locally
    const userMsg = { role: 'user', text: query, timestamp: nowISO() };
    state.conversation.push(userMsg);
    renderChatMessage(userMsg);
    el.messageInput.value = '';
    // Build payload
    const includedFiles = state.selectedFiles.filter((f) => f.included);
    // Show spinner and timing
    const startTime = Date.now();
    showSpinner(true);
    if (el.requestTiming) el.requestTiming.innerText = 'Request started...';
    // Ensure contents fetched for included files
    const filesPayload = [];
    for (const f of includedFiles) {
      try {
        if (f.contentCached === null || f.contentCached === undefined) {
          const res = await readFileContent(f.handle, DEFAULT_MAX_CHARS_PER_FILE);
          if (res.isBinary) {
            // skip binary file but include metadata
            filesPayload.push({ path: f.path, size: res.size || f.size, content: '', truncated: false });
            f.contentCached = null;
            f.truncated = false;
            continue;
          }
          f.contentCached = res.content;
          f.truncated = !!res.truncated;
        }
        filesPayload.push({ path: f.path, size: f.size, content: f.contentCached || '', truncated: !!f.truncated });
      } catch (e) {
        console.error('Failed to read included file: ' + e);
        filesPayload.push({ path: f.path, size: f.size, content: '', truncated: false });
      }
    }

    const payload = {
      query,
      files: filesPayload,
      options: {
        allow_pseudocode: el.allowPseudoCheckbox ? !!el.allowPseudoCheckbox.checked : true,
        tone: el.toneSelect ? (el.toneSelect.value || 'concise') : 'concise'
      }
    };

    try {
      const resp = await sendQuery(payload);
      const durationMs = Date.now() - startTime;
      if (el.requestTiming) el.requestTiming.innerText = `Response in ${Math.round(durationMs)} ms`;
      if (!resp) {
        renderAssistantError('Empty response from server.');
      } else if (resp.error) {
        renderAssistantError('Server error: ' + resp.error);
      } else {
        const assistantText = resp.assistant || '';
        const assistantMsg = { role: 'assistant', text: assistantText, timestamp: nowISO() };
        state.conversation.push(assistantMsg);
        renderChatMessage(assistantMsg);
      }
    } catch (err) {
      console.error('Chat send failed: ' + err);
      renderAssistantError('Network error: ' + err);
      if (el.requestTiming) el.requestTiming.innerText = '';
    } finally {
      showSpinner(false);
    }
  }

  // Do fetch to api/query
  async function sendQuery(payload) {
    try {
      const res = await fetch('api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok) {
        let msg = `${res.status} ${res.statusText}`;
        try {
          if (contentType.includes('application/json')) {
            const json = await res.json();
            msg = json.error || JSON.stringify(json);
          } else {
            const txt = await res.text();
            msg = txt || msg;
          }
        } catch (e) {
          // ignore
        }
        return { error: msg };
      }
      if (contentType.includes('application/json')) {
        const json = await res.json();
        return json;
      } else {
        const txt = await res.text();
        return { assistant: txt };
      }
    } catch (err) {
      console.error('Fetch api/query failed: ' + err);
      throw err;
    }
  }

  // Render a chat message in the UI (user or assistant)
  function renderChatMessage(msg) {
    if (!el.chatContainer) return;
    const msgEl = document.createElement('div');
    msgEl.className = 'message ' + (msg.role === 'user' ? 'user' : 'assistant');

    // parse and convert file references for assistant messages
    if (msg.role === 'assistant') {
      const nodes = parseAssistantTextToNodes(msg.text);
      for (const n of nodes) msgEl.appendChild(n);
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.innerHTML = `<span class="timestamp">${new Date(msg.timestamp).toLocaleTimeString()}</span>`;
      msgEl.appendChild(meta);
    } else {
      msgEl.innerText = msg.text;
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.innerHTML = `<span class="timestamp">${new Date(msg.timestamp).toLocaleTimeString()}</span>`;
      msgEl.appendChild(meta);
    }

    el.chatContainer.appendChild(msgEl);
    // scroll to bottom
    el.chatContainer.scrollTop = el.chatContainer.scrollHeight;
  }

  // Convert assistant text into DOM nodes, with file links where possible
  function parseAssistantTextToNodes(text) {
    const containerNodes = [];

    // Approach:
    // 1) Find explicit "file: path/to/file" patterns
    // 2) Find mentions of filenames/paths that match selected files
    // We'll build a combined set of match positions and then create nodes.

    const filePaths = state.selectedFiles.map((f) => f.path).sort((a, b) => b.length - a.length); // longer first
    const matches = [];

    // explicit file: pattern
    const explicitRe = /file:\s*([^\s,;]+)/gi;
    let m;
    while ((m = explicitRe.exec(text)) !== null) {
      const matched = m[1];
      const start = m.index;
      const end = explicitRe.lastIndex;
      // record match to replace only the path part
      const groupStart = text.indexOf(matched, start);
      if (groupStart >= 0) {
        matches.push({ start: groupStart, end: groupStart + matched.length, path: matched });
      }
    }

    // look for known file paths/names occurrences
    for (const p of filePaths) {
      const idx = text.indexOf(p);
      if (idx >= 0) {
        matches.push({ start: idx, end: idx + p.length, path: p });
      }
    }

    // dedupe and sort matches by position
    const uniqueMatches = matches
      .sort((a, b) => a.start - b.start)
      .filter((v, i, arr) => {
        // remove overlaps
        if (i === 0) return true;
        const prev = arr[i - 1];
        if (v.start < prev.end) return false;
        return true;
      });

    // build nodes by slicing text
    let cursor = 0;
    for (const match of uniqueMatches) {
      if (match.start > cursor) {
        const plainText = text.slice(cursor, match.start);
        containerNodes.push(document.createTextNode(plainText));
      }
      const linkText = text.slice(match.start, match.end);
      const link = document.createElement('a');
      link.className = 'file-ref';
      link.href = '#';
      link.innerText = linkText;
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openPreview(match.path);
      });
      containerNodes.push(link);
      cursor = match.end;
    }
    if (cursor < text.length) {
      containerNodes.push(document.createTextNode(text.slice(cursor)));
    }

    // Wrap nodes in fragment(s) with newline handling
    const frag = document.createDocumentFragment();
    // preserve newlines as text nodes
    for (const n of containerNodes) {
      frag.appendChild(n);
    }
    return [frag];
  }

  function renderAssistantError(message) {
    const assistantMsg = { role: 'assistant', text: `Error: ${message}`, timestamp: nowISO() };
    state.conversation.push(assistantMsg);
    renderChatMessage(assistantMsg);
  }

  function showSpinner(show) {
    if (!el.spinner) return;
    if (show) {
      el.spinner.classList.remove('hidden');
      el.spinner.innerHTML = `<div class="center-spinner"><div class="box"><div class="spinner"></div><div class="text">Waiting for model...</div></div></div>`;
    } else {
      el.spinner.classList.add('hidden');
      el.spinner.innerHTML = '';
    }
  }

  // Keyboard handling for message input: Ctrl+Enter to submit
  function onMessageKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      sendChat();
    }
  }

  // Attach event listeners
  function attachListeners() {
    if (el.openFolderBtn) el.openFolderBtn.addEventListener('click', pickDirectory);
    if (el.selectFilesBtn) el.selectFilesBtn.addEventListener('click', pickFiles);
    if (el.clearSelectionBtn) el.clearSelectionBtn.addEventListener('click', clearSelection);
    if (el.readWholeRepoBtn) el.readWholeRepoBtn.addEventListener('click', readWholeRepoAction);
    if (el.sendBtn) el.sendBtn.addEventListener('click', sendChat);
    if (el.messageInput) el.messageInput.addEventListener('keydown', onMessageKeyDown);
    if (el.includeRepoCheckbox) {
      el.includeRepoCheckbox.addEventListener('change', (e) => {
        // if the user already loaded a directory and toggles this, update "included" defaults
        // Note: this only affects newly loaded directories
        // Provide immediate visual cue
        if (state.selectedFiles.length) {
          // if checked, auto-include all, otherwise leave as-is
          if (el.includeRepoCheckbox.checked) {
            for (const f of state.selectedFiles) f.included = true;
          } else {
            for (const f of state.selectedFiles) f.included = false;
          }
          renderFileList();
        }
      });
    }
  }

  // Initialize UI
  function init() {
    attachListeners();
    renderFileList();
    if (el.previewPane) el.previewPane.innerHTML = '<div class="annotations">No file selected.</div>';
    if (el.chatContainer) {
      const info = document.createElement('div');
      info.className = 'annotations small';
      info.innerText = 'Session-only chat (cleared on refresh)';
      el.chatContainer.parentElement && el.chatContainer.parentElement.insertBefore(info, el.chatContainer);
    }
  }

  // Kick off
  init();

  // Export some functions for debugging in console (optional)
  window.__aiAssistant = {
    state,
    pickDirectory,
    pickFiles,
    readFileContent,
    sendChat,
    openPreview,
    renderFileList
  };
})();