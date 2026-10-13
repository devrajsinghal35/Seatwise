import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';

export type ToastType = 'info' | 'success' | 'error' | 'warning';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((current) => [...current, { id, type, message }]);

      // Auto dismiss after 5 seconds
      setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== id));
      }, 5000);
    },
    []
  );

  return (
    <ToastContext.Provider value={{ toast, removeToast }}>
      {children}
      <div
        className="toast-container"
        role="region"
        aria-label="Notifications"
        aria-live="polite"
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            className={`toast toast-${item.type}`}
            role={item.type === 'error' ? 'alert' : 'status'}
          >
            <div className="toast-content">
              <span className="toast-icon" aria-hidden="true">
                {item.type === 'success' && '✓'}
                {item.type === 'error' && '✕'}
                {item.type === 'warning' && '⚠'}
                {item.type === 'info' && 'ℹ'}
              </span>
              <span className="toast-message">{item.message}</span>
            </div>
            <button
              type="button"
              className="toast-dismiss"
              onClick={() => removeToast(item.id)}
              aria-label="Dismiss notification"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
