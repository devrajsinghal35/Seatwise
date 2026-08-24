export type Role = 'customer' | 'organiser' | 'admin';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
}

export type SeatStatus = 'available' | 'held' | 'booked';

export interface Seat {
  id: number;
  rowLabel: string;
  seatNumber: number;
  label: string;
  categoryId: number;
  category: string;
  price: number;
  status: SeatStatus;
  heldByMe: boolean;
  holdExpiresAt: number | null;
  holdKind: 'checkout' | 'offer' | null;
}

export interface CategorySummary {
  categoryId: number;
  category: string;
  price: number | null;
  total: number;
  available: number;
}

export interface Hold {
  seatIds: number[];
  holdExpiresAt: number;
  holdTtlSeconds?: number;
  total: number;
}

export interface SeatMap {
  seats: Seat[];
  categories: CategorySummary[];
  hold: Hold | null;
}

export interface EventListing {
  id: number;
  title: string;
  kind: 'movie' | 'concert';
  description: string;
  language: string;
  runtimeMin: number | null;
  organiser: string;
  showCount: number;
  nextShowAt: string;
}

export interface ShowListing {
  id: number;
  eventId: number;
  startsAt: string;
  venueId: number;
  venueName: string;
  venueCity: string;
  seats: number;
  available: number;
  fromPrice: number | null;
}

export interface EventDetail extends Omit<EventListing, 'showCount' | 'nextShowAt'> {
  organiserId: number;
  shows: ShowListing[];
}

export interface ShowDetail extends ShowListing {
  event: Pick<EventListing, 'id' | 'title' | 'kind' | 'description' | 'language' | 'runtimeMin'>;
}

export interface BookedSeat {
  label: string;
  category: string;
  price: number;
}

export interface Booking {
  id: number;
  reference: string;
  amount: number;
  status: 'confirmed' | 'cancelled';
  source: 'checkout' | 'waitlist_offer';
  createdAt: string;
  cancelledAt: string | null;
  showId: number;
  startsAt: string;
  title: string;
  kind: 'movie' | 'concert';
  venueName: string;
  venueCity: string;
  seats: BookedSeat[];
}

export interface WaitlistEntry {
  id: number;
  status: 'waiting' | 'offered';
  offerExpiresAt: number | null;
  offerToken: string | null;
  category: string;
  title: string;
  startsAt: string;
  showId: number;
  venueName: string;
  position: number | null;
}

export interface Offer {
  id: number;
  status: string;
  expiresAt: number;
  expired: boolean;
  showSeatId: number;
  showId: number;
  price: number;
  rowLabel: string;
  seatNumber: number;
  category: string;
  title: string;
  kind: string;
  startsAt: string;
  venueName: string;
  venueCity: string;
}

export interface Venue {
  id: number;
  name: string;
  city: string;
  seatCount: number;
  categories: { id: number; name: string }[];
}

export interface EventRevenue {
  event: { id: number; title: string; kind: string };
  revenue: number;
  refunded: number;
  confirmedBookings: number;
  cancelledBookings: number;
  seats: number;
  booked: number;
  occupancy: number;
  waiting: number;
  byCategory: { category: string; seats: number; booked: number; revenue: number }[];
  shows: {
    id: number;
    startsAt: string;
    venueName: string;
    venueCity: string;
    seats: number;
    booked: number;
    revenue: number;
    bookings: number;
    occupancy: number;
  }[];
}
