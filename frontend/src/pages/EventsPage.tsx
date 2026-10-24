import { Button, Center, HStack, Input, InputGroup, SimpleGrid, Stack, Switch } from '@chakra-ui/react';
import { useDeferredValue, useState } from 'react';
import { LuCalendarX, LuSearch } from 'react-icons/lu';
import { useEvents } from '../api/hooks';
import { EventCard } from '../components/EventCard';
import { PageHeader } from '../components/PageHeader';
import { CardGridSkeleton, Empty, ErrorState } from '../components/States';

export function EventsPage() {
  const [search, setSearch] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const q = useDeferredValue(search.trim());
  const events = useEvents({ q: q.length >= 2 ? q : undefined, available: onlyAvailable });
  const items = events.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <Stack gap="0">
      <PageHeader
        title="Upcoming events"
        description="Find something great to do and grab your tickets before they're gone."
        actions={
          <HStack gap="4" w={{ base: 'full', md: 'auto' }}>
            <InputGroup startElement={<LuSearch />} flex="1" minW={{ md: '72' }}>
              <Input placeholder="Search events or venues" value={search} onChange={(e) => setSearch(e.target.value)} bg="bg.panel" />
            </InputGroup>
            <Switch.Root colorPalette="brand" checked={onlyAvailable} onCheckedChange={(e) => setOnlyAvailable(e.checked)}>
              <Switch.HiddenInput />
              <Switch.Control />
              <Switch.Label whiteSpace="nowrap">Available only</Switch.Label>
            </Switch.Root>
          </HStack>
        }
      />

      {events.isPending ? (
        <CardGridSkeleton />
      ) : events.isError ? (
        <ErrorState error={events.error} onRetry={() => events.refetch()} />
      ) : items.length === 0 ? (
        <Empty icon={<LuCalendarX />} title="No events found" description={q ? 'Try a different search.' : 'Check back soon – new events are added all the time.'} />
      ) : (
        <>
          <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap="6">
            {items.map((event) => <EventCard key={event.id} event={event} />)}
          </SimpleGrid>
          {events.hasNextPage && (
            <Center mt="10">
              <Button variant="outline" onClick={() => events.fetchNextPage()} loading={events.isFetchingNextPage}>
                Load more events
              </Button>
            </Center>
          )}
        </>
      )}
    </Stack>
  );
}
