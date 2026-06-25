import { getUserFromToken } from "@/lib/auth";
import { User } from "@/lib/models";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const payload = await getUserFromToken();
    if (!payload) {
      return NextResponse.json({ authenticated: false });
    }

    const user = await User.findByPk(payload.id);

    if (!user) {
      return NextResponse.json({ authenticated: false });
    }

    return NextResponse.json({
      authenticated: true,
      user: { id: user.id, email: user.email, username: user.username },
    });
  } catch {
    return NextResponse.json({ authenticated: false });
  }
}
