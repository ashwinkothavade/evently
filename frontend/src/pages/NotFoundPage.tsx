import { Button } from '@chakra-ui/react';
import { LuCompass } from 'react-icons/lu';
import { Link as RouterLink } from 'react-router';
import { Empty } from '../components/States';

export function NotFoundPage() {
  return (
    <Empty
      icon={<LuCompass />}
      title="Page not found"
      description="The page you're looking for doesn't exist."
      action={<Button asChild colorPalette="brand"><RouterLink to="/">Back to events</RouterLink></Button>}
    />
  );
}
