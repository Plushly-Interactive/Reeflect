import { QUOTES } from '../../shared/quotes.data.js';
import { PREF_FAVORITE_QUOTE_IDS } from '../../shared/prefKeys.js';
import { initI18n, applyI18n, t } from '../../shared/i18n.js';
import { BRAND_NAME } from '../../shared/brand.js';
import { keyActivate } from '../../shared/utils.js';
import { host } from '../../shared/host.js';

await initI18n();
applyI18n();
document.title = `${t('quotes_pageTitle')} - ${BRAND_NAME}`;
keyActivate(document.querySelector('#back-btn'), [' ']);

const { [PREF_FAVORITE_QUOTE_IDS]: favIds = [] } = await host.prefs.get(PREF_FAVORITE_QUOTE_IDS);

const listEl = document.querySelector('#quotes-list');
const emptyEl = document.querySelector('#empty-state');

if (favIds.length === 0) {
  emptyEl.removeAttribute('hidden');
} else {
  for (const id of favIds) {
    const q = QUOTES.find(q => q.id === id);
    if (!q) continue;
    renderCard(q, id);
  }
}

function renderCard(q, id) {
  const card = document.createElement('div');
  card.className = 'quote-card';

  const textEl = document.createElement('p');
  textEl.className = 'quote-text';
  textEl.textContent = `"${q.text}"`;
  if (q.source) {
    const link = document.createElement('a');
    link.className = 'link-btn';
    link.tabIndex = 0;
    link.textContent = ' ↗';
    link.href = q.source;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    textEl.appendChild(link);
  }
  card.appendChild(textEl);

  if (q.author) {
    const authorEl = document.createElement('p');
    authorEl.className = 'quote-author text-meta';
    authorEl.textContent = `— ${q.author}`;
    if (q.philosophySource) {
      const link = document.createElement('a');
      link.className = 'link-btn';
      link.tabIndex = 0;
      link.textContent = ' ' + t('quotes_discoverLink');
      link.href = q.philosophySource;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      authorEl.appendChild(link);
    }
    card.appendChild(authorEl);
  }

  const unfavBtn = document.createElement('button');
  unfavBtn.className = 'unfav-btn';
  unfavBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 20.5C12 20.5 2.5 14.5 2.5 8C2.5 5.5 4.5 3.5 7 3.5C9 3.5 10.8 4.7 12 6.5C13.2 4.7 15 3.5 17 3.5C19.5 3.5 21.5 5.5 21.5 8C21.5 14.5 12 20.5 12 20.5Z" stroke="currentColor" stroke-width="1.5" fill="currentColor" stroke-linejoin="round"/></svg> ${t('quotes_removeBtn')}`;
  unfavBtn.addEventListener('click', async () => {
    const { [PREF_FAVORITE_QUOTE_IDS]: current = [] } = await host.prefs.get(PREF_FAVORITE_QUOTE_IDS);
    const updated = current.filter(fid => fid !== id);
    await host.prefs.set({ [PREF_FAVORITE_QUOTE_IDS]: updated });
    card.remove();
    if (listEl.childElementCount === 0) emptyEl.removeAttribute('hidden');
  });
  card.appendChild(unfavBtn);

  listEl.appendChild(card);
}
