import { NextRequest, NextResponse } from "next/server";
import { getUserFromToken } from "../../../lib/auth";

import { User } from "../../../lib/models/User";

export async function GET(req: NextRequest) {
  try {
    const payload = await getUserFromToken();
    if (!payload) {
      return NextResponse.json({ authenticated: false, success: false });
    }

    const allUsers = await User.findAll({
      attributes: ["id", "email", "username"],
    });

    return NextResponse.json({ data: allUsers, success: true });
  } catch (err) {
    console.log(err);
  }
}
