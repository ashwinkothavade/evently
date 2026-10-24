import { Flex, Heading, Stack, Text } from '@chakra-ui/react';
import type { ReactNode } from 'react';

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <Flex mb="8" gap="4" align={{ base: 'start', md: 'end' }} justify="space-between" direction={{ base: 'column', md: 'row' }}>
      <Stack gap="1">
        <Heading size="2xl" letterSpacing="tight">{title}</Heading>
        {description && <Text color="fg.muted">{description}</Text>}
      </Stack>
      {actions}
    </Flex>
  );
}
