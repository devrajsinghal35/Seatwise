import type { CSSProperties } from 'react';

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  style?: CSSProperties;
}

export const Skeleton = ({ className = '', width, height, borderRadius, style }: SkeletonProps) => {
  return (
    <div
      className={`skeleton ${className}`.trim()}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
        borderRadius: typeof borderRadius === 'number' ? `${borderRadius}px` : borderRadius,
        ...style,
      }}
      aria-hidden="true"
    />
  );
};

export const EventGridSkeleton = () => (
  <div className="event-grid" aria-label="Loading events..." role="status">
    {Array.from({ length: 6 }).map((_, i) => (
      <div key={i} className="card event-card skeleton-card">
        <Skeleton width={60} height={20} borderRadius={99} />
        <Skeleton width="80%" height={24} style={{ marginTop: 12, marginBottom: 8 }} />
        <Skeleton width="50%" height={16} style={{ marginBottom: 16 }} />
        <Skeleton width="100%" height={40} style={{ marginBottom: 12 }} />
        <Skeleton width="60%" height={16} style={{ marginBottom: 16 }} />
        <Skeleton width="100%" height={38} borderRadius={8} />
      </div>
    ))}
  </div>
);

export const ShowListSkeleton = () => (
  <div className="show-list" aria-label="Loading showings..." role="status">
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="card show-row skeleton-card">
        <div style={{ flex: 1 }}>
          <Skeleton width={180} height={20} style={{ marginBottom: 6 }} />
          <Skeleton width={120} height={14} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <Skeleton width={80} height={16} />
          <Skeleton width={100} height={14} />
        </div>
        <Skeleton width={110} height={38} borderRadius={8} />
      </div>
    ))}
  </div>
);

export const SeatMapSkeleton = () => (
  <div className="booking-layout" aria-label="Loading seating map..." role="status">
    <div className="seatmap skeleton-card" style={{ minHeight: 380 }}>
      <Skeleton width="60%" height={24} style={{ margin: '0 auto 24px' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
        {Array.from({ length: 5 }).map((_, r) => (
          <div key={r} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Skeleton width={20} height={20} borderRadius={4} />
            <div style={{ display: 'flex', gap: 6 }}>
              {Array.from({ length: 10 }).map((_, s) => (
                <Skeleton key={s} width={34} height={34} borderRadius={8} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 28 }}>
        <Skeleton width={90} height={20} />
        <Skeleton width={90} height={20} />
        <Skeleton width={90} height={20} />
      </div>
    </div>
    <div className="card summary skeleton-card" style={{ minHeight: 320 }}>
      <Skeleton width="60%" height={24} style={{ marginBottom: 16 }} />
      <Skeleton width="100%" height={18} style={{ marginBottom: 8 }} />
      <Skeleton width="80%" height={18} style={{ marginBottom: 24 }} />
      <Skeleton width="100%" height={44} borderRadius={8} style={{ marginTop: 'auto' }} />
    </div>
  </div>
);

export const BookingsSkeleton = () => (
  <ul className="stack" aria-label="Loading bookings..." role="status">
    {Array.from({ length: 3 }).map((_, i) => (
      <li key={i} className="card row skeleton-card">
        <div style={{ flex: 1 }}>
          <Skeleton width={200} height={22} style={{ marginBottom: 8 }} />
          <Skeleton width={160} height={16} />
        </div>
        <Skeleton width={100} height={36} borderRadius={8} />
      </li>
    ))}
  </ul>
);
