// The loading look of a data page: a small group of chart bars in a slow wave inside every card
// (theme.css shows it under body.is-loading only). The group stays in the card, because a device
// change loads again. Cards a page script adds later get theirs through the observer.
const HEIGHTS = [40, 65, 50, 80, 60, 95, 70, 55, 85, 45, 75, 60];

function addBars(host) {
  if (host.querySelector(':scope > .loading-bars')) return;
  const bars = document.createElement('div');
  bars.className = 'loading-bars';
  bars.setAttribute('aria-hidden', 'true');
  HEIGHTS.forEach((height, i) => {
    const bar = document.createElement('span');
    bar.style.height = `${height}%`;
    // A negative delay starts each bar part way into its cycle. With a positive one a bar stood at
    // full height until its turn came, then jumped to the first keyframe. 1.8 is the cycle in theme.css.
    bar.style.animationDelay = `${i * 0.12 - 1.8}s`;
    bars.append(bar);
  });
  host.append(bars);
}

const addAll = () => document.querySelectorAll('.chart-container, .loads-data').forEach(addBars);
addAll();
new MutationObserver(addAll).observe(document.body, { childList: true, subtree: true });
