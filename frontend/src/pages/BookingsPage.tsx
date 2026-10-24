import { Badge, Box, Button, Center, Flex, Heading, HStack, Icon, Link, Stack, Tabs, Text } from '@chakra-ui/react';
import { useState } from 'react';
import { LuArmchair, LuCalendar, LuCalendarPlus, LuHourglass, LuMapPin, LuTicket, LuX } from 'react-icons/lu';
import { Link as RouterLink } from 'react-router';
import { download } from '../api/client';
import { useBookings, useCancelBooking, useLeaveWaitlist, useWaitlist } from '../api/hooks';
import type { Booking } from '../api/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PageHeader } from '../components/PageHeader';
import { Empty, ErrorState, ListSkeleton } from '../components/States';
import { toaster } from '../components/toaster';
import { formatDateTime, formatPrice, timeAgo } from '../lib/format';

function BookingCard({ booking, onCancel }: { booking: Booking; onCancel: (b: Booking) => void }) {
  const upcoming = new Date(booking.event.startsAt) > new Date();
  const active = booking.status === 'confirmed' && booking.event.status !== 'cancelled';
  const seats = booking.seats.map((s) => `${s.row}${s.number}`).join(', ');

  return (
    <Flex layerStyle="card" p="5" gap="5" direction={{ base: 'column', md: 'row' }} align={{ md: 'center' }} opacity={active ? 1 : 0.7}>
      <Flex boxSize="14" flexShrink="0" borderRadius="xl" bg={active ? 'brand.subtle' : 'bg.muted'} color={active ? 'brand.fg' : 'fg.muted'} align="center" justify="center">
        <Icon boxSize="6"><LuTicket /></Icon>
      </Flex>
      <Stack gap="1.5" flex="1">
        <HStack gap="2" wrap="wrap">
          <Link asChild fontWeight="semibold" fontSize="lg">
            <RouterLink to={`/events/${booking.eventId}`}>{booking.event.name}</RouterLink>
          </Link>
          {booking.status === 'cancelled' ? (
            <Badge colorPalette="red">Cancelled</Badge>
          ) : booking.event.status === 'cancelled' ? (
            <Badge colorPalette="red">Event cancelled</Badge>
          ) : (
            <Badge colorPalette="green">Confirmed</Badge>
          )}
          {booking.source === 'waitlist' && <Badge colorPalette="brand">From waitlist</Badge>}
        </HStack>
        <HStack gap="4" color="fg.muted" fontSize="sm" wrap="wrap">
          <HStack gap="1"><LuCalendar /> {formatDateTime(booking.event.startsAt)}</HStack>
          <HStack gap="1"><LuMapPin /> {booking.event.venue}</HStack>
          {seats && <HStack gap="1"><LuArmchair /> {seats}</HStack>}
        </HStack>
        <Text fontSize="xs" color="fg.subtle">
          {booking.quantity} ticket(s) · {formatPrice(booking.totalPriceCents)} · booked {timeAgo(booking.createdAt)} · ref {booking.id.slice(0, 8)}
        </Text>
      </Stack>
      {active && upcoming && (
        <HStack gap="2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => download(`/bookings/${booking.id}/calendar.ics`, `evently-${booking.id.slice(0, 8)}.ics`).catch(() => toaster.error({ title: 'Download failed' }))}
          >
            <LuCalendarPlus /> Add to calendar
          </Button>
          <Button variant="ghost" colorPalette="red" size="sm" onClick={() => onCancel(booking)}>
            <LuX /> Cancel
          </Button>
        </HStack>
      )}
    </Flex>
  );
}

function WaitlistSection() {
  const waitlist = useWaitlist();
  const leave = useLeaveWaitlist();
  const waiting = waitlist.data?.filter((w) => w.status === 'waiting') ?? [];
  if (waiting.length === 0) return null;

  return (
    <Stack gap="3" mb="8">
      <Heading size="md">On the waitlist</Heading>
      {waiting.map((entry) => (
        <Flex key={entry.id} layerStyle="card" p="4" gap="4" align="center" borderColor="brand.emphasized">
          <Flex boxSize="10" borderRadius="lg" bg="brand.subtle" color="brand.fg" align="center" justify="center"><LuHourglass /></Flex>
          <Stack gap="0" flex="1">
            <Link asChild fontWeight="semibold"><RouterLink to={`/events/${entry.eventId}`}>{entry.event?.name}</RouterLink></Link>
            <Text fontSize="sm" color="fg.muted">Position #{entry.position} · {entry.quantity} ticket(s) · we'll book automatically when a spot opens</Text>
          </Stack>
          <Button size="sm" variant="ghost" loading={leave.isPending && leave.variables === entry.eventId} onClick={() => leave.mutate(entry.eventId, {
            onSuccess: () => toaster.info({ title: 'You left the waitlist' }),
          })}>
            Leave
          </Button>
        </Flex>
      ))}
    </Stack>
  );
}

export function BookingsPage() {
  const [tab, setTab] = useState<'confirmed' | 'cancelled' | 'all'>('confirmed');
  const bookings = useBookings(tab === 'all' ? undefined : tab);
  const cancel = useCancelBooking();
  const [toCancel, setToCancel] = useState<Booking | null>(null);
  const items = bookings.data?.pages.flatMap((p) => p.data) ?? [];

  const confirmCancel = () => {
    if (!toCancel) return;
    cancel.mutate(toCancel.id, {
      onSuccess: () => {
        toaster.success({ title: 'Booking cancelled', description: 'Your tickets were released.' });
        setToCancel(null);
      },
      onError: (err) => toaster.error({ title: 'Could not cancel', description: err.message }),
    });
  };

  return (
    <Box>
      <PageHeader title="My bookings" description="Your tickets, waitlist spots and booking history." />
      <WaitlistSection />
      <Tabs.Root value={tab} onValueChange={(e) => setTab(e.value as typeof tab)} colorPalette="brand" variant="line" mb="6">
        <Tabs.List>
          <Tabs.Trigger value="confirmed">Active</Tabs.Trigger>
          <Tabs.Trigger value="cancelled">Cancelled</Tabs.Trigger>
          <Tabs.Trigger value="all">All</Tabs.Trigger>
        </Tabs.List>
      </Tabs.Root>

      {bookings.isPending ? (
        <ListSkeleton />
      ) : bookings.isError ? (
        <ErrorState error={bookings.error} onRetry={() => bookings.refetch()} />
      ) : items.length === 0 ? (
        <Empty
          icon={<LuTicket />}
          title={tab === 'cancelled' ? 'No cancelled bookings' : 'No bookings yet'}
          description="When you book tickets they'll show up here."
          action={<Button asChild colorPalette="brand"><RouterLink to="/">Browse events</RouterLink></Button>}
        />
      ) : (
        <Stack gap="4">
          {items.map((b) => <BookingCard key={b.id} booking={b} onCancel={setToCancel} />)}
          {bookings.hasNextPage && (
            <Center mt="4">
              <Button variant="outline" onClick={() => bookings.fetchNextPage()} loading={bookings.isFetchingNextPage}>Load more</Button>
            </Center>
          )}
        </Stack>
      )}

      <ConfirmDialog
        open={toCancel !== null}
        title="Cancel this booking?"
        body={toCancel && <Text>Your {toCancel.quantity} ticket(s) for <b>{toCancel.event.name}</b> will be released and may go to someone on the waitlist. This can't be undone.</Text>}
        confirmLabel="Cancel booking"
        destructive
        loading={cancel.isPending}
        onConfirm={confirmCancel}
        onClose={() => setToCancel(null)}
      />
    </Box>
  );
}
