# E2EE Architecture

End-to-End Encryption using X3DH key exchange + OLM Double Ratchet (`@matrix-org/olm`).

---

## Key Terminology

| Term | Definition |
|---|---|
| **Identity Key (IK)** | Long-term ECDSA P-256 key pair. Generated once on registration. Public part stored in DB (`usermodels.publickey`). Private part encrypted with user password and saved in IndexedDB. |
| **Signed Pre-Key (SPK)** | Medium-term key pair. Signed with the Identity Key. Uploaded to server on login. Rotated periodically. |
| **One-Time Pre-Key (OTPK)** | Ephemeral key pair. Created in batches (50 at a time). Each OTPK can be used only once for a session. Server deletes it after use. |
| **OLM Session** | Established between two users using X3DH. Implements Double Ratchet for forward secrecy. Stored encrypted in IndexedDB. |

---

## File Map

### `/lib/` — Server & Shared Utilities

| File | Purpose | Side |
|---|---|---|
| `lib/db.ts` | Singleton Sequelize connection (Postgres) | Server |
| `lib/auth.ts` | JWT sign/verify, `getUserFromToken()` | Server |
| `lib/crypto.ts` | Browser-side ECDSA key generation, AES-GCM encrypt/decrypt for IndexedDB storage | Client |
| `lib/olm.ts` | OLM session creation, X3DH, encrypt/decrypt wrappers | Client |

### `/lib/models/` — Sequelize TypeScript Models

| File | Table | Columns |
|---|---|---|
| `lib/models/User.ts` | `usermodels` | `id`, `email`, `password`, `username`, `publickey` |
| `lib/models/Message.ts` | `messagetables` | `id`, `message` (ciphertext), `senderid`, `receiverid`, `time`, `status` |

### `/app/api/` — Next.js API Routes

| Route | Method | Purpose |
|---|---|---|
| `api/register` | POST | Register user. Generates identity key (server-side via Node crypto), stores public key in DB |
| `api/login` | POST | Authenticate, return user + JWT cookie |
| `api/me` | GET | Return authenticated user from JWT cookie |
| `api/publickey/check` | POST | Upload client-generated public key (for users who registered before this feature) |
| `api/keys/upload` | POST | Upload signed pre-key + one-time pre-keys |
| `api/keys/bundle/[userId]` | GET | Fetch a user's pre-key bundle for X3DH session establishment |
| `api/keys/remaining` | GET | Check remaining one-time pre-key count |

### `/app/` — Frontend Pages

| Route | File | Purpose |
|---|---|---|
| `/` | `app/page.tsx` | Home — WebSocket chat, user list, message boxes |
| `/login` | `app/login/page.tsx` | Login form. On success: decrypt identity key, upload pre-keys |
| `/register` | `app/register/page.tsx` | Registration form |

### `/migrations/` — Sequelize Migrations

| File | Change |
|---|---|
| `20260618054547-create-usermodel.js` | Creates `usermodels` table |
| `20260618060000-add-publickey-to-usermodels.js` | Adds `publickey` column |
| `20260618060100-create-messagetable.js` | Creates `messagetables` table |
| `20260618...-create-prekeys.js` | Creates `prekeys` table |

---

## Database Schema

### `usermodels`

| Column | Type | Nullable | Notes |
|---|---|---|---|
| id | INTEGER (PK) | No | Auto-increment |
| email | STRING | No | Unique |
| password | STRING | No | bcrypt hash |
| username | STRING | No | |
| publickey | STRING | Yes | Base64 SPKI format (ECDSA P-256) |
| createdAt | DATE | No | |
| updatedAt | DATE | No | |

### `messagetables`

| Column | Type | Nullable | Notes |
|---|---|---|---|
| id | INTEGER (PK) | No | Auto-increment |
| message | STRING | No | **Ciphertext** (base64), never plaintext |
| senderid | INTEGER (FK → usermodels.id) | No | |
| receiverid | INTEGER (FK → usermodels.id) | No | |
| time | DATE | Yes | Default: `NOW()` |
| status | STRING | Yes | Default: `"sent"` |
| createdAt | DATE | No | |
| updatedAt | DATE | No | |

### `prekeys`

| Column | Type | Nullable | Notes |
|---|---|---|---|
| id | INTEGER (PK) | No | Auto-increment |
| userid | INTEGER (FK → usermodels.id) | No | Owner of this key |
| type | STRING | No | `"signed"` or `"one-time"` |
| key_id | STRING | No | Unique identifier for the key |
| publickey | STRING | No | Base64 public key |
| signature | STRING | Yes | Signature by identity key (only for signed pre-key) |
| used | BOOLEAN | No | Default: `false` |
| createdAt | DATE | No | |
| updatedAt | DATE | No | |

---

## IndexedDB Schema (Browser)

Database name: `KeyDB`

### `keys` Object Store

| Key | Value |
|---|---|
| `"privateKey"` | `{ encrypted: number[], iv: number[], salt: number[] }` — AES-GCM encrypted identity private key |
| `"session:${userId}:outbound"` | Serialized OLM session for sending to user |
| `"session:${userId}:inbound"` | Serialized OLM session for receiving from user |

---

## Data Flows

### Registration Flow

```
User submits form (email, password, username)
  |
  v
POST /api/register (server-side)
  ├── Hash password (bcrypt, 12 rounds)
  ├── Generate ECDSA P-256 key pair (Node crypto.generateKeyPairSync)
  ├── Store user in DB: { publickey: publicKeyPEM }
  ├── Return: { user, privateKey (PEM), JWT cookie }
  |
  v
Register page receives response
  ├── Encrypt privateKey with password (PBKDF2 → AES-GCM)
  ├── Save encrypted to IndexedDB
  └── Redirect to /login
```

### Login Flow (Identity Key + Pre-Key Upload)

```
User submits form (email, password)
  |
  v
POST /api/login
  ├── Verify bcrypt hash
  ├── Return: { user: { id, email, username, publickey } }
  └── Set JWT cookie
  |
  v
Login page handles response
  ├── If user.publickey == null:
  │     ├── Generate identity key (client-side Web Crypto)
  │     ├── Upload to POST /api/publickey/check
  │     └── Encrypt + save private key to IndexedDB
  |
  ├── Else (identity key exists):
  │     └── Decrypt identity key from IndexedDB using form.password
  |
  ├── Generate Signed Pre-Key + 50 One-Time Pre-Keys via OLM
  ├── Upload to POST /api/keys/upload
  └── Redirect to /
```

### Session Establishment (X3DH)

```
Alice clicks Bob in user list
  |
  v
GET /api/keys/bundle/{bobId}
  └── Returns: { identityKey, signedPreKey, signature, oneTimePreKey }
  |
  v
Alice's browser (OLM):
  1. Load own identity private key from IndexedDB
  2. Verify Bob's signed pre-key signature using Bob's identity key
  3. Run X3DH with:
     - Alice's identity key (private)
     - Bob's identity key (public)
     - Bob's signed pre-key (public)
     - Bob's one-time pre-key (public)
  4. Create OLM session from shared secret
  5. Save session to IndexedDB ("session:{bobId}:outbound")
  |
  v
Alice sends first message:
  1. session.encrypt(plaintext) → ciphertext + ephemeral keys
  2. WebSocket: { to: bobId, ciphertext, ephemeral }
  3. POST /api/messages: { receiverId: bobId, message: ciphertext }
```

### Message Reception

```
Bob's WebSocket receives: { from: aliceId, ciphertext, ephemeral }
  |
  v
Bob's browser:
  1. Check IndexedDB for "session:{aliceId}:inbound"
  2. If no session exists:
     ├── Load own identity key (private) + Alice's identity key (public)
     ├── Run X3DH with the ephemeral keys from the message
     ├── Create OLM session
     └── Save to IndexedDB ("session:{aliceId}:inbound")
  3. session.decrypt(ciphertext) → plaintext
  4. Display in UI
  |
  v
Double Ratchet rotates keys — next message uses new keys
```

### Subsequent Messages (Fast Path)

```
Alice types "hello"
  |
  v
Load "session:{bobId}:outbound" from IndexedDB
  |
  v
session.encrypt("hello")
  ├── Ratchet step (new keys derived)
  ├── Returns: { ciphertext: "...", ephemeral: { ... } }
  └── Ciphertext depends on ratchet state, not static keys
  |
  v
WebSocket → Bob
Bob decrypts with his side of the session
```

---

## Phase Implementation Plan

### Phase 1 — Pre-Key Infrastructure (Current)
- [x] `lib/olm.ts` — OLM wrappers (key gen, session, encrypt/decrypt)
- [x] Migration: `prekeys` table
- [x] `app/api/keys/upload/route.ts`
- [x] `app/api/keys/bundle/[userId]/route.ts`
- [x] `app/api/keys/remaining/route.ts`
- [x] Update `app/login/page.tsx` — upload pre-keys on login

### Phase 2 — Session Management
- [ ] `lib/session.ts` — session CRUD against IndexedDB
- [ ] Update `app/page.tsx` — create session when opening a chat

### Phase 3 — Encrypted Messaging
- [ ] Update `app/page.tsx` — `sendMessage()` encrypts via OLM
- [ ] Update `app/page.tsx` — `onmessage` decrypts via OLM
- [ ] `app/api/messages/route.ts` — store/retrieve encrypted messages

### Phase 4 — Persistent Session Store
- [ ] Extend `lib/crypto.ts` — generic IndexedDB helpers for sessions

### Phase 5 — One-Time Key Rotation
- [ ] Auto-top-up one-time pre-keys when pool runs low
