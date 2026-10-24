import { Box, Button, HStack, IconButton, Input, Menu, Portal, Progress, Stack, Table, Tabs, Text } from '@chakra-ui/react';
import { useState } from 'react';
import { LuEllipsisVertical, LuPencil, LuPlus, LuUsers, LuX } from 'react-icons/lu';
import { useAdminEvents, useCancelEvent } from '../../api/hooks';
import type { EventItem } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { availabilityTone, EventStatusBadge } from '../../components/EventBits';
import { PageHeader } from '../../components/PageHeader';
import { Empty, ErrorState, ListSkeleton } from '../../components/States';
import { toaster } from '../../components/toaster';
import { formatDateTime, formatPrice } from '../../lib/format';
import { AttendeesDrawer } from './AttendeesDrawer';
import { EventFormDialog } from './EventFormDialog';

export function AdminEventsPage() {
  const [status, setStatus] = useState<string>('all');
  const events = useAdminEvents(status === 'all' ? undefined : status);
  const cancelEvent = useCancelEvent();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EventItem | null>(null);
  const [attendeesFor, setAttendeesFor] = useState<EventItem | null>(null);
  const [toCancel, setToCancel] = useState<EventItem | null>(null);
  const [reason, setReason] = useState('');

  const openCreate = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (e: EventItem) => { setEditing(e); setFormOpen(true); };

  const confirmCancel = () => {
    if (!toCancel) return;
    cancelEvent.mutate({ id: toCancel.id, reason: reason || undefined }, {
      onSuccess: (r) => {
        toaster.success({ title: 'Event cancelled', description: `${r.bookingsCancelled} booking(s) cancelled and attendees notified.` });
        setToCancel(null);
        setReason('');
      },
      onError: (err) => toaster.error({ title: 'Could not cancel event', description: err.message }),
    });
  };

  const items = events.data?.data ?? [];

  return (
    <Box>
      <PageHeader
        title="Manage events"
        description="Create, edit and cancel events. Capacity changes are validated against tickets already sold."
        actions={<Button colorPalette="brand" onClick={openCreate}><LuPlus /> New event</Button>}
      />
      <Tabs.Root value={status} onValueChange={(e) => setStatus(e.value)} colorPalette="brand" variant="line" mb="6">
        <Tabs.List>
          {['all', 'published', 'draft', 'cancelled'].map((s) => (
            <Tabs.Trigger key={s} value={s} textTransform="capitalize">{s}</Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs.Root>

      {events.isPending ? (
        <ListSkeleton />
      ) : events.isError ? (
        <ErrorState error={events.error} onRetry={() => events.refetch()} />
      ) : items.length === 0 ? (
        <Empty title="No events here" description="Create your first event to start selling tickets." action={<Button colorPalette="brand" onClick={openCreate}><LuPlus /> New event</Button>} />
      ) : (
        <Box layerStyle="card" overflowX="auto">
          <Table.Root size="md" interactive>
            <Table.Header>
              <Table.Row bg="bg.muted">
                <Table.ColumnHeader>Event</Table.ColumnHeader>
                <Table.ColumnHeader>Date</Table.ColumnHeader>
                <Table.ColumnHeader>Status</Table.ColumnHeader>
                <Table.ColumnHeader minW="48">Sales</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Price</Table.ColumnHeader>
                <Table.ColumnHeader w="12" />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {items.map((e) => {
                const tone = availabilityTone(e);
                const sold = e.capacity - e.availableSeats;
                return (
                  <Table.Row key={e.id}>
                    <Table.Cell>
                      <Text fontWeight="semibold">{e.name}</Text>
                      <Text fontSize="xs" color="fg.muted">{e.venue}{e.isSeated && ' · reserved seating'}</Text>
                    </Table.Cell>
                    <Table.Cell whiteSpace="nowrap" fontSize="sm">{formatDateTime(e.startsAt)}</Table.Cell>
                    <Table.Cell><EventStatusBadge status={e.status} /></Table.Cell>
                    <Table.Cell>
                      <Stack gap="1">
                        <Text fontSize="xs" color="fg.muted">{sold} / {e.capacity}</Text>
                        <Progress.Root value={(sold / e.capacity) * 100} size="xs" colorPalette={tone.palette}>
                          <Progress.Track borderRadius="full"><Progress.Range /></Progress.Track>
                        </Progress.Root>
                      </Stack>
                    </Table.Cell>
                    <Table.Cell textAlign="end">{formatPrice(e.priceCents)}</Table.Cell>
                    <Table.Cell>
                      <Menu.Root positioning={{ placement: 'bottom-end' }}>
                        <Menu.Trigger asChild>
                          <IconButton aria-label={`Actions for ${e.name}`} variant="ghost" size="sm"><LuEllipsisVertical /></IconButton>
                        </Menu.Trigger>
                        <Portal>
                          <Menu.Positioner>
                            <Menu.Content>
                              <Menu.Item value="attendees" onClick={() => setAttendeesFor(e)}><LuUsers /> Attendees</Menu.Item>
                              <Menu.Item value="edit" disabled={e.status === 'cancelled'} onClick={() => openEdit(e)}><LuPencil /> Edit</Menu.Item>
                              <Menu.Item value="cancel" color="fg.error" disabled={e.status === 'cancelled'} onClick={() => setToCancel(e)}><LuX /> Cancel event</Menu.Item>
                            </Menu.Content>
                          </Menu.Positioner>
                        </Portal>
                      </Menu.Root>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
        </Box>
      )}

      <EventFormDialog open={formOpen} event={editing} onClose={() => setFormOpen(false)} />
      <AttendeesDrawer event={attendeesFor} onClose={() => setAttendeesFor(null)} />
      <ConfirmDialog
        open={toCancel !== null}
        title={`Cancel ${toCancel?.name ?? 'event'}?`}
        body={
          <Stack gap="3">
            <Text>All {toCancel ? toCancel.capacity - toCancel.availableSeats : 0} sold ticket(s) will be cancelled, the waitlist cleared, and every attendee notified.</Text>
            <HStack><Input placeholder="Reason shown to attendees (optional)" value={reason} onChange={(e) => setReason(e.target.value)} /></HStack>
          </Stack>
        }
        confirmLabel="Cancel event"
        destructive
        loading={cancelEvent.isPending}
        onConfirm={confirmCancel}
        onClose={() => setToCancel(null)}
      />
    </Box>
  );
}
