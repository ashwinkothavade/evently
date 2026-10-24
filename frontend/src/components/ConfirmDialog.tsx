import { Button, CloseButton, Dialog, Portal } from '@chakra-ui/react';
import type { ReactNode } from 'react';

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog.Root open={props.open} onOpenChange={(e) => !e.open && props.onClose()} role="alertdialog" placement="center">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>{props.title}</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>{props.body}</Dialog.Body>
            <Dialog.Footer>
              <Button variant="outline" onClick={props.onClose}>Keep it</Button>
              <Button colorPalette={props.destructive ? 'red' : 'brand'} loading={props.loading} onClick={props.onConfirm}>
                {props.confirmLabel}
              </Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
