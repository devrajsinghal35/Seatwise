import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

export const EmptyState = ({ icon, title, description, action }: EmptyStateProps) => (
  <div className="card empty-state" role="status">
    <div className="empty-state-icon" aria-hidden="true">
      {icon ?? (
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="10" />
          <path d="M8 12h8" />
        </svg>
      )}
    </div>
    <h3 className="empty-state-title">{title}</h3>
    <p className="empty-state-desc muted">{description}</p>
    {action && <div className="empty-state-action">{action}</div>}
  </div>
);

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export const ErrorBanner = ({ message, onRetry, onDismiss }: ErrorBannerProps) => (
  <div className="notice notice-error" role="alert">
    <div className="notice-body">
      <span className="notice-icon" aria-hidden="true">✕</span>
      <span>{message}</span>
    </div>
    <div className="notice-actions">
      {onRetry && (
        <button type="button" className="button small ghost" onClick={onRetry}>
          Try again
        </button>
      )}
      {onDismiss && (
        <button type="button" className="notice-close" onClick={onDismiss} aria-label="Dismiss error">
          &times;
        </button>
      )}
    </div>
  </div>
);
