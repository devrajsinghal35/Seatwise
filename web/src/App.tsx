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
    const handleMouseMove = (e: MouseEvent) => {
      if (!bgRef.current) return;
      // Calculate offset based on mouse position (max 30px translation)
      const x = (e.clientX / window.innerWidth - 0.5) * 60;
      const y = (e.clientY / window.innerHeight - 0.5) * 60;
      // Negative translates it in the opposite direction of the mouse for a parallax feel
      bgRef.current.style.transform = `translate(${-x}px, ${-y}px) scale(1.05)`;
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <div
      ref={bgRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: -1,
        backgroundColor: 'var(--bg)',
        backgroundImage: "url('https://image.tmdb.org/t/p/original/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        filter: 'brightness(0.3) blur(2px)', // Dim and slightly blur so UI is readable
        transition: 'transform 0.1s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        willChange: 'transform',
      }}
    />
  );
};

export const App = () => (
  <>
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
  </>
);
