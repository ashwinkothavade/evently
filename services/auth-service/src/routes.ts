import { currentUser, requireUser } from '@evently/shared/http';
import { parse } from '@evently/shared/validate';
import { Router } from 'express';
import { z } from 'zod';
import type { createAuthService } from './service.js';

const RegisterBody = z.object({
  email: z.email().max(254),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
});

const LoginBody = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export function authRoutes(auth: ReturnType<typeof createAuthService>) {
  const router = Router();

  router.post('/api/v1/auth/register', async (req, res) => {
    res.status(201).json({ data: await auth.register(parse(RegisterBody, req.body)) });
  });

  router.post('/api/v1/auth/login', async (req, res) => {
    res.json({ data: await auth.login(parse(LoginBody, req.body)) });
  });

  router.get('/api/v1/me', requireUser, async (req, res) => {
    res.json({ data: await auth.getUser(currentUser(req).id) });
  });

  return router;
}
