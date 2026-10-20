/** 极简 IndexedDB 封装：题库、答题记录、考试记录、设置 */
import type { Attempt, Question, QuestionRecord, Settings } from '@/types'

const DB_NAME = 'sdzkb-computer'
const DB_VERSION = 1

export const STORE_QUESTIONS = 'questions'
export const STORE_RECORDS = 'records'
export const STORE_ATTEMPTS = 'attempts'
export const STORE_META = 'meta'

let dbPromise: Promise<IDBDatabase> | null = null

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_QUESTIONS)) {
        const s = db.createObjectStore(STORE_QUESTIONS, { keyPath: 'id' })
        s.createIndex('chapterId', 'chapterId')
        s.createIndex('type', 'type')
        s.createIndex('paperId', 'paperId')
        s.createIndex('source', 'source')
      }
      if (!db.objectStoreNames.contains(STORE_RECORDS)) {
        db.createObjectStore(STORE_RECORDS, { keyPath: 'qid' })
      }
      if (!db.objectStoreNames.contains(STORE_ATTEMPTS)) {
        db.createObjectStore(STORE_ATTEMPTS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx(db: IDBDatabase, stores: string[], mode: IDBTransactionMode) {
  return db.transaction(stores, mode)
}

function done(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

function reqToPromise<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

export async function getAll<T>(store: string): Promise<T[]> {
  const db = await openDB()
  const t = tx(db, [store], 'readonly')
  const r = t.objectStore(store).getAll()
  const res = await reqToPromise(r)
  await done(t)
  return res as T[]
}

export async function getOne<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDB()
  const t = tx(db, [store], 'readonly')
  const r = t.objectStore(store).get(key)
  const res = await reqToPromise(r)
  await done(t)
  return res as T | undefined
}

export async function putMany(store: string, items: unknown[]): Promise<void> {
  if (!items.length) return
  const db = await openDB()
  const t = tx(db, [store], 'readwrite')
  const os = t.objectStore(store)
  for (const it of items) os.put(it)
  await done(t)
}

export async function putOne(store: string, item: unknown): Promise<void> {
  const db = await openDB()
  const t = tx(db, [store], 'readwrite')
  t.objectStore(store).put(item)
  await done(t)
}

export async function delMany(store: string, keys: IDBValidKey[]): Promise<void> {
  if (!keys.length) return
  const db = await openDB()
  const t = tx(db, [store], 'readwrite')
  const os = t.objectStore(store)
  for (const k of keys) os.delete(k)
  await done(t)
}

export async function clearStore(store: string): Promise<void> {
  const db = await openDB()
  const t = tx(db, [store], 'readwrite')
  t.objectStore(store).clear()
  await done(t)
}

export async function countStore(store: string): Promise<number> {
  const db = await openDB()
  const t = tx(db, [store], 'readonly')
  const r = t.objectStore(store).count()
  const res = await reqToPromise(r)
  await done(t)
  return res
}

// ---------- 领域 API ----------

export const DEFAULT_SETTINGS: Settings = {
  multiMode: 'sd',
  practiceMode: 'answer',
  immediateFeedback: true,
  examDate: '',
  pageSize: 0, // 0 = 不分页（一次做完）
}

export async function loadSettings(): Promise<Settings> {
  const m = await getOne<{ key: string; value: Settings }>(STORE_META, 'settings')
  return { ...DEFAULT_SETTINGS, ...(m?.value || {}) }
}

export async function saveSettings(s: Settings): Promise<void> {
  await putOne(STORE_META, { key: 'settings', value: s })
}

export const questionRepo = {
  all: () => getAll<Question>(STORE_QUESTIONS),
  save: (qs: Question[]) => putMany(STORE_QUESTIONS, qs),
  remove: (ids: string[]) => delMany(STORE_QUESTIONS, ids),
  clear: () => clearStore(STORE_QUESTIONS),
  count: () => countStore(STORE_QUESTIONS),
}

export const recordRepo = {
  all: () => getAll<QuestionRecord>(STORE_RECORDS),
  save: (rs: QuestionRecord[]) => putMany(STORE_RECORDS, rs),
  remove: (ids: string[]) => delMany(STORE_RECORDS, ids),
  clear: () => clearStore(STORE_RECORDS),
}

export const attemptRepo = {
  all: () => getAll<Attempt>(STORE_ATTEMPTS),
  save: (as: Attempt[]) => putMany(STORE_ATTEMPTS, as),
  remove: (ids: string[]) => delMany(STORE_ATTEMPTS, ids),
  clear: () => clearStore(STORE_ATTEMPTS),
}
