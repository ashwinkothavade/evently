import { Badge, Box, Flex, Heading, HStack, Icon, LinkBox, LinkOverlay, Stack, Text } from '@chakra-ui/react';
import { LuArmchair, LuCalendar, LuMapPin } from 'react-icons/lu';
import { Link as RouterLink } from 'react-router';
import type { EventItem } from '../api/types';
import { formatDateTime, formatPrice } from '../lib/format';
import { AvailabilityBar } from './EventBits';

/** Deterministic gradient per event so cards look distinct without images. */
function gradientFor(id: string) {
  const hue = parseInt(id.slice(0, 6), 16) % 360;
  return `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 50) % 360} 75% 45%))`;
}

export function EventCard({ event }: { event: EventItem }) {
  const day = new Date(event.startsAt);
  return (
    <LinkBox as="article" layerStyle="card" overflow="hidden" transition="all 0.15s" _hover={{ boxShadow: 'md', transform: 'translateY(-2px)' }}>
      <Box h="28" bgImage={gradientFor(event.id)} position="relative">
        <Stack position="absolute" top="3" left="3" gap="0" bg="bg.panel" borderRadius="lg" px="3" py="1.5" textAlign="center" boxShadow="sm">
          <Text fontSize="xs" fontWeight="bold" color="brand.fg" textTransform="uppercase">
            {day.toLocaleString(undefined, { month: 'short' })}
          </Text>
          <Text fontSize="xl" fontWeight="800" lineHeight="1">{day.getDate()}</Text>
        </Stack>
        <HStack position="absolute" top="3" right="3" gap="2">
          {event.isSeated && (
            <Badge variant="solid" colorPalette="gray" bg="blackAlpha.600"><LuArmchair /> Reserved seating</Badge>
          )}
        </HStack>
      </Box>
      <Stack p="5" gap="3">
        <Flex justify="space-between" align="start" gap="3">
          <Heading size="md" lineClamp={2}>
            <LinkOverlay asChild>
              <RouterLink to={`/events/${event.id}`}>{event.name}</RouterLink>
            </LinkOverlay>
          </Heading>
          <Text fontWeight="bold" color="brand.fg" whiteSpace="nowrap">{formatPrice(event.priceCents)}</Text>
        </Flex>
        <Stack gap="1" color="fg.muted" fontSize="sm">
          <HStack><Icon><LuCalendar /></Icon><Text>{formatDateTime(event.startsAt)}</Text></HStack>
          <HStack><Icon><LuMapPin /></Icon><Text lineClamp={1}>{event.venue}</Text></HStack>
        </Stack>
        <AvailabilityBar event={event} size="xs" />
      </Stack>
    </LinkBox>
  );
}
