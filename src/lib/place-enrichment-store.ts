import { browser } from '$app/environment';
import { getZenithFirestore, hasFirebaseConfig } from './firebase';
import type { GooglePlaceType, PlaceEnrichmentRecord } from './types';

type EnrichmentLoadResult = {
  records: Record<string, PlaceEnrichmentRecord>;
  storageLabel: string;
};

const LOCAL_STORAGE_KEY = 'zen.place-enrichments.v1';
const COLLECTION_NAME = 'zenithPlaceEnrichments';

function firestoreDocId(id: string): string {
  return encodeURIComponent(id).replace(/\./g, '%2E');
}

function normalizeTypes(value: unknown): GooglePlaceType[] {
  return Array.isArray(value) ? (value.filter((item) => typeof item === 'string') as GooglePlaceType[]) : [];
}

function normalizeRecord(value: unknown): PlaceEnrichmentRecord | null {
  if (!value || typeof value !== 'object') return null;

  const record = value as Partial<PlaceEnrichmentRecord>;
  if (!record.id || !record.label) return null;

  return {
    id: record.id,
    label: record.label,
    canonicalKey: record.canonicalKey,
    googlePlaceTypes: normalizeTypes(record.googlePlaceTypes),
    primaryType: record.primaryType ?? 'point_of_interest',
    history: record.history,
    personalNote: record.personalNote,
    source: record.source ?? 'manual',
    updatedAt: record.updatedAt ?? new Date().toISOString()
  };
}

function readLocalRecords(): Record<string, PlaceEnrichmentRecord> {
  if (!browser) return {};

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, value]) => [key, normalizeRecord(value)] as const)
        .filter((entry): entry is [string, PlaceEnrichmentRecord] => Boolean(entry[1]))
    );
  } catch {
    return {};
  }
}

function writeLocalRecords(records: Record<string, PlaceEnrichmentRecord>) {
  if (!browser) return;

  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(records));
}

async function readFirestoreRecords(): Promise<Record<string, PlaceEnrichmentRecord>> {
  const db = await getZenithFirestore();
  if (!db) return {};

  const { collection, getDocs } = await import('firebase/firestore');
  const snapshot = await getDocs(collection(db, COLLECTION_NAME));

  return Object.fromEntries(
    snapshot.docs
      .map((snapshotDoc) => normalizeRecord(snapshotDoc.data()))
      .filter((record): record is PlaceEnrichmentRecord => Boolean(record))
      .map((record) => [record.id, { ...record, source: 'firestore' as const }])
  );
}

export async function loadPlaceEnrichments(): Promise<EnrichmentLoadResult> {
  const localRecords = readLocalRecords();

  if (!hasFirebaseConfig()) {
    return {
      records: localRecords,
      storageLabel: 'Local enrichment'
    };
  }

  try {
    const firestoreRecords = await readFirestoreRecords();
    const records = { ...localRecords, ...firestoreRecords };
    writeLocalRecords(records);

    return {
      records,
      storageLabel: 'Firestore enrichment'
    };
  } catch {
    return {
      records: localRecords,
      storageLabel: 'Local enrichment'
    };
  }
}

export async function savePlaceEnrichment(record: PlaceEnrichmentRecord): Promise<'firestore' | 'local'> {
  const localRecords = readLocalRecords();
  const nextRecord = {
    ...record,
    updatedAt: new Date().toISOString()
  };

  writeLocalRecords({
    ...localRecords,
    [record.id]: nextRecord
  });

  if (!hasFirebaseConfig()) {
    return 'local';
  }

  try {
    const db = await getZenithFirestore();
    if (!db) return 'local';

    const { doc, setDoc } = await import('firebase/firestore');
    await setDoc(doc(db, COLLECTION_NAME, firestoreDocId(record.id)), nextRecord, { merge: true });

    return 'firestore';
  } catch {
    return 'local';
  }
}
