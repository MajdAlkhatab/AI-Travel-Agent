import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  // 1. Pull your secure variables directly from Vercel's environment
  const ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
  const IG_ACCOUNT_ID = process.env.INSTAGRAM_ACCOUNT_ID;

  if (!ACCESS_TOKEN || !IG_ACCOUNT_ID) {
    return NextResponse.json({ error: 'Missing Meta API credentials in Vercel' }, { status: 500 });
  }

  try {
    // 2. Grab the image and caption you want to post from the request body
    const body = await request.json();
    const { imageUrl, caption } = body;

    // STEP A: Create the media container on Instagram
    const containerUrl = `https://graph.facebook.com/v20.0/${IG_ACCOUNT_ID}/media?image_url=${encodeURIComponent(imageUrl)}&caption=${encodeURIComponent(caption)}&access_token=${ACCESS_TOKEN}`;
    
    const containerRes = await fetch(containerUrl, { method: 'POST' });
    const containerData = await containerRes.json();

    if (containerData.error) {
      throw new Error(`Container Error: ${containerData.error.message}`);
    }

    const creationId = containerData.id;

    // STEP B: Publish the container to your live feed
    const publishUrl = `https://graph.facebook.com/v20.0/${IG_ACCOUNT_ID}/media_publish?creation_id=${creationId}&access_token=${ACCESS_TOKEN}`;
    
    const publishRes = await fetch(publishUrl, { method: 'POST' });
    const publishData = await publishRes.json();

    if (publishData.error) {
      throw new Error(`Publish Error: ${publishData.error.message}`);
    }

    // Success! Return the official Instagram Post ID
    return NextResponse.json({ 
      success: true, 
      message: 'Successfully posted to TripHunter!', 
      postId: publishData.id 
    });

  } catch (error: any) {
    console.error("Instagram Publish Failed:", error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}