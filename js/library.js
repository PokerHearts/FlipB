/**
 * library.js – Controller for index.html
 * Automatically lists PDFs in the PDFs/ folder by querying the GitHub API
 * when hosted on GitHub Pages, merging with custom metadata from books.json.
 */

import { fmtDate, debounce, applyTheme, getTheme, toggleTheme } from './modules/utils.js';

// ─── DOM refs ─────────────────────────────────────────────────────────────
const grid         = document.getElementById('books-grid');
const emptyState   = document.getElementById('empty-state');
const searchInput  = document.getElementById('search-input');
const filterWrap   = document.getElementById('filter-chips');
const countEl      = document.getElementById('book-count');
const themeToggle  = document.getElementById('theme-toggle');

// ─── State ────────────────────────────────────────────────────────────────
let activeCategory = 'All';
let searchQuery    = '';
let catalog        = [];

// ─── Init ─────────────────────────────────────────────────────────────────
applyTheme(getTheme());
themeToggle.addEventListener('click', () => toggleTheme());

loadCatalog();

// ─── Utility: Parse Title from Filename ────────────────────────────────────
function cleanTitle(filename) {
  const base = filename.replace(/\.pdf$/i, '');
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/%20/g, ' ')
    .trim()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ─── Auto-detect GitHub Owner/Repo ────────────────────────────────────────
function getGitHubRepo() {
  const hostname = window.location.hostname;
  const pathParts = window.location.pathname.split('/').filter(Boolean);

  if (hostname.endsWith('.github.io')) {
    const owner = hostname.split('.')[0];
    // If pathParts[0] is empty, it's a User Page, so repo is owner.github.io
    const repo = pathParts[0] || `${owner}.github.io`;
    return { owner, repo };
  }
  return null;
}

// ─── Fetch catalog ────────────────────────────────────────────────────────
async function loadCatalog() {
  let booksMetadata = [];
  try {
    const res = await fetch('books.json');
    if (res.ok) booksMetadata = await res.json();
  } catch (e) {
    // Optional books.json missing or corrupt is fine
  }

  const github = getGitHubRepo();
  let discoveredFiles = [];

  if (github && github.owner && github.repo) {
    try {
      let apiUrl = `https://api.github.com/repos/${github.owner}/${github.repo}/contents/PDFs`;
      let res = await fetch(apiUrl);
      if (!res.ok) {
        apiUrl = `https://api.github.com/repos/${github.owner}/${github.repo}/contents/pdfs`;
        res = await fetch(apiUrl);
      }
      if (res.ok) {
        const files = await res.json();
        discoveredFiles = files.filter(f => f.type === 'file' && f.name.toLowerCase().endsWith('.pdf'));
      }
    } catch (e) {
      console.warn('Failed to query GitHub API for PDFs list:', e);
    }
  }

  // Merge discovered files with booksMetadata
  if (discoveredFiles.length > 0) {
    catalog = discoveredFiles.map(file => {
      // Find override in books.json by matching file or slug
      const slug = file.name.replace(/\.pdf$/i, '');
      const override = booksMetadata.find(b => b.file === file.name || b.slug === slug);
      return {
        slug: slug,
        title: override?.title || cleanTitle(file.name),
        file: file.path,
        author: override?.author || '',
        category: override?.category || 'General',
        desc: override?.desc || '',
        cover: override?.cover || '',
        created: override?.created || Date.now(),
        pages: override?.pages || null
      };
    });
  } else {
    // Local development fallback or API rate-limited: use books.json list
    catalog = booksMetadata.map(b => ({
      slug: b.slug || b.file?.replace(/\.pdf$/i, '') || 'book',
      title: b.title || cleanTitle(b.file || 'book.pdf'),
      file: b.file || `${b.slug}.pdf`,
      author: b.author || '',
      category: b.category || 'General',
      desc: b.desc || '',
      cover: b.cover || '',
      created: b.created || Date.now(),
      pages: b.pages || null
    }));
  }

  render();
}

// ─── Search & filter ──────────────────────────────────────────────────────
searchInput.addEventListener('input', debounce(e => {
  searchQuery = e.target.value.toLowerCase().trim();
  render();
}, 200));

// ─── Render ───────────────────────────────────────────────────────────────
function render() {
  const categories = ['All', ...new Set(catalog.map(b => b.category).filter(Boolean))];
  renderFilters(categories);

  const filtered = catalog.filter(b => {
    const matchCat  = activeCategory === 'All' || b.category === activeCategory;
    const matchSearch = !searchQuery ||
      b.title.toLowerCase().includes(searchQuery) ||
      (b.author || '').toLowerCase().includes(searchQuery) ||
      (b.desc || '').toLowerCase().includes(searchQuery);
    return matchCat && matchSearch;
  });

  countEl.textContent = `${filtered.length} book${filtered.length !== 1 ? 's' : ''}`;
  grid.innerHTML = '';

  if (!filtered.length) {
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  filtered.forEach(book => grid.appendChild(buildCard(book)));
}

function renderFilters(categories) {
  const existing = [...filterWrap.querySelectorAll('.chip')].map(c => c.dataset.cat);
  if (JSON.stringify(existing) === JSON.stringify(categories)) return;

  filterWrap.innerHTML = '';
  categories.forEach(cat => {
    const chip = document.createElement('button');
    chip.className = `chip${cat === activeCategory ? ' active' : ''}`;
    chip.dataset.cat = cat;
    chip.textContent = cat;
    chip.addEventListener('click', () => {
      activeCategory = cat;
      render();
    });
    filterWrap.appendChild(chip);
  });
}

function buildCard(book) {
  const card = document.createElement('div');
  card.className = 'book-card';
  card.setAttribute('role', 'article');
  card.setAttribute('aria-label', book.title);

  // Use cover image if specified, otherwise placeholder
  const hasCover = !!book.cover;
  const coverHTML = hasCover
    ? `<img src="${book.cover}" alt="${book.title} cover" loading="lazy"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
       <div class="book-cover-placeholder" style="display:none">
         ${bookIcon()}
         <span class="text-xs text-muted">${book.file || book.slug}</span>
       </div>`
    : `<div class="book-cover-placeholder">
         ${bookIcon()}
         <span class="text-xs text-muted">${book.file || book.slug}</span>
       </div>`;

  const viewerLink = `viewer.html?pdf=${encodeURIComponent(book.file)}`;

  card.innerHTML = `
    <div class="book-cover">
      ${coverHTML}
      ${book.category ? `<span class="book-category-badge">${book.category}</span>` : ''}
    </div>
    <div class="book-info">
      <div class="book-title">${book.title}</div>
      ${book.author ? `<div class="book-author">by ${book.author}</div>` : '<div class="book-author">&nbsp;</div>'}
      <div class="book-meta">
        <span class="book-pages">${book.pages ? book.pages + ' pages' : book.file}</span>
        <button class="btn-open">Open</button>
      </div>
    </div>`;

  const openViewer = () => { location.href = viewerLink; };

  card.querySelector('.btn-open').addEventListener('click', e => {
    e.stopPropagation();
    openViewer();
  });

  card.addEventListener('click', openViewer);

  return card;
}

// ─── SVG icon ─────────────────────────────────────────────────────────────
function bookIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
  </svg>`;
}
