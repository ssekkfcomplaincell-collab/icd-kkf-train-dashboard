import { NextResponse } from "next/server";
import { getTrainData } from "@/lib/google-sheet";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 30;

// Keep the route dynamic; Google Sheets is fetched at request time, never during build.


export async function GET(request: Request) {
  try {
    // Refresh requests are intentionally soft: the server cache is reused
    // within its TTL so repeated clicks do not download the same sheet again.
    // A cold server or expired cache performs the full sheet fetch.
    const trains = await getTrainData({ force: false });

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