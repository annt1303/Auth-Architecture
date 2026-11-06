import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CONFIG, type Config } from '../config/config.js';
import { Db } from '../db/db.js';

export type ValidSession = { id: string; principalId: string; createdAt: Date };

const hashToken = (token: string) => createHash('sha256').update(token).digest();

// Session phía server (SPEC §5.4). Cookie chỉ chứa token ngẫu nhiên; DB lưu SHA-256 của nó.
// Session không mang quyền: quyền luôn được đọc lại từ DB ở mỗi request.
@Injectable()
export class SessionService {
  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async create(principalId: string, req: Request, res: Response): Promise<void> {
    const token = randomBytes(32).toString('base64url');
    await this.db.query(
      `INSERT INTO auth_sessions (token_hash, principal_id, expires_at, user_agent, source_ip)
       VALUES ($1, $2, now() + make_interval(mins => $3), $4, $5)`,
      [
        hashToken(token),
        principalId,
        this.config.SESSION_TTL_MINUTES,
        req.headers['user-agent'] ?? null,
        req.socket.remoteAddress ?? null,
      ],
    );
    res.cookie(this.config.SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.NODE_ENV === 'production',
      path: '/',
      maxAge: this.config.SESSION_TTL_MINUTES * 60_000,
    });
  }

  async validate(req: Request): Promise<ValidSession | null> {
    const token: unknown = req.cookies?.[this.config.SESSION_COOKIE_NAME];
    if (typeof token !== 'string' || token.length === 0) return null;
    const [row] = await this.db.query<{ id: string; principal_id: string; created_at: Date }>(
      `UPDATE auth_sessions SET last_seen_at = now()
        WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
        RETURNING id, principal_id, created_at`,
      [hashToken(token)],
    );
    return row ? { id: row.id, principalId: row.principal_id, createdAt: row.created_at } : null;
  }

  async revoke(req: Request, res: Response): Promise<void> {
    const token: unknown = req.cookies?.[this.config.SESSION_COOKIE_NAME];
    if (typeof token === 'string') {
      await this.db.query(
        `UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
        [hashToken(token)],
      );
    }
    res.clearCookie(this.config.SESSION_COOKIE_NAME, { path: '/' });
  }
}
