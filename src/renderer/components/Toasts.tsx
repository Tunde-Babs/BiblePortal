import { useApp } from '../stores/app';
import { IconClose } from './Icons';

/** Transient feedback, stacked bottom-right above the status bar. */
export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);

  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`} role="status">
          <span className="toast-msg">{t.message}</span>
          <button className="btn icon sm ghost" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <IconClose size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
