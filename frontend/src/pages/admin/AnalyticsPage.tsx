import {
  Badge, Box, Flex, Grid, Heading, HStack, Icon, Progress, SegmentGroup, Skeleton, Stack, Switch, Table, Text,
} from '@chakra-ui/react';
import { useMemo, useState, type ReactNode } from 'react';
import { LuCircleAlert, LuCircleCheck, LuDollarSign, LuGauge, LuTicket, LuTicketX, LuUsers } from 'react-icons/lu';
import {
  Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useAnalytics } from '../../api/hooks';
import type { DailyStat, PopularEvent } from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState } from '../../components/States';
import { formatDate, formatNumber, formatPercent, formatPrice } from '../../lib/format';

// Chart colours come from the theme's validated chart.* tokens (see theme/system.ts).
const C = {
  series1: 'var(--chakra-colors-chart-series1)',
  series2: 'var(--chakra-colors-chart-series2)',
  grid: 'var(--chakra-colors-chart-grid)',
  axis: 'var(--chakra-colors-chart-axis)',
  muted: 'var(--chakra-colors-chart-muted)',
  text: 'var(--chakra-colors-fg)',
  textMuted: 'var(--chakra-colors-fg-muted)',
  surface: 'var(--chakra-colors-bg-panel)',
};
const axisTick = { fill: C.muted, fontSize: 12 };

function StatTile({ label, value, help, icon }: { label: string; value: ReactNode; help?: ReactNode; icon: ReactNode }) {
  return (
    <Stack layerStyle="card" p="5" gap="2">
      <HStack justify="space-between" color="fg.muted">
        <Text fontSize="sm" fontWeight="medium">{label}</Text>
        <Icon boxSize="4">{icon}</Icon>
      </HStack>
      <Text fontSize="3xl" fontWeight="800" letterSpacing="tight" lineHeight="1">{value}</Text>
      {help && <Text fontSize="xs" color="fg.muted">{help}</Text>}
    </Stack>
  );
}

function ChartCard({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <Stack layerStyle="card" p="5" gap="4">
      <Flex justify="space-between" align="start" gap="4">
        <Stack gap="0.5">
          <Heading size="md">{title}</Heading>
          {description && <Text fontSize="sm" color="fg.muted">{description}</Text>}
        </Stack>
        {actions}
      </Flex>
      {children}
    </Stack>
  );
}

/** Shared tooltip so every chart's hover layer looks the same. */
function ChartTooltip({ active, payload, label, format }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
  format?: (label: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <Box bg="bg.panel" borderWidth="1px" borderColor="border" borderRadius="md" boxShadow="md" px="3" py="2" fontSize="sm">
      <Text fontWeight="semibold" mb="1">{format && label ? format(label) : label}</Text>
      {payload.map((p) => (
        <HStack key={p.name} gap="2">
          <Box boxSize="2.5" borderRadius="full" bg={p.color} />
          <Text color="fg.muted">{p.name}</Text>
          <Text ml="auto" fontWeight="semibold" pl="4">{formatNumber(p.value)}</Text>
        </HStack>
      ))}
    </Box>
  );
}

function DailyChart({ data, asTable }: { data: DailyStat[]; asTable: boolean }) {
  if (asTable) {
    return (
      <Box maxH="72" overflowY="auto">
        <Table.Root size="sm" stickyHeader>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Date</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">Tickets booked</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">Cancellations</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">Revenue</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body fontVariantNumeric="tabular-nums">
            {[...data].reverse().map((d) => (
              <Table.Row key={d.date}>
                <Table.Cell>{formatDate(d.date)}</Table.Cell>
                <Table.Cell textAlign="end">{d.ticketsBooked}</Table.Cell>
                <Table.Cell textAlign="end">{d.cancellations}</Table.Cell>
                <Table.Cell textAlign="end">{formatPrice(d.revenueCents)}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Box>
    );
  }
  return (
    <Box h="72" role="img" aria-label="Line chart of tickets booked and bookings cancelled per day">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tick={axisTick}
            tickLine={false}
            axisLine={{ stroke: C.axis }}
            tickFormatter={(d: string) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            minTickGap={24}
          />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
          <Tooltip content={<ChartTooltip format={formatDate} />} cursor={{ stroke: C.axis, strokeWidth: 1 }} />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: C.textMuted }} />
          <Line type="linear" name="Tickets booked" dataKey="ticketsBooked" stroke={C.series1} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: C.surface, strokeWidth: 2 }} />
          <Line type="linear" name="Cancellations" dataKey="cancellations" stroke={C.series2} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: C.surface, strokeWidth: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
}

/** Single-line category label (Recharts would otherwise wrap long names). */
function CategoryTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill={C.textMuted} fontSize={12}>
      {payload?.value}
    </text>
  );
}

function PopularChart({ data }: { data: PopularEvent[] }) {
  const rows = data.filter((d) => d.ticketsSold > 0).map((d) => ({ ...d, label: d.name.length > 26 ? `${d.name.slice(0, 25)}…` : d.name }));
  if (rows.length === 0) return <Text color="fg.muted" fontSize="sm">No tickets sold yet.</Text>;
  return (
    <Box h={`${Math.max(160, rows.length * 44)}px`} role="img" aria-label="Bar chart of tickets sold per event">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }} barCategoryGap={8}>
          <CartesianGrid stroke={C.grid} horizontal={false} />
          <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="label" tick={<CategoryTick />} tickLine={false} axisLine={{ stroke: C.axis }} width={200} interval={0} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: C.grid, opacity: 0.4 }} />
          <Bar name="Tickets sold" dataKey="ticketsSold" fill={C.series1} radius={[0, 4, 4, 0]} maxBarSize={24}>
            <LabelList dataKey="ticketsSold" position="right" fill={C.textMuted} fontSize={12} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}

const RANGES = { '7': 7, '30': 30, '90': 90 } as const;

export function AnalyticsPage() {
  const [days, setDays] = useState<keyof typeof RANGES>('30');
  const [asTable, setAsTable] = useState(false);
  const range = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - (RANGES[days] - 1) * 86_400_000);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }, [days]);
  const { overview, popular, utilization, daily, integrity } = useAnalytics(range);
  const o = overview.data;

  return (
    <Box>
      <PageHeader
        title="Analytics"
        description="Live booking insights, built from the event stream (no load on the booking database)."
        actions={
          integrity.data && (
            <Badge size="lg" colorPalette={integrity.data.ok ? 'green' : 'red'} variant="surface" gap="1.5">
              <Icon>{integrity.data.ok ? <LuCircleCheck /> : <LuCircleAlert />}</Icon>
              {integrity.data.ok ? `Inventory consistent · ${integrity.data.eventsChecked} events audited` : `${integrity.data.mismatches.length} inventory mismatch(es)`}
            </Badge>
          )
        }
      />

      {overview.isError && <ErrorState error={overview.error} onRetry={() => overview.refetch()} />}

      <Grid templateColumns={{ base: '1fr 1fr', lg: 'repeat(5, 1fr)' }} gap="4" mb="6">
        {!o ? (
          Array.from({ length: 5 }, (_, i) => <Skeleton key={i} h="28" borderRadius="card" />)
        ) : (
          <>
            <StatTile label="Tickets sold" icon={<LuTicket />} value={formatNumber(o.bookings.ticketsSold)} help={`${formatNumber(o.bookings.confirmed)} active bookings`} />
            <StatTile label="Revenue" icon={<LuDollarSign />} value={formatPrice(o.bookings.revenueCents)} help="from confirmed bookings" />
            <StatTile label="Capacity utilization" icon={<LuGauge />} value={formatPercent(o.events.capacityUtilization)} help={`${formatNumber(o.events.ticketsBooked)} of ${formatNumber(o.events.totalCapacity)} seats · ${o.events.soldOut} sold out`} />
            <StatTile label="Cancellation rate" icon={<LuTicketX />} value={formatPercent(o.bookings.cancellationRate)} help={`${formatNumber(o.bookings.cancelled)} of ${formatNumber(o.bookings.total)} bookings`} />
            <StatTile label="Waitlist" icon={<LuUsers />} value={formatNumber(o.events.peopleOnWaitlists)} help={`waiting · ${formatNumber(o.bookings.waitlistPromotions)} promoted so far`} />
          </>
        )}
      </Grid>

      <Grid templateColumns={{ base: '1fr', xl: '3fr 2fr' }} gap="6" mb="6">
        <ChartCard
          title="Daily activity"
          description="Tickets booked and bookings cancelled per day (UTC)"
          actions={
            <HStack gap="4">
              <SegmentGroup.Root size="xs" value={days} onValueChange={(e) => setDays(e.value as keyof typeof RANGES)}>
                <SegmentGroup.Indicator />
                <SegmentGroup.Items items={[{ value: '7', label: '7d' }, { value: '30', label: '30d' }, { value: '90', label: '90d' }]} />
              </SegmentGroup.Root>
              <Switch.Root size="sm" checked={asTable} onCheckedChange={(e) => setAsTable(e.checked)}>
                <Switch.HiddenInput />
                <Switch.Control />
                <Switch.Label fontSize="xs">Table</Switch.Label>
              </Switch.Root>
            </HStack>
          }
        >
          {daily.isPending ? <Skeleton h="72" /> : daily.isError ? <ErrorState error={daily.error} /> : <DailyChart data={daily.data} asTable={asTable} />}
        </ChartCard>

        <ChartCard title="Most popular events" description="Ranked by tickets sold">
          {popular.isPending ? <Skeleton h="72" /> : popular.isError ? <ErrorState error={popular.error} /> : <PopularChart data={popular.data} />}
        </ChartCard>
      </Grid>

      <ChartCard title="Capacity utilization" description="Upcoming published events, fullest first">
        {utilization.isPending ? (
          <Skeleton h="40" />
        ) : utilization.isError ? (
          <ErrorState error={utilization.error} />
        ) : utilization.data.length === 0 ? (
          <Text color="fg.muted" fontSize="sm">No upcoming events.</Text>
        ) : (
          <Box overflowX="auto">
            <Table.Root size="sm">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Event</Table.ColumnHeader>
                  <Table.ColumnHeader>Date</Table.ColumnHeader>
                  <Table.ColumnHeader minW="56">Utilization</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">Sold / capacity</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">Waitlist</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body fontVariantNumeric="tabular-nums">
                {utilization.data.map((u) => (
                  <Table.Row key={u.eventId}>
                    <Table.Cell fontWeight="medium">{u.name}</Table.Cell>
                    <Table.Cell whiteSpace="nowrap">{formatDate(u.startsAt)}</Table.Cell>
                    <Table.Cell>
                      <HStack gap="3">
                        <Progress.Root value={u.utilization * 100} size="sm" flex="1" aria-label={`${u.name} utilization`}>
                          <Progress.Track borderRadius="full"><Progress.Range bg="chart.series1" /></Progress.Track>
                        </Progress.Root>
                        <Text fontSize="xs" w="10" textAlign="end">{formatPercent(u.utilization)}</Text>
                      </HStack>
                    </Table.Cell>
                    <Table.Cell textAlign="end">{u.bookedCount} / {u.capacity}</Table.Cell>
                    <Table.Cell textAlign="end">{u.waitlistSize > 0 ? <Badge colorPalette="brand">{u.waitlistSize}</Badge> : '–'}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Box>
        )}
      </ChartCard>
    </Box>
  );
}
