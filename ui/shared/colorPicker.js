import { t } from './i18n.js';

function hsvToHex(h, s, v) {
  const f = n => {
    const k = (n + h / 60) % 6;
    const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

function hexToHsv(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

function normalizeHex(raw) {
  const hex = raw.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(hex)) return `#${hex}`;
  if (/^[0-9a-f]{3}$/.test(hex)) return `#${hex.split('').map(c => c + c).join('')}`;
  return null;
}

export function buildColorPicker(id, initColor, onChange, { labelledBy } = {}) {
  const wrap = document.querySelector(`#${id}`);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = `${id}-btn`;
  btn.className = 'dropdown-btn color-btn';
  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');
  // Combine the external row label (e.g. "Active time") with the button's own
  // visible text (the hex value) rather than letting aria-labelledby replace it
  // outright — referencing the button's own id contributes its text content at
  // that position in the accessible-name concatenation.
  if (labelledBy) btn.setAttribute('aria-labelledby', `${labelledBy} ${btn.id}`);
  btn.innerHTML = '<span class="color-swatch color-btn-swatch"></span><span class="color-btn-label"></span>';
  const btnSwatch = btn.querySelector('.color-btn-swatch');
  const btnLabel = btn.querySelector('.color-btn-label');

  const popup = document.createElement('div');
  popup.className = 'dropdown-menu color-popup';

  const area = document.createElement('div');
  area.className = 'color-picker-area';
  const svBox = document.createElement('div');
  svBox.className = 'color-sv';
  svBox.tabIndex = 0;
  svBox.setAttribute('role', 'slider');
  svBox.setAttribute('aria-label', t('colorPicker_svLabel'));
  const svMarker = document.createElement('div');
  svMarker.className = 'color-sv-marker';
  svBox.append(svMarker);
  const hueBar = document.createElement('div');
  hueBar.className = 'color-hue';
  hueBar.tabIndex = 0;
  hueBar.setAttribute('role', 'slider');
  hueBar.setAttribute('aria-valuemin', '0');
  hueBar.setAttribute('aria-valuemax', '360');
  hueBar.setAttribute('aria-label', t('colorPicker_hueLabel'));
  const hueThumb = document.createElement('div');
  hueThumb.className = 'color-hue-thumb';
  hueBar.append(hueThumb);
  area.append(svBox, hueBar);

  const hexRow = document.createElement('div');
  hexRow.className = 'color-hex-row';
  const hexInput = document.createElement('input');
  hexInput.type = 'text';
  hexInput.className = 'text-input color-hex-input';
  hexInput.placeholder = '#rrggbb';
  hexInput.maxLength = 7;
  const defaultBtn = document.createElement('button');
  defaultBtn.type = 'button';
  defaultBtn.className = 'link-btn';
  defaultBtn.textContent = t('colorPicker_default');
  hexRow.append(hexInput, defaultBtn);

  popup.append(area, hexRow);
  wrap.append(btn, popup);

  let hsv = { h: 0, s: 0, v: 0 };

  function renderPicker() {
    svBox.style.backgroundColor = `hsl(${hsv.h}, 100%, 50%)`;
    svMarker.style.left = `${hsv.s * 100}%`;
    svMarker.style.top = `${(1 - hsv.v) * 100}%`;
    hueThumb.style.top = `${(hsv.h / 360) * 100}%`;
    // role="slider" is a compromise on svBox (it's genuinely 2D — saturation and
    // brightness together — with no matching ARIA widget), but aria-valuetext
    // still gives a screen reader something better than silence as it changes.
    svBox.setAttribute('aria-valuetext', t('colorPicker_svValue', [Math.round(hsv.s * 100), Math.round(hsv.v * 100)]));
    const hueDeg = Math.round(hsv.h);
    hueBar.setAttribute('aria-valuenow', hueDeg);
    hueBar.setAttribute('aria-valuetext', t('colorPicker_hueValue', [hueDeg]));
  }

  // preview keeps hsv authoritative: recomputing it from the hex would lose
  // hue when saturation or value hits 0 and snap the markers to red
  function preview() {
    const color = hsvToHex(hsv.h, hsv.s, hsv.v);
    btn.dataset.value = color;
    btnSwatch.style.background = color;
    btnLabel.textContent = color;
    hexInput.value = color;
    renderPicker();
  }

  function setValue(color) {
    hsv = hexToHsv(color);
    btn.dataset.value = color;
    btnSwatch.style.background = color;
    btnLabel.textContent = color;
    hexInput.value = color;
    renderPicker();
  }
  setValue(initColor);

  function dragHandler(el, onMove) {
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      onMove(e);
      const move = ev => onMove(ev);
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        onChange(btn.dataset.value);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
  }

  dragHandler(svBox, e => {
    const r = svBox.getBoundingClientRect();
    hsv.s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    hsv.v = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    preview();
  });

  dragHandler(hueBar, e => {
    const r = hueBar.getBoundingClientRect();
    hsv.h = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) * 360;
    preview();
  });

  const clamp01 = v => Math.min(1, Math.max(0, v));

  // commit on keyup so holding an arrow key previews live but writes storage once
  function commitOnArrowKeyup(el) {
    el.addEventListener('keyup', e => {
      if (e.key.startsWith('Arrow')) onChange(btn.dataset.value);
    });
  }

  svBox.addEventListener('keydown', e => {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowLeft') hsv.s = clamp01(hsv.s - step);
    else if (e.key === 'ArrowRight') hsv.s = clamp01(hsv.s + step);
    else if (e.key === 'ArrowUp') hsv.v = clamp01(hsv.v + step);
    else if (e.key === 'ArrowDown') hsv.v = clamp01(hsv.v - step);
    else return;
    e.preventDefault();
    preview();
  });
  commitOnArrowKeyup(svBox);

  hueBar.addEventListener('keydown', e => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') hsv.h = Math.max(0, hsv.h - step);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') hsv.h = Math.min(360, hsv.h + step);
    else return;
    e.preventDefault();
    preview();
  });
  commitOnArrowKeyup(hueBar);

  popup.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    popup.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    btn.focus();
  });

  hexInput.addEventListener('change', () => {
    const color = normalizeHex(hexInput.value);
    if (color) {
      setValue(color);
      onChange(color);
    } else {
      hexInput.value = btn.dataset.value;
    }
  });

  defaultBtn.addEventListener('click', () => {
    popup.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    onChange(null);
  });

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = popup.classList.contains('open');
    document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
    if (!isOpen) {
      delete wrap.dataset.direction;
      popup.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      if (popup.getBoundingClientRect().bottom > window.innerHeight) wrap.dataset.direction = 'up';
      svBox.focus();
    } else {
      btn.setAttribute('aria-expanded', 'false');
    }
  });
  popup.addEventListener('click', e => e.stopPropagation());

  return { setValue };
}
