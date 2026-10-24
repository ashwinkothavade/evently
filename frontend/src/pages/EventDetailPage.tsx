import {
  Alert, Badge, Box, Button, Flex, Grid, GridItem, Heading, HStack, Icon, SegmentGroup, Separator, Skeleton, Stack, Text,
} from '@chakra-ui/react';
import { useMemo, useState } from 'react';
import { LuArrowLeft, LuCalendar, LuClock, LuMapPin, LuTicket, LuUsers } from 'react-icons/lu';
import { Link as RouterLink, useNavigate, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { useCreateBooking, useEvent, useJoinWaitlist, useSeatMap, useWaitlist } from '../api/hooks';
import type { EventItem } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AvailabilityBadge, AvailabilityBar } from '../components/EventBits';
import { QuantityPicker } from '../components/QuantityPicker';
import { SeatPicker } from '../components/SeatPicker';
import { ErrorState } from '../components/States';
import { toaster } from '../components/toaster';
import { formatDateTime, formatPrice } from '../lib/format';

function Fact({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <HStack gap="3" color="fg.muted">
      <Flex boxSize="9" borderRadius="lg" bg="brand.subtle" color="brand.fg" align="center" justify="center">
        <Icon boxSize="4">{icon}</Icon>
      </Flex>
      <Text>{children}</Text>
    </HStack>
  );
}

function BookingPanel({ event }: { event: EventItem }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [quantity, setQuantity] = useState(1);
  const [mode, setMode] = useState<'best' | 'pick'>('best');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // One key per booking attempt: a retried click/network retry never double-books.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const seatMap = useSeatMap(event.id, event.isSeated && mode === 'pick');
  const createBooking = useCreateBooking();
  const joinWaitlist = useJoinWaitlist();
  const waitlist = useWaitlist(Boolean(user));
  const myEntry = waitlist.data?.find((w) => w.eventId === event.id && w.status === 'waiting');

  const picking = event.isSeated && mode === 'pick';
  const count = picking ? selected.size : quantity;
  const maxTickets = Math.min(event.maxPerBooking, event.availableSeats);
  const bookable = event.status === 'published' && new Date(event.startsAt) > new Date();

  const toggleSeat = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const book = () => {
    if (!user) return navigate('/login', { state: { from: `/events/${event.id}` } });
    createBooking.mutate(
      { eventId: event.id, idempotencyKey, ...(picking ? { seatIds: [...selected] } : { quantity }) },
      {
        onSuccess: (booking) => {
          setIdempotencyKey(crypto.randomUUID());
          setSelected(new Set());
          const seats = booking.seats.map((s) => `${s.row}${s.number}`).join(', ');
          toaster.success({ title: 'Booking confirmed 🎉', description: seats ? `Your seats: ${seats}` : `${booking.quantity} ticket(s) booked.` });
          navigate('/bookings');
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code !== 'NETWORK_ERROR') setIdempotencyKey(crypto.randomUUID());
          toaster.error({ title: 'Booking failed', description: err.message });
        },
      },
    );
  };

  const join = () => {
    if (!user) return navigate('/login', { state: { from: `/events/${event.id}` } });
    joinWaitlist.mutate(
      { eventId: event.id, quantity },
      {
        onSuccess: (entry) => toaster.success({ title: "You're on the waitlist", description: `Position #${entry.position}. We'll book automatically when a spot opens.` }),
        onError: (err) => toaster.error({ title: 'Could not join waitlist', description: err.message }),
      },
    );
  };

  if (!bookable) {
    return (
      <Alert.Root status={event.status === 'cancelled' ? 'error' : 'info'} borderRadius="card">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>{event.status === 'cancelled' ? 'This event was cancelled' : 'Bookings are closed'}</Alert.Title>
          {event.cancelReason && <Alert.Description>{event.cancelReason}</Alert.Description>}
        </Alert.Content>
      </Alert.Root>
    );
  }

  if (event.soldOut) {
    return (
      <Stack gap="4">
        <Alert.Root status="warning" borderRadius="lg">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Sold out</Alert.Title>
            <Alert.Description>Join the waitlist – if tickets free up we book them for you automatically and notify you.</Alert.Description>
          </Alert.Content>
        </Alert.Root>
        {myEntry ? (
          <Box p="4" borderRadius="lg" bg="brand.subtle" textAlign="center">
            <Text fontWeight="semibold" color="brand.fg">You're #{myEntry.position} on the waitlist</Text>
            <Text fontSize="sm" color="fg.muted">for {myEntry.quantity} ticket(s)</Text>
          </Box>
        ) : (
          <>
            <Flex justify="space-between" align="center">
              <Text fontWeight="medium">Tickets wanted</Text>
              <QuantityPicker value={quantity} max={event.maxPerBooking} onChange={setQuantity} />
            </Flex>
            <Button colorPalette="brand" size="lg" onClick={join} loading={joinWaitlist.isPending}>
              <LuUsers /> Join waitlist
            </Button>
          </>
        )}
      </Stack>
    );
  }

  return (
    <Stack gap="5">
      {event.isSeated && (
        <SegmentGroup.Root value={mode} onValueChange={(e) => setMode(e.value as 'best' | 'pick')} size="sm" w="full">
          <SegmentGroup.Indicator />
          <SegmentGroup.Items flex="1" items={[{ value: 'best', label: 'Best available' }, { value: 'pick', label: 'Pick my seats' }]} />
        </SegmentGroup.Root>
      )}

      {picking ? (
        seatMap.isPending ? <Skeleton h="48" /> : seatMap.data ? (
          <SeatPicker map={seatMap.data} selected={selected} max={event.maxPerBooking} onToggle={toggleSeat} />
        ) : <ErrorState error={seatMap.error} />
      ) : (
        <Flex justify="space-between" align="center">
          <Stack gap="0">
            <Text fontWeight="medium">Tickets</Text>
            <Text fontSize="xs" color="fg.muted">Max {event.maxPerBooking} per booking</Text>
          </Stack>
          <QuantityPicker value={quantity} max={maxTickets} onChange={setQuantity} />
        </Flex>
      )}

      <Separator />
      <Flex justify="space-between" align="baseline">
        <Text color="fg.muted">Total</Text>
        <Text fontSize="2xl" fontWeight="800">{formatPrice(event.priceCents * count)}</Text>
      </Flex>
      <Button colorPalette="brand" size="lg" onClick={book} loading={createBooking.isPending} disabled={count === 0}>
        <LuTicket /> {user ? `Book ${count} ticket${count === 1 ? '' : 's'}` : 'Sign in to book'}
      </Button>
    </Stack>
  );
}

export function EventDetailPage() {
  const { id = '' } = useParams();
  const event = useEvent(id);

  const duration = useMemo(() => {
    if (!event.data?.endsAt) return null;
    const minutes = (new Date(event.data.endsAt).getTime() - new Date(event.data.startsAt).getTime()) / 60_000;
    const hours = Math.round((minutes / 60) * 10) / 10;
    return minutes >= 60 ? `${hours} hour${hours === 1 ? '' : 's'}` : `${minutes} minutes`;
  }, [event.data]);

  if (event.isPending) return <Skeleton h="96" borderRadius="card" />;
  if (event.isError) return <ErrorState error={event.error} onRetry={() => event.refetch()} />;
  const e = event.data;

  return (
    <Stack gap="6">
      <Button asChild variant="ghost" size="sm" alignSelf="start" ml="-3">
        <RouterLink to="/"><LuArrowLeft /> All events</RouterLink>
      </Button>
      <Grid templateColumns={{ base: '1fr', lg: '1fr 400px' }} gap="8" alignItems="start">
        <GridItem>
          <Stack gap="6" layerStyle="card" p={{ base: '6', md: '8' }}>
            <Stack gap="3">
              <HStack gap="2">
                <AvailabilityBadge event={e} />
                {e.isSeated && <Badge colorPalette="brand">Reserved seating</Badge>}
              </HStack>
              <Heading size="3xl" letterSpacing="tight">{e.name}</Heading>
            </Stack>
            <Stack gap="3">
              <Fact icon={<LuCalendar />}>{formatDateTime(e.startsAt)}</Fact>
              {duration && <Fact icon={<LuClock />}>{duration}</Fact>}
              <Fact icon={<LuMapPin />}>{e.venue}</Fact>
            </Stack>
            <AvailabilityBar event={e} size="sm" />
            {e.description && (
              <>
                <Separator />
                <Stack gap="2">
                  <Heading size="md">About this event</Heading>
                  <Text color="fg.muted" whiteSpace="pre-line">{e.description}</Text>
                </Stack>
              </>
            )}
          </Stack>
        </GridItem>
        <GridItem position={{ lg: 'sticky' }} top="24">
          <Stack layerStyle="card" p="6" gap="5">
            <Flex justify="space-between" align="baseline">
              <Heading size="lg">{formatPrice(e.priceCents)}</Heading>
              <Text color="fg.muted" fontSize="sm">per ticket</Text>
            </Flex>
            <BookingPanel event={e} />
          </Stack>
        </GridItem>
      </Grid>
    </Stack>
  );
}
