"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { generateKeyPair, encryptAndSavePrivateKey, getAndDecryptPrivateKey, getEncryptedPrivateKey } from "../../lib/crypto";
import { createAccount, generateOneTimeKeys, markKeysPublished, getIdentityKeys, freeAccount, pickleAccount } from "../../lib/olm";
import { saveOlmAccount } from "../../lib/session";

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.message);
      setLoading(false);
      return;
    }

    const userId = data.user.id;

    const existingKey = await getEncryptedPrivateKey(userId);
    if (existingKey) {
      await getAndDecryptPrivateKey(form.password, userId);
    } else {
      const { publicKey, privateKey } = await generateKeyPair();
      await encryptAndSavePrivateKey(privateKey, form.password, userId);

      await fetch("/api/publickey/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_Key: publicKey, id: userId }),
      });
    }

    const account = await createAccount();
    const oneTimeKeys = await generateOneTimeKeys(account, 50);
    markKeysPublished(account);

    const olmKeys = getIdentityKeys(account);

    await fetch("/api/keys/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oneTimeKeys, olmIdentityKey: olmKeys.curve25519 }),
    });

    const accountPickle = await pickleAccount(account, form.password);
    await saveOlmAccount(accountPickle, userId);
    sessionStorage.setItem("identityKey", form.password);
    sessionStorage.setItem("userId", userId.toString());
    freeAccount(account);
    router.push("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f5f7] px-4">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-5 rounded-[18px] bg-white p-8"
      >
        <h1 className="text-[28px] font-semibold leading-[1.14] tracking-[-0.374px] text-[#1d1d1f]">Sign in</h1>

        {error && (
          <p className="rounded-[8px] bg-red-50 px-3 py-2 text-[14px] tracking-[-0.224px] text-red-600">
            {error}
          </p>
        )}

        <input
          className="h-11 rounded-full border border-[#e0e0e0] bg-white px-5 text-[17px] tracking-[-0.374px] text-[#1d1d1f] outline-none transition-colors placeholder:text-[#7a7a7a] focus:border-[#0066cc]"
          type="email"
          placeholder="Email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
        />
        <input
          className="h-11 rounded-full border border-[#e0e0e0] bg-white px-5 text-[17px] tracking-[-0.374px] text-[#1d1d1f] outline-none transition-colors placeholder:text-[#7a7a7a] focus:border-[#0066cc]"
          type="password"
          placeholder="Password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
        />

        <button
          type="submit"
          disabled={loading}
          className="rounded-full bg-[#0066cc] px-[22px] py-[11px] text-[17px] tracking-[-0.374px] text-white transition-transform active:scale-95 disabled:opacity-50"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>

        <p className="text-center text-[14px] tracking-[-0.224px] text-[#7a7a7a]">
          Don&apos;t have an account?{" "}
          <a href="/register" className="text-[#0066cc] no-underline">
            Register
          </a>
        </p>
      </form>
    </div>
  );
}
