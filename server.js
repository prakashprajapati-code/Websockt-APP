import { createServer } from "http";
import { parse } from "url";
import { readFileSync } from "fs";
import next from "next";
import { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import pg from "pg";

// Inline .env loader (works on all Node versions, safe in production without .env file)
try {
  const text = readFileSync(".env", "utf-8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
} catch { }

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3001", 10);
const SECRET = process.env.JWT_SECRET || "dev-secret";

const app = next({ dev });
const handle = app.getRequestHandler();

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
});

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  const clients = new Map();
  const pendingMessages = new Map();

  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws, req) => {

    ws.isAlive = true;

    ws.on("pong", () => {
      ws.isAlive = true;
    });
    const cookieHeader = req.headers.cookie;
    const cookies = Object.fromEntries(
      cookieHeader?.split(";").map((c) => c.trim().split("=")) || [],
    );
    const token = cookies.token;

    let userId;
    try {
      const decoded = jwt.verify(token, SECRET);
      userId = decoded.id;
    } catch {
      ws.close(4001, "Unauthorized");
      return;
    }

    console.log(`User ${userId} connected`);
    const oldSocket = clients.get(userId);

    if (oldSocket) {
      oldSocket.close(4000, "New session");
    }

    clients.set(userId, ws);

    // Send online user list to the newly connected client
    ws.send(
      JSON.stringify({
        type: "online_users",
        userIds: Array.from(clients.keys()),
      }),
    );

    // Broadcast presence to all other clients
    try {
      for (const [id, client] of clients) {
        if (id !== userId && client.readyState === 1) {
          client.send(
            JSON.stringify({ type: "presence", userId, status: "online" }),
          );
        }
      }
    } catch (err) {
      console.error("presence broadcast error:", err);
    }

    // Flush any pending offline messages (in-memory queue)
    const pending = pendingMessages.get(userId) || [];
    pendingMessages.delete(userId);
    for (const msg of pending) {
      ws.send(JSON.stringify(msg));
      // Notify original sender that their message was delivered
      const senderWs = clients.get(msg.from);
      if (senderWs && senderWs.readyState === 1) {
        senderWs.send(
          JSON.stringify({
            type: "delivery_ack",
            localId: msg.localId,
            messageId: msg.messageId,
            status: "delivered",
          }),
        );
      }
    }

    // DB fallback: deliver any messages still marked 'sent' (covers restarts)
    (async () => {
      try {
        const result = await pool.query(
          `SELECT id, senderid AS from, receiverid AS to, message AS ciphertext, senderkey, messagetype FROM messagetables WHERE receiverid = $1 AND status = 'sent' ORDER BY id ASC`,
          [userId],
        );
        for (const row of result.rows) {
          ws.send(JSON.stringify(row));
          await pool.query(
            `UPDATE messagetables SET status = 'delivered' WHERE id = $1`,
            [row.id],
          );
          // Notify original sender
          const senderWs = clients.get(row.from);
          if (senderWs && senderWs.readyState === 1) {
            senderWs.send(
              JSON.stringify({
                type: "delivery_ack",
                messageId: row.id,
                status: "delivered",
              }),
            );
          }
        }
      } catch (err) {
        console.error("DB fallback delivery error:", err);
      }
    })();

    ws.on("message", async (event) => {
      let parsed;
      try {
        parsed = JSON.parse(event.toString());
      } catch {
        return;
      }

      // ✅ Add this block
      if (parsed.type === "pong") {
        ws.isAlive = true;
        return;
      }

      const { from, to, ciphertext, messageType, senderKey, localId } = parsed;

      if (!from || !to || !ciphertext) return;
      if (from !== userId) return;

      let insertResult;
      try {
        insertResult = await pool.query(
          `INSERT INTO messagetables (message, senderid, receiverid, "time","createdAt", status,"updatedAt", senderkey, messagetype) VALUES ($1, $2, $3, NOW(),NOW(), $4,NOW(), $5, $6) RETURNING id`,
          [ciphertext, from, to, "sent", senderKey || null, messageType ?? null],
        );
      } catch (err) {
        console.error("DB insert error:", err);
        return;
      }

      const messageId = insertResult.rows[0].id;

      // Send immediate acknowledgment to sender
      ws.send(
        JSON.stringify({ type: "delivery_ack", localId, messageId, status: "sent" }),
      );

      const recipientWs = clients.get(to);
      if (recipientWs && recipientWs.readyState === 1) {
        // Recipient online — relay and mark delivered
        recipientWs.send(event.toString());
        try {
          await pool.query(
            `UPDATE messagetables SET status = 'delivered' WHERE id = $1`,
            [messageId],
          );
        } catch { }
        ws.send(
          JSON.stringify({
            type: "delivery_ack",
            localId,
            messageId,
            status: "delivered",
          }),
        );
      } else {
        // Queue for offline delivery (status stays 'sent')
        if (!pendingMessages.has(to)) pendingMessages.set(to, []);
        pendingMessages
          .get(to)
          .push({ from, to, ciphertext, messageType, senderKey, messageId, localId });
      }
    });



    ws.on("close", (code, reason) => {
      console.log(`User ${userId} disconnected (code: ${code}, reason: ${reason || "none"})`);

      if (clients.get(userId) === ws) {
        clients.delete(userId);
      }

      try {
        for (const [id, client] of clients) {
          if (client.readyState === 1) {
            client.send(
              JSON.stringify({ type: "presence", userId, status: "offline" }),
            );
          }
        }
      } catch (err) {
        console.error("Broadcast offline error:", err);
      }
    });

    ws.on("error", (err) => {
      console.error(`WebSocket error for user ${userId}:`, err.message);
    });
  });

  // Ping every 30 seconds — detects killed tab, network drop, laptop sleep
  // Replace the ping interval with this
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      // Send app-level ping instead of protocol-level ws.ping()
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    });
  }, 30000);

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });

  process.on("SIGTERM", () => {
    clearInterval(interval);
    server.close();
  });

  process.on("SIGINT", () => {
    clearInterval(interval);
    server.close();
  });
});
