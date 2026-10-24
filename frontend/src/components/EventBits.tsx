import { Badge, HStack, Progress, Text } from '@chakra-ui/react';
import type { EventItem, EventStatus } from '../api/types';

/** One place that decides how availability is communicated, used everywhere. */
export function availabilityTone(event: Pick<EventItem, 'capacity' | 'availableSeats'>) {
  const ratio = event.capacity > 0 ? event.availableSeats / event.capacity : 0;
  if (event.availableSeats === 0) return { palette: 'red', label: 'Sold out' } as const;
  if (ratio <= 0.2) return { palette: 'orange', label: `Only ${event.availableSeats} left` } as const;
  return { palette: 'green', label: `${event.availableSeats} available` } as const;
}

export function AvailabilityBadge({ event }: { event: EventItem }) {
  if (event.status === 'cancelled') return <Badge colorPalette="gray">Cancelled</Badge>;
  const tone = availabilityTone(event);
  return <Badge colorPalette={tone.palette}>{tone.label}</Badge>;
}

export function AvailabilityBar({ event, size = 'sm' }: { event: EventItem; size?: 'xs' | 'sm' | 'md' }) {
  const sold = event.capacity - event.availableSeats;
  const tone = availabilityTone(event);
  return (
    <Progress.Root value={(sold / event.capacity) * 100} size={size} colorPalette={tone.palette} aria-label="Tickets sold">
      <HStack justify="space-between" mb="1.5">
        <Text fontSize="xs" color="fg.muted">{sold.toLocaleString()} / {event.capacity.toLocaleString()} sold</Text>
        <Text fontSize="xs" fontWeight="medium" color={`${tone.palette}.fg`}>{tone.label}</Text>
      </HStack>
      <Progress.Track borderRadius="full">
        <Progress.Range />
      </Progress.Track>
    </Progress.Root>
  );
}

const STATUS_PALETTE: Record<EventStatus, string> = { draft: 'gray', published: 'green', cancelled: 'red' };

export function EventStatusBadge({ status }: { status: EventStatus }) {
  return <Badge colorPalette={STATUS_PALETTE[status]} textTransform="capitalize">{status}</Badge>;
}
