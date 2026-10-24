# auth-service

User accounts and token issuing.

| | |
|---|---|
| Port | `4001` |
| Schema | `auth` (`users`, `outbox`) |
| Publishes | `user.registered` |
| Consumes | — |

## API (via the gateway)
| Method | Path | |
|---|---|---|
| POST | `/api/v1/auth/register` | Create an account → `{ token, user }` |
| POST | `/api/v1/auth/login` | Sign in → `{ token, user }` |
| GET | `/api/v1/me` | Current user |

## Behavior
- Passwords are hashed with **bcrypt** (`BCRYPT_ROUNDS`, default 10). Emails are unique case-insensitively (`UNIQUE (lower(email))`).
- Login always runs one bcrypt comparison, even for unknown emails, so response time doesn't reveal whether an account exists.
- Tokens are HS256 JWTs carrying `sub`, `email` and `role`, valid for `JWT_EXPIRES_IN`. Only the gateway verifies them.
- **Bootstrap admin:** with `ADMIN_EMAIL` and `ADMIN_PASSWORD` set, startup creates that admin (or promotes an existing account with that email).
- Every new user is published as `user.registered` through the outbox; booking-service and notify-service keep replicas of names and emails.

## Configuration
`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `BCRYPT_ROUNDS`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, plus the common variables.
