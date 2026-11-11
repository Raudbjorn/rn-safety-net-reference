import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';

import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';

// Run via `npm run rules:ci`, which starts the Firestore emulator and sets FIRESTORE_EMULATOR_HOST.
const PROJECT_ID = 'demo-safety-net';
const VESSEL = 'vessel-1';
const OTHER_VESSEL = 'vessel-2';
const DRILL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const drillBody = (overrides: Record<string, unknown> = {}) => ({
  id: DRILL_ID,
  vesselId: VESSEL,
  type: 'fire',
  performedAt: '2026-11-11T10:00:00.000Z',
  ...overrides,
});

describe('firestore rules: drills', () => {
  let env: RulesTestEnvironment;

  before(async () => {
    assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'run through `npm run rules:ci` so the emulator is up');
    env = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    });
  });

  after(async () => {
    await env.cleanup();
  });

  beforeEach(async () => {
    await env.clearFirestore();
    // Seed with rules disabled: crew membership is backend-owned, clients cannot write it.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, `vessels/${VESSEL}/crew/alice`), { active: true });
      await setDoc(doc(db, `vessels/${VESSEL}/crew/bob`), { active: false });
      await setDoc(doc(db, `vessels/${OTHER_VESSEL}/crew/carol`), { active: true });
      await setDoc(doc(db, `vessels/${VESSEL}/drills/${DRILL_ID}`), drillBody());
    });
  });

  const drillPath = (id = DRILL_ID, vessel = VESSEL) => `vessels/${vessel}/drills/${id}`;
  const NEW_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  describe('create', () => {
    it('[REQ-AUTHZ-001] an active member of the vessel can create a drill', async () => {
      const db = env.authenticatedContext('alice').firestore();
      await assertSucceeds(setDoc(doc(db, drillPath(NEW_ID)), drillBody({ id: NEW_ID })));
    });

    it('[REQ-AUTHZ-001] an inactive member cannot', async () => {
      const db = env.authenticatedContext('bob').firestore();
      await assertFails(setDoc(doc(db, drillPath(NEW_ID)), drillBody({ id: NEW_ID })));
    });

    it('[REQ-AUTHZ-001] a member of a different vessel cannot', async () => {
      const db = env.authenticatedContext('carol').firestore();
      await assertFails(setDoc(doc(db, drillPath(NEW_ID)), drillBody({ id: NEW_ID })));
    });

    it('[REQ-AUTHZ-001] an unauthenticated client cannot', async () => {
      const db = env.unauthenticatedContext().firestore();
      await assertFails(setDoc(doc(db, drillPath(NEW_ID)), drillBody({ id: NEW_ID })));
    });

    it('[REQ-AUTHZ-001] a member cannot file a body that names a different vessel than the path', async () => {
      const db = env.authenticatedContext('alice').firestore();
      await assertFails(setDoc(doc(db, drillPath(NEW_ID)), drillBody({ id: NEW_ID, vesselId: OTHER_VESSEL })));
    });
  });

  // Controls. Each differs from a denial above by exactly one attribute and must succeed. They stop a
  // broken rule (or an emulator error) from making every `assertFails` pass for the wrong reason.
  describe('controls: denials follow the data', () => {
    it('[REQ-AUTHZ-001] the inactive member is allowed once flipped to active', async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), `vessels/${VESSEL}/crew/bob`), { active: true });
      });
      const db = env.authenticatedContext('bob').firestore();
      await assertSucceeds(setDoc(doc(db, drillPath(NEW_ID)), drillBody({ id: NEW_ID })));
    });

    it('[REQ-AUTHZ-001] the other-vessel member is allowed on her own vessel, refused on this one', async () => {
      const db = env.authenticatedContext('carol').firestore();
      await assertSucceeds(
        setDoc(doc(db, drillPath(NEW_ID, OTHER_VESSEL)), drillBody({ id: NEW_ID, vesselId: OTHER_VESSEL })),
      );
      await assertFails(setDoc(doc(db, drillPath(NEW_ID, VESSEL)), drillBody({ id: NEW_ID })));
    });

    it('[REQ-AUTHZ-001] a member is allowed when the body agrees with the path (only the vessel field differs from the refused case)', async () => {
      const db = env.authenticatedContext('alice').firestore();
      await assertSucceeds(setDoc(doc(db, drillPath(NEW_ID)), drillBody({ id: NEW_ID, vesselId: VESSEL })));
    });

    it('[REQ-AUTHZ-003] the inactive member can read once flipped to active', async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), `vessels/${VESSEL}/crew/bob`), { active: true });
      });
      const db = env.authenticatedContext('bob').firestore();
      await assertSucceeds(getDoc(doc(db, drillPath())));
    });
  });

  describe('append-only', () => {
    it('[REQ-AUTHZ-002] nobody can update a record, including an active member', async () => {
      const db = env.authenticatedContext('alice').firestore();
      await assertFails(updateDoc(doc(db, drillPath()), { type: 'abandon-ship' }));
    });

    it('[REQ-AUTHZ-002] nobody can delete a record, including an active member', async () => {
      const db = env.authenticatedContext('alice').firestore();
      await assertFails(deleteDoc(doc(db, drillPath())));
    });

    it('[REQ-AUTHZ-002] overwriting an existing id with set() is an update, so it is refused too', async () => {
      const db = env.authenticatedContext('alice').firestore();
      await assertFails(setDoc(doc(db, drillPath()), drillBody({ type: 'man-overboard' })));
    });
  });

  describe('read', () => {
    it('[REQ-AUTHZ-003] an active member can read the vessel drills', async () => {
      const db = env.authenticatedContext('alice').firestore();
      await assertSucceeds(getDoc(doc(db, drillPath())));
      await assertSucceeds(getDocs(collection(db, `vessels/${VESSEL}/drills`)));
    });

    it('[REQ-AUTHZ-003] a member of another vessel cannot read a single record or list the collection', async () => {
      const db = env.authenticatedContext('carol').firestore();
      await assertFails(getDoc(doc(db, drillPath())));
      await assertFails(getDocs(collection(db, `vessels/${VESSEL}/drills`)));
    });

    it('[REQ-AUTHZ-003] an inactive member cannot read', async () => {
      const db = env.authenticatedContext('bob').firestore();
      await assertFails(getDoc(doc(db, drillPath())));
    });

    it('[REQ-AUTHZ-003] an unauthenticated client cannot read', async () => {
      const db = env.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, drillPath())));
    });
  });

  describe('crew membership is not client-writable', () => {
    it('a user cannot grant themselves membership', async () => {
      const db = env.authenticatedContext('mallory').firestore();
      await assertFails(setDoc(doc(db, `vessels/${VESSEL}/crew/mallory`), { active: true }));
    });
  });
});
