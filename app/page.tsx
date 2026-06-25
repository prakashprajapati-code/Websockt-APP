"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  unpickleAccount,
  createOutboundSession,
  createInboundSessionFromPreKey,
  decryptMessage,
  freeAccount,
  getIdentityKeys,
} from "../lib/olm";
import {
  loadStoredSession,
  storeSession,
  sessionExists,
  getOlmAccount,
  olmAccountExists,
  storeSentPlaintext,
  getSentPlaintexts,
  storeReceivedPlaintext,
  getReceivedPlaintexts,
} from "../lib/session";
import { CacheStorage } from "../utils/cachesStore";

type AuthUser = { id: number; email: string; username: string } | null;
const inetrvalt = 2000;

export default function Home() {
  const router = useRouter();
  const [authUser, setAuthUser] = useState<AuthUser>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const olmAccountRef = useRef<any>(null);
  const sessionsRef = useRef<Map<number, any>>(new Map());

  useEffect(() => {
    const identityKey = sessionStorage.getItem("identityKey");
    const userIdStr = sessionStorage.getItem("userId");
    if (!identityKey || !userIdStr) {
      router.push("/login");
      return;
    }
    const userId = Number(userIdStr);

    (async () => {
      const exists = await olmAccountExists(userId);
      if (exists) {
        const blob = await getOlmAccount(userId);
        if (blob) {
          const acc = await unpickleAccount(blob, identityKey);
          olmAccountRef.current = acc;
          return;
        }
      }
      router.push("/login");
    })();

    return () => {
      if (olmAccountRef.current) {
        freeAccount(olmAccountRef.current);
        olmAccountRef.current = null;
      }
      sessionsRef.current.forEach((s) => s.free());
      sessionsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.authenticated) setAuthUser(data.user);
      })
      .finally(() => setAuthLoading(false));
  }, []);

  const authUserRef = useRef(authUser);
  useEffect(() => {
    authUserRef.current = authUser;
  }, [authUser]);

  const [isactive, setIsactive] = useState(false);
  const [message, setMessage] = useState("");

  const [userlist, setuserList] = useState([]);

  const [loading, setloading] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const timeid = useRef<NodeJS.Timeout | null>(null);

  const [openchat, setOpenchat] = useState<number | null>(null);
  const openchatRef = useRef(openchat);
  useEffect(() => {
    openchatRef.current = openchat;
  }, [openchat]);

  const [receivermessagesarr, setReciverMessageArray] = useState<
    { message: string; senderId: number; receiverId: number; time: string }[]
  >([]);
  const [sendmessageerarr, setSendMessageArr] = useState<
    {
      message: string;
      senderId: number;
      receiverId: number;
      time: string;
      localId: string;
      status: string;
    }[]
  >([]);

  const [onlineUsers, setOnlineUsers] = useState<Set<number>>(new Set());
  const [unreadCounts, setUnreadCounts] = useState<Map<number, number>>(
    new Map(),
  );

  const connection = useCallback(async () => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

    try {
      const socket = new WebSocket(`${protocol}//${window.location.host}`);

      if (socket) {
        socketRef.current = socket;
        socket.onopen = () => {
          setIsactive(true);
               socket.send(JSON.stringify({ type: "pong" }));
        };

        socket.onmessage = async (event) => {
          const text = await event.data;
          let parsed: any;
          try {
            parsed = JSON.parse(text);
          } catch {
            return;
          }

          // ✅ Add this block
          if (parsed.type === "ping") {
            socket.send(JSON.stringify({ type: "pong" }));
            return;
          }

          if (parsed.type === "online_users") {
            setOnlineUsers(new Set(parsed.userIds));
            return;
          }
          if (parsed.type === "presence") {
            setOnlineUsers((prev) => {
              const next = new Set(prev);
              parsed.status === "online"
                ? next.add(parsed.userId)
                : next.delete(parsed.userId);
              return next;
            });
            return;
          }
          if (parsed.type === "delivery_ack") {
            setSendMessageArr((prev) =>
              prev.map((msg) =>
                msg.localId === parsed.localId
                  ? { ...msg, status: parsed.status }
                  : msg,
              ),
            );
            return;
          }

          if (
            parsed.ciphertext &&
            parsed.from &&
            parsed.from !== authUserRef.current?.id
          ) {
            const { from, ciphertext, messageType, senderKey } = parsed;

            if (messageType === 0 && senderKey) {
              const acc = olmAccountRef.current;
              if (!acc) return;
              const session = await createInboundSessionFromPreKey(
                acc,
                senderKey,
                ciphertext,
              );
              sessionsRef.current.set(from, session);
              await storeSession(
                from,
                session,
                sessionStorage.getItem("identityKey")!,
              );
              const plaintext = decryptMessage(
                session,
                messageType,
                ciphertext,
              );
              const now = new Date().toISOString();
              storeReceivedPlaintext(
                authUserRef.current!.id,
                from,
                plaintext,
                now,
                sessionStorage.getItem("identityKey")!,
              );
              setReciverMessageArray((prev) => [
                ...prev,
                {
                  message: plaintext,
                  senderId: from,
                  receiverId: authUserRef.current!.id,
                  time: now,
                },
              ]);
              if (openchatRef.current !== from) {
                setUnreadCounts((prev) =>
                  new Map(prev).set(from, (prev.get(from) || 0) + 1),
                );
              }
            } else if (messageType === 1) {
              const session = sessionsRef.current.get(from);
              if (session) {
                const plaintext = decryptMessage(
                  session,
                  messageType,
                  ciphertext,
                );
                const now = new Date().toISOString();
                storeReceivedPlaintext(
                  authUserRef.current!.id,
                  from,
                  plaintext,
                  now,
                  sessionStorage.getItem("identityKey")!,
                );
                await storeSession(
                  from,
                  session,
                  sessionStorage.getItem("identityKey")!,
                );
                setReciverMessageArray((prev) => [
                  ...prev,
                  {
                    message: plaintext,
                    senderId: from,
                    receiverId: authUserRef.current!.id,
                    time: now,
                  },
                ]);
                if (openchatRef.current !== from) {
                  setUnreadCounts((prev) =>
                    new Map(prev).set(from, (prev.get(from) || 0) + 1),
                  );
                }
              }
            }
          } else {
            setReciverMessageArray((prev) => [...prev, text]);
          }
        };

        socket.onclose = () => {
          setIsactive(false);
          socketRef.current = null;
          setTimeout(() => {
            connection(); // ⚠️ flat 3s retry, no limit
          }, 3000);
        };

        socket.onerror = (event) => console.log(event);
      }
    } catch (e) {
      console.log(e);
    }
  }, []);

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  const userall = async () => {
    let res = await fetch("/api/alluser");
    let data = await res.json();
    if (data.success == true) setuserList(data.data);
  };

  useEffect(() => {
    if (authUser) {
      connection();
      userall();
    }

    return () => {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [authUser]);

  useEffect(() => {
    if (!openchat || !olmAccountRef.current) return;
    if (sessionsRef.current.has(openchat)) return;

    const identityKey = sessionStorage.getItem("identityKey")!;
    (async () => {
      const exists = await sessionExists(openchat);
      if (exists) {
        const session = await loadStoredSession(openchat, identityKey);
        if (session) sessionsRef.current.set(openchat, session);
      }
    })();
  }, [openchat]);

  useEffect(() => {
    if (!openchat || !authUser) return;

    setReciverMessageArray([]);
    setSendMessageArr([]);
    setUnreadCounts((prev) => {
      const next = new Map(prev);
      next.delete(openchat);
      return next;
    });

    const identityKey = sessionStorage.getItem("identityKey")!;

    (async () => {
      if (!sessionsRef.current.has(openchat)) {
        const exists = await sessionExists(openchat);
        if (exists) {
          const session = await loadStoredSession(openchat, identityKey);
          if (session) sessionsRef.current.set(openchat, session);
        }
      }

      const data = await CacheStorage({ userid: openchat });

      const received: {
        message: string;
        senderId: number;
        receiverId: number;
        time: string;
      }[] = [];
      const sent: {
        message: string;
        senderId: number;
        receiverId: number;
        time: string;
        localId: string;
        status: string;
      }[] = [];

      const localSent = await getSentPlaintexts(
        authUser.id,
        openchat,
        identityKey,
      );
      for (const s of localSent) {
        sent.push({
          message: s.text,
          senderId: authUser.id,
          receiverId: openchat,
          time: s.time,
          localId: "",
          status: "delivered",
        });
      }

      const localReceived = await getReceivedPlaintexts(
        authUser.id,
        openchat,
        identityKey,
      );
      const localReceivedSet = new Set(localReceived.map((r) => r.text));
      for (const r of localReceived) {
        received.push({
          message: r.text,
          senderId: r.senderId,
          receiverId: authUser.id,
          time: r.time,
        });
      }

      let historySession: any = null;

      for (const msg of (data || []) as any[]) {
        if (msg.senderid === authUser.id) continue;

        if (!historySession) {
          let key = msg.senderkey;
          if (!key && msg.messagetype === 0) {
            try {
              const bundleRes = await fetch(`/api/keys/bundle/${openchat}`);
              if (bundleRes.ok) {
                const bundle = await bundleRes.json();
                key = bundle.identityKey;
              }
            } catch {}
          }
          if (key) {
            const acc = olmAccountRef.current;
            if (acc) {
              try {
                historySession = await createInboundSessionFromPreKey(
                  acc,
                  key,
                  msg.message,
                );
              } catch (e) {
                console.log("history session create failed for msg", msg.id, e);
              }
            }
          }
        }

        if (!historySession) continue;

        let plaintext: string | null = null;
        try {
          plaintext = decryptMessage(
            historySession,
            msg.messagetype ?? 1,
            msg.message,
          );
        } catch {
          if (msg.messagetype == null) {
            try {
              plaintext = decryptMessage(historySession, 0, msg.message);
            } catch {}
          }
        }

        if (plaintext && !localReceivedSet.has(plaintext)) {
          received.push({
            message: plaintext,
            senderId: msg.senderid,
            receiverId: msg.receiverid,
            time: msg.time,
          });
        }
      }

      if (historySession) {
        sessionsRef.current.set(openchat, historySession);
        await storeSession(openchat, historySession, identityKey);
      } else {
        const loaded = sessionsRef.current.get(openchat);
        if (loaded) {
          for (const msg of (data || []) as any[]) {
            if (msg.senderid === authUser.id) continue;
            try {
              const pt = decryptMessage(
                loaded,
                msg.messagetype ?? 1,
                msg.message,
              );
              if (pt && !localReceivedSet.has(pt)) {
                received.push({
                  message: pt,
                  senderId: msg.senderid,
                  receiverId: msg.receiverid,
                  time: msg.time,
                });
              }
            } catch {}
          }
        }
      }

      setReciverMessageArray(received);
      setSendMessageArr(sent);
    })();
  }, [openchat, authUser]);

  const handletype = (e: any) => {
    setloading(true);
    const text: string = e.target.value;

    if (timeid.current) {
      clearInterval(timeid.current);
    }

    timeid.current = setTimeout(() => {
      setMessage(text);
      setloading(false);
    }, inetrvalt);
  };

  const sendMessage = async (id: number) => {
    if (!socketRef.current || socketRef.current?.readyState === 0 || !authUser)
      return;
    const text = inputRef.current?.value?.trim() || message;
    if (!text) return;

    let session = sessionsRef.current.get(id);
    if (!session) {
      const bundleRes = await fetch(`/api/keys/bundle/${id}`);
      if (!bundleRes.ok) return;
      const bundle = await bundleRes.json();
      if (!bundle.oneTimeKey || !bundle.identityKey) return;
      session = await createOutboundSession(
        olmAccountRef.current,
        bundle.identityKey,
        bundle.oneTimeKey.publicKey,
      );
      sessionsRef.current.set(id, session);
      await storeSession(id, session, sessionStorage.getItem("identityKey")!);
    }

    const { type, body } = session.encrypt(text);
    await storeSession(id, session, sessionStorage.getItem("identityKey")!);
    const senderKey = getIdentityKeys(olmAccountRef.current).curve25519;
    const localId = crypto.randomUUID();
    const payload = JSON.stringify({
      from: authUser.id,
      to: id,
      ciphertext: body,
      messageType: type,
      senderKey,
      localId,
    });
    socketRef.current?.send(payload);
    const now = new Date().toISOString();
    setSendMessageArr((prev) => [
      ...prev,
      {
        message: text,
        senderId: authUser.id,
        receiverId: id,
        time: now,
        localId,
        status: "sending",
      },
    ]);
    storeSentPlaintext(
      authUser.id,
      id,
      text,
      now,
      sessionStorage.getItem("identityKey")!,
    );
    if (inputRef.current) inputRef.current.value = "";
    setMessage("");
  };

  return (
    <div className="mx-auto max-w-5xl bg-[#f5f5f7] px-4 py-6">
      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-slide { animation: fadeSlideUp 0.4s ease-out; }
      `}</style>

      <div className="animate-fade-slide mb-6 rounded-[18px] border border-[#e0e0e0] bg-white p-6">
        {authLoading ? (
          <div className="flex items-center gap-3 text-[17px] tracking-[-0.374px] text-[#7a7a7a]">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[#0066cc] border-t-transparent" />
            Checking auth...
          </div>
        ) : authUser ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0066cc] text-[17px] font-semibold text-white">
                {authUser.username.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <p className="text-[17px] font-semibold tracking-[-0.374px] text-[#1d1d1f]">
                  {authUser.username}
                </p>
                <p className="text-[14px] tracking-[-0.224px] text-[#7a7a7a]">
                  {authUser.email}
                </p>
              </div>
            </div>
            <button
              onClick={async () => {
                if (socketRef.current) {
                  socketRef.current.close();
                  socketRef.current = null;
                }
                await fetch("/api/logout", { method: "POST" });
                sessionStorage.clear();
                router.push("/login");
              }}
              className="rounded-[11px] border border-[#f0f0f0] bg-[#fafafc] px-[14px] py-[8px] text-[14px] font-semibold tracking-[-0.224px] text-[#ff453a] transition-colors hover:bg-red-50"
            >
              Sign out
            </button>
          </div>
        ) : (
          <p className="text-[17px] tracking-[-0.374px] text-[#7a7a7a]">
            <a
              href="/login"
              className="font-semibold text-[#0066cc] no-underline"
            >
              Sign in
            </a>{" "}
            or{" "}
            <a
              href="/register"
              className="font-semibold text-[#0066cc] no-underline"
            >
              register
            </a>
          </p>
        )}
      </div>

      {authUser && (
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="w-full shrink-0 lg:w-80">
            <div className="animate-fade-slide rounded-[18px] border border-[#e0e0e0] bg-white">
              <div className="flex items-center justify-between border-b border-[#e0e0e0] px-6 py-3">
                <h2 className="text-[14px] font-semibold tracking-[-0.224px] text-[#1d1d1f]">
                  Users
                </h2>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${isactive ? "bg-[#30d158]" : "bg-[#ff453a]"}`}
                  />
                  <span
                    className={`text-[12px] tracking-[-0.12px] ${isactive ? "text-[#30d158]" : "text-[#ff453a]"}`}
                  >
                    {isactive ? "Connected" : "Not connected"}
                  </span>
                </div>
              </div>
              <div>
                {Array.isArray(userlist) && userlist.length > 0 ? (
                  userlist.map((val: any, idx: number) => (
                    <div
                      key={val?.id}
                      style={{ animationDelay: `${idx * 60}ms` }}
                      className="animate-fade-slide"
                    >
                      <button
                        onClick={() => setOpenchat(val?.id)}
                        className={`flex w-full items-center gap-3 px-6 py-3 text-left transition-colors active:scale-[0.98] ${
                          openchat === val.id
                            ? "bg-[#f5f5f7]"
                            : "hover:bg-[#f5f5f7]"
                        }`}
                      >
                        <div className="relative shrink-0">
                          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0066cc] text-[17px] font-semibold text-white">
                            {val?.username.slice(0, 1).toUpperCase()}
                          </span>
                          {onlineUsers.has(val.id) && (
                            <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-[#30d158]" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-[17px] font-semibold tracking-[-0.374px] text-[#1d1d1f]">
                              {val?.username}
                            </p>
                            {(unreadCounts.get(val.id) || 0) > 0 && (
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#ff453a] text-[11px] font-bold text-white">
                                {unreadCounts.get(val.id)}
                              </span>
                            )}
                          </div>
                          {authUser.id == val.id && (
                            <p className="text-[14px] text-[#7a7a7a]">(you)</p>
                          )}
                        </div>
                        {openchat === val.id && (
                          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#0066cc]" />
                        )}
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                    <p className="text-[17px] text-[#7a7a7a]">No users found</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-1 flex-col">
            {openchat ? (
              Array.isArray(userlist) &&
              userlist.length > 0 &&
              userlist.map(
                (val: any) =>
                  val.id == openchat && (
                    <div
                      key={val.id}
                      className="animate-fade-slide flex flex-1 flex-col rounded-[18px] border border-[#e0e0e0] bg-white"
                    >
                      <div className="flex items-center gap-3 border-b border-[#e0e0e0] px-6 py-3">
                        <div className="relative shrink-0">
                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0066cc] text-[15px] font-semibold text-white">
                            {val?.username.slice(0, 1).toUpperCase()}
                          </span>
                          {onlineUsers.has(val.id) && (
                            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#30d158]" />
                          )}
                        </div>
                        <p className="text-[17px] font-semibold tracking-[-0.374px] text-[#1d1d1f]">
                          {val?.username}
                        </p>
                      </div>

                      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
                        {receivermessagesarr.length > 0 ||
                        sendmessageerarr.length > 0 ? (
                          <>
                            {receivermessagesarr.map(
                              (msg: any, index: number) =>
                                val.id == msg.senderId && (
                                  <div
                                    key={`r-${index}`}
                                    style={{
                                      animationDelay: `${index * 80}ms`,
                                    }}
                                    className="animate-fade-slide flex items-start gap-3"
                                  >
                                    <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e0e0e0] text-[13px] font-semibold text-[#1d1d1f]">
                                      {val?.username.slice(0, 1).toUpperCase()}
                                    </span>
                                    <div className="max-w-[75%] rounded-[18px] rounded-tl-[4px] bg-[#f5f5f7] px-4 py-2.5">
                                      <p className="break-words text-[17px] text-[#1d1d1f]">
                                        {msg.message}
                                      </p>
                                      <p className="mt-1 text-[12px] text-[#7a7a7a]">
                                        {formatTime(msg.time)}
                                      </p>
                                    </div>
                                  </div>
                                ),
                            )}
                            {sendmessageerarr.map(
                              (msg: any, index: number) =>
                                val.id == msg.receiverId && (
                                  <div
                                    key={`s-${index}`}
                                    style={{
                                      animationDelay: `${index * 80}ms`,
                                    }}
                                    className="animate-fade-slide flex justify-end"
                                  >
                                    <div className="max-w-[75%] rounded-[18px] rounded-br-[4px] bg-[#0066cc] px-4 py-2.5">
                                      <p className="break-words text-[17px] text-white">
                                        {msg.message}
                                      </p>
                                      <div className="mt-1 flex items-center justify-end gap-1">
                                        <p className="text-[12px] text-white/60">
                                          {formatTime(msg.time)}
                                        </p>
                                        {msg.status === "sending" && (
                                          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
                                        )}
                                        {msg.status === "sent" && (
                                          <span className="text-[12px] text-white/60">
                                            ✓
                                          </span>
                                        )}
                                        {msg.status === "delivered" && (
                                          <span className="text-[12px] text-[#30d158]">
                                            ✓✓
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ),
                            )}
                          </>
                        ) : (
                          <div className="flex h-full flex-col items-center justify-center py-16 text-center">
                            <p className="text-[17px] text-[#7a7a7a]">
                              No messages yet
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="border-t border-[#e0e0e0] px-6 py-4">
                        <div className="relative">
                          <input
                            ref={inputRef}
                            onChange={handletype}
                            className="h-11 w-full rounded-full border border-[#e0e0e0] bg-[#f5f5f7] px-5 pr-12 text-[17px] text-[#1d1d1f] outline-none transition-colors placeholder:text-[#7a7a7a] focus:border-[#0066cc] focus:bg-white"
                            type="text"
                            placeholder="Type a message..."
                          />
                          {loading && (
                            <span className="absolute right-4 top-1/2 -translate-y-1/2">
                              <span className="inline-block h-3 w-3 animate-ping rounded-full bg-[#0066cc]" />
                            </span>
                          )}
                        </div>
                        {loading && message && (
                          <p className="mt-2 animate-pulse text-[14px] font-medium text-[#0066cc]">
                            {message}
                          </p>
                        )}
                        <button
                          disabled={
                            loading ||
                            Boolean(socketRef.current?.readyState !== 1)
                          }
                          onClick={() => sendMessage(val.id)}
                          className={`mt-3 w-full rounded-full px-[22px] py-[11px] text-[17px] transition-transform active:scale-95 ${
                            loading ||
                            Boolean(socketRef.current?.readyState !== 1)
                              ? "cursor-not-allowed bg-[#cccccc] text-white"
                              : "cursor-pointer bg-[#0066cc] text-white hover:opacity-90"
                          }`}
                        >
                          {loading ? "Sending..." : "Send"}
                        </button>
                      </div>
                    </div>
                  ),
              )
            ) : (
              <div className="flex flex-1 items-center justify-center rounded-[18px] border border-[#e0e0e0] bg-white">
                <p className="text-[17px] text-[#7a7a7a]">
                  Select a user to start chatting
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
