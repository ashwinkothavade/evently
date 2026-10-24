import { publish } from '@evently/shared/bus';
import { isPgError, PgCode, type Database } from '@evently/shared/db';
import { conflict, notFound, unauthorized } from '@evently/shared/errors';
import type { Role } from '@evently/shared/http';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: Role;
  created_at: Date;
}

const toUserDto = (row: UserRow) => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role,
  createdAt: row.created_at,
});

// Compared against when the email is unknown, so timing does not reveal account existence.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', config.BCRYPT_ROUNDS);

export function createAuthService(db: Database, onPublished: () => void) {
  function session(row: UserRow) {
    // The gateway verifies this token and forwards sub/email/role to services.
    const token = jwt.sign({ sub: row.id, email: row.email, role: row.role }, config.JWT_SECRET, {
      expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    });
    return { token, user: toUserDto(row) };
  }

  async function register(input: { email: string; name: string; password: string }) {
    const passwordHash = await bcrypt.hash(input.password, config.BCRYPT_ROUNDS);
    try {
      const user = await db.withTransaction(async (tx) => {
        const { rows } = await tx.query<UserRow>(
          'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING *',
          [input.email, input.name, passwordHash],
        );
        const user = rows[0]!;
        await publish(tx, 'user.registered', { userId: user.id, email: user.email, name: user.name, role: user.role });
        return user;
      });
      onPublished();
      return session(user);
    } catch (err) {
      if (isPgError(err) && err.code === PgCode.UNIQUE_VIOLATION) {
        throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
      }
      throw err;
    }
  }

  async function login(input: { email: string; password: string }) {
    const { rows } = await db.pool.query<UserRow>('SELECT * FROM users WHERE lower(email) = lower($1)', [input.email]);
    const user = rows[0];
    const valid = await bcrypt.compare(input.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !valid) throw unauthorized('Invalid email or password');
    return session(user);
  }

  async function getUser(id: string) {
    const { rows } = await db.pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    if (!rows[0]) throw notFound('User');
    return toUserDto(rows[0]);
  }

  /** Creates the bootstrap admin, or promotes an existing account with that email. */
  async function ensureAdmin(email: string, password: string) {
    const passwordHash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);
    await db.withTransaction(async (tx) => {
      const { rows } = await tx.query<UserRow>(
        `INSERT INTO users (email, name, password_hash, role) VALUES ($1, 'Administrator', $2, 'admin')
         ON CONFLICT ((lower(email))) DO UPDATE SET role = 'admin'
         RETURNING *`,
        [email, passwordHash],
      );
      const user = rows[0]!;
      await publish(tx, 'user.registered', { userId: user.id, email: user.email, name: user.name, role: user.role });
    });
    onPublished();
  }

  return { register, login, getUser, ensureAdmin };
}
