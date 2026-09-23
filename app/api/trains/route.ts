import { NextResponse } from "next/server";
import { getTrainData } from "@/lib/google-sheet";

export const revalidate = 60;

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
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300"
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