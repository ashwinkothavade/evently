# Diagrams

| File | Shows | Source |
|---|---|---|
| [architecture.png](architecture.png) | High-level architecture: gateway, services, event bus, data layer | [architecture.svg](architecture.svg) (hand-drawn) |
| [er-booking-schema.png](er-booking-schema.png) | ER diagram of the booking schema (the consistency core) | [DESIGN.md §5.1](../DESIGN.md#51-booking-schema-the-consistency-core) |
| [er-other-schemas.png](er-other-schemas.png) | ER diagram of the auth, catalog and notify schemas | [DESIGN.md §5.2](../DESIGN.md#52-other-schemas) |
| [sequence-booking.png](sequence-booking.png) | Booking request flow | [DESIGN.md §7.1](../DESIGN.md#71-booking) |
| [sequence-cancel-waitlist.png](sequence-cancel-waitlist.png) | Cancellation with waitlist promotion | [DESIGN.md §7.2](../DESIGN.md#72-cancellation-and-waitlist-promotion) |
| [sequence-admin-edit.png](sequence-admin-edit.png) | Admin edit: optimistic lock and sync command | [DESIGN.md §7.3](../DESIGN.md#73-admin-edits-an-event-synchronous-command--optimistic-lock) |

The PNGs other than the architecture diagram are exported from the Mermaid sources in DESIGN.md, which GitHub also renders inline.
