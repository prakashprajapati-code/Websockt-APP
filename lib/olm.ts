let olmModule: any = null;
let initialized = false;

async function getOlm() {
  if (typeof window === "undefined") return null;
  if (!olmModule) {
    olmModule = (await import("@matrix-org/olm")).default;
  }
  if (!initialized) {
    await olmModule.init({ locateFile: () => "/olm.wasm" });
    initialized = true;
  }
  return olmModule;
}

export async function createAccount() {
  const Olm = await getOlm();
  if (!Olm) throw new Error("OLM not available outside browser");
  const account = new Olm.Account();
  account.create();
  return account;
}

export async function generateOneTimeKeys(account: any, count: number) {
  account.generate_one_time_keys(count);
  const raw = account.one_time_keys();
  const parsed = JSON.parse(raw);
  return Object.entries(parsed.curve25519 || {}).map(([keyId, pub]) => ({
    keyId,
    publicKey: pub as string,
  }));
}

export async function createOutboundSession(
  ownAccount: any,
  theirIdentityKey: string,
  theirOneTimeKey: string,
) {
  const Olm = await getOlm();
  if (!Olm) throw new Error("OLM not available outside browser");
  const session = new Olm.Session();
  session.create_outbound(ownAccount, theirIdentityKey, theirOneTimeKey);
  return session;
}

export async function createInboundSessionFromPreKey(
  ownAccount: any,
  theirIdentityKey: string,
  preKeyMessage: string,
) {
  try {
    const Olm = await getOlm();
    if (!Olm) throw new Error("OLM not available outside browser");
    const session = new Olm.Session();
    session.create_inbound_from(ownAccount, theirIdentityKey, preKeyMessage);
    return session;
  } catch (e) {
    console.log(e);
  }
}

export function encryptMessage(session: any, plaintext: string) {
  return session.encrypt(plaintext) as { type: 0 | 1; body: string };
}

export function decryptMessage(
  session: any,
  messageType: number,
  ciphertext: string,
) {
  return session.decrypt(messageType, ciphertext) as string;
}

export function getSessionId(session: any) {
  return session.session_id();
}

export async function pickleAccount(account: any, key: string) {
  const pickled = account.pickle(key);
  const encoder = new TextEncoder();
  const data = encoder.encode(pickled);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pwKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const encKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    pwKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    encKey,
    data,
  );
  return {
    encrypted: Array.from(new Uint8Array(encrypted)),
    iv: Array.from(iv),
    salt: Array.from(salt),
  };
}

export async function unpickleAccount(
  pickled: { encrypted: number[]; iv: number[]; salt: number[] },
  key: string,
) {
  const encoder = new TextEncoder();
  const pwKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const decKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new Uint8Array(pickled.salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    pwKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(pickled.iv) },
    decKey,
    new Uint8Array(pickled.encrypted),
  );
  const decoded = new TextDecoder().decode(decrypted);
  const Olm = await getOlm();
  if (!Olm) throw new Error("OLM not available outside browser");
  const account = new Olm.Account();
  account.unpickle(key, decoded);
  return account;
}

export async function securePickle(data: any, key: string) {
  const pickled = data.pickle(key);
  const encoder = new TextEncoder();
  const encoded = encoder.encode(pickled);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pwKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const encKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    pwKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    encKey,
    encoded,
  );
  return {
    encrypted: Array.from(new Uint8Array(encrypted)),
    iv: Array.from(iv),
    salt: Array.from(salt),
  };
}

export async function secureUnpickle<T>(
  pickled: { encrypted: number[]; iv: number[]; salt: number[] },
  key: string,
  factory: () => T,
  unpickleFn: (obj: T, key: string, pickle: string) => void,
) {
  const encoder = new TextEncoder();
  const pwKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const decKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new Uint8Array(pickled.salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    pwKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(pickled.iv) },
    decKey,
    new Uint8Array(pickled.encrypted),
  );
  const decoded = new TextDecoder().decode(decrypted);
  const obj = factory();
  unpickleFn(obj, key, decoded);
  return obj;
}

export async function saveSession(session: any, key: string) {
  return securePickle(session, key);
}

export async function loadSession(
  pickled: { encrypted: number[]; iv: number[]; salt: number[] },
  key: string,
) {
  const Olm = await getOlm();
  if (!Olm) throw new Error("OLM not available outside browser");
  return secureUnpickle(
    pickled,
    key,
    () => new Olm.Session(),
    (s, k, p) => s.unpickle(k, p),
  );
}

export function markKeysPublished(account: any) {
  account.mark_keys_as_published();
}

export function getIdentityKeys(account: any) {
  const raw = account.identity_keys();
  return JSON.parse(raw) as { curve25519: string; ed25519: string };
}

export function freeAccount(account: any) {
  account.free();
}
