// ─── Constants & State ────────────────────────────────────────────────────────
const SVG_HALF_STAR = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-star"><defs><linearGradient id="half-grad-modal"><stop offset="50%" stop-color="currentColor"/><stop offset="50%" stop-color="transparent"/></linearGradient></defs><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="url(#half-grad-modal)"></polygon></svg>`;

const IMG_FALLBACK = 'assets/poster_placeholder_vertical.svg';

const Store = {
    get: (key, fallback = null) => {
        try {
            const v = localStorage.getItem(key);
            return v !== null ? JSON.parse(v) : fallback;
        } catch { return fallback; }
    },
    set: (key, value) => {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    },
    remove: (key) => {
        try { localStorage.removeItem(key); } catch {}
    },
    getCache: (id) => Store.get(`tmdb_movie_${id}`) || Store.get(`tmdb_${id}`) || Store.get(`tmdb_v2_deep_movie_${id}`),
    setCache: (id, data) => {
        Store.set(`tmdb_movie_${id}`, data);
        Store.set(`tmdb_${id}`, data);
    },
};

const state = {
    allMovies: [],
    currentOpenId: null,
    isPreviewMode: false,
    previewMovie: null,
    separateWatched: Store.get('separateWatched', true),
    alwaysShowTitles: Store.get('alwaysShowTitles', false),
    sortPref: Store.get('sortPref', 'default'),
    activeFilter: null,
    randFilters: Store.get('randFilters', { duration: 'any', rating: 'any', genre: 'any' }),
};

// ─── DOM References ───────────────────────────────────────────────────────────
const grid = document.getElementById('movie-grid');
const searchInput = document.getElementById('query');
const resultsBox = document.getElementById('search-results');
const modalOverlay = document.getElementById('modal');
const sortSelect = document.getElementById('sort-select');
const clearBtn = document.getElementById('clear-btn');
const toast = document.getElementById('toast');
const fabRandom = document.getElementById('fab-random');
const randomizerPanel = document.getElementById('randomizer-panel');

// ─── Utility Functions ────────────────────────────────────────────────────────
const formatRuntime = (mins) => {
    if (!mins) return '';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h${m < 10 ? '0' : ''}${m}`;
};

let toastTimer;
const showToast = (msg) => {
    if (toastTimer) clearTimeout(toastTimer);
    const toastMsg = document.getElementById('toast-msg');
    if (toastMsg) toastMsg.textContent = msg;
    if (toast) {
        toast.classList.add('show');
        toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
    }
};

const fetchTMDB = async (endpoint, params = '', lang = 'fr-FR', options = {}) => {
    try {
        const res = await fetch(`/api/tmdb?endpoint=${encodeURIComponent(endpoint)}&params=${encodeURIComponent(params)}&lang=${lang}`, {
            signal: options.signal,
        });
        if (!res.ok) throw new Error('Network error');
        return await res.json();
    } catch (e) {
        if (e.name !== 'AbortError') console.error('TMDB Fetch Error:', e);
        return null;
    }
};

// ─── Sticky Header Observer for Modal ─────────────────────────────────────────
const stickyHeaderObserver = new IntersectionObserver(
    ([e]) => {
        const header = document.getElementById('sticky-header');
        if (header) {
            header.classList.toggle('is-stuck', !e.isIntersecting);
        }
    },
    {
        root: document.getElementById('modal-scroll-wrapper'),
        threshold: [0, 1],
    }
);

// ─── Load Movies ──────────────────────────────────────────────────────────────
async function loadMovies() {
    if (grid) {
        grid.innerHTML = Array(10).fill(0).map(() => `<div class="skeleton"></div>`).join('');
    }

    if (sortSelect) {
        sortSelect.value = state.sortPref;
        const sortLabel = document.getElementById('sort-label-text');
        if (sortLabel && sortSelect.selectedIndex >= 0) {
            sortLabel.textContent = sortSelect.options[sortSelect.selectedIndex].text;
        }
    }

    // Apply saved title visibility & sort behavior
    document.body.classList.toggle('show-titles', state.alwaysShowTitles);
    const btnTitles = document.getElementById('btn-toggle-titles');
    if (btnTitles) btnTitles.classList.toggle('active', state.alwaysShowTitles);

    const btnSortBehav = document.getElementById('btn-sort-behavior');
    if (btnSortBehav) {
        btnSortBehav.classList.toggle('active', state.separateWatched);
        btnSortBehav.innerHTML = `<i data-lucide="${state.separateWatched ? 'eye-off' : 'eye'}" size="16"></i>`;
    }

    let dbMovies = [];
    try {
        const res = await fetch(`/api/movies?t=${Date.now()}`);
        if (res.ok) {
            dbMovies = await res.json();
        } else {
            console.error('Fetch /api/movies failed with status:', res.status);
        }
    } catch (e) {
        console.error('Error loading movies from API:', e);
    }

    const moviesList = Array.isArray(dbMovies) ? dbMovies : (dbMovies?.media || dbMovies?.results || []);

    if (!moviesList || moviesList.length === 0) {
        state.allMovies = [];
        renderGrid();
        return;
    }

    let needsMigration = false;

    // Enrich items if metadata is missing
    const promises = moviesList.map(async (item) => {
        let genresArr = [];
        try {
            genresArr = typeof item.genres === 'string' ? JSON.parse(item.genres) : (item.genres || []);
        } catch { genresArr = []; }

        // If item already has rich data from D1, use it
        if (item.title && item.director && item.poster_path && genresArr.length > 0) {
            return {
                id: item.id,
                tmdb_id: item.tmdb_id,
                watched: !!item.watched,
                title: item.title,
                original_title: item.original_title || '',
                poster_path: item.poster_path,
                backdrop_path: item.backdrop_path,
                overview: item.overview || '',
                release_date: item.release_date,
                vote_average: Number(item.vote_average) || 0,
                runtime: Number(item.runtime) || 0,
                director: item.director,
                genres: genresArr,
                imdb_id: item.imdb_id || '',
            };
        }

        needsMigration = true;

        // Otherwise check local cache or fetch TMDB
        let cached = Store.getCache(item.tmdb_id);
        if (!cached || !cached.director || !cached.genres || !cached.poster_path) {
            const data = await fetchTMDB(`movie/${item.tmdb_id}`, '&append_to_response=credits,images&include_image_language=fr,null');
            if (data) {
                const dir = data.credits?.crew?.find(p => p.job === 'Director')?.name || 'Inconnu';
                cached = {
                    title: data.title || data.original_title || item.title || 'Titre inconnu',
                    original_title: data.original_title || '',
                    poster_path: data.poster_path || (data.images?.posters?.length > 0 ? data.images.posters[0].file_path : null),
                    backdrop_path: data.backdrop_path,
                    overview: data.overview || '',
                    release_date: data.release_date,
                    vote_average: data.vote_average || 0,
                    runtime: data.runtime || 0,
                    director: dir,
                    genres: data.genres || [],
                    imdb_id: data.imdb_id || item.imdb_id || '',
                };
                Store.setCache(item.tmdb_id, cached);
            }
        }

        return {
            id: item.id,
            tmdb_id: item.tmdb_id,
            watched: !!item.watched,
            title: cached?.title || item.title || 'Titre inconnu',
            original_title: cached?.original_title || item.original_title || '',
            poster_path: cached?.poster_path || item.poster_path,
            backdrop_path: cached?.backdrop_path || item.backdrop_path,
            overview: cached?.overview || item.overview || '',
            release_date: cached?.release_date || item.release_date,
            vote_average: Number(cached?.vote_average || item.vote_average) || 0,
            runtime: Number(cached?.runtime || item.runtime) || 0,
            director: cached?.director || item.director || 'Inconnu',
            genres: cached?.genres || genresArr,
            imdb_id: cached?.imdb_id || item.imdb_id || '',
        };
    });

    state.allMovies = (await Promise.all(promises)).filter(Boolean);
    applySort();

    // Trigger migration in background if any entries lacked rich data
    if (needsMigration) {
        fetch('/api/migrate').catch(() => {});
    }
}

// ─── Render Grid ──────────────────────────────────────────────────────────────
function renderGrid() {
    if (!grid) return;
    grid.innerHTML = '';

    let displayList = [...state.allMovies];

    // Filter logic
    const activeFilterChip = document.getElementById('active-filter');
    const activeFilterText = document.getElementById('active-filter-text');

    if (state.activeFilter) {
        if (state.activeFilter.type === 'genre') {
            displayList = displayList.filter(m => m.genres?.some(g => g.name === state.activeFilter.value));
        } else if (state.activeFilter.type === 'director') {
            displayList = displayList.filter(m => m.director === state.activeFilter.value);
        }
        if (activeFilterChip && activeFilterText) {
            activeFilterChip.classList.remove('hidden');
            activeFilterText.textContent = state.activeFilter.value;
        }
    } else if (activeFilterChip) {
        activeFilterChip.classList.add('hidden');
    }

    const countBadge = document.getElementById('count-badge');
    if (countBadge) countBadge.textContent = displayList.length;

    if (displayList.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <i data-lucide="film" class="empty-icon"></i>
                <p style="font-weight: 500; font-size: 1.05rem;">Aucun film trouvé.</p>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    const isGenreMode = state.sortPref === 'genre' && !state.activeFilter;
    const itemsToRender = [];

    displayList.forEach(m => {
        if (isGenreMode && m.genres?.length) {
            m.genres.forEach(g => itemsToRender.push({ movie: m, groupKey: g.name }));
        } else {
            itemsToRender.push({ movie: m, groupKey: isGenreMode ? 'Non classé' : null });
        }
    });

    if (isGenreMode) {
        itemsToRender.sort((a, b) => {
            const diff = a.groupKey.localeCompare(b.groupKey);
            if (diff !== 0) return diff;
            if (state.separateWatched && a.movie.watched !== b.movie.watched) {
                return (a.movie.watched ? 1 : 0) - (b.movie.watched ? 1 : 0);
            }
            return a.movie.title.localeCompare(b.movie.title);
        });
    }

    let currentGroup = null;
    const frag = document.createDocumentFragment();

    itemsToRender.forEach(item => {
        if (isGenreMode && item.groupKey !== currentGroup) {
            const header = document.createElement('div');
            header.className = 'genre-header';
            header.innerHTML = `<i data-lucide="tag" size="16"></i> ${item.groupKey}`;
            frag.appendChild(header);
            currentGroup = item.groupKey;
        }

        const m = item.movie;
        const card = document.createElement('div');
        card.id = `movie-card-${m.id}`;
        card.className = `movie-card ${m.watched ? 'is-watched' : ''}`;
        card.setAttribute('role', 'listitem');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', `${m.title}${m.watched ? ' (Vu)' : ''}`);

        const imgUrl = m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : IMG_FALLBACK;
        const timeStr = formatRuntime(m.runtime);
        const ratingStr = m.vote_average ? m.vote_average.toFixed(1) : '';
        const yearStr = (m.release_date || '').split('-')[0];

        card.innerHTML = `
            ${m.watched ? '<div class="watched-badge" aria-label="Vu"><i data-lucide="check" size="16" stroke-width="3"></i></div>' : ''}
            ${ratingStr ? `<div class="card-rating" aria-label="Note ${ratingStr}"><i data-lucide="star" fill="currentColor"></i> ${ratingStr}</div>` : ''}
            <img src="${imgUrl}" loading="lazy" alt="${m.title}">
            <div class="card-overlay">
                <div class="card-title">${m.title}</div>
                <div class="card-meta">
                    <span>${yearStr}</span>
                    ${timeStr ? `<span class="meta-dot"></span><span>${timeStr}</span>` : ''}
                </div>
            </div>
        `;

        card.addEventListener('click', () => openModal(m.id));
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openModal(m.id);
            }
        });

        frag.appendChild(card);
    });

    grid.appendChild(frag);
    if (window.lucide) window.lucide.createIcons();
}

// ─── Filter & Sorting ─────────────────────────────────────────────────────────
function applyFilter(type, value) {
    state.activeFilter = { type, value };
    closeModal(null, true);
    applySort();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetAll() {
    state.activeFilter = null;
    applySort();
}

function applySort() {
    Store.set('sortPref', state.sortPref);

    if (state.sortPref === 'genre' && !state.activeFilter) {
        state.allMovies.sort((a, b) => a.title.localeCompare(b.title));
    } else {
        state.allMovies.sort((a, b) => {
            if (state.separateWatched && a.watched !== b.watched) {
                return (a.watched ? 1 : 0) - (b.watched ? 1 : 0);
            }

            switch (state.sortPref) {
                case 'alpha':
                    return a.title.localeCompare(b.title);
                case 'recent':
                    return new Date(b.release_date || 0) - new Date(a.release_date || 0);
                case 'old':
                    return new Date(a.release_date || 0) - new Date(b.release_date || 0);
                case 'rating':
                    return (b.vote_average || 0) - (a.vote_average || 0);
                case 'short':
                    return (a.runtime || 0) - (b.runtime || 0);
                case 'long':
                    return (b.runtime || 0) - (a.runtime || 0);
                case 'default':
                default:
                    return b.id - a.id;
            }
        });
    }

    renderGrid();
}

function toggleSortBehavior() {
    state.separateWatched = !state.separateWatched;
    Store.set('separateWatched', state.separateWatched);

    const btn = document.getElementById('btn-sort-behavior');
    if (btn) {
        btn.classList.toggle('active', state.separateWatched);
        btn.innerHTML = `<i data-lucide="${state.separateWatched ? 'eye-off' : 'eye'}" size="16"></i>`;
        if (window.lucide) window.lucide.createIcons();
    }

    showToast(state.separateWatched ? 'Films vus regroupés en bas' : 'Films vus mélangés');
    applySort();
}

function toggleTitleBehavior() {
    state.alwaysShowTitles = !state.alwaysShowTitles;
    Store.set('alwaysShowTitles', state.alwaysShowTitles);

    const btn = document.getElementById('btn-toggle-titles');
    if (btn) btn.classList.toggle('active', state.alwaysShowTitles);
    document.body.classList.toggle('show-titles', state.alwaysShowTitles);

    showToast(state.alwaysShowTitles ? 'Titres toujours affichés' : 'Titres au survol');
}

// ─── Search Functionality ─────────────────────────────────────────────────────
let debounceTimer;
let searchAbortController;

function openSearchAndFocus() {
    document.querySelector('.header-content')?.classList.add('search-active');
    searchInput?.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeSearchMobile() {
    if (searchInput) searchInput.value = '';
    if (resultsBox) resultsBox.style.display = 'none';
    clearBtn?.classList.remove('visible');
    document.querySelector('.header-content')?.classList.remove('search-active');
}

function clearSearch() {
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
    }
    if (resultsBox) resultsBox.style.display = 'none';
    clearBtn?.classList.remove('visible');
}

if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        const q = e.target.value;
        if (clearBtn) clearBtn.classList.toggle('visible', q.length > 0);

        if (searchAbortController) searchAbortController.abort();
        searchAbortController = new AbortController();

        if (q.trim().length < 2) {
            if (resultsBox) resultsBox.style.display = 'none';
            return;
        }

        debounceTimer = setTimeout(async () => {
            const queryClean = q.toLowerCase().trim();

            // 1. Local matches
            const localMatches = state.allMovies.filter(m =>
                (m.title && m.title.toLowerCase().includes(queryClean)) ||
                (m.original_title && m.original_title.toLowerCase().includes(queryClean))
            );

            // 2. Remote TMDB query
            const data = await fetchTMDB('search/movie', `&query=${encodeURIComponent(q.trim())}`, 'fr-FR', {
                signal: searchAbortController.signal,
            });

            if (searchInput.value.trim() !== q.trim()) return;

            const remoteResults = data?.results || [];

            if (!localMatches.length && !remoteResults.length) {
                if (resultsBox) {
                    resultsBox.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--text-muted);">Aucun résultat</div>';
                    resultsBox.style.display = 'block';
                }
                return;
            }

            if (!resultsBox) return;
            resultsBox.innerHTML = '';
            resultsBox.style.display = 'block';

            // Render Local Matches First
            if (localMatches.length > 0) {
                localMatches.slice(0, 4).forEach(m => {
                    const div = document.createElement('div');
                    div.className = 'result-item';
                    div.style.background = 'rgba(255, 255, 255, 0.04)';

                    const img = m.poster_path ? `https://image.tmdb.org/t/p/w92${m.poster_path}` : IMG_FALLBACK;
                    const isWatched = m.watched;
                    const badgeText = isWatched ? 'Vu' : 'Dans la liste';
                    const badgeIcon = isWatched ? 'check' : 'bookmark';
                    const badgeColor = isWatched ? 'var(--green)' : '#fbbf24';
                    const badgeBg = isWatched ? 'rgba(16, 185, 129, 0.2)' : 'rgba(251, 191, 36, 0.2)';
                    const badgeBorder = isWatched ? 'rgba(16, 185, 129, 0.35)' : 'rgba(251, 191, 36, 0.35)';

                    div.innerHTML = `
                        <img src="${img}" alt="${m.title}">
                        <div class="result-info">
                            <span class="result-title">${m.title}</span>
                            <span class="result-year">${(m.release_date || '').split('-')[0]}${m.director ? ` • ${m.director}` : ''}</span>
                        </div>
                        <div class="in-library-badge" style="background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder}">
                            <i data-lucide="${badgeIcon}" size="12"></i> ${badgeText}
                        </div>
                    `;

                    div.addEventListener('click', () => {
                        resultsBox.style.display = 'none';
                        searchInput.value = '';
                        clearBtn?.classList.remove('visible');
                        document.querySelector('.header-content')?.classList.remove('search-active');
                        openModal(m.id);
                    });

                    resultsBox.appendChild(div);
                });
            }

            // Render Remote Matches (filtering out already local items)
            const filteredRemote = remoteResults
                .filter(m => !state.allMovies.some(local => local.tmdb_id === m.id))
                .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
                .slice(0, 8);

            filteredRemote.forEach(m => {
                const div = document.createElement('div');
                div.className = 'result-item';
                const img = m.poster_path ? `https://image.tmdb.org/t/p/w92${m.poster_path}` : IMG_FALLBACK;
                const year = (m.release_date || '').split('-')[0];

                div.innerHTML = `
                    <img src="${img}" alt="${m.title}">
                    <div class="result-info">
                        <span class="result-title">${m.title}</span>
                        <span class="result-year">${year}</span>
                    </div>
                `;

                div.addEventListener('click', () => {
                    resultsBox.style.display = 'none';
                    searchInput.value = '';
                    clearBtn?.classList.remove('visible');
                    document.querySelector('.header-content')?.classList.remove('search-active');
                    openPreviewModal(m.id);
                });

                resultsBox.appendChild(div);
            });

            if (window.lucide) window.lucide.createIcons();
        }, 280);
    });
}

// ─── Modal Implementation ─────────────────────────────────────────────────────
function openModalOverlay() {
    if (!modalOverlay) return;
    document.body.classList.add('modal-open');
    modalOverlay.style.display = 'flex';
    requestAnimationFrame(() => {
        modalOverlay.classList.add('open');
        const scrollWrapper = document.getElementById('modal-scroll-wrapper');
        if (scrollWrapper) scrollWrapper.scrollTop = 0;

        const sentinel = document.getElementById('sticky-sentinel');
        if (sentinel) stickyHeaderObserver.observe(sentinel);
    });
}

function closeModal(e, force = false) {
    if (!modalOverlay) return;
    if (force || (e && e.target === modalOverlay)) {
        modalOverlay.classList.remove('open');
        document.body.classList.remove('modal-open');
        setTimeout(() => {
            modalOverlay.style.display = 'none';
            stickyHeaderObserver.disconnect();
            state.currentOpenId = null;
            state.isPreviewMode = false;
            state.previewMovie = null;
        }, 300);
    }
}

function renderStars(voteAverage) {
    const starsContainer = document.getElementById('m-rating-stars');
    if (!starsContainer) return;
    starsContainer.innerHTML = '';
    const score = (voteAverage || 0) / 2;
    const rounded = Math.round(score * 2) / 2;

    for (let i = 1; i <= 5; i++) {
        if (i <= Math.floor(rounded)) {
            starsContainer.innerHTML += `<i data-lucide="star" fill="currentColor"></i>`;
        } else if (i === Math.ceil(rounded) && !Number.isInteger(rounded)) {
            starsContainer.innerHTML += SVG_HALF_STAR;
        } else {
            starsContainer.innerHTML += `<i data-lucide="star" class="text-gray-700" style="opacity: 0.35;"></i>`;
        }
    }
    if (voteAverage) {
        starsContainer.innerHTML += `<span class="modal-rating-num">${voteAverage.toFixed(1)}</span>`;
    }
}

async function fetchAllocineLink(imdbId, title, btn) {
    if (!btn) return;
    btn.href = `https://www.allocine.fr/rechercher/?q=${encodeURIComponent(title)}`;

    if (!imdbId) return;
    try {
        const query = `SELECT ?allocine_id WHERE { ?item wdt:P345 "${imdbId}". ?item wdt:P1265 ?allocine_id. }`;
        const res = await fetch(`https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`, {
            headers: { Accept: 'application/sparql-results+json' },
        });
        if (res.ok) {
            const data = await res.json();
            const allocineId = data.results.bindings?.[0]?.allocine_id?.value;
            if (allocineId) {
                btn.href = `https://www.allocine.fr/film/fichefilm_gen_cfilm=${allocineId}.html`;
            }
        }
    } catch {}
}

function populateModalData(m) {
    const titleEl = document.getElementById('m-title');
    const synopsisEl = document.getElementById('m-synopsis');
    const dateEl = document.getElementById('m-date');
    const runtimeEl = document.getElementById('m-runtime');
    const genreEl = document.getElementById('m-genre');
    const directorEl = document.getElementById('m-director');
    const backdropEl = document.getElementById('m-backdrop');
    const ambientEl = document.getElementById('modal-ambient-bg');

    if (titleEl) titleEl.textContent = m.title;
    if (synopsisEl) synopsisEl.textContent = m.overview || 'Pas de description.';
    if (dateEl) dateEl.textContent = (m.release_date || '').split('-')[0] || '';
    if (runtimeEl) runtimeEl.textContent = formatRuntime(m.runtime);

    // Smart clickable genre links
    if (genreEl) {
        genreEl.innerHTML = (m.genres || []).map(g =>
            `<span class="smart-link" onclick="window.appUi.applyFilter('genre', '${g.name.replace(/'/g, "\\'")}')">${g.name}</span>`
        ).join(' • ');
    }

    // Smart clickable director link
    if (directorEl) {
        directorEl.innerHTML = m.director && m.director !== 'Inconnu'
            ? `De <span class="director-name smart-link" onclick="window.appUi.applyFilter('director', '${m.director.replace(/'/g, "\\'")}')">${m.director}</span>`
            : '';
    }

    const backUrl = m.backdrop_path ? `https://image.tmdb.org/t/p/w780${m.backdrop_path}` : (m.poster_path ? `https://image.tmdb.org/t/p/w780${m.poster_path}` : IMG_FALLBACK);
    if (backdropEl) backdropEl.src = backUrl;
    if (ambientEl) ambientEl.style.backgroundImage = `url(${m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : backUrl})`;

    renderStars(m.vote_average);
}

function openModal(id) {
    const m = state.allMovies.find(x => x.id === id);
    if (!m) return;

    state.currentOpenId = id;
    state.isPreviewMode = false;
    state.previewMovie = null;

    populateModalData(m);

    // Show Library actions, hide preview actions
    document.getElementById('library-actions')?.classList.remove('hidden');
    document.getElementById('preview-actions')?.classList.add('hidden');
    const delBtn = document.getElementById('btn-delete');
    if (delBtn) {
        delBtn.style.display = 'block';
        delBtn.innerText = 'Retirer de la liste';
    }

    updateWatchUI(m.watched);

    const allocineBtn = document.getElementById('btn-allocine');
    fetchAllocineLink(m.imdb_id, m.title, allocineBtn);

    openModalOverlay();
    if (window.lucide) window.lucide.createIcons();
}

async function openPreviewModal(tmdbId) {
    state.isPreviewMode = true;
    state.currentOpenId = null;

    // Fetch deep details for preview
    const data = await fetchTMDB(`movie/${tmdbId}`, '&append_to_response=credits,images&include_image_language=fr,null');
    if (!data) {
        showToast("Impossible de charger les détails du film");
        return;
    }

    const dir = data.credits?.crew?.find(p => p.job === 'Director')?.name || 'Inconnu';
    const previewObj = {
        tmdb_id: tmdbId,
        title: data.title || data.original_title || 'Titre inconnu',
        original_title: data.original_title || '',
        poster_path: data.poster_path || (data.images?.posters?.length > 0 ? data.images.posters[0].file_path : null),
        backdrop_path: data.backdrop_path,
        overview: data.overview || '',
        release_date: data.release_date,
        vote_average: data.vote_average || 0,
        runtime: data.runtime || 0,
        director: dir,
        genres: data.genres || [],
        imdb_id: data.imdb_id || '',
    };

    state.previewMovie = previewObj;
    populateModalData(previewObj);

    // Show preview actions, hide library actions
    document.getElementById('library-actions')?.classList.add('hidden');
    document.getElementById('preview-actions')?.classList.remove('hidden');
    const delBtn = document.getElementById('btn-delete');
    if (delBtn) delBtn.style.display = 'none';

    const allocinePreviewBtn = document.getElementById('btn-allocine-preview');
    fetchAllocineLink(previewObj.imdb_id, previewObj.title, allocinePreviewBtn);

    openModalOverlay();
    if (window.lucide) window.lucide.createIcons();
}

function updateWatchUI(isWatched) {
    const btn = document.getElementById('btn-watch');
    if (!btn) return;
    btn.innerHTML = isWatched
        ? `<i data-lucide="check-circle" size="18" aria-hidden="true"></i> <span>Vu !</span>`
        : `<i data-lucide="eye" size="18" aria-hidden="true"></i> <span>Marquer Vu</span>`;
    btn.classList.toggle('watched', isWatched);
    if (window.lucide) window.lucide.createIcons();
}

async function toggleWatchedCurrent() {
    if (!state.currentOpenId) return;
    const m = state.allMovies.find(x => x.id === state.currentOpenId);
    if (!m) return;

    const newState = !m.watched;
    m.watched = newState;
    updateWatchUI(m.watched);
    applySort();

    try {
        await fetch('/api/movies', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: state.currentOpenId, watched: newState }),
        });
    } catch (e) {
        console.error('Error toggling watched:', e);
    }
}

async function deleteCurrent() {
    const btn = document.getElementById('btn-delete');
    if (!btn) return;
    if (btn.innerText !== '⚠️ Confirmer ?') {
        btn.innerText = '⚠️ Confirmer ?';
        return;
    }

    const idToDelete = state.currentOpenId;
    state.allMovies = state.allMovies.filter(m => m.id !== idToDelete);
    applySort();
    closeModal(null, true);
    showToast('Film supprimé');

    try {
        await fetch('/api/movies', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: idToDelete }),
        });
    } catch (e) {
        console.error('Error deleting movie:', e);
    }
}

async function addCurrentPreview() {
    if (!state.previewMovie) return;
    const tmdbId = state.previewMovie.tmdb_id;

    if (state.allMovies.some(m => m.tmdb_id === tmdbId)) {
        showToast('Déjà dans la liste !');
        closeModal(null, true);
        return;
    }

    try {
        const res = await fetch('/api/movies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tmdb_id: tmdbId }),
        });

        if (res.ok) {
            const data = await res.json();
            const newRow = Array.isArray(data) ? data[0] : data;

            const newId = newRow.id || Date.now();
            const fullMovie = {
                ...state.previewMovie,
                id: newId,
                watched: false,
            };

            state.allMovies.unshift(fullMovie);
            applySort();
            closeModal(null, true);
            showToast('Film ajouté !');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            showToast("Erreur lors de l'ajout");
        }
    } catch (e) {
        console.error('Error adding movie:', e);
        showToast("Erreur lors de l'ajout");
    }
}

// ─── Advanced Randomizer ──────────────────────────────────────────────────────
function toggleRandomizerPanel(e) {
    if (e) e.stopPropagation();

    // Dice roll animation
    const diceIcon = fabRandom?.querySelector('i');
    if (diceIcon) {
        diceIcon.classList.remove('rolling');
        void diceIcon.offsetWidth; // Trigger reflow
        diceIcon.classList.add('rolling');
    }

    if (!randomizerPanel) return;
    if (randomizerPanel.classList.contains('open')) {
        randomizerPanel.classList.remove('open');
        return;
    }

    // Restore saved filters
    const saved = Store.get('randFilters');
    if (saved) Object.assign(state.randFilters, saved);

    // Update Duration chips
    document.querySelectorAll('#rand-duration-group .chip').forEach(c => {
        c.classList.toggle('active', c.dataset.val === state.randFilters.duration);
    });

    // Update Rating chips
    document.querySelectorAll('#rand-rating-group .chip').forEach(c => {
        c.classList.toggle('active', c.dataset.val === state.randFilters.rating);
    });

    populateRandomGenres();
    randomizerPanel.classList.add('open');
}

function populateRandomGenres() {
    const pool = state.allMovies.filter(m => !m.watched);
    const counts = {};
    pool.forEach(m => m.genres?.forEach(g => {
        counts[g.name] = (counts[g.name] || 0) + 1;
    }));

    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const group = document.getElementById('rand-genre-group');
    if (!group) return;
    group.innerHTML = '';

    const buildChip = (label, val, isActive) => {
        const btn = document.createElement('button');
        btn.className = `chip ${isActive ? 'active' : ''}`;
        btn.dataset.val = val;
        btn.textContent = label;
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
        return btn;
    };

    group.appendChild(buildChip('Peu importe', 'any', state.randFilters.genre === 'any'));
    top.forEach(([name]) => {
        group.appendChild(buildChip(name, name, state.randFilters.genre === name));
    });
    group.appendChild(buildChip('Autre', 'other', state.randFilters.genre === 'other'));

    group.querySelectorAll('.chip').forEach(btn => {
        btn.addEventListener('click', () => {
            group.querySelectorAll('.chip').forEach(c => {
                c.classList.remove('active');
                c.setAttribute('aria-checked', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-checked', 'true');
            state.randFilters.genre = btn.dataset.val;
            Store.set('randFilters', state.randFilters);
        });
    });
}

function executeRandomizer() {
    let pool = state.allMovies.filter(m => !m.watched);

    // Apply active view filter if any
    if (state.activeFilter) {
        if (state.activeFilter.type === 'genre') {
            pool = pool.filter(m => m.genres?.some(g => g.name === state.activeFilter.value));
        } else if (state.activeFilter.type === 'director') {
            pool = pool.filter(m => m.director === state.activeFilter.value);
        }
    }

    // Duration filter
    if (state.randFilters.duration !== 'any') {
        pool = pool.filter(m => {
            const r = m.runtime || 0;
            if (state.randFilters.duration === 'short') return r > 0 && r < 90;
            if (state.randFilters.duration === 'medium') return r >= 90 && r <= 135;
            if (state.randFilters.duration === 'long') return r > 135;
            return true;
        });
    }

    // Rating filter
    if (state.randFilters.rating !== 'any') {
        pool = pool.filter(m => {
            const score = m.vote_average || 0;
            if (state.randFilters.rating === 'good') return score >= 8.0;
            if (state.randFilters.rating === 'bad') return score > 0 && score < 6.0;
            return true;
        });
    }

    // Genre filter
    if (state.randFilters.genre !== 'any') {
        pool = pool.filter(m => {
            if (!m.genres?.length) return state.randFilters.genre === 'other';
            const topGenreEls = document.querySelectorAll('#rand-genre-group .chip:not([data-val="any"]):not([data-val="other"])');
            const topGenreNames = Array.from(topGenreEls).map(c => c.dataset.val);
            const hasTop = m.genres.some(g => topGenreNames.includes(g.name));
            if (state.randFilters.genre === 'other') return !hasTop;
            return m.genres.some(g => g.name === state.randFilters.genre);
        });
    }

    Store.set('randFilters', state.randFilters);

    if (pool.length === 0) {
        showToast('Aucun titre ne correspond, sois moins difficile !');
        if (fabRandom) {
            fabRandom.classList.add('fab-shake');
            setTimeout(() => fabRandom.classList.remove('fab-shake'), 500);
        }
        return;
    }

    randomizerPanel?.classList.remove('open');
    startShuffleAnimation(pool);
}

function startShuffleAnimation(pool) {
    openModalOverlay();
    const box = document.getElementById('modal-content-box');
    if (!box) return;
    box.classList.add('shuffling');

    document.getElementById('library-actions')?.classList.add('hidden');
    document.getElementById('preview-actions')?.classList.add('hidden');
    const delBtn = document.getElementById('btn-delete');
    if (delBtn) delBtn.style.display = 'none';

    let steps = 0;
    const interval = setInterval(() => {
        const temp = pool[Math.floor(Math.random() * pool.length)];
        const titleEl = document.getElementById('m-title');
        const synopsisEl = document.getElementById('m-synopsis');
        const genreEl = document.getElementById('m-genre');
        const directorEl = document.getElementById('m-director');
        const dateEl = document.getElementById('m-date');
        const runtimeEl = document.getElementById('m-runtime');
        const starsEl = document.getElementById('m-rating-stars');
        const backdropEl = document.getElementById('m-backdrop');

        if (titleEl) titleEl.textContent = temp.title;
        if (synopsisEl) synopsisEl.textContent = 'Le destin choisit…';
        if (genreEl) genreEl.textContent = '…';
        if (directorEl) directorEl.textContent = '';
        if (dateEl) dateEl.textContent = '-';
        if (runtimeEl) runtimeEl.textContent = '-';
        if (starsEl) starsEl.innerHTML = '';
        if (backdropEl) {
            backdropEl.src = temp.backdrop_path ? `https://image.tmdb.org/t/p/w780${temp.backdrop_path}` : IMG_FALLBACK;
        }

        steps++;
        if (steps >= 24) {
            clearInterval(interval);
            box.classList.remove('shuffling');
            const winner = pool[Math.floor(Math.random() * pool.length)];
            openModal(winner.id);

            box.style.transform = 'scale(1.02)';
            setTimeout(() => (box.style.transform = 'scale(1)'), 200);
            showToast("🎬 C'est parti !");
        }
    }, 80);
}

// ─── Event Bindings ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Mobile search open/close
    document.getElementById('mobile-search-trigger')?.addEventListener('click', openSearchAndFocus);
    document.getElementById('mobile-search-close')?.addEventListener('click', closeSearchMobile);
    clearBtn?.addEventListener('click', clearSearch);

    // Active filter reset
    document.getElementById('active-filter')?.addEventListener('click', resetAll);

    // Toolbar buttons
    document.getElementById('btn-toggle-titles')?.addEventListener('click', toggleTitleBehavior);
    document.getElementById('btn-sort-behavior')?.addEventListener('click', toggleSortBehavior);

    // Sort select change
    sortSelect?.addEventListener('change', (e) => {
        state.sortPref = e.target.value;
        const sortLabel = document.getElementById('sort-label-text');
        if (sortLabel && sortSelect.selectedIndex >= 0) {
            sortLabel.textContent = sortSelect.options[sortSelect.selectedIndex].text;
        }
        applySort();
    });

    // Randomizer buttons
    fabRandom?.addEventListener('click', toggleRandomizerPanel);
    document.getElementById('close-rand-btn')?.addEventListener('click', () => randomizerPanel?.classList.remove('open'));
    document.getElementById('btn-roll-dice')?.addEventListener('click', executeRandomizer);

    // Randomizer chip clicks for Duration
    document.querySelectorAll('#rand-duration-group .chip').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#rand-duration-group .chip').forEach(c => {
                c.classList.remove('active');
                c.setAttribute('aria-checked', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-checked', 'true');
            state.randFilters.duration = btn.dataset.val;
            Store.set('randFilters', state.randFilters);
        });
    });

    // Randomizer chip clicks for Rating
    document.querySelectorAll('#rand-rating-group .chip').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#rand-rating-group .chip').forEach(c => {
                c.classList.remove('active');
                c.setAttribute('aria-checked', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-checked', 'true');
            state.randFilters.rating = btn.dataset.val;
            Store.set('randFilters', state.randFilters);
        });
    });

    // Modal action buttons
    document.getElementById('btn-modal-close')?.addEventListener('click', (e) => closeModal(e, true));
    modalOverlay?.addEventListener('click', (e) => closeModal(e, false));
    document.getElementById('btn-watch')?.addEventListener('click', toggleWatchedCurrent);
    document.getElementById('btn-delete')?.addEventListener('click', deleteCurrent);
    document.getElementById('btn-add-preview')?.addEventListener('click', addCurrentPreview);

    // Close search dropdown on click outside
    document.addEventListener('click', (e) => {
        if (searchInput && resultsBox && !searchInput.contains(e.target) && !resultsBox.contains(e.target)) {
            resultsBox.style.display = 'none';
        }
        if (randomizerPanel && fabRandom && !randomizerPanel.contains(e.target) && !fabRandom.contains(e.target)) {
            randomizerPanel.classList.remove('open');
        }
    });

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch((err) => console.log('SW reg failed:', err));
    }

    // Initialize Movies
    loadMovies();
});

// ─── Global UI API for Easter Eggs & Inline handlers ──────────────────────────
window.appUi = {
    getSearchInput: () => searchInput,
    openSearchAndFocus,
    closeModal,
    showToast,
    applyFilter,
    resetAll,
};
window.showToast = showToast;
window.closeModal = closeModal;
