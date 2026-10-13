import { useEffect, useRef } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { AdminVenues } from './pages/AdminVenues';
import { Booking } from './pages/Booking';
import { BookingDetail } from './pages/BookingDetail';
import { Browse } from './pages/Browse';
import { EventDetail } from './pages/EventDetail';
import { MyBookings } from './pages/MyBookings';
import { OfferClaim } from './pages/OfferClaim';
import { Organiser } from './pages/Organiser';
import { SignIn } from './pages/SignIn';
import { ToastProvider } from './components/Toast';
import type { ReactNode } from 'react';
import type { Role } from './types';

const RequireRole = ({ roles, children }: { roles: Role[]; children: ReactNode }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <p className="muted">Loading...</p>;
  if (!user) return <Navigate to="/signin" state={{ from: location.pathname }} replace />;
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;

  return <>{children}</>;
};

const Nav = () => {
  const { user, signOut } = useAuth();

  return (
    <header className="topbar">
      <Link to="/" className="brand">
        SeatWise
      </Link>

      <nav>
        <Link to="/">What's on</Link>
        {user?.role === 'customer' && <Link to="/bookings">My bookings</Link>}
        {user?.role === 'organiser' && <Link to="/organiser">Dashboard</Link>}
        {user?.role === 'admin' && <Link to="/venues">Venues</Link>}
      </nav>

      <div className="topbar-user">
        {user ? (
          <>
            <span className="muted small">
              {user.name} <em>({user.role})</em>
            </span>
            <button type="button" className="ghost small" onClick={signOut}>
              Sign out
            </button>
          </>
        ) : (
          <Link className="button small" to="/signin">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
};

const ParallaxBackground = () => {
  const bgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mediaQuery.matches) {
      return;
    }

    let rafId: number | null = null;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let isRunning = false;

    const animate = () => {
      currentX += (targetX - currentX) * 0.08;
      currentY += (targetY - currentY) * 0.08;

      if (bgRef.current) {
        bgRef.current.style.transform = `translate3d(${-currentX.toFixed(2)}px, ${-currentY.toFixed(2)}px, 0)`;
      }

      const diff = Math.abs(targetX - currentX) + Math.abs(targetY - currentY);
      if (diff > 0.05) {
        rafId = requestAnimationFrame(animate);
      } else {
        isRunning = false;
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      targetX = (e.clientX / window.innerWidth - 0.5) * 40;
      targetY = (e.clientY / window.innerHeight - 0.5) * 40;

      if (!isRunning) {
        isRunning = true;
        rafId = requestAnimationFrame(animate);
      }
    };

    const handleMediaChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        if (rafId) cancelAnimationFrame(rafId);
        window.removeEventListener('mousemove', handleMouseMove);
        if (bgRef.current) bgRef.current.style.transform = 'translate3d(0, 0, 0)';
      } else {
        window.addEventListener('mousemove', handleMouseMove, { passive: true });
      }
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    mediaQuery.addEventListener('change', handleMediaChange);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('mousemove', handleMouseMove);
      mediaQuery.removeEventListener('change', handleMediaChange);
    };
  }, []);

  return (
    <div className="parallax-bg-wrapper" aria-hidden="true">
      <div ref={bgRef} className="parallax-bg-canvas">
        <div className="parallax-orb orb-1" />
        <div className="parallax-orb orb-2" />
        <div className="parallax-orb orb-3" />
        <div className="parallax-grid-overlay" />
      </div>
    </div>
  );
};

export const App = () => (
  <ToastProvider>
    <ParallaxBackground />
    <Nav />

    <main>
      <Routes>
        <Route path="/" element={<Browse />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/events/:eventId" element={<EventDetail />} />
        <Route path="/shows/:showId" element={<Booking />} />

        <Route
          path="/bookings"
          element={
            <RequireRole roles={['customer']}>
              <MyBookings />
            </RequireRole>
          }
        />
        <Route
          path="/bookings/:bookingId"
          element={
            <RequireRole roles={['customer']}>
              <BookingDetail />
            </RequireRole>
          }
        />
        <Route path="/offer/:token" element={<OfferClaim />} />
        <Route
          path="/organiser"
          element={
            <RequireRole roles={['organiser']}>
              <Organiser />
            </RequireRole>
          }
        />
        <Route
          path="/venues"
          element={
            <RequireRole roles={['admin']}>
              <AdminVenues />
            </RequireRole>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </main>

    <footer className="footer">
      <p className="muted small">SeatWise — seat holds expire automatically and waitlisted seats are offered in turn.</p>
    </footer>
  </ToastProvider>
);
