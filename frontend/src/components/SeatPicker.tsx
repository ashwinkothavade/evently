import { Box, Button, Flex, Grid, HStack, Stack, Text } from '@chakra-ui/react';
import type { SeatMap } from '../api/types';

/** Interactive seat map: click to toggle seats, up to `max`. */
export function SeatPicker({ map, selected, max, onToggle }: {
  map: SeatMap;
  selected: Set<string>;
  max: number;
  onToggle: (seatId: string) => void;
}) {
  return (
    <Stack gap="4">
      <Box textAlign="center" py="1.5" borderRadius="md" bg="bg.muted" color="fg.muted" fontSize="xs" letterSpacing="widest" fontWeight="semibold">
        STAGE
      </Box>
      <Stack gap="1.5">
        {map.rows.map((row) => (
          // Row label | one equal-width column per seat | row label: always fits the panel.
          <Grid key={row.label} templateColumns={`1.25rem repeat(${row.seats.length}, minmax(0, 1fr)) 1.25rem`} gap="1" alignItems="center">
            <Text fontSize="xs" color="fg.subtle" fontWeight="semibold" textAlign="center">{row.label}</Text>
            {row.seats.map((seat) => {
              const isSelected = selected.has(seat.id);
              const disabled = !seat.available || (!isSelected && selected.size >= max);
              return (
                <Button
                  key={seat.id}
                  size="2xs"
                  minW="0"
                  w="full"
                  h="auto"
                  aspectRatio="1"
                  px="0"
                  fontSize="2xs"
                  aria-label={`Row ${row.label} seat ${seat.number}${seat.available ? '' : ' (taken)'}`}
                  aria-pressed={isSelected}
                  variant={isSelected ? 'solid' : seat.available ? 'outline' : 'subtle'}
                  colorPalette={isSelected ? 'brand' : 'gray'}
                  disabled={disabled}
                  opacity={seat.available ? 1 : 0.35}
                  onClick={() => onToggle(seat.id)}
                >
                  {seat.number}
                </Button>
              );
            })}
            <Text fontSize="xs" color="fg.subtle" fontWeight="semibold" textAlign="center">{row.label}</Text>
          </Grid>
        ))}
      </Stack>
      <Flex gap="4" justify="center" fontSize="xs" color="fg.muted">
        <HStack><Box boxSize="3" borderWidth="1px" borderRadius="sm" /> Available</HStack>
        <HStack><Box boxSize="3" bg="brand.solid" borderRadius="sm" /> Selected</HStack>
        <HStack><Box boxSize="3" bg="bg.emphasized" borderRadius="sm" /> Taken</HStack>
      </Flex>
    </Stack>
  );
}
