import { NextResponse } from 'next/server';

// Helper function to create a small safety delay for Meta's servers
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request: Request) {
  // --- 1. SECURITY CHECK ---
  const authHeader = request.headers.get('authorization');
  const API_SECRET = process.env.API_SECRET_KEY;

  if (!API_SECRET || authHeader !== `Bearer ${API_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized access' }, { status: 401 });
  }

  // --- 2. ENVIRONMENT VARIABLES ---
  const ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
  const FB_PAGE_ID = process.env.FACEBOOK_PAGE_ID;
  const IG_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || process.env.INSTAGRAM_ACCOUNT_ID; 

  if (!ACCESS_TOKEN || !IG_ACCOUNT_ID || !FB_PAGE_ID) {
    return NextResponse.json({ error: 'Missing Meta environment variables in Vercel settings' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { imageUrls, caption } = body;

    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0 || !caption) {
      return NextResponse.json({ error: 'Missing imageUrls array or caption in request body' }, { status: 400 });
    }

    console.log(`Starting Social Media Publish Sequence for ${imageUrls.length} images...`);

    // --- STEP A: POST TO FACEBOOK PAGE (MULTI-PHOTO) ---
    let fbPostId = null;
    try {
      const fbPhotoIds = [];
      for (const url of imageUrls) {
        const fbPhotoRes = await fetch(`https://graph.facebook.com/v25.0/${FB_PAGE_ID}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: url,
            published: false, // Upload but keep hidden until feed post
            access_token: ACCESS_TOKEN
          })
        });
        const fbPhotoData = await fbPhotoRes.json();
        
        if (fbPhotoData.id) {
          fbPhotoIds.push({ media_fbid: fbPhotoData.id });
        }
      }

      if (fbPhotoIds.length > 0) {
        const fbFeedRes = await fetch(`https://graph.facebook.com/v25.0/${FB_PAGE_ID}/feed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: caption,
            attached_media: fbPhotoIds,
            access_token: ACCESS_TOKEN
          })
        });
        const fbFeedData = await fbFeedRes.json();
        
        if (fbFeedData.error) {
          console.error("Facebook Feed Publish Error Details:", fbFeedData.error);
        } else {
          fbPostId = fbFeedData.id;
          console.log(`Facebook Multi-Photo Post created successfully. ID: ${fbPostId}`);
        }
      }
    } catch (fbErr) {
      console.error("Facebook Process Error:", fbErr);
    }

    // --- STEP B: CREATE INSTAGRAM CAROUSEL ITEMS ---
    const igItemIds = [];
    for (const url of imageUrls) {
      const igItemRes = await fetch(`https://graph.facebook.com/v25.0/${IG_ACCOUNT_ID}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: url,
          is_carousel_item: true, // Tells Meta this is 1 slide of a carousel
          access_token: ACCESS_TOKEN
        })
      });
      const igItemData = await igItemRes.json();
      
      if (igItemData.id) {
        igItemIds.push(igItemData.id);
      } else if (igItemData.error) {
        console.error("IG Item Creation Error:", igItemData.error);
      }
    }

    if (igItemIds.length === 0) {
      throw new Error("Failed to create any Instagram carousel items.");
    }

    // --- STEP C: CREATE INSTAGRAM CAROUSEL CONTAINER ---
    const igContainerRes = await fetch(`https://graph.facebook.com/v25.0/${IG_ACCOUNT_ID}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_type: 'CAROUSEL',
        caption: caption,
        children: igItemIds.join(','),
        access_token: ACCESS_TOKEN
      })
    });
    const igContainerData = await igContainerRes.json();

    if (igContainerData.error) {
      throw new Error(`IG Container Error: ${igContainerData.error.message}`);
    }

    const creationId = igContainerData.id;
    console.log(`IG Carousel Container created successfully. ID: ${creationId}`);

    // --- STEP D: SAFETY DELAY ---
    // Give Meta's servers extra time to process all images before pushing live
    await delay(5000); 

    // --- STEP E: PUBLISH INSTAGRAM CAROUSEL ---
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

    console.log(`Successfully published Carousel to Instagram! Post ID: ${igPublishData.id}`);
    
    return NextResponse.json({ 
      success: true, 
      message: 'Successfully posted Carousel to Facebook and Instagram!', 
      facebookPostId: fbPostId,
      instagramPostId: igPublishData.id 
    });

  } catch (error: any) {
    console.error("Publish Flow Aborted:", error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}