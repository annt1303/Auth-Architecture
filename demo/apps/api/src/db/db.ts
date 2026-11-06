import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';
import { mapDbError } from '../common/api-error.js';
import { CONFIG, type Config } from '../config/config.js';

export type Queryable = {
  query<T extends pg.QueryResultRow>(text: string, values?: unknown[]): Promise<T[]>;
};

export type ActorInfo = {
  principalId: string | null;
  correlationId: string;
  reason?: string;
};

// Truy cập DB bằng SQL tham số hóa. Mọi truy vấn trên dữ liệu thuộc tenant phải có
// điều kiện tenant_id (tài liệu gốc §13); FilterPlan được dịch ở authz/data-scope.ts.
@Injectable()
export class Db implements OnModuleDestroy {
  private readonly pool: pg.Pool;

  constructor(@Inject(CONFIG) config: Config) {
    this.pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });
  }

  async query<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query<T>(text, values);
    return result.rows;
  }

  // Ghi dữ liệu trong một transaction có actor. Trigger audit lớp A đọc actor,
  // correlation id và lý do từ các biến này (tài liệu gốc §8.5.5).
  async withActor<T>(actor: ActorInfo, fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.actor_id', $1, true),
                set_config('app.correlation_id', $2, true),
                set_config('app.reason', $3, true)`,
        [actor.principalId ?? '', actor.correlationId, actor.reason ?? ''],
      );
      const tx: Queryable = {
        query: async <R extends pg.QueryResultRow>(text: string, values: unknown[] = []) =>
          (await client.query<R>(text, values)).rows,
      };
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw mapDbError(err);
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
