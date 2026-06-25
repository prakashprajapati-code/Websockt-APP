import {
  saveSession as olmSaveSession,
  loadSession as olmLoadSession,
  unpickleAccount,
  pickleAccount,
} from "./olm";
import { encryptPlaintext, decryptPlaintext } from "./crypto";

export interface StoredSession {
  pickled: { encrypted: number[]; iv: number[]; salt: number[] };
  sessionId: string;
  userId: number;
}

export interface EncryptedBlob {
  encrypted: number[];
  iv: number[];
  salt: number[];
}

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("KeyDB", 4);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("keys")) {
        db.createObjectStore("keys");
      }
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions");
      }
      if (!db.objectStoreNames.contains("sent_messages")) {
        db.createObjectStore("sent_messages");
      }
      if (!db.objectStoreNames.contains("received_messages")) {
        db.createObjectStore("received_messages");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function storeSentPlaintext(
  userId: number,
  receiverId: number,
  text: string,
  time: string,
  identityKey: string,
) {
  const db = await openDB();
  const key = `sent_${userId}_${receiverId}_${time}`;
  const encrypted = await encryptPlaintext(text, identityKey);
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("sent_messages", "readwrite");
    tx.objectStore("sent_messages").put({ encrypted, time, userId, receiverId }, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getSentPlaintexts(userId: number, receiverId: number, identityKey: string) {
  const db = await openDB();
  return new Promise<{ text: string; time: string }[]>((resolve, reject) => {
    const tx = db.transaction("sent_messages", "readonly");
    const req = tx.objectStore("sent_messages").getAll();
    req.onsuccess = async () => {
      const all: any[] = req.result || [];
      const filtered = all
        .filter((item) => item.userId === userId && item.receiverId === receiverId)
        .sort((a, b) => a.time.localeCompare(b.time));
      const decrypted: { text: string; time: string }[] = [];
      for (const item of filtered) {
        if (item.encrypted) {
          try {
            const text = await decryptPlaintext(item.encrypted, identityKey);
            decrypted.push({ text, time: item.time });
          } catch {}
        }
      }
      resolve(decrypted);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function storeReceivedPlaintext(
  userId: number,
  senderId: number,
  text: string,
  time: string,
  identityKey: string,
) {
  const db = await openDB();
  const key = `recv_${userId}_${senderId}_${time}`;
  const encrypted = await encryptPlaintext(text, identityKey);
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("received_messages", "readwrite");
    tx.objectStore("received_messages").put({ encrypted, time, userId, senderId }, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getReceivedPlaintexts(userId: number, senderId: number, identityKey: string) {
  const db = await openDB();
  return new Promise<{ text: string; time: string; senderId: number }[]>((resolve, reject) => {
    const tx = db.transaction("received_messages", "readonly");
    const req = tx.objectStore("received_messages").getAll();
    req.onsuccess = async () => {
      const all: any[] = req.result || [];
      const filtered = all
        .filter((item) => item.userId === userId && item.senderId === senderId)
        .sort((a, b) => a.time.localeCompare(b.time));
      const decrypted: { text: string; time: string; senderId: number }[] = [];
      for (const item of filtered) {
        if (item.encrypted) {
          try {
            const text = await decryptPlaintext(item.encrypted, identityKey);
            decrypted.push({ text, time: item.time, senderId: item.senderId });
          } catch {}
        }
      }
      resolve(decrypted);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getStoredSession(userId: number) {
  const db = await openDB();
  return new Promise<StoredSession | undefined>((resolve, reject) => {
    const tx = db.transaction("sessions", "readonly");
    const req = tx.objectStore("sessions").get(`session_${userId}`);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function storeSession(userId: number, session: any, key: string) {
  try {
    const db = await openDB();
    const pickled = await olmSaveSession(session, key);
    const data: StoredSession = {
      pickled,
      sessionId: session.session_id(),
      userId,
    };
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction("sessions", "readwrite");
      tx.objectStore("sessions").put(data, `session_${userId}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.log(e);
  }
}

export async function loadStoredSession(userId: number, key: string) {
  const stored = await getStoredSession(userId);
  if (!stored) return null;
  return olmLoadSession(stored.pickled, key);
}

export async function deleteStoredSession(userId: number) {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("sessions", "readwrite");
    tx.objectStore("sessions").delete(`session_${userId}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function sessionExists(userId: number) {
  const stored = await getStoredSession(userId);
  return !!stored;
}

export async function saveOlmAccount(blob: EncryptedBlob, userId: number) {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("sessions", "readwrite");
    tx.objectStore("sessions").put(blob, `olm_account_${userId}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getOlmAccount(userId: number) {
  const db = await openDB();
  return new Promise<EncryptedBlob | undefined>((resolve, reject) => {
    const tx = db.transaction("sessions", "readonly");
    const req = tx.objectStore("sessions").get(`olm_account_${userId}`);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function olmAccountExists(userId: number) {
  const blob = await getOlmAccount(userId);
  return !!blob;
}
