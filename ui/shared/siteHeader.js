import { attachInfoTooltip } from './utils.js';
import { idsSummary } from './labels.js';

// The id line under a site or path page's name. Several ids show as a summary with an info icon;
// the full list opens on hover (desktop) or tap (touch) anywhere on the name or the summary.
// Returns the setter: call it with the page's ids, again whenever they change.
export function siteHeaderIds() {
  const title = document.querySelector('#site-title');
  const line = document.querySelector('#site-id');
  const info = document.querySelector('#site-ids-info');
  let ids = [];
  attachInfoTooltip(title, document.querySelector('#site-ids-tooltip'), () => (ids.length > 1 ? ids.join('\n') : ''));
  return (next) => {
    ids = next;
    line.textContent = ids.length > 1 ? idsSummary(ids) : ids[0];
    title.classList.toggle('has-list', ids.length > 1);
    info.hidden = ids.length <= 1;
  };
}
