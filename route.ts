import { NextResponse } from "next/server";
import { getTrainData } from "@/lib/google-sheet";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const trains = await getTrainData();

    return NextResponse.json(
      {
        ok: true,
        updatedAt: new Date().toISOString(),
        trains
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0"
        }
      }
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}