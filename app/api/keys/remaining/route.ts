import { getUserFromToken } from "@/lib/auth";
import { PreKey } from "@/lib/models";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const payload = await getUserFromToken();
    if (!payload) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    const count = await PreKey.count({
      where: { userid: payload.id, type: "one-time", used: false },
    });

    return NextResponse.json({ success: true, count });
  } catch {
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
