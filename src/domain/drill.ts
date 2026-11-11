import { z } from 'zod';

/** Errors as values: no exceptions for expected failures. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const DRILL_TYPES = ['fire', 'abandon-ship', 'man-overboard', 'steering-failure'] as const;
export type DrillType = (typeof DRILL_TYPES)[number];

const MAX_VESSEL_ID_LENGTH = 64;
const MAX_NOTES_LENGTH = 500;

/** What a person enters. The id is NOT part of it: the app assigns it (REQ-DRILL-002). */
export const DrillInputSchema = z.object({
  vesselId: z.string().min(1).max(MAX_VESSEL_ID_LENGTH),
  type: z.enum(DRILL_TYPES),
  performedAt: z.iso.datetime(),
  notes: z.string().max(MAX_NOTES_LENGTH).optional(),
});
export type DrillInput = z.infer<typeof DrillInputSchema>;

/** What travels over the wire and is stored. One schema shared by app and gateway = one contract. */
export const DrillRecordSchema = DrillInputSchema.extend({ id: z.uuid() });
export type DrillRecord = z.infer<typeof DrillRecordSchema>;

/** Field-by-field equality, so a resubmission of the same drill is recognised as the same drill. */
export function sameDrill(a: DrillRecord, b: DrillRecord): boolean {
  return (
    a.id === b.id &&
    a.vesselId === b.vesselId &&
    a.type === b.type &&
    a.performedAt === b.performedAt &&
    (a.notes ?? '') === (b.notes ?? '')
  );
}

export function describeIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}
