import { HStack, IconButton, NumberInput } from '@chakra-ui/react';
import { LuMinus, LuPlus } from 'react-icons/lu';

export function QuantityPicker({ value, max, onChange }: { value: number; max: number; onChange: (n: number) => void }) {
  return (
    <NumberInput.Root
      value={String(value)}
      min={1}
      max={Math.max(1, max)}
      onValueChange={(e) => onChange(Number.isNaN(e.valueAsNumber) ? 1 : e.valueAsNumber)}
      unstyled
      spinOnPress={false}
    >
      <HStack gap="2">
        <NumberInput.DecrementTrigger asChild>
          <IconButton variant="outline" size="sm" aria-label="Fewer tickets"><LuMinus /></IconButton>
        </NumberInput.DecrementTrigger>
        <NumberInput.ValueText textAlign="center" fontSize="lg" fontWeight="semibold" minW="6ch" />
        <NumberInput.IncrementTrigger asChild>
          <IconButton variant="outline" size="sm" aria-label="More tickets"><LuPlus /></IconButton>
        </NumberInput.IncrementTrigger>
      </HStack>
    </NumberInput.Root>
  );
}
