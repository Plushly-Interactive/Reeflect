const ARROW_ICON = '<svg width="12" height="12" viewBox="0 0 24 24"><polygon points="6,9 18,9 12,17" fill="currentColor" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/></svg>';

export function enhanceNumberInput(id) {
  enhanceNumberInputEl(document.querySelector(`#${id}`));
}

export function enhanceNumberInputEl(input) {
  const wrap = document.createElement('div');
  wrap.className = 'number-input-wrap';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const btns = document.createElement('div');
  btns.className = 'number-input-btns';
  const upBtn = document.createElement('button');
  upBtn.type = 'button';
  upBtn.className = 'number-input-btn number-input-up';
  upBtn.innerHTML = ARROW_ICON;
  const downBtn = document.createElement('button');
  downBtn.type = 'button';
  downBtn.className = 'number-input-btn number-input-down';
  downBtn.innerHTML = ARROW_ICON;
  btns.append(upBtn, downBtn);
  wrap.appendChild(btns);

  function step(dir) {
    input.focus();
    const stepVal = parseFloat(input.step) || 1;
    const min = input.min !== '' ? parseFloat(input.min) : -Infinity;
    const max = input.max !== '' ? parseFloat(input.max) : Infinity;
    let val = parseFloat(input.value);
    if (isNaN(val)) val = 0;
    val = Math.min(max, Math.max(min, val + dir * stepVal));
    input.value = val;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  upBtn.addEventListener('click', () => step(1));
  downBtn.addEventListener('click', () => step(-1));
}
