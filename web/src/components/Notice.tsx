import type { ReactNode } from 'react';

interface NoticeProps {
  kind?: 'error' | 'info' | 'success';
  children: ReactNode;
  onDismiss?: () => void;
}

export const Notice = ({ kind = 'info', children, onDismiss }: NoticeProps) => (
  <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
    <span>{children}</span>
    {onDismiss && (
      <button type="button" className="notice-close" onClick={onDismiss} aria-label="Dismiss">
        &times;
      </button>
    )}
  </div>
);
