import { NextRequest, NextResponse } from "next/server";
import { User } from "@/lib/models";
import { getUserFromToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const payload = await getUserFromToken();
    if (!payload) {
      return NextResponse.json({ authenticated: false });
    }
    const { public_Key, id } = await req.json();

    if (!public_Key || !id) {
      return NextResponse.json({
        success: false,
        message: "required filed",
      });
    }

    let isexists = await User.findOne({
      where: {
        id: id,
      },
    });

    if (!isexists) {
      return NextResponse.json({
        success: false,
        message: "user is not exists",
      });
    }

    //verifykey
    isexists.publickey = public_Key;

    await isexists.save();
    return NextResponse.json({
        success:true,
        message:"SucessFully"
    })
  } catch (e) {
    console.log(e);
    return NextResponse.json({
      success: false,
      message: "server error",
      error: e,
    });
  }
}
