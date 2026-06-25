import { verifyToken } from "../../../lib/auth";
import { cookies } from "next/headers";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;
  if (!token) return Response.json({ token: null });
  try {
    verifyToken(token);
    return Response.json({ token });
  } catch {
    return Response.json({ token: null });
  }
}
