import { Badge, CloseButton, Drawer, Portal, Skeleton, Stack, Table, Text } from '@chakra-ui/react';
import { useAttendees } from '../../api/hooks';
import type { EventItem } from '../../api/types';
import { ErrorState } from '../../components/States';
import { formatPrice, timeAgo } from '../../lib/format';

export function AttendeesDrawer({ event, onClose }: { event: EventItem | null; onClose: () => void }) {
  const attendees = useAttendees(event?.id ?? null);
  return (
    <Drawer.Root open={event !== null} onOpenChange={(e) => !e.open && onClose()} size="lg">
      <Portal>
        <Drawer.Backdrop />
        <Drawer.Positioner>
          <Drawer.Content>
            <Drawer.Header>
              <Stack gap="0">
                <Drawer.Title>Attendees</Drawer.Title>
                <Text color="fg.muted" fontSize="sm">{event?.name} · {attendees.data?.meta.total ?? 0} booking(s)</Text>
              </Stack>
            </Drawer.Header>
            <Drawer.Body>
              {attendees.isPending ? (
                <Skeleton h="40" />
              ) : attendees.isError ? (
                <ErrorState error={attendees.error} />
              ) : attendees.data.data.length === 0 ? (
                <Text color="fg.muted">No bookings yet.</Text>
              ) : (
                <Table.Root size="sm" interactive>
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader>Attendee</Table.ColumnHeader>
                      <Table.ColumnHeader textAlign="end">Tickets</Table.ColumnHeader>
                      <Table.ColumnHeader>Status</Table.ColumnHeader>
                      <Table.ColumnHeader textAlign="end">Paid</Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {attendees.data.data.map((a) => (
                      <Table.Row key={a.id}>
                        <Table.Cell>
                          <Text fontWeight="medium">{a.user.name ?? 'Unknown user'}</Text>
                          <Text fontSize="xs" color="fg.muted">{a.user.email} · {timeAgo(a.createdAt)}</Text>
                        </Table.Cell>
                        <Table.Cell textAlign="end">{a.quantity}</Table.Cell>
                        <Table.Cell>
                          <Badge colorPalette={a.status === 'confirmed' ? 'green' : 'red'}>{a.status}</Badge>
                          {a.source === 'waitlist' && <Badge ml="1" colorPalette="brand">waitlist</Badge>}
                        </Table.Cell>
                        <Table.Cell textAlign="end">{formatPrice(a.totalPriceCents)}</Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              )}
            </Drawer.Body>
            <Drawer.CloseTrigger asChild><CloseButton size="sm" /></Drawer.CloseTrigger>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
}
