import express, { type NextFunction, type Request, type Response } from 'express';

import { DrillRecordSchema, sameDrill, type DrillRecord } from '../src/domain/drill';

const BODY_LIMIT = '16kb';

export interface GatewayOptions {
  /** Test-only fault hooks. Never enable outside tests and the e2e script. */
  faultsEnabled?: boolean;
}

/**
 * A deliberately small stand-in for an API gateway.
 *  - REQ-DRILL-005: at most one record per client-generated id, however often it is submitted.
 *  - REQ-DRILL-006: with the "drop next reply" fault armed, the record is stored and then the
 *    connection is destroyed, which is exactly the "server saved it, the reply was lost" case.
 */
export function createGateway(options: GatewayOptions = {}) {
  const store = new Map<string, DrillRecord>();
  const faults = { dropNextReply: false };

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: BODY_LIMIT }));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post('/v1/drills', (req: Request, res: Response) => {
    const parsed = DrillRecordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        error: 'invalid',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const record = parsed.data;
    const existing = store.get(record.id);
    if (existing) {
      if (sameDrill(existing, record)) {
        res.status(200).json({ status: 'duplicate' });
      } else {
        res.status(409).json({ error: 'id-conflict' });
      }
      return;
    }

    store.set(record.id, record);

    if (options.faultsEnabled && faults.dropNextReply) {
      faults.dropNextReply = false;
      req.socket.destroy(); // stored, but the client never hears about it
      return;
    }
    res.status(201).json({ status: 'stored' });
  });

  app.get('/v1/drills', (_req: Request, res: Response) => {
    res.json({ count: store.size, drills: [...store.values()] });
  });

  if (options.faultsEnabled) {
    app.post('/__fault/drop-next-reply', (_req: Request, res: Response) => {
      faults.dropNextReply = true;
      res.status(204).end();
    });
  }

  app.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(400).json({ error: 'bad-request' });
  });

  return { app, store };
}
