/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextResponse } from 'next/server';
import { list } from '@vercel/blob';

export async function GET() {
  try {
    const { blobs } = await list({ prefix: 'deals.json' });
    if (blobs.length === 0) {
      return NextResponse.json([]);
    }
    const blobResponse = await fetch(blobs[0].url, { cache: 'no-store' });
    if (!blobResponse.ok) return NextResponse.json([]);

    const deals = await blobResponse.json();
    return NextResponse.json(deals);
  } catch (error) {
    return NextResponse.json([]);
  }
}