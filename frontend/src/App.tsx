import { Center, Spinner } from '@chakra-ui/react';
import { lazy, Suspense, type ReactNode } from 'react';
import { Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { BookingsPage } from './pages/BookingsPage';
import { EventDetailPage } from './pages/EventDetailPage';
import { EventsPage } from './pages/EventsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { NotificationsPage } from './pages/NotificationsPage';

// Admin screens (and the charting library) load only for admins.
const AdminEventsPage = lazy(() => import('./pages/admin/AdminEventsPage').then((m) => ({ default: m.AdminEventsPage })));
const AnalyticsPage = lazy(() => import('./pages/admin/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })));

const admin = (page: ReactNode) => (
  <RequireAuth role="admin">
    <Suspense fallback={<Center py="20"><Spinner size="lg" color="brand.solid" /></Center>}>{page}</Suspense>
  </RequireAuth>
);

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<EventsPage />} />
        <Route path="events/:id" element={<EventDetailPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="bookings" element={<RequireAuth><BookingsPage /></RequireAuth>} />
        <Route path="notifications" element={<RequireAuth><NotificationsPage /></RequireAuth>} />
        <Route path="admin/events" element={admin(<AdminEventsPage />)} />
        <Route path="admin/analytics" element={admin(<AnalyticsPage />)} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
