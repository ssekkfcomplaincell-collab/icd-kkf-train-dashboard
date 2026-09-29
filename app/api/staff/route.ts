import { NextResponse } from "next/server";
import { getTrainStaff } from "@/lib/staff-sheet";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const trainNo = (url.searchParams.get("train") || "").trim();
    const departureDate = (url.searchParams.get("depDate") || "").trim();

    if (!trainNo || !departureDate) {
      return NextResponse.json({ ok: false, error: "train and depDate are required" }, { status: 400 });
    }

    const staff = await getTrainStaff(trainNo, departureDate);
    return NextResponse.json({ ok: true, staff }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to load staff data" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
