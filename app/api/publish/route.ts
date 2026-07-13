import { NextResponse } from 'next/server';

// Helper function to create a small safety delay for Meta's servers
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request: Request) {
  // --- 1. SECURITY CHECK ---
  const authHeader = request.headers.get('authorization');
  const API_SECRET = process.env.API_SECRET_KEY;

  // Ensure this endpoint can't be triggered by random public requests
  if (!API_SECRET || authHeader !== `Bearer ${API_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized access' }, { status: 401 });
  }

  // --- 2. ENVIRONMENT VARIABLES ---
  const ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
  const IG_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID; 
  const FB_PAGE_ID = process.env.FACEBOOK_PAGE_ID;

  if (!ACCESS_TOKEN || !IG_ACCOUNT_ID || !FB_PAGE_ID) {
    return NextResponse.json({ error: 'Missing Meta environment variables in Vercel settings' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { imageUrl, caption } = body;

    if (!imageUrl || !caption) {
      return NextResponse.json({ error: 'Missing imageUrl or caption in request body' }, { status: 400 });
    }

    console.log("Starting Social Media Publish Sequence...");

    // --- STEP A: POST TO FACEBOOK PAGE ---
    const fbRes = await fetch(`https://graph.facebook.com/v25.0/${FB_PAGE_ID}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: imageUrl,
        message: caption,
        access_token: ACCESS_TOKEN
      })
    });
    const fbData = await fbRes.json();
    
    if (fbData.error) {
      console.error("Facebook Publication Error Details:", fbData.error);
    } else {
      console.log(`Facebook Post created successfully. ID: ${fbData.id}`);
    }

    // --- STEP B: CREATE INSTAGRAM CONTAINER ---
    const igContainerRes = await fetch(`https://graph.facebook.com/v25.0/${IG_ACCOUNT_ID}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        caption: caption,
        access_token: ACCESS_TOKEN
      })
    });
    const igContainerData = await igContainerRes.json();

    if (igContainerData.error) {
      throw new Error(`IG Container Error: ${igContainerData.error.message}`);
    }

    const creationId = igContainerData.id;
    console.log(`IG Container created successfully. ID: ${creationId}`);

    // --- STEP C: SAFETY DELAY ---
    // Give Meta's servers 3 seconds to fully download and process the image dimensions
    await delay(3000); 

    // --- STEP D: PUBLISH INSTAGRAM CONTAINER ---
    const igPublishRes = await fetch(`https://graph.facebook.com/v25.0/${IG_ACCOUNT_ID}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: creationId,
        access_token: ACCESS_TOKEN
      })
    });
    const igPublishData = await igPublishRes.json();

    if (igPublishData.error) {
      throw new Error(`IG Publish Error: ${igPublishData.error.message}`);
    }

    console.log(`Successfully published to Instagram! Post ID: ${igPublishData.id}`);
    
    return NextResponse.json({ 
      success: true, 
      message: 'Successfully posted to Facebook and Instagram!', 
      facebookPostId: fbData.id || null,
      instagramPostId: igPublishData.id 
    });

  } catch (error: any) {
    console.error("Publish Flow Aborted:", error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}