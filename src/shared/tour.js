import { t } from './i18n.js';
import { host } from './host.js';

const TOUR_KEY = 'tour';

const DEFAULT_STATE = { completed: false, completedAt: null, inProgress: null, useMockData: false };

export async function readTourState() {
  const { [TOUR_KEY]: state } = await host.prefs.get(TOUR_KEY);
  return { ...DEFAULT_STATE, ...(state || {}) };
}

let writeChain = Promise.resolve();
export function writeTourState(patch) {
  const next = writeChain.then(async () => {
    const current = await readTourState();
    const merged = { ...current, ...patch };
    await host.prefs.set({ [TOUR_KEY]: merged });
    return merged;
  });
  writeChain = next.catch(() => {});
  return next;
}

export function markTourCompleted() {
  return writeTourState({
    completed: true,
    completedAt: new Date().toISOString(),
    inProgress: null,
    useMockData: false,
  });
}

export function setTourProgress(surface, stepIndex) {
  return writeTourState({ inProgress: { surface, stepIndex } });
}

export function clearTourProgress() {
  return writeTourState({ inProgress: null });
}

const SPOTLIGHT_PADDING = 6;
const TOOLTIP_MARGIN = 12;
const VIEWPORT_MARGIN = 8;

export function runTour({ surface, steps, startIndex = 0, onClose, showCloseButton = true }) {
  if (!steps || steps.length === 0) return { stop: () => {} };

  const previouslyFocused = document.activeElement;

  const overlay = document.createElement('div');
  overlay.id = 'tour-overlay';

  const spotlight = document.createElement('div');
  spotlight.id = 'tour-spotlight';

  const closeBtn = document.createElement('button');
  closeBtn.id = 'tour-close-btn';
  closeBtn.className = 'icon-btn';
  closeBtn.title = t('tour_closeTour');
  closeBtn.setAttribute('aria-label', t('tour_closeTour'));
  closeBtn.innerHTML = '&times;';
  if (!showCloseButton) closeBtn.style.display = 'none';

  const tooltip = document.createElement('div');
  tooltip.id = 'tour-tooltip';
  tooltip.innerHTML = `
    <div id="tour-tooltip-arrow"></div>
    <div id="tour-tooltip-title"></div>
    <div id="tour-tooltip-body"></div>
    <div id="tour-tooltip-footer">
      <span id="tour-step-counter"></span>
      <button id="tour-prev-btn" class="btn">${t('tour_previous')}</button>
      <button id="tour-next-btn" class="btn">${t('tour_next')}</button>
    </div>
  `;

  const confirm = document.createElement('div');
  confirm.id = 'tour-confirm';
  confirm.className = 'modal-dialog';
  confirm.style.display = 'none';
  confirm.innerHTML = `
    <div id="tour-confirm-body">${t('tour_confirmInterrupt')}</div>
    <div id="tour-confirm-actions">
      <button id="tour-confirm-no" class="btn">${t('tour_keepGoing')}</button>
      <button id="tour-confirm-yes" class="btn">${t('tour_interrupt')}</button>
    </div>
  `;

  document.body.append(overlay, spotlight, tooltip, confirm);
  tooltip.appendChild(closeBtn);

  const titleEl = tooltip.querySelector('#tour-tooltip-title');
  const bodyEl = tooltip.querySelector('#tour-tooltip-body');
  const counterEl = tooltip.querySelector('#tour-step-counter');
  const prevBtn = tooltip.querySelector('#tour-prev-btn');
  const nextBtn = tooltip.querySelector('#tour-next-btn');
  const confirmNo = confirm.querySelector('#tour-confirm-no');
  const confirmYes = confirm.querySelector('#tour-confirm-yes');

  let currentIndex = 0;
  let currentStep = null;
  let stopped = false;
  let handoffEngaged = false;
  let handoffTarget = null;
  let advanceClickCleanup = null;
  let resizeObserver = null;

  function applyClickThroughHole(top, left, width, height) {
    const t = Math.max(0, top);
    const l = Math.max(0, left);
    const r = left + width;
    const b = top + height;
    overlay.style.clipPath = `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${t}px, ${l}px ${t}px, ${l}px ${b}px, ${r}px ${b}px, ${r}px ${t}px, 0 ${t}px)`;
  }

  function clearClickThroughHole() {
    overlay.style.clipPath = '';
  }

  function positionTooltipFor(target) {
    const rect = target.getBoundingClientRect();
    const top = rect.top - SPOTLIGHT_PADDING;
    const left = rect.left - SPOTLIGHT_PADDING;
    const width = rect.width + SPOTLIGHT_PADDING * 2;
    const height = rect.height + SPOTLIGHT_PADDING * 2;

    const tipRect = tooltip.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const spaceBelow = vh - (top + height);
    let tipTop = top + height + TOOLTIP_MARGIN;
    if (spaceBelow < tipRect.height + TOOLTIP_MARGIN + VIEWPORT_MARGIN) {
      tipTop = top - tipRect.height - TOOLTIP_MARGIN;
    }
    tipTop = Math.max(VIEWPORT_MARGIN, Math.min(tipTop, vh - tipRect.height - VIEWPORT_MARGIN));

    let tipLeft = left + width / 2 - tipRect.width / 2;
    tipLeft = Math.max(VIEWPORT_MARGIN, Math.min(tipLeft, vw - tipRect.width - VIEWPORT_MARGIN));

    tooltip.style.top = `${tipTop}px`;
    tooltip.style.left = `${tipLeft}px`;
  }

  function positionFor(target, { moveTooltip = true, clickThrough = false } = {}) {
    const rect = target.getBoundingClientRect();
    const top = rect.top - SPOTLIGHT_PADDING;
    const left = rect.left - SPOTLIGHT_PADDING;
    const width = rect.width + SPOTLIGHT_PADDING * 2;
    const height = rect.height + SPOTLIGHT_PADDING * 2;
    spotlight.style.display = '';
    spotlight.style.top = `${top}px`;
    spotlight.style.left = `${left}px`;
    spotlight.style.width = `${width}px`;
    spotlight.style.height = `${height}px`;
    spotlight.style.pointerEvents = clickThrough ? 'none' : 'auto';

    applyClickThroughHole(top, left, width, height);

    if (moveTooltip) positionTooltipFor(target);
  }

  function positionFloating(position) {
    spotlight.style.display = 'none';
    clearClickThroughHole();
    const tipRect = tooltip.getBoundingClientRect();
    const vw = window.innerWidth;
    let tipTop = VIEWPORT_MARGIN;
    let tipLeft;
    if (position === 'top-right') {
      tipLeft = vw - tipRect.width - VIEWPORT_MARGIN;
    } else if (position === 'top-left') {
      tipLeft = VIEWPORT_MARGIN;
    } else {
      tipLeft = vw / 2 - tipRect.width / 2;
    }
    tooltip.style.top = `${tipTop}px`;
    tooltip.style.left = `${tipLeft}px`;
  }

  function reposition() {
    if (!currentStep) return;
    if (currentStep.selector) {
      const target = document.querySelector(currentStep.selector);
      if (target) positionFor(target, {
        moveTooltip: !currentStep.keepTooltipPosition,
        clickThrough: isStepClickThrough(currentStep),
      });
    } else if (!currentStep.keepTooltipPosition) {
      positionFloating(currentStep.tooltipPosition);
    }
  }

  function isStepClickThrough(step) {
    return step.advanceOn === 'click'
      || step.handoff?.mode === 'inPage'
      || step.handoff?.mode === 'crossDocument'
      || step.nonBlocking === true;
  }

  async function showStep(index) {
    if (stopped) return;
    if (index >= steps.length) return finish(false);
    if (index < 0) index = 0;

    const step = steps[index];

    const direction = index < currentIndex ? 'backward' : 'forward';

    if (step.selector) {
      const target = document.querySelector(step.selector);
      if (!target) {
        currentIndex = index;
        return showStep(direction === 'backward' ? index - 1 : index + 1);
      }
    }

    if (currentStep && currentStep.onExit) {
      try { await currentStep.onExit({ direction }); } catch (_e) {}
    }
    if (advanceClickCleanup) {
      advanceClickCleanup();
      advanceClickCleanup = null;
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    currentStep = step;
    currentIndex = index;

    if (step.onEnter) {
      try { await step.onEnter({ direction }); } catch (_e) {}
    }

    titleEl.textContent = step.title || '';
    bodyEl.textContent = step.body || '';
    counterEl.textContent = `${index + 1} / ${steps.length}`;
    prevBtn.disabled = index === 0;

    const isHandoff = !!step.handoff;
    const advanceOnClick = step.advanceOn === 'click';
    // A handoff/click-driven step normally hides Next since the user is meant to
    // act on the page itself to advance — but if that action depends on
    // something outside our control (e.g. clicking a browser toolbar icon),
    // `skippable` lets the step offer an explicit way past it instead of
    // stranding a user for whom that action isn't working.
    const skippable = step.skippable === true && (isHandoff || advanceOnClick);
    nextBtn.style.display = (isHandoff || advanceOnClick) && !skippable ? 'none' : '';
    nextBtn.textContent = skippable ? t('tour_skip') : (index === steps.length - 1 ? t('tour_finish') : t('tour_next'));

    tooltip.classList.toggle('has-arrow-up', step.arrow === 'up');
    const wasModalStep = document.body.classList.contains('tour-modal-step');
    const isModalStep = step.modalStep === true;
    document.body.classList.toggle('tour-modal-step', isModalStep);
    if (wasModalStep && !isModalStep) {
      document.dispatchEvent(new CustomEvent('tour:modal-step-leave'));
    }
    document.body.classList.toggle('tour-drill-step', step.drillStep === true);

    document.querySelectorAll('.tour-target').forEach(el => el.classList.remove('tour-target'));

    let anchorPositioned = false;
    if (step.keepTooltipPosition) {
      for (let i = index - 1; i >= 0; i--) {
        const prev = steps[i];
        if (!prev.selector || prev.keepTooltipPosition) continue;
        const prevTarget = document.querySelector(prev.selector);
        if (!prevTarget) continue;
        positionTooltipFor(prevTarget);
        anchorPositioned = true;
        break;
      }
    }

    const keepPos = anchorPositioned;

    if (step.selector) {
      const liveTarget = document.querySelector(step.selector);
      if (!liveTarget) return showStep(index + 1);
      liveTarget.classList.add('tour-target');
      positionFor(liveTarget, {
        moveTooltip: !keepPos,
        clickThrough: isStepClickThrough(step),
      });
      if (advanceOnClick) {
        const handler = () => showStep(currentIndex + 1);
        liveTarget.addEventListener('click', handler, { once: true });
        advanceClickCleanup = () => liveTarget.removeEventListener('click', handler);
      }
      resizeObserver = new ResizeObserver(reposition);
      resizeObserver.observe(liveTarget);
    } else if (!keepPos) {
      positionFloating(step.tooltipPosition);
    }

    if (isHandoff) {
      handoffEngaged = true;
      handoffTarget = step.handoff.nextSurface;
      await setTourProgress(step.handoff.nextSurface, step.handoff.nextStepIndex ?? 0);
    } else {
      handoffEngaged = false;
      handoffTarget = null;
      await setTourProgress(surface, index);
    }

    focusTourStep(step);
  }

  // What's reachable inside the spotlighted target: either the target itself
  // (if it's directly focusable, e.g. a click-driven step's own button), or —
  // when the step declares `focusSelector` — only elements matching that
  // narrower selector (e.g. just a table's rows, excluding other controls
  // that happen to share the highlighted container), or else every focusable
  // descendant of the target (e.g. a highlighted section with several
  // controls) — so a keyboard user can reach and operate the same things a
  // mouse user can click through the overlay's cutout.
  function getTargetFocusables() {
    if (!currentStep?.selector) return [];
    const target = document.querySelector(currentStep.selector);
    if (!target) return [];
    if (currentStep.focusSelector) {
      return [...target.querySelectorAll(currentStep.focusSelector)]
        .filter(el => !el.disabled && el.offsetParent !== null);
    }
    if (target.tabIndex >= 0 || ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) {
      return [target];
    }
    return [...target.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.disabled && el.offsetParent !== null);
  }

  // Tab stops for the current step: the tooltip's own visible/enabled buttons
  // plus whatever's reachable inside the spotlighted target.
  function getTourFocusables() {
    const list = [prevBtn, nextBtn, closeBtn].filter(el => el.style.display !== 'none' && !el.disabled);
    list.push(...getTargetFocusables());
    return list;
  }

  function focusTourStep(step) {
    if (isStepClickThrough(step)) {
      const targetFocusables = getTargetFocusables();
      if (targetFocusables.length) { targetFocusables[0].focus(); return; }
    }
    const focusables = getTourFocusables();
    if (!focusables.length) return;
    (focusables.includes(nextBtn) ? nextBtn : focusables[0]).focus();
  }

  async function finish(skipped) {
    if (stopped) return;
    stopped = true;
    if (currentStep && currentStep.onExit) {
      try { await currentStep.onExit(); } catch (_e) {}
    }
    if (advanceClickCleanup) { advanceClickCleanup(); advanceClickCleanup = null; }
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    document.querySelectorAll('.tour-target').forEach(el => el.classList.remove('tour-target'));
    document.body.classList.remove('tour-drill-step');
    if (document.body.classList.contains('tour-modal-step')) {
      document.body.classList.remove('tour-modal-step');
      document.dispatchEvent(new CustomEvent('tour:modal-step-leave'));
    }
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
    document.removeEventListener('keydown', onKeydown);
    host.prefs.offChanged(onStorageChanged);
    overlay.remove();
    spotlight.remove();
    tooltip.remove();
    closeBtn.remove();
    confirm.remove();
    if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    if (skipped || !handoffEngaged) {
      await markTourCompleted();
    }
    if (onClose) onClose({ skipped });
  }

  function onKeydown(e) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!currentStep) return;
    const confirmOpen = confirm.style.display !== 'none';
    if (confirmOpen && e.key === 'Escape') { e.preventDefault(); confirmNo.click(); return; }
    if (e.key === 'Tab') {
      const focusables = confirmOpen ? [confirmNo, confirmYes] : getTourFocusables();
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    if (confirmOpen) return; // Enter activates the focused confirm button natively; don't also advance the tour underneath.
    const advanceOnClick = currentStep.advanceOn === 'click';
    const isHandoff = !!currentStep.handoff;
    if (e.key === 'ArrowRight' || e.key === 'Enter') {
      if (advanceOnClick || isHandoff) return;
      e.preventDefault();
      showStep(currentIndex + 1);
    } else if (e.key === 'ArrowLeft') {
      if (currentIndex === 0) return;
      e.preventDefault();
      showStep(currentIndex - 1);
    }
  }

  function onStorageChanged(changes) {
    if (!changes[TOUR_KEY]) return;
    const oldState = { ...DEFAULT_STATE, ...(changes[TOUR_KEY].oldValue || {}) };
    const newState = { ...DEFAULT_STATE, ...(changes[TOUR_KEY].newValue || {}) };
    if (newState.completed && !oldState.completed) return closeQuietly();
    const newSurface = newState.inProgress?.surface;
    if (!newSurface || newSurface === surface) return;
    if (newSurface === handoffTarget) return;
    // If we handed off via crossDocument, keep the overlay alive while the user
    // navigates through other surfaces — only close when the surface returns to
    // this one (handled above) or the tour completes.
    const currentStep = steps[currentIndex];
    if (currentStep?.handoff?.mode === 'crossDocument') return;
    closeQuietly();
  }

  function closeQuietly() {
    if (stopped) return;
    stopped = true;
    if (advanceClickCleanup) { advanceClickCleanup(); advanceClickCleanup = null; }
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    document.querySelectorAll('.tour-target').forEach(el => el.classList.remove('tour-target'));
    document.body.classList.remove('tour-drill-step');
    if (document.body.classList.contains('tour-modal-step')) {
      document.body.classList.remove('tour-modal-step');
      document.dispatchEvent(new CustomEvent('tour:modal-step-leave'));
    }
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
    document.removeEventListener('keydown', onKeydown);
    host.prefs.offChanged(onStorageChanged);
    overlay.remove();
    spotlight.remove();
    tooltip.remove();
    closeBtn.remove();
    confirm.remove();
    if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    if (onClose) onClose({ skipped: false, quiet: true });
  }

  // Skipping a handoff step whose completion depends on something outside our
  // control (see `skippable`) shouldn't just advance to this surface's own next
  // step — that would silently drop any steps reachable only via the handoff
  // (e.g. rules.js's steps, only reachable via the popup). `skipTo` lets a step
  // redirect straight to the surface/step that a successful handoff chain would
  // have eventually reached, so nothing downstream becomes unreachable.
  // Mirrors how a normal inPage handoff works: set the pending progress, then
  // actually navigate there ourselves (skipTo.url) rather than tearing the tour
  // down with nothing to pick it back up — a real navigation unloads this page
  // (and its tour instance) naturally, and the destination page's own
  // autoStartIfMatches resumes the tour on load, same as clicking a nav button.
  async function skipCurrentStep(step) {
    if (!step.skipTo) { showStep(currentIndex + 1); return; }
    await setTourProgress(step.skipTo.nextSurface, step.skipTo.nextStepIndex ?? 0);
    if (step.skipTo.url) window.location.href = step.skipTo.url;
    else finish(false);
  }

  prevBtn.addEventListener('click', () => showStep(currentIndex - 1));
  nextBtn.addEventListener('click', () => {
    const step = currentStep;
    const skippable = step?.skippable === true && (!!step?.handoff || step?.advanceOn === 'click');
    if (skippable) skipCurrentStep(step);
    else showStep(currentIndex + 1);
  });
  closeBtn.addEventListener('click', () => { confirm.style.display = ''; confirmNo.focus(); });
  confirmNo.addEventListener('click', () => { confirm.style.display = 'none'; closeBtn.focus(); });
  confirmYes.addEventListener('click', () => finish(true));
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
  document.addEventListener('keydown', onKeydown);
  host.prefs.onChanged(onStorageChanged);

  showStep(startIndex);

  return {
    stop: () => finish(true),
    goto: (index) => { if (!stopped) showStep(index); },
    getIndex: () => currentIndex,
  };
}

export async function autoStartIfMatches(surface, steps, options = {}) {
  const state = await readTourState();
  if (state.completed) return null;

  const pendingSurface = state.inProgress?.surface;
  if (!pendingSurface) return null;
  if (pendingSurface === surface) {
    return runTour({
      surface,
      steps,
      startIndex: state.inProgress.stepIndex || 0,
      ...options,
    });
  }
  const handoffIdx = steps.findIndex(s => s.handoff?.nextSurface === pendingSurface);
  if (handoffIdx >= 0) {
    return runTour({
      surface,
      steps,
      startIndex: handoffIdx,
      ...options,
    });
  }
  return null;
}
