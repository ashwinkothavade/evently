# @evently/frontend

The Evently web app: **React 19 + Vite + Chakra UI v3**, with TanStack Query for server state and React Router.

## Run
```bash
npm run dev -w @evently/frontend    # http://localhost:5173, proxies /api → http://localhost:8080
npm run build -w @evently/frontend  # → dist/
```
To call a gateway on another origin, set `VITE_API_URL=https://<gateway>` at build time.

## Screens
| Route | Who | What |
|---|---|---|
| `/` | everyone | Upcoming events: search, "available only", infinite list |
| `/events/:id` | everyone | Details, live availability, booking panel (quantity, *best available* or seat picker), waitlist when sold out |
| `/bookings` | user | Active/cancelled bookings, cancel, add to calendar, waitlist positions |
| `/notifications` | user | Inbox; the navbar bell shows the unread count |
| `/login`, `/register` | guests | Field-level validation errors from the API |
| `/admin/events` | admin | Event table with sales bars; create/edit (optimistic locking), cancel, attendee drawer |
| `/admin/analytics` | admin | KPI tiles, daily activity chart (with table view), most popular events, utilization, integrity badge |

Admin screens and the charting library are **lazy-loaded**, so regular users never download them.

## Design consistency
- One design system in [`src/theme/system.ts`](src/theme/system.ts): the `brand` palette as semantic tokens for light and dark, the `card` layer style, and Inter typography.
- Shared building blocks in `src/components/` (`PageHeader`, `EventCard`, `AvailabilityBar`, `Empty`/`ErrorState`/skeletons, `ConfirmDialog`, `SeatPicker`, `QuantityPicker`). Every page composes these instead of styling ad hoc.
- Availability is always shown with the same color logic (`availabilityTone`): green available, orange ≤ 20% left, red sold out, each with a text label.
- Chart colors (`chart.*` tokens) were checked with a colorblind-safety and contrast validator in both modes. Every chart has a legend or title, hover tooltips, and a table view for the daily series.
- Light and dark mode, persisted per user.

## Data layer
- `src/api/client.ts`: fetch wrapper with the JWT, typed `ApiError` (`status`, `code`, `details`) and a global 401 → sign-out.
- `src/api/hooks.ts`: one hook per endpoint. Mutations invalidate the affected queries. Event details and seat maps refresh every 10s; notifications every 15s.
- Bookings send an **`Idempotency-Key`** per attempt, so double-clicks and network retries can't double-book.
