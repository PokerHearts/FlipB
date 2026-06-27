/**
 * library.js – Controller for index.html
 * Automatically scans the GitHub repository books/ folder via the GitHub API,
 * downloads their meta.json files, and renders flipbook library cards dynamically.
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
function cleanTitle(slug) {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/%20/g, ' ')
    .trim()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ─── Fetch catalog ────────────────────────────────────────────────────────
async function loadCatalog() {
  let githubRepo = '';
  
  // 1. Read repository from config.json
  try {
    const configRes = await fetch('config.json');
    if (configRes.ok) {
      const config = await configRes.json();
      githubRepo = config.github_repo;
    }
  } catch (e) {
    console.warn('Failed to load config.json:', e);
  }

  // Fallback: try to auto-detect from hostname if config.json is default
  if (!githubRepo || githubRepo === 'username/repo-name') {
    const host = window.location.hostname;
    const path = window.location.pathname;
    if (host.includes('.github.io')) {
      const owner = host.split('.')[0];
      const repo = path.split('/')[1] || '';
      if (owner && repo) {
        githubRepo = `${owner}/${repo}`;
      }
    }
  }

  // If we still don't know the repository, show instructions
  if (!githubRepo || githubRepo === 'username/repo-name') {
    showConfigureMessage();
    return;
  }

  // 2. Query GitHub Contents API to discover subfolders in books/
  try {
    const apiUrl = `https://api.github.com/repos/${githubRepo}/contents/books`;
    const res = await fetch(apiUrl);
    
    if (!res.ok) {
      if (res.status === 404) {
        // Books folder doesn't exist yet
        catalog = [];
        render();
        return;
      }
      throw new Error(`GitHub API returned ${res.status}`);
    }
    
    const items = await res.json();
    
    // Filter out directories (each directory is a book slug)
    const folders = items.filter(item => item.type === 'dir').map(item => item.name);

    // Fetch details for each book folder in parallel
    const books = await Promise.all(
      folders.map(async slug => {
        try {
          const metaUrl = `books/${slug}/meta.json`;
          const metaRes = await fetch(metaUrl);
          if (metaRes.ok) {
            const meta = await metaRes.json();
            return {
              slug: meta.slug || slug,
              title: meta.title || cleanTitle(slug),
              author: meta.author || '',
              category: meta.category || 'General',
              desc: meta.desc || '',
              pages: meta.pages || 0,
              created: meta.created || Date.now(),
              cover: meta.cover || `books/${slug}/pages/1.${meta.extension || 'jpg'}`
            };
          }
        } catch (e) {
          console.warn('Failed to load metadata for', slug, e);
        }
        return null;
      })
    );

    catalog = books.filter(Boolean);
  } catch (err) {
    console.error('GitHub catalog scan failed:', err);
    // Local fallback: try loading from a local list if offline
    catalog = [];
  }

  render();
}

function showConfigureMessage() {
  emptyState.classList.remove('hidden');
  emptyState.querySelector('p').innerHTML = 
    `Please configure your GitHub repository name in <code class="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">config.json</code> to enable automated book scanning.`;
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

  card.innerHTML = `
    <div class="book-cover">
      <img src="${book.cover}" alt="${book.title} cover" loading="lazy"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
      <div class="book-cover-placeholder" style="display:none">
        ${bookIcon()}
        <span class="text-xs text-muted">${book.slug}</span>
      </div>
      ${book.category ? `<span class="book-category-badge">${book.category}</span>` : ''}
    </div>
    <div class="book-info">
      <div class="book-title">${book.title}</div>
      ${book.author ? `<div class="book-author">by ${book.author}</div>` : '<div class="book-author">&nbsp;</div>'}
      <div class="book-meta">
        <span class="book-pages">${book.pages ? book.pages + ' pages' : ''}</span>
        <button class="btn-open">Open</button>
      </div>
    </div>`;

  const openViewer = () => {
    location.href = `viewer.html?book=${encodeURIComponent(book.slug)}`;
  };

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
