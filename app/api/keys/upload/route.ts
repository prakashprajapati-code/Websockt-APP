import { getUserFromToken } from "../../../../lib/auth"
import { PreKey, User } from "../../../../lib/models";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const payload = await getUserFromToken();
    if (!payload) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    const { oneTimeKeys, olmIdentityKey } = await req.json();

    if (olmIdentityKey) {
      await User.update({ olm_identity_key:olmIdentityKey }, { where: { id: payload.id } });
    }

    if (!oneTimeKeys || !Array.isArray(oneTimeKeys)) {
      return NextResponse.json(
        { success: false, message: "oneTimeKeys array is required" },
        { status: 400 },
      );
    }

    const entries = oneTimeKeys.map((key: { keyId: string; publicKey: string }) => ({
      userid: payload.id,
      type: "one-time" as const,
      key_id: key.keyId,
      publickey: key.publicKey,
      signature: null,
    }));

    await PreKey.destroy({ where: { userid: payload.id, type: "one-time", used: false } });

    await PreKey.bulkCreate(entries);

    return NextResponse.json({ success: true, uploaded: entries.length });
  } catch {
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
