import {
  Alert, Button, CloseButton, Dialog, Field, Grid, Input, NativeSelect, Portal, SegmentGroup, Stack, Textarea,
} from '@chakra-ui/react';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import { useCreateEvent, useUpdateEvent, type EventInput } from '../../api/hooks';
import type { EventItem } from '../../api/types';
import { toaster } from '../../components/toaster';
import { isoToLocalInput, localInputToIso } from '../../lib/format';

interface FormState {
  name: string;
  description: string;
  venue: string;
  startsAt: string;
  endsAt: string;
  kind: 'ga' | 'seated';
  capacity: string;
  rows: string;
  seatsPerRow: string;
  price: string;
  maxPerBooking: string;
  status: 'draft' | 'published';
}

const empty: FormState = {
  name: '', description: '', venue: '', startsAt: '', endsAt: '', kind: 'ga', capacity: '100',
  rows: '10', seatsPerRow: '12', price: '25.00', maxPerBooking: '10', status: 'published',
};

function fromEvent(e: EventItem): FormState {
  return {
    name: e.name,
    description: e.description ?? '',
    venue: e.venue,
    startsAt: isoToLocalInput(e.startsAt),
    endsAt: e.endsAt ? isoToLocalInput(e.endsAt) : '',
    kind: e.isSeated ? 'seated' : 'ga',
    capacity: String(e.capacity),
    rows: String(e.seating?.rows ?? ''),
    seatsPerRow: String(e.seating?.seatsPerRow ?? ''),
    price: (e.priceCents / 100).toFixed(2),
    maxPerBooking: String(e.maxPerBooking),
    status: e.status === 'draft' ? 'draft' : 'published',
  };
}

/** Create (event = null) or edit an event. Edits send the loaded version (optimistic locking). */
export function EventFormDialog({ open, event, onClose }: { open: boolean; event: EventItem | null; onClose: () => void }) {
  const [form, setForm] = useState<FormState>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const create = useCreateEvent();
  const update = useUpdateEvent();
  const editing = event !== null;

  useEffect(() => {
    if (open) {
      setForm(event ? fromEvent(event) : empty);
      setErrors({});
      setError(null);
    }
  }, [open, event]);

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    setError(null);
    const input: EventInput = {
      name: form.name,
      description: form.description || (editing ? null : undefined),
      venue: form.venue,
      startsAt: form.startsAt ? localInputToIso(form.startsAt) : '',
      endsAt: form.endsAt ? localInputToIso(form.endsAt) : editing ? null : undefined,
      priceCents: Math.round(Number(form.price) * 100),
      maxPerBooking: Number(form.maxPerBooking),
      status: form.status,
      ...(form.kind === 'seated'
        ? editing ? {} : { seating: { rows: Number(form.rows), seatsPerRow: Number(form.seatsPerRow) } }
        : { capacity: Number(form.capacity) }),
    };
    try {
      if (editing) {
        const { seating: _seating, ...patch } = input;
        const updated = await update.mutateAsync({ id: event.id, version: event.version, patch });
        toaster.success({
          title: 'Event updated',
          description: updated.waitlistPromoted > 0 ? `${updated.waitlistPromoted} waitlisted booking(s) confirmed.` : undefined,
        });
      } else {
        await create.mutateAsync(input);
        toaster.success({ title: 'Event created' });
      }
      onClose();
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        setErrors(Object.fromEntries((err.details as { path: string; message: string }[]).map((d) => [d.path.split('.')[0], d.message])));
      }
      if (err instanceof ApiError && err.code === 'VERSION_MISMATCH') {
        setError('Someone else changed this event while you were editing. Close and reopen it to load the latest version.');
      } else {
        setError(err instanceof Error ? err.message : 'Save failed');
      }
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()} size="lg" placement="center" scrollBehavior="inside">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content as="form" onSubmit={submit}>
            <Dialog.Header>
              <Dialog.Title>{editing ? 'Edit event' : 'Create event'}</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Stack gap="5">
                {error && (
                  <Alert.Root status="error" size="sm"><Alert.Indicator /><Alert.Title>{error}</Alert.Title></Alert.Root>
                )}
                <Field.Root required invalid={Boolean(errors.name)}>
                  <Field.Label>Name</Field.Label>
                  <Input value={form.name} onChange={set('name')} placeholder="Summer Jazz Night" />
                  <Field.ErrorText>{errors.name}</Field.ErrorText>
                </Field.Root>
                <Field.Root invalid={Boolean(errors.description)}>
                  <Field.Label>Description</Field.Label>
                  <Textarea value={form.description} onChange={set('description')} rows={3} />
                </Field.Root>
                <Field.Root required invalid={Boolean(errors.venue)}>
                  <Field.Label>Venue</Field.Label>
                  <Input value={form.venue} onChange={set('venue')} placeholder="Blue Note, New York" />
                  <Field.ErrorText>{errors.venue}</Field.ErrorText>
                </Field.Root>
                <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap="4">
                  <Field.Root required invalid={Boolean(errors.startsAt)}>
                    <Field.Label>Starts</Field.Label>
                    <Input type="datetime-local" value={form.startsAt} onChange={set('startsAt')} />
                    <Field.ErrorText>{errors.startsAt}</Field.ErrorText>
                  </Field.Root>
                  <Field.Root invalid={Boolean(errors.endsAt)}>
                    <Field.Label>Ends</Field.Label>
                    <Input type="datetime-local" value={form.endsAt} onChange={set('endsAt')} />
                    <Field.ErrorText>{errors.endsAt}</Field.ErrorText>
                  </Field.Root>
                </Grid>

                <Field.Root>
                  <Field.Label>Admission</Field.Label>
                  <SegmentGroup.Root
                    value={form.kind}
                    disabled={editing}
                    onValueChange={(e) => setForm((f) => ({ ...f, kind: e.value as FormState['kind'] }))}
                  >
                    <SegmentGroup.Indicator />
                    <SegmentGroup.Items items={[{ value: 'ga', label: 'General admission' }, { value: 'seated', label: 'Reserved seating' }]} />
                  </SegmentGroup.Root>
                  {editing && <Field.HelperText>Admission type can't change after creation.</Field.HelperText>}
                </Field.Root>

                {form.kind === 'ga' ? (
                  <Field.Root required invalid={Boolean(errors.capacity)}>
                    <Field.Label>Capacity</Field.Label>
                    <Input type="number" min={1} value={form.capacity} onChange={set('capacity')} />
                    <Field.ErrorText>{errors.capacity}</Field.ErrorText>
                    {editing && <Field.HelperText>Can't be lower than tickets already sold ({event.bookedCount}).</Field.HelperText>}
                  </Field.Root>
                ) : (
                  <Grid templateColumns="1fr 1fr" gap="4">
                    <Field.Root required disabled={editing} invalid={Boolean(errors.seating)}>
                      <Field.Label>Rows (max 26)</Field.Label>
                      <Input type="number" min={1} max={26} value={form.rows} onChange={set('rows')} />
                    </Field.Root>
                    <Field.Root required disabled={editing} invalid={Boolean(errors.seating)}>
                      <Field.Label>Seats per row</Field.Label>
                      <Input type="number" min={1} max={100} value={form.seatsPerRow} onChange={set('seatsPerRow')} />
                      <Field.ErrorText>{errors.seating}</Field.ErrorText>
                    </Field.Root>
                  </Grid>
                )}

                <Grid templateColumns={{ base: '1fr', md: '1fr 1fr 1fr' }} gap="4">
                  <Field.Root required invalid={Boolean(errors.priceCents)}>
                    <Field.Label>Price (USD)</Field.Label>
                    <Input type="number" min={0} step="0.01" value={form.price} onChange={set('price')} />
                    <Field.ErrorText>{errors.priceCents}</Field.ErrorText>
                  </Field.Root>
                  <Field.Root required invalid={Boolean(errors.maxPerBooking)}>
                    <Field.Label>Max per booking</Field.Label>
                    <Input type="number" min={1} max={100} value={form.maxPerBooking} onChange={set('maxPerBooking')} />
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>Status</Field.Label>
                    <NativeSelect.Root>
                      <NativeSelect.Field value={form.status} onChange={set('status')}>
                        <option value="published">Published</option>
                        <option value="draft">Draft (hidden)</option>
                      </NativeSelect.Field>
                      <NativeSelect.Indicator />
                    </NativeSelect.Root>
                  </Field.Root>
                </Grid>
              </Stack>
            </Dialog.Body>
            <Dialog.Footer>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" colorPalette="brand" loading={create.isPending || update.isPending}>
                {editing ? 'Save changes' : 'Create event'}
              </Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger asChild><CloseButton size="sm" /></Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
