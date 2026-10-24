import { Box, Button, Circle, Flex, Icon, Stack, Text } from '@chakra-ui/react';
import type { ReactNode } from 'react';
import { LuBell, LuCalendarClock, LuCalendarX, LuCircleCheck, LuPartyPopper, LuTicketX } from 'react-icons/lu';
import { useNavigate } from 'react-router';
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from '../api/hooks';
import type { Notification } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { Empty, ErrorState, ListSkeleton } from '../components/States';
import { timeAgo } from '../lib/format';

const STYLE: Record<Notification['type'], { icon: ReactNode; palette: string }> = {
  BOOKING_CONFIRMED: { icon: <LuCircleCheck />, palette: 'green' },
  WAITLIST_PROMOTED: { icon: <LuPartyPopper />, palette: 'brand' },
  BOOKING_CANCELLED: { icon: <LuTicketX />, palette: 'gray' },
  EVENT_CANCELLED: { icon: <LuCalendarX />, palette: 'red' },
  EVENT_UPDATED: { icon: <LuCalendarClock />, palette: 'orange' },
};

export function NotificationsPage() {
  const navigate = useNavigate();
  const notifications = useNotifications(true);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const items = notifications.data?.data ?? [];
  const unread = notifications.data?.meta.unreadCount ?? 0;

  const open = (n: Notification) => {
    if (!n.read) markRead.mutate(n.id);
    if (n.data.eventId) navigate(n.type === 'EVENT_UPDATED' || n.type === 'EVENT_CANCELLED' ? `/events/${n.data.eventId}` : '/bookings');
  };

  return (
    <Box maxW="3xl" mx="auto">
      <PageHeader
        title="Notifications"
        description={unread > 0 ? `You have ${unread} unread notification${unread === 1 ? '' : 's'}.` : "You're all caught up."}
        actions={unread > 0 && <Button variant="outline" size="sm" onClick={() => markAll.mutate()} loading={markAll.isPending}>Mark all as read</Button>}
      />
      {notifications.isPending ? (
        <ListSkeleton />
      ) : notifications.isError ? (
        <ErrorState error={notifications.error} onRetry={() => notifications.refetch()} />
      ) : items.length === 0 ? (
        <Empty icon={<LuBell />} title="No notifications yet" description="Booking confirmations, waitlist updates and event changes will appear here." />
      ) : (
        <Stack gap="3">
          {items.map((n) => {
            const style = STYLE[n.type];
            return (
              <Flex
                key={n.id}
                as="button"
                textAlign="left"
                layerStyle="card"
                p="4"
                gap="4"
                align="start"
                cursor="pointer"
                _hover={{ boxShadow: 'sm' }}
                bg={n.read ? 'bg.panel' : 'brand.subtle'}
                onClick={() => open(n)}
              >
                <Flex boxSize="10" flexShrink="0" borderRadius="full" bg={`${style.palette}.muted`} color={`${style.palette}.fg`} align="center" justify="center">
                  <Icon boxSize="5">{style.icon}</Icon>
                </Flex>
                <Stack gap="0.5" flex="1">
                  <Text fontWeight={n.read ? 'medium' : 'bold'}>{n.title}</Text>
                  <Text fontSize="sm" color="fg.muted">{n.body}</Text>
                  <Text fontSize="xs" color="fg.subtle">{timeAgo(n.createdAt)}</Text>
                </Stack>
                {!n.read && <Circle size="2.5" bg="brand.solid" mt="2" aria-label="Unread" />}
              </Flex>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
