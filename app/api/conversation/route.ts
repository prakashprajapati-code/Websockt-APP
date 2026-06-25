import { getUserFromToken } from "../../../lib/auth";
import { Message } from "../../../lib/models/Message";
import { NextRequest, NextResponse } from "next/server";
import { Op } from "sequelize";

export async function GET(req: NextRequest) {
  try {
    const payload = await getUserFromToken();
    if (!payload) {
      return NextResponse.json({ authenticated: false });
    }

    const { searchParams } = new URL(req.url);
    const withUserId = searchParams.get("with");
    if (!withUserId) {
      return NextResponse.json({ success: false, message: "Missing 'with' query param" });
    }

    const partnerId = parseInt(withUserId, 10);

    const messages = await Message.findAll({
      where: {
        [Op.or]: [
          { senderid: payload.id, receiverid: partnerId },
          { senderid: partnerId, receiverid: payload.id },
        ],
      },
      order: [["id", "ASC"]],
    });

    return NextResponse.json({ success: true, data: messages });
  } catch (e) {
    console.log(e);
    return NextResponse.json({ success: false, message: "Internal server error", e });
  }
}
