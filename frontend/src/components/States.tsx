import { Alert, Button, EmptyState, SimpleGrid, Skeleton, Stack, VStack } from '@chakra-ui/react';
import type { ReactNode } from 'react';
import { LuInbox } from 'react-icons/lu';
import { ApiError } from '../api/client';

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof ApiError ? error.message : 'Something went wrong.';
  return (
    <Alert.Root status="error" borderRadius="card">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>Could not load data</Alert.Title>
        <Alert.Description>{message}</Alert.Description>
      </Alert.Content>
      {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>}
    </Alert.Root>
  );
}

export function Empty({ title, description, icon, action }: { title: string; description?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <EmptyState.Root layerStyle="card" py="12">
      <EmptyState.Content>
        <EmptyState.Indicator color="brand.fg">{icon ?? <LuInbox />}</EmptyState.Indicator>
        <VStack textAlign="center">
          <EmptyState.Title>{title}</EmptyState.Title>
          {description && <EmptyState.Description>{description}</EmptyState.Description>}
        </VStack>
        {action}
      </EmptyState.Content>
    </EmptyState.Root>
  );
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} gap="6">
      {Array.from({ length: count }, (_, i) => <Skeleton key={i} h="64" borderRadius="card" />)}
    </SimpleGrid>
  );
}

export function ListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <Stack gap="4">
      {Array.from({ length: count }, (_, i) => <Skeleton key={i} h="24" borderRadius="card" />)}
    </Stack>
  );
}
