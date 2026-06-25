import { signToken } from "@/lib/auth";
import { generateKeyPair } from "@/lib/crypto";
import { User } from "@/lib/models";
import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { email, password, username ,publicKey} = await req.json();

    if (!email || !password || !username) {
      return NextResponse.json(
        { success: false, message: "All fields are required" },
        { status: 400 }
      );
    }

    const existing = await User.findOne({ where: { email } });

    if (existing) {
      return NextResponse.json(
        { success: false, message: "Email already registered" },
        { status: 409 }
      );
    }

    const hashed = await bcrypt.hash(password, 12);

    const user = await User.create({ email, password: hashed, username, publickey: publicKey });

    const token = signToken({ id: user.id, email: user.email });

    const res = NextResponse.json(
      {
        success: true,
        user: { id: user.id, email: user.email, username: user.username, publickey: publicKey },
      },
      { status: 201 }
    );

    res.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });

    return res;
  } catch(e) {
    console.log(e)
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}
