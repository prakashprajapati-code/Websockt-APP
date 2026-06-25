import { PreKey, User } from "@/lib/models";
import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const { userId } = await params;
    const id = parseInt(userId, 10);
    if (isNaN(id)) {
      return NextResponse.json(
        { success: false, message: "Invalid user ID" },
        { status: 400 },
      );
    }

    const user = await User.findByPk(id, {
      attributes: ["id", "olm_identity_key"],
    });
    if (!user || !user.olm_identity_key) {
      return NextResponse.json(
        {
          success: false,
          message: "User not found or has no OLM identity key",
        },
        { status: 404 },
      );
    }

    const oneTimePreKey = await PreKey.findOne({
      where: { userid: id, type: "one-time", used: false },
      order: [["createdAt", "ASC"]],
    });

    if (oneTimePreKey) {
      await oneTimePreKey.update({ used: true });
    }

    return NextResponse.json({
      success: true,
      identityKey: user.olm_identity_key,
      oneTimeKey: oneTimePreKey
        ? { keyId: oneTimePreKey.key_id, publicKey: oneTimePreKey.publickey }
        : null,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
