import { t } from './i18n.js';

export function confirmDialog({ message, confirmLabel = t('confirm_defaultOk'), cancelLabel = t('storage_cancelBtn') }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.id = 'confirm-dialog';
    dialog.className = 'modal-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'confirm-dialog-body');
    dialog.innerHTML = `
      <div id="confirm-dialog-body"></div>
      <div id="confirm-dialog-actions">
        <button id="confirm-dialog-cancel" class="btn"></button>
        <button id="confirm-dialog-ok" class="btn"></button>
      </div>
    `;
    const cancelBtn = dialog.querySelector('#confirm-dialog-cancel');
    const okBtn = dialog.querySelector('#confirm-dialog-ok');
    dialog.querySelector('#confirm-dialog-body').textContent = message;
    cancelBtn.textContent = cancelLabel;
    okBtn.textContent = confirmLabel;

    const overlay = document.createElement('div');
    overlay.id = 'confirm-dialog-overlay';

    function close(result) {
      document.removeEventListener('keydown', onKey);
      dialog.remove();
      overlay.remove();
      resolve(result);
    }
    // Only two focusable elements, so the trap is a direct wrap between them
    // rather than a generic querySelectorAll-based scan.
    function onKey(e) {
      if (e.key === 'Escape') { close(false); return; }
      if (e.key === 'Enter') { close(true); return; }
      if (e.key !== 'Tab') return;
      e.preventDefault();
      (document.activeElement === okBtn ? cancelBtn : okBtn).focus();
    }

    overlay.addEventListener('click', () => close(false));
    cancelBtn.addEventListener('click', () => close(false));
    okBtn.addEventListener('click', () => close(true));
    document.addEventListener('keydown', onKey);

    document.body.append(overlay, dialog);
    okBtn.focus();
  });
}
