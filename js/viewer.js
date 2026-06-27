/**
 * viewer.js – Controller for viewer.html
 *
 * Loads a PDF directly from the PDFs/ folder using PDF.js and renders
 * pages on-the-fly into StPageFlip. No pre-rendering, no IndexedDB.
 *
 * Usage:
 *   viewer.html?pdf=chemistry.pdf        ← direct PDF filename
 *   viewer.html?book=chemistry           ← looks up in books.json
 */

import { getParam, applyTheme, getTheme, toggleTheme, debounce } from './modules/utils.js';
import { toastError } from './modules/toast.js';

// ─── DOM refs ─────────────────────────────────────────────────────────────

const loadingScreen  = document.getElementById('viewer-loading');
const loadingText    = document.getElementById('loading-text');
const flipbookEl     = document.getElementById('flipbook');
const flipbookWrap   = document.getElementById('flipbook-container');
const pageInput      = document.getElementById('page-input');
const pageTotal      = document.getElementById('page-total');
const progressBar    = document.getElementById('viewer-progress');
const btnPrev        = document.getElementById('btn-prev');
const btnNext        = document.getElementById('btn-next');
const btnFullscreen  = document.getElementById('btn-fullscreen');
const btnZoomIn      = document.getElementById('btn-zoom-in');
const btnZoomOut     = document.getElementById('btn-zoom-out');
const zoomLabel      = document.getElementById('zoom-label');
const themeToggle    = document.getElementById('theme-toggle');
const navTitle       = document.getElementById('nav-title');
const navAuthor      = document.getElementById('nav-author');
const zoomOverlay    = document.getElementById('zoom-overlay');
const zoomImg        = document.getElementById('zoom-img');
const viewerPage     = document.getElementById('viewer-page');

const btnToc            = document.getElementById('btn-toc');
const btnSearch         = document.getElementById('btn-search');
const sidePanel         = document.getElementById('side-panel');
const btnPanelClose     = document.getElementById('btn-panel-close');
const tabToc            = document.getElementById('tab-toc');
const tabSearch         = document.getElementById('tab-search');
const sectionToc        = document.getElementById('section-toc');
const sectionSearch     = document.getElementById('section-search');
const tocList           = document.getElementById('toc-list');
const searchBoxInput    = document.getElementById('search-box-input');
const btnSearchTrigger  = document.getElementById('btn-search-trigger');
const searchResultsList = document.getElementById('search-results-list');

// ─── State ────────────────────────────────────────────────────────────────

let bookIndex      = [];     // Cache of chapters/outline bookmarks for searching

let pageFlip       = null;
let pdfDoc         = null;
let totalPages     = 0;
let zoomLevel      = 1;
let pageURLs       = [];     // URLs for each page (WebP files or PDF blob URLs)
let rendering      = {};     // track in-progress renders
let isLandscapePDF = false;  // automatically locks landscape view
let bookMode       = 'pdf';  // 'pdf' or 'webp'
let bookBaseURL    = '';     // base URL for WebP images folder
let currentMeta    = null;
let isRebuilding   = false;

const RENDER_SCALE   = 3.0; // 3.0x scale for crisp Retina quality
const PREFETCH_AHEAD = 3;

// ─── Init ─────────────────────────────────────────────────────────────────

applyTheme(getTheme());
themeToggle.addEventListener('click', () => toggleTheme());

// Route based on parameter
const pdfParam  = getParam('pdf');
const bookParam = getParam('book');

if (pdfParam) {
  bookMode = 'pdf';
  initPDF(pdfParam, pdfParam.replace(/\.pdf$/i, ''));
} else if (bookParam) {
  // If bookParam is a URL or has folders, load as external WebP. Otherwise, check catalog
  if (bookParam.startsWith('http://') || bookParam.startsWith('https://')) {
    bookMode = 'webp';
    initWebP(bookParam);
  } else {
    initFromCatalog(bookParam);
  }
} else {
  showError('No book specified. Use ?pdf=filename.pdf or ?book=slug');
}

// ─── Security ─────────────────────────────────────────────────────────────

document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('dragstart',   e => {
  if (e.target.closest('#flipbook')) return;
  e.preventDefault();
});
document.addEventListener('selectstart', e => { if (!isInput(e.target)) e.preventDefault(); });
document.addEventListener('keydown', e => {
  if (e.ctrlKey && ['s','p','u'].includes(e.key.toLowerCase())) e.preventDefault();
});

function isInput(el) {
  return el.matches('input, textarea, [contenteditable]');
}

// ─── Catalog lookup ───────────────────────────────────────────────────────

async function initFromCatalog(slug) {
  setLoadingText('Looking up book…');
  try {
    const res = await fetch('books.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const catalog = await res.json();
    const entry = catalog.find(b => b.slug === slug);
    if (!entry) throw new Error('Not in catalog');

    if (entry.file) {
      bookMode = 'pdf';
      initPDF(entry.file, entry.title || slug, entry.author);
    } else {
      bookMode = 'webp';
      initWebP(entry.gcs_url || entry.slug);
    }
  } catch {
    // Fallback: try loading slug as a WebP book folder
    bookMode = 'webp';
    initWebP(slug);
  }
}

// ─── PDF Mode Init ────────────────────────────────────────────────────────

async function initPDF(pdfFilename, title, author) {
  setLoadingText('Loading PDF…');

  const pdfPath = (pdfFilename.toLowerCase().startsWith('pdfs/') || pdfFilename.toLowerCase().startsWith('pdf/'))
    ? pdfFilename
    : `PDFs/${pdfFilename}`;
  document.title = `${title} — Flipbook`;
  navTitle.textContent  = title;
  navAuthor.textContent = author ? `by ${author}` : '';

  // Configure PDF.js worker
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdf.worker.min.js';

  try {
    pdfDoc = await pdfjsLib.getDocument(pdfPath).promise;
  } catch (err) {
    showError(`Could not load "${pdfFilename}". Make sure it exists in the PDFs/ folder.`);
    return;
  }

  totalPages = pdfDoc.numPages;
  setLoadingText(`Rendering ${totalPages} pages…`);

  await buildFlipbookPDF();
}

// ─── WebP Mode Init ───────────────────────────────────────────────────────

async function initWebP(path) {
  setLoadingText('Loading metadata…');
  
  if (path.startsWith('http://') || path.startsWith('https://')) {
    bookBaseURL = path.endsWith('/') ? path.slice(0, -1) : path;
  } else {
    bookBaseURL = `books/${path}`;
  }

  try {
    const res = await fetch(`${bookBaseURL}/meta.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const meta = await res.json();
    currentMeta = meta;

    document.title = `${meta.title || 'Book'} — Flipbook`;
    navTitle.textContent  = meta.title || 'Book';
    navAuthor.textContent = meta.author ? `by ${meta.author}` : '';
    totalPages = meta.pages;

    await buildFlipbookWebP(meta);
  } catch (err) {
    showError('Could not load book metadata. Make sure the files are uploaded and public.');
  }
}

// ─── Build PDF Flipbook ───────────────────────────────────────────────────

async function buildFlipbookPDF() {
  // Get first page dimensions for sizing
  const firstPage = await pdfDoc.getPage(1);
  const vp        = firstPage.getViewport({ scale: RENDER_SCALE });
  const srcW      = vp.width;
  const srcH      = vp.height;
  const ratio     = srcH / srcW;
  firstPage.cleanup();

  isLandscapePDF = srcW > srcH;

  // Stage dimensions
  const stageW = flipbookWrap.clientWidth  - 16;
  const stageH = flipbookWrap.clientHeight - 16;

  let pageW, pageH;
  const useSinglePage = window.innerWidth < window.innerHeight;

  if (useSinglePage) {
    // Single page mode: fit width, clamp height to stage
    pageW = stageW - 16;
    pageH = Math.round(pageW * ratio);
    if (pageH > stageH - 16) {
      pageH = stageH - 16;
      pageW = Math.round(pageH / ratio);
    }
  } else {
    // Two-page spread: fit height, check width limit
    pageH = stageH - 20;
    pageW = Math.round(pageH / ratio);

    if (pageW * 2 > stageW - 20) {
      pageW = Math.floor((stageW - 20) / 2);
      pageH = Math.round(pageW * ratio);
    }
  }

  // Render first page immediately so viewer isn't blank
  const firstURL = await renderPage(1);

  // Build placeholder array — pages load on demand
  const placeholder = makeBlankDataURL();
  pageURLs = Array(totalPages).fill(placeholder);
  pageURLs[0] = firstURL;

  // Build DOM elements for StPageFlip HTML mode
  flipbookEl.innerHTML = '';
  for (let i = 0; i < totalPages; i++) {
    const pageDiv = document.createElement('div');
    pageDiv.className = 'page';
    if (i === 0 || i === totalPages - 1) {
      pageDiv.setAttribute('data-density', 'hard');
    }

    const img = document.createElement('img');
    img.src = pageURLs[i];
    img.alt = `Page ${i + 1}`;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'contain';
    img.style.display = 'block';

    pageDiv.appendChild(img);
    flipbookEl.appendChild(pageDiv);
  }

  // Initialize StPageFlip
  pageFlip = new St.PageFlip(flipbookEl, {
    width:      pageW,
    height:     pageH,
    size:       'stretch',
    minWidth:   useSinglePage ? 200 : 400,
    maxWidth:   useSinglePage ? 2000 : 4000,
    minHeight:  200,
    maxHeight:  2000,
    maxShadowOpacity: 0.5,
    showCover:  !useSinglePage,
    mobileScrollSupport: true,
    swipeDistance: 30,
    usePortrait: useSinglePage,
    autoSize:    true,
  });

  pageFlip.loadFromHTML(flipbookEl.querySelectorAll('.page'));

  pageFlip.on('flip', e => {
    updatePageUI(e.data);
    prefetchAround(e.data);
  });

  pageFlip.on('changeState', e => {
    if (e.data === 'read') prefetchAround(pageFlip.getCurrentPageIndex());
  });

  // Hide loading, start initial page routing
  setTimeout(() => {
    loadingScreen.classList.add('hidden');
    startInitialPage();
  }, 300);

  // Controls
  document.addEventListener('keydown', onKeydown);
  flipbookEl.addEventListener('dblclick', onDoubleClick);
  zoomOverlay.addEventListener('click', () => zoomOverlay.classList.remove('active'));
  document.getElementById('btn-fs-close').addEventListener('click', toggleFullscreen);
}

// ─── Build WebP Flipbook ──────────────────────────────────────────────────

async function buildFlipbookWebP(meta) {
  setLoadingText('Calculating page sizes…');

  const ext = meta.extension || 'webp';

  // Build page paths
  pageURLs = [];
  for (let i = 0; i < totalPages; i++) {
    pageURLs.push(`${bookBaseURL}/pages/${i + 1}.${ext}`);
  }

  // Detect image aspect ratio by loading page 1
  let ratio = 1.414; // Default A4 ratio
  try {
    ratio = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalHeight / img.naturalWidth);
      img.onerror = () => reject();
      img.src = pageURLs[0];
    });
  } catch (err) {
    console.warn('Could not determine aspect ratio, using standard A4');
  }

  isLandscapePDF = ratio < 1.0;

  // Stage dimensions
  const stageW = flipbookWrap.clientWidth  - 16;
  const stageH = flipbookWrap.clientHeight - 16;

  let pageW, pageH;
  const useSinglePage = window.innerWidth < window.innerHeight;

  if (useSinglePage) {
    pageW = stageW - 16;
    pageH = Math.round(pageW * ratio);
    if (pageH > stageH - 16) {
      pageH = stageH - 16;
      pageW = Math.round(pageH / ratio);
    }
  } else {
    pageH = stageH - 20;
    pageW = Math.round(pageH / ratio);

    if (pageW * 2 > stageW - 20) {
      pageW = Math.floor((stageW - 20) / 2);
      pageH = Math.round(pageW * ratio);
    }
  }

  // Build DOM elements for StPageFlip HTML mode
  flipbookEl.innerHTML = '';
  for (let i = 0; i < totalPages; i++) {
    const pageDiv = document.createElement('div');
    pageDiv.className = 'page';
    if (i === 0 || i === totalPages - 1) {
      pageDiv.setAttribute('data-density', 'hard');
    }

    const img = document.createElement('img');
    // Load first two pages immediately to avoid flash of white
    img.src = i < 2 ? pageURLs[i] : makeBlankDataURL();
    img.alt = `Page ${i + 1}`;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'contain';
    img.style.display = 'block';

    pageDiv.appendChild(img);
    flipbookEl.appendChild(pageDiv);
  }

  // Initialize StPageFlip
  pageFlip = new St.PageFlip(flipbookEl, {
    width:      pageW,
    height:     pageH,
    size:       'stretch',
    minWidth:   useSinglePage ? 200 : 400,
    maxWidth:   useSinglePage ? 2000 : 4000,
    minHeight:  200,
    maxHeight:  2000,
    maxShadowOpacity: 0.5,
    showCover:  !useSinglePage,
    mobileScrollSupport: true,
    swipeDistance: 30,
    usePortrait: useSinglePage,
    autoSize:    true,
  });

  pageFlip.loadFromHTML(flipbookEl.querySelectorAll('.page'));

  pageFlip.on('flip', e => {
    updatePageUI(e.data);
    prefetchAround(e.data);
  });

  pageFlip.on('changeState', e => {
    if (e.data === 'read') prefetchAround(pageFlip.getCurrentPageIndex());
  });

  // Hide loading, start initial page routing
  setTimeout(() => {
    loadingScreen.classList.add('hidden');
    startInitialPage();
  }, 300);

  // Controls
  document.addEventListener('keydown', onKeydown);
  flipbookEl.addEventListener('dblclick', onDoubleClick);
  zoomOverlay.addEventListener('click', () => zoomOverlay.classList.remove('active'));
  document.getElementById('btn-fs-close').addEventListener('click', toggleFullscreen);
}

// ─── Render a single PDF page to blob URL ─────────────────────────────────

async function renderPage(pageNum) {
  const page     = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: RENDER_SCALE });

  const canvas  = document.createElement('canvas');
  canvas.width  = viewport.width;
  canvas.height = viewport.height;
  const ctx     = canvas.getContext('2d');

  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();

  return new Promise(resolve => {
    canvas.toBlob(blob => {
      resolve(URL.createObjectURL(blob));
    }, 'image/webp', 0.95);
  });
}

// ─── Prefetch pages around current spread ─────────────────────────────────

async function prefetchAround(pageIndex) {
  const start = Math.max(0, pageIndex - 1);
  const end   = Math.min(totalPages - 1, pageIndex + PREFETCH_AHEAD);

  for (let i = start; i <= end; i++) {
    const pageDivs = flipbookEl.querySelectorAll('.page');
    if (!pageDivs[i]) continue;
    const img = pageDivs[i].querySelector('img');
    if (!img) continue;

    if (img.src.startsWith('data:')) {
      if (bookMode === 'pdf') {
        if (rendering[i]) continue;
        rendering[i] = true;
        try {
          const url = await renderPage(i + 1);
          pageURLs[i] = url;
          img.src = url;
        } catch (e) {
          console.error('Failed to render page:', i + 1, e);
        }
        rendering[i] = false;
      } else {
        // WebP mode: swap placeholder with actual WebP URL
        img.src = pageURLs[i];
      }
    }
  }
}

// ─── UI Updates ───────────────────────────────────────────────────────────

function updatePageUI(pageIndex) {
  const current = pageIndex + 1;
  if (pageInput) pageInput.value = current;
  if (pageTotal) pageTotal.textContent = totalPages;

  const pct = (pageIndex / Math.max(1, totalPages - 1)) * 100;
  progressBar.style.width = `${pct}%`;

  // Update URL hash with page number for sharing/linking
  const url = new URL(window.location.href);
  url.hash = `page=${current}`;
  window.history.replaceState(null, '', url.toString());
}

// ─── Controls ─────────────────────────────────────────────────────────────

btnPrev.addEventListener('click', () => pageFlip?.flipPrev());
btnNext.addEventListener('click', () => pageFlip?.flipNext());

document.getElementById('btn-first').addEventListener('click', () => pageFlip?.flip(0));
document.getElementById('btn-last').addEventListener('click',  () => pageFlip?.flip(totalPages - 1));

btnFullscreen.addEventListener('click', toggleFullscreen);

if (pageInput) {
  pageInput.addEventListener('change', e => {
    let val = parseInt(e.target.value, 10);
    if (isNaN(val)) return;
    val = Math.max(1, Math.min(totalPages, val));
    pageFlip?.flip(val - 1);
  });
}

btnZoomIn.addEventListener('click',  () => adjustZoom(0.25));
btnZoomOut.addEventListener('click', () => adjustZoom(-0.25));

function adjustZoom(delta) {
  zoomLevel = Math.max(0.5, Math.min(2.5, zoomLevel + delta));
  flipbookEl.style.transform = `scale(${zoomLevel})`;
  flipbookEl.style.transformOrigin = 'center center';
  zoomLabel.textContent = `${Math.round(zoomLevel * 100)}%`;
}

function onKeydown(e) {
  if (!pageFlip) return;
  switch (e.key) {
    case 'ArrowRight': case 'ArrowDown': case 'PageDown':
      pageFlip.flipNext(); break;
    case 'ArrowLeft': case 'ArrowUp': case 'PageUp':
      pageFlip.flipPrev(); break;
    case 'Home': pageFlip.flip(0); break;
    case 'End':  pageFlip.flip(totalPages - 1); break;
    case 'f': case 'F': toggleFullscreen(); break;
    case '+': case '=': adjustZoom(0.25); break;
    case '-': case '_': adjustZoom(-0.25); break;
    case 'Escape': zoomOverlay.classList.remove('active'); break;
  }
}

// ─── Double-click zoom ────────────────────────────────────────────────────

async function onDoubleClick() {
  const pageIndex = pageFlip?.getCurrentPageIndex() ?? 0;

  // Ensure page is rendered
  if (pageURLs[pageIndex].startsWith('data:')) {
    const url = await renderPage(pageIndex + 1);
    pageURLs[pageIndex] = url;
    
    const pageDivs = flipbookEl.querySelectorAll('.page');
    if (pageDivs[pageIndex]) {
      const img = pageDivs[pageIndex].querySelector('img');
      if (img) img.src = url;
    }
  }

  zoomImg.src = pageURLs[pageIndex];
  zoomOverlay.classList.add('active');
}

// ─── Fullscreen ───────────────────────────────────────────────────────────

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    viewerPage.requestFullscreen?.() || viewerPage.webkitRequestFullscreen?.();
  } else {
    document.exitFullscreen?.() || document.webkitExitFullscreen?.();
  }
}

document.addEventListener('fullscreenchange', async () => {
  const icon = btnFullscreen.querySelector('svg');
  if (document.fullscreenElement) {
    icon.innerHTML = exitFsIcon();
    if (isLandscapePDF && screen.orientation && screen.orientation.lock) {
      try {
        await screen.orientation.lock('landscape');
      } catch (err) {
        console.warn('Orientation lock failed:', err);
      }
    }
  } else {
    icon.innerHTML = enterFsIcon();
    if (screen.orientation && screen.orientation.unlock) {
      try {
        screen.orientation.unlock();
      } catch (err) {}
    }
  }
  
  // Recalculate book size after fullscreen layout transition completes
  setTimeout(() => {
    pageFlip?.update();
  }, 100);
});

// ─── Helpers ──────────────────────────────────────────────────────────────

function startInitialPage() {
  let startPage = parseInt(getParam('page') || getParam('index') || window.location.hash.replace('#page=', '').replace('#index=', ''), 10);
  if (!isNaN(startPage) && startPage >= 1 && startPage <= totalPages) {
    pageFlip?.flip(startPage - 1);
  } else {
    updatePageUI(0);
    prefetchAround(0);
  }
}

function makeBlankDataURL() {
  return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
}

function showError(msg) {
  loadingText.textContent = msg;
  loadingScreen.classList.remove('hidden');
  document.querySelector('.loader-ring').style.display = 'none';
  toastError(msg);
}

function setLoadingText(msg) { loadingText.textContent = msg; }

function enterFsIcon() {
  return `<path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>`;
}

function exitFsIcon() {
  return `<path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>`;
}

async function handleResize() {
  if (isRebuilding || !pageFlip) return;

  const isCurrentlyPortrait = window.innerWidth < window.innerHeight;
  const isBookPortrait = pageFlip.getOrientation() === 'portrait';

  if (isCurrentlyPortrait === isBookPortrait) {
    // Sizing change only, orientation didn't swap
    pageFlip.update();
    return;
  }

  isRebuilding = true;
  const currentPageIndex = pageFlip.getCurrentPageIndex();

  try {
    pageFlip.destroy();
    pageFlip = null;

    if (bookMode === 'pdf') {
      await buildFlipbookPDF();
    } else {
      await buildFlipbookWebP(currentMeta);
    }

    // Restore book position
    pageFlip.flip(currentPageIndex);
  } catch (err) {
    console.warn('Rebuilding flipbook failed:', err);
  }
  isRebuilding = false;
}

window.addEventListener('resize', debounce(handleResize, 150));

// ─── Side Panel (Index & Search) ──────────────────────────────────────

function openSidePanel(activeTab = 'toc') {
  sidePanel.classList.add('active');

  if (activeTab === 'toc') {
    tabToc.classList.add('active');
    tabSearch.classList.remove('active');
    sectionToc.classList.add('active');
    sectionSearch.classList.remove('active');
  } else {
    tabToc.classList.remove('active');
    tabSearch.classList.add('active');
    sectionToc.classList.remove('active');
    sectionSearch.classList.add('active');
    setTimeout(() => searchBoxInput.focus(), 150);
  }

  // Load Table of Contents on open
  if (bookIndex.length === 0) {
    if (bookMode === 'pdf') {
      loadPDFOutline();
    } else {
      loadWebPOTOC(currentMeta);
    }
  }
}

function closeSidePanel() {
  sidePanel.classList.remove('active');
}

btnToc.addEventListener('click', () => {
  if (sidePanel.classList.contains('active') && sectionToc.classList.contains('active')) {
    closeSidePanel();
  } else {
    openSidePanel('toc');
  }
});

btnSearch.addEventListener('click', () => {
  if (sidePanel.classList.contains('active') && sectionSearch.classList.contains('active')) {
    closeSidePanel();
  } else {
    openSidePanel('search');
  }
});

btnPanelClose.addEventListener('click', closeSidePanel);

// Tab switching
tabToc.addEventListener('click', () => openSidePanel('toc'));
tabSearch.addEventListener('click', () => openSidePanel('search'));

// Search trigger
btnSearchTrigger.addEventListener('click', doSearch);
searchBoxInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') doSearch();
  else if (e.key === 'Escape') closeSidePanel();
});
searchBoxInput.addEventListener('input', doSearch); // Real-time search as they type!

function doSearch() {
  const query = searchBoxInput.value.trim().toLowerCase();
  searchResultsList.innerHTML = '';

  if (!query) {
    searchResultsList.innerHTML = '<div class="text-sm text-muted">Type a word to search index names.</div>';
    return;
  }

  const results = bookIndex.filter(item => item.title.toLowerCase().includes(query));

  if (results.length === 0) {
    searchResultsList.innerHTML = '<div class="text-sm text-muted">No matching index items found.</div>';
    return;
  }

  results.forEach(result => {
    const btn = document.createElement('button');
    btn.className = 'search-result-item';
    
    // Highlight matching query
    const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
    const highlightedTitle = result.title.replace(regex, '<mark>$1</mark>');

    btn.innerHTML = `
      <div class="search-result-header" style="margin-bottom: 0;">
        <span class="chapter-title">${highlightedTitle}</span>
        <span class="chapter-page">Page ${result.page}</span>
      </div>
    `;
    btn.addEventListener('click', () => {
      pageFlip?.flip(result.page - 1);
      closeSidePanel();
    });
    searchResultsList.appendChild(btn);
  });
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── TOC / Index loaders ──────────────────────────────────────────────────

async function loadPDFOutline() {
  tocList.innerHTML = '<div class="text-sm text-muted">Loading outline…</div>';
  try {
    const outline = await pdfDoc.getOutline();
    if (!outline || outline.length === 0) {
      tocList.innerHTML = '<div class="text-sm text-muted">No index bookmarks found.</div>';
      bookIndex = [];
      return;
    }

    // Resolve page index numbers for outline items in parallel
    const items = await Promise.all(
      outline.map(async item => {
        let pageNum = null;
        if (item.dest) {
          try {
            const dest = item.dest;
            const ref = typeof dest === 'string' ? dest : dest[0];
            if (ref && typeof ref === 'object') {
              const pageIdx = await pdfDoc.getPageIndex(ref);
              pageNum = pageIdx + 1;
            } else if (typeof ref === 'number') {
              pageNum = ref + 1;
            }
          } catch (e) {}
        }
        return {
          title: item.title,
          page: pageNum
        };
      })
    );

    const validItems = items.filter(i => i.page !== null);
    bookIndex = validItems;

    if (validItems.length === 0) {
      tocList.innerHTML = '<div class="text-sm text-muted">No index bookmarks found.</div>';
    } else {
      renderTOC(validItems);
    }
  } catch (err) {
    tocList.innerHTML = '<div class="text-sm text-muted">No index bookmarks found.</div>';
    bookIndex = [];
  }
}

function loadWebPOTOC(meta) {
  bookIndex = meta && meta.index ? meta.index : [];
  if (bookIndex.length > 0) {
    renderTOC(bookIndex);
  } else {
    tocList.innerHTML = '<div class="text-sm text-muted">No index bookmarks found.</div>';
  }
}

function renderTOC(items) {
  tocList.innerHTML = '';
  items.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'chapter-item';
    btn.innerHTML = `
      <span class="chapter-title">${item.title}</span>
      <span class="chapter-page">Page ${item.page}</span>
    `;
    btn.addEventListener('click', () => {
      pageFlip?.flip(item.page - 1);
      closeSidePanel();
    });
    tocList.appendChild(btn);
  });
}
