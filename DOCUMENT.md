# E2EE Chat Application — Architecture & Message Flow

## 1. Architecture Overview

```
┌──────────────┐     WebSocket      ┌──────────────┐     PostgreSQL
│  Browser A    │ ◄──────────────►  │  ws Server   │ ◄────────────►  messagetables
│  (Next.js)    │                    │  (server.mjs)│                  prekeys
│               │    HTTP REST       │              │                  usermodels
│  IndexedDB    │ ◄──────────────►  │  Next.js API │
│  (KeyDB v4)   │                    │  Routes      │
└──────────────┘                    └──────────────┘
```

**Client-side (browser):**
- Next.js React app with E2EE (OLM v3.2.15)
- IndexedDB `KeyDB` v4 for local session + message storage
- WebSocket connection to `ws://localhost:3001` for real-time messaging + presence

**Server-side:**
- `server/server.mjs` — standalone WebSocket server (port 3001), reads JWT from cookie
- Next.js API routes — REST endpoints for auth, key management, conversation history
- PostgreSQL — message ciphertexts, user accounts, pre-keys

---

## 2. Authentication & Registration

### Registration (`/api/register`)
1. User submits email + password + username
2. Password hashed with bcrypt, user row created
3. `generateKeyPair()` — ECDSA P-256 key pair generated via `crypto.subtle`
4. `encryptAndSavePrivateKey(privateKey, password, userId)` — PBKDF2(password) → AES-GCM encrypt private key → stored in IndexedDB `keys` store

### Login (`/api/login`)
1. Email + password POST → validate with bcrypt
2. JWT signed with `lib/auth.ts` → `signToken({ id, email })` → expires 7 days
3. Cookie set: `httpOnly`, `sameSite: lax`, `maxAge: 7 days`, `path: /`
4. Login page then:
   - Loads or generates ECDSA key pair
   - Creates OLM account via `createAccount()` → `Olm.Account.create()`
   - Generates 50 one-time keys → `generateOneTimeKeys(account, 50)`
   - Uploads identity key + OTKs to `POST /api/keys/upload`
   - Pickles OLM account with password → stores in IndexedDB `sessions` store
   - Saves `identityKey` (password) + `userId` to `sessionStorage`

### Logout (`/api/logout`)
- POST → clears `token` cookie (`maxAge: 0`)
- Client: closes WebSocket, calls `/api/logout`, clears `sessionStorage`, redirects to `/login`

### Auth Middleware
- `getUserFromToken()` — reads `token` cookie, verifies JWT, returns `{ id, email }`
- Used by all protected API routes

---

## 3. OLM Key Management

### OLM Account
```
createAccount()
  → new Olm.Account()
  → account.create()
  → returned to caller
```

Created fresh on every login. Pickled with password (PBKDF2 + AES-GCM) and stored in IndexedDB. Unpickled on dashboard mount.

### Identity Keys
```
getIdentityKeys(account)
  → account.identity_keys() returns JSON string
  → JSON.parse → { curve25519: string, ed25519: string }
```
- `curve25519` key uploaded to `User.olm_identity_key` via `POST /api/keys/upload`
- Used by X3DH handshake as the long-term identity

### One-Time Pre-Keys
```
generateOneTimeKeys(account, 50)
  → account.generate_one_time_keys(50)
  → account.one_time_keys() returns JSON string
  → JSON.parse → { curve25519: { keyId: publicKey, ... } }
  → returns [{ keyId, publicKey }]
```

**Upload** (`POST /api/keys/upload`):
```typescript
await PreKey.destroy({ where: { userid: payload.id, type: "one-time", used: false } });
await PreKey.bulkCreate(entries);
```
Old unused OTKs are deleted before inserting new ones.

**Bundle Fetch** (`GET /api/keys/bundle/[userId]`):
- Returns `{ identityKey, oneTimeKey }` where `oneTimeKey` is the first unused OTK
- That OTK is then marked `used: true` (one-time use)

---

## 4. Session Establishment (X3DH)

### Outbound Session (Sender)
```
createOutboundSession(ownAccount, theirIdentityKey, theirOneTimeKey)
  → new Olm.Session()
  → session.create_outbound(ownAccount, theirIdentityKey, theirOneTimeKey)
  → returns session
```

Called when sending a message to a user for the first time (no session exists).

### Inbound Session (Receiver)
```
createInboundSessionFromPreKey(ownAccount, theirIdentityKey, preKeyMessage)
  → new Olm.Session()
  → session.create_inbound_from(ownAccount, theirIdentityKey, preKeyMessage)
  → returns session
```

Called when receiving a `messageType === 0` (pre-key message). The `senderKey` from the message payload contains the sender's `curve25519` identity key.

### Message Types
- **type 0** (pre-key message): First message in a session. Includes `senderKey`. Recipient creates inbound session from this.
- **type 1** (normal message): All subsequent messages. Decrypted with existing session.

### Session Persistence
After every `encrypt()` or `decrypt()` call, the session is persisted:
```
storeSession(userId, session, identityKey)
  → session.pickle(identityKey) → AES-GCM encrypt → IndexedDB `sessions` store
```

On chat open, stored session is loaded from IndexedDB if one exists.

---

## 5. Message Send Flow

```
┌──────────┐     ┌──────────────┐     ┌────────────┐     ┌─────────────┐
│  User     │     │  page.tsx    │     │  server.mjs │     │  PostgreSQL  │
│  types    │────►│              │────►│             │────►│             │
│  text     │     │  encrypt()   │     │  INSERT     │     │             │
└──────────┘     │  relay       │     │  relay      │     └─────────────┘
                 │  store local │     └────────────┘
                 └──────────────┘
```

### Step-by-step

1. **Session check** — `sessionsRef.current.get(id)`. If no session exists, fetch bundle from `/api/keys/bundle/[id]` and `createOutboundSession`.

2. **Encrypt** — `session.encrypt(text)` → `{ type: 0|1, body: ciphertext }`

3. **Persist session** — `storeSession(id, session, identityKey)`

4. **Build payload**
```json
{
  "from": authUser.id,
  "to": recipientId,
  "ciphertext": "<base64 ciphertext>",
  "messageType": 0|1,
  "senderKey": "<sender's curve25519 identity key>"
}
```

5. **Send** — `socketRef.current?.send(JSON.stringify(payload))`

6. **Update UI** — Push `{ message: plaintext, senderId, receiverId, time }` to `sendmessageerarr`

7. **Store locally** — `storeSentPlaintext(authUser.id, recipientId, plaintext, time, identityKey)`
   - PBKDF2(password) → AES-GCM encrypt plaintext
   - Store `{ encrypted, time, userId, receiverId }` in IndexedDB `sent_messages`

---

## 6. Message Receive Flow

```
┌──────────────┐     ┌────────────┐     ┌──────────────┐
│  server.mjs  │────►│  page.tsx  │────►│  IndexedDB   │
│  relay       │     │  decrypt() │     │  store recv  │
└──────────────┘     │  update UI │     └──────────────┘
                     └────────────┘
```

### Step-by-step

1. **WebSocket receive** — Raw JSON string parsed

2. **Presence check** — `parsed.type === "online_users"` or `"presence"` → handled separately, skipped

3. **Ciphertext check** — `parsed.ciphertext && parsed.from && parsed.from !== self`

4. **Type 0 (pre-key message)**:
   - `createInboundSessionFromPreKey(acc, senderKey, ciphertext)` → new session
   - Store session to IndexedDB
   - `decryptMessage(session, 0, ciphertext)` → plaintext

5. **Type 1 (normal message)**:
   - Load existing session from `sessionsRef.current.get(from)`
   - `decryptMessage(session, 1, ciphertext)` → plaintext
   - Persist session to IndexedDB (ratchet moved forward)

6. **Store received plaintext**:
   ```typescript
   storeReceivedPlaintext(selfId, from, plaintext, time, identityKey)
   ```
   - PBKDF2(password) → AES-GCM encrypt plaintext
   - Store `{ encrypted, time, userId, senderId }` in IndexedDB `received_messages`

7. **Update UI** — Push `{ message: plaintext, senderId: from, receiverId: selfId, time }` to `receivermessagesarr`

---

## 7. Message History (After Reload)

### Triggered by
- User selects a chat (`openchat` state changes)
- Clears both message arrays

### Source 1: Local IndexedDB (fast, reliable)

**Sent messages** — `getSentPlaintexts(authUser.id, openchat, identityKey)`:
- Read all entries from `sent_messages` store
- Filter by `userId` + `receiverId`, sort by `time`
- For each entry with `encrypted` field: PBKDF2(password) → AES-GCM decrypt → return `{ text, time }`
- Old plaintext entries (pre-encryption) are skipped

**Received messages** — `getReceivedPlaintexts(authUser.id, openchat, identityKey)`:
- Same pattern using `received_messages` store
- Returns `{ text, time, senderId }`
- A deduplication set `localReceivedSet` is built from decrypted texts

### Source 2: Server API (for messages not in local store)

```
CacheStorage({ userid: openchat })
  → Check in-memory Map cache
  → If miss: fetch GET /api/conversation?with=openchat
  → Returns messages ordered by id ASC
  → Cache in Map for subsequent calls
```

For each server message where `msg.senderid !== authUser.id`:

1. **Build history session** (once):
   - Use `msg.senderkey` if available
   - If no senderKey but `messagetype === 0`, try fetching bundle for `openchat`
   - `createInboundSessionFromPreKey(acc, key, msg.message)` → historySession

2. **Decrypt**:
   ```typescript
   decryptMessage(historySession, msg.messagetype ?? 1, msg.message)
   ```
   - On failure: try type 0 if messagetype is null (legacy messages)

3. **Dedupe check** — `if (plaintext && !localReceivedSet.has(plaintext))` — skip if already loaded from local store

4. **Fallback** — If history session creation fails, try decryption with the loaded live session (`sessionsRef.current.get(openchat)`)

### Why local storage is necessary

OLM's ratchet only moves **forward**. A session persisted after N decryptions cannot decrypt message N-1. Therefore:
- Real-time messages are decrypted and stored as encrypted plaintexts in IndexedDB
- On reload, local store is the primary source
- Server messages are only used for messages never seen before

---

## 8. Presence System

### Server (`server/server.mjs`)

State: `clients` Map `<userId, WebSocket>`, `pendingMessages` Map `<userId, message[]>`

**On connection** (after JWT auth):
```javascript
// Send current online set to new client
ws.send({ type: "online_users", userIds: Array.from(clients.keys()) });

// Broadcast user came online
for (const [id, client] of clients) {
  if (id !== userId) client.send({ type: "presence", userId, status: "online" });
}

// Flush pending offline messages
pendingMessages.get(userId).forEach(msg => ws.send(msg));
```

**On disconnect**:
```javascript
clients.delete(userId);
for (const [id, client] of clients) {
  client.send({ type: "presence", userId, status: "offline" });
}
```

### Client (`app/page.tsx`)

State: `onlineUsers: Set<number>` — tracks which user IDs are online

**WebSocket `onmessage` handler**:
```typescript
if (parsed.type === "online_users") {
  setOnlineUsers(new Set(parsed.userIds));
}
if (parsed.type === "presence") {
  parsed.status === "online" ? set.add(parsed.userId) : set.delete(parsed.userId);
}
```

**UI**: Green dot (`bg-[#30d158]`) rendered on sidebar user avatar when `onlineUsers.has(val.id)`.

---

## 9. Offline Delivery

### Queue mechanism in `server/server.mjs`

```
pendingMessages = Map<userId, message[]>
```

**On message relay**, if recipient has no open WebSocket:
```javascript
if (!pendingMessages.has(to)) pendingMessages.set(to, []);
pendingMessages.get(to).push({ from, to, ciphertext, messageType, senderKey });
```

**On recipient's next WebSocket connection**, all queued messages are flushed to the client. The client processes them identically to real-time messages (same `onmessage` handler), so no special code path is needed.

Messages are **not** re-sent from the server once queued — they are delivered exactly once on the next connection.

---

## 10. Database Schema

### PostgreSQL Tables

#### `usermodels`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER (PK, auto) | |
| email | STRING | Unique |
| password | STRING | bcrypt hash |
| username | STRING | |
| publickey | TEXT | Nullable, ECDSA public key |
| olm_identity_key | TEXT | Nullable, OLM curve25519 key |
| createdAt | DATE | |
| updatedAt | DATE | |

#### `prekeys`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER (PK, auto) | |
| userid | INTEGER | FK to usermodels.id |
| type | STRING | `"one-time"` or `"signed"` |
| key_id | STRING | OLM key ID |
| publickey | TEXT | Public key value |
| signature | TEXT | Nullable |
| used | BOOLEAN | Default false, true after bundle fetch |

#### `messagetables`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER (PK, auto) | |
| message | TEXT | E2EE ciphertext (base64) |
| senderid | INTEGER | FK |
| receiverid | INTEGER | FK |
| time | DATE | Default NOW() |
| status | STRING | Default `"sent"` |
| senderkey | STRING | Nullable, sender's curve25519 key |
| messagetype | INTEGER | Nullable, 0=pre-key, 1=normal |
| createdAt | DATE | |
| updatedAt | DATE | |

Note: Messages with NULL `senderkey` or `messagetype` are legacy messages stored before migration `20260623000000-add-message-metadata.js`. They cannot be re-decrypted for history display.

---

## 11. IndexedDB Schema (KeyDB v4)

| Object Store | Key Pattern | Value | Purpose |
|---|---|---|---|
| `keys` | `privateKey_${userId}` | `EncryptedBlob` | ECDSA private key encrypted with password |
| `sessions` | `session_${userId}` | `StoredSession` | OLM session pickled + AES-GCM encrypted |
| `sessions` | `olm_account_${userId}` | `EncryptedBlob` | OLM account pickled + AES-GCM encrypted |
| `sent_messages` | `sent_${userId}_${receiverId}_${time}` | `{ encrypted, time, userId, receiverId }` | Sent message plaintexts (encrypted) |
| `received_messages` | `recv_${userId}_${senderId}_${time}` | `{ encrypted, time, userId, senderId }` | Received message plaintexts (encrypted) |

### EncryptedBlob Format
```typescript
interface EncryptedBlob {
  encrypted: number[];  // AES-GCM ciphertext
  iv: number[];         // 12-byte random IV
  salt: number[];       // 16-byte random salt
}
```

Keys for sent/received messages are unique per `userId + partnerId + timestamp`, preventing duplicates and enabling efficient filtering.

---

## 12. Local Storage Encryption

### Algorithm
- **KDF**: PBKDF2 with 100,000 iterations, SHA-256
- **Cipher**: AES-GCM 256-bit
- **Key material**: User's login password (stored in `sessionStorage` as `identityKey`)
- **Per-message**: Fresh random salt (16 bytes) + IV (12 bytes) using `crypto.getRandomValues()`

### Encrypt (write)
```
encryptPlaintext(plaintext, password)
  → deriveEncryptionKey(password, salt) → AES-GCM key
  → crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext)
  → return { encrypted: Uint8Array, iv, salt }
```

### Decrypt (read)
```
decryptPlaintext(blob, password)
  → deriveEncryptionKey(password, blob.salt) → AES-GCM key
  → crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.iv }, key, blob.encrypted)
  → return plaintext string
```

### Security notes
- Same encryption scheme used for OLM account pickles, ECDSA private key, and message plaintexts
- IndexedDB is **not encrypted at rest** — this layer prevents readable exposure via DevTools or XSS
- Loss of `identityKey` (password) = permanent loss of all locally stored plaintexts
- Old IndexedDB entries stored before v4 upgrade (plaintext `text` field) are silently skipped

---

## 13. UI Structure

```
┌─────────────────────────────────────────────────────┐
│  [Avatar] Username          email        [Sign out] │
├──────────────┬──────────────────────────────────────┤
│  ◉ Connected │                                      │
│              │   [Avatar] Hello!             ← recv │
│  ┌──────────┐│                Hi there!  [blue] → sent│
│  │ Users    ││   [Avatar] How are you?      ← recv │
│  │          ││                          12:30 PM    │
│  │ [●]  alice││                                      │
│  │ [ ]  bob ││  ┌──────────────────────────────┐   │
│  │          ││  │ Type a message...        [●] │   │
│  └──────────┘│  └──────────────────────────────┘   │
│              │           [Send]                     │
└──────────────┴──────────────────────────────────────┘
```

### Components

**Top Bar**
- User avatar (blue circle, first letter of username)
- Name + email
- "Sign out" button (red text, right-aligned)

**Sidebar**
- Connection indicator (green/red dot + "Connected"/"Not connected")
- "Users" header
- User list — each item:
  - Avatar (blue circle, first letter)
  - Green dot (`bg-[#30d158]`, absolute positioned bottom-right) if user is online
  - Username + "(you)" label for self
  - Blue dot indicator for selected user

**Main Panel**
- Chat header — selected user's avatar + name
- Message area (scrollable):
  - Received messages — left-aligned, gray bubble (`bg-[#f5f5f7]`), sender avatar, timestamp below
  - Sent messages — right-aligned, blue bubble (`bg-[#0066cc]`), white text, timestamp below
  - Empty state: "No messages yet"
- Input bar:
  - Rounded pill input with placeholder "Type a message..."
  - Loading indicator (ping animation) during typing debounce
  - Character preview during typing
  - "Send" button (disabled when loading or disconnected)

### Timestamp Format
```
formatTime(dateStr):
  if today → toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  else     → toLocaleDateString([], { month: 'short', day: 'numeric' })
```
Examples: `12:30 PM` (today), `Jan 15` (older)

---

## 14. WebSocket Protocol

### Client → Server
```json
{
  "from": 1,
  "to": 2,
  "ciphertext": "base64...",
  "messageType": 0,
  "senderKey": "curve25519..."
}
```

### Server → Client (message relay)
Same format as above (echoed from sender).

### Server → Client (presence)
```json
{ "type": "online_users", "userIds": [1, 2, 3] }
{ "type": "presence", "userId": 1, "status": "online" }
{ "type": "presence", "userId": 1, "status": "offline" }
```

### Server → Client (offline delivery flush)
Same format as message relay — sent on connect. Client's existing `onmessage` handler processes them identically.

---

## 15. Security Model Summary

| Layer | Mechanism | Key |
|---|---|---|
| Transport | WebSocket (ws://) | None (no TLS in dev) |
| Authentication | JWT in httpOnly cookie | `JWT_SECRET` env var |
| E2EE | OLM (Double Ratchet + X3DH) | `curve25519` keys |
| Local storage | PBKDF2 + AES-GCM-256 | User's password |
| At-rest (server) | None (ciphertext only) | N/A — server stores encrypted messages |

### Threat model
- **Server compromise**: Attacker sees only ciphertext, cannot read messages
- **Database breach**: `messagetables.message` contains only base64 ciphertext
- **XSS attack**: Attacker gains access to IndexedDB but encrypted blobs are protected by password-derived key
- **Lost password**: All locally stored plaintexts are unrecoverable. Server ciphertext cannot be re-decrypted because OLM sessions are stored client-side.
