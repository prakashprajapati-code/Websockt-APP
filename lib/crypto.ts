import { openDB } from "./session";

interface EncryptedBlob {
  encrypted: number[];
  iv: number[];
  salt: number[];
}

function arrayBufferToBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function generateKeyPair() {
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    true,
    ["sign", "verify"],
  );

  const publicKey = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const privateKey = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);

  return {
    publicKey: arrayBufferToBase64(publicKey),
    privateKey: arrayBufferToBase64(privateKey),
  };
}

// Generate AES key from password
export async function deriveEncryptionKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
) {
  const encoder = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

// Encrypt and save private key
export async function encryptAndSavePrivateKey(
  privateKey: string,
  userPassword: string,
  userId: number,
) {
  const encoder = new TextEncoder();

  const salt = crypto.getRandomValues(new Uint8Array(16));

  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encryptionKey = await deriveEncryptionKey(userPassword, salt);

  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    encryptionKey,
    encoder.encode(privateKey),
  );

  const encryptedData = {
    encrypted: Array.from(new Uint8Array(encrypted)),
    iv: Array.from(iv),
    salt: Array.from(salt),
  };

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("keys", "readwrite");

    tx.objectStore("keys").put(encryptedData, `privateKey_${userId}`);

    tx.oncomplete = () => resolve(encryptedData);

    tx.onerror = reject;
  });
}

// Read encrypted key
export async function getEncryptedPrivateKey(
  userId: number,
): Promise<EncryptedBlob | undefined> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("keys", "readonly");
    const store = tx.objectStore("keys");

    const getReq = store.get(`privateKey_${userId}`);

    getReq.onsuccess = () => {
      resolve(getReq.result ?? undefined);
    };

    getReq.onerror = () => {
      reject(getReq.error || new Error("Failed to read private key"));
    };

    tx.onerror = () => {
      reject(tx.error || new Error("IndexedDB transaction failed"));
    };

    tx.onabort = () => {
      reject(new Error("IndexedDB transaction aborted"));
    };
  });
}
// Read and decrypt private key
export async function getAndDecryptPrivateKey(
  userPassword: string,
  userId: number,
) {
  const encryptedData = await getEncryptedPrivateKey(userId);

  if (!encryptedData) {
    throw new Error("Private key not found in IndexedDB. Please re-login.");
  }

  const encryptionKey = await deriveEncryptionKey(
    userPassword,
    new Uint8Array(encryptedData.salt),
  );

  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(encryptedData.iv),
    },
    encryptionKey,
    new Uint8Array(encryptedData.encrypted),
  );

  return new TextDecoder().decode(decrypted);
}

export async function encryptPlaintext(
  plaintext: string,
  password: string,
): Promise<EncryptedBlob> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptionKey = await deriveEncryptionKey(password, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    encryptionKey,
    encoder.encode(plaintext),
  );
  return {
    encrypted: Array.from(new Uint8Array(encrypted)),
    iv: Array.from(iv),
    salt: Array.from(salt),
  };
}

export async function decryptPlaintext(
  data: EncryptedBlob,
  password: string,
): Promise<string> {
  const encryptionKey = await deriveEncryptionKey(
    password,
    new Uint8Array(data.salt),
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(data.iv) },
    encryptionKey,
    new Uint8Array(data.encrypted),
  );
  return new TextDecoder().decode(decrypted);
}
