import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';

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
    const { imageUrls, caption, economics } = body;

    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0 || !caption) {
      return NextResponse.json({ error: 'Missing imageUrls array or caption in request body' }, { status: 400 });
    }

    console.log(`Starting Social Media Publish Sequence for ${imageUrls.length} images...`);

    // --- STEP 0: STAMP THE EXACT FRONTEND UI BADGE ON FIRST IMAGE ---
    if (economics && economics.totalCurrent != null) {
      try {
        console.log("Stamping first image with pricing badge...");
        
        // Load font for rendering text
        const fontRes = await fetch('https://fonts.gstatic.com/s/roboto/v30/KFOlCnqEu92Fr1MmWUlvAx05IsDqlA.ttf');
        const fontBuffer = await fontRes.arrayBuffer();

        // Check if there are savings to render the red/green tags, else just render total price
        const hasSavings = economics.totalSavingsPercent > 0;

        // Generate the transparent UI Overlay mimicking your Tailwind frontend
        const svg = await satori(
          {
            type: 'div',
            props: {
              style: { 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', // Centers the badge horizontally
                justifyContent: 'flex-start', // Pushes to the upper part
                width: '100%', 
                height: '100%', 
                paddingTop: '120px', // Distance from the top edge
                fontFamily: 'Roboto' 
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }, // Inner wrapper for alignment
                    children: hasSavings ? [
                      // Red Discount Badge (rounded-t-lg rounded-bl-lg, translate-y-1, drop-shadow)
                      {
                        type: 'div',
                        props: {
                          style: { 
                            display: 'flex', 
                            backgroundColor: 'rgba(239, 68, 68, 0.95)', 
                            color: 'white', 
                            fontSize: '32px', 
                            fontWeight: 900, 
                            textTransform: 'uppercase',
                            letterSpacing: '4px',
                            padding: '12px 32px', 
                            borderRadius: '24px 24px 0 24px', 
                            border: '2px solid rgba(248, 113, 113, 0.4)',
                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)',
                            zIndex: 20, 
                            marginBottom: '-16px' // Simulates the overlap / translate-y
                          },
                          children: `${economics.totalSavingsPercent}% RABATT`
                        }
                      },
                      // Main Glass Box (bg-white/30, rounded-xl, items-end, shadow-xl)
                      {
                        type: 'div',
                        props: {
                          style: { 
                            display: 'flex', 
                            flexDirection: 'column', 
                            alignItems: 'flex-end', 
                            backgroundColor: 'rgba(255, 255, 255, 0.85)', // Slightly higher opacity to simulate lack of CSS blur
                            padding: '40px 48px', 
                            borderRadius: '32px', 
                            border: '3px solid rgba(255, 255, 255, 0.6)',
                            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
                            zIndex: 10
                          },
                          children: [
                            { type: 'span', props: { style: { fontSize: '28px', color: '#111827', textTransform: 'uppercase', letterSpacing: '6px', fontWeight: 800, marginBottom: '8px' }, children: 'TOTALT PRIS' } },
                            { type: 'span', props: { style: { fontSize: '110px', fontWeight: 900, color: '#111827', lineHeight: 1, marginBottom: '24px' }, children: `${economics.totalCurrent.toLocaleString('sv-SE')} kr` } },
                            // Green Savings Box
                            { 
                              type: 'div', 
                              props: { 
                                style: { 
                                  display: 'flex', 
                                  backgroundColor: 'rgba(52, 211, 153, 0.35)', 
                                  border: '2px solid rgba(110, 231, 183, 0.5)',
                                  padding: '16px 32px', 
                                  borderRadius: '16px' 
                                }, 
                                children: { type: 'span', props: { style: { fontSize: '32px', fontWeight: 800, color: '#022c22' }, children: `Du sparar ${economics.totalSavings.toLocaleString('sv-SE')} kr` } } 
                              } 
                            }
                          ]
                        }
                      }
                    ] : [
                      // NO SAVINGS UI (Just the main box)
                      {
                        type: 'div',
                        props: {
                          style: { 
                            display: 'flex', 
                            flexDirection: 'column', 
                            alignItems: 'flex-end', 
                            backgroundColor: 'rgba(255, 255, 255, 0.85)',
                            padding: '40px 48px', 
                            borderRadius: '32px', 
                            border: '3px solid rgba(255, 255, 255, 0.6)',
                            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
                            marginTop: '40px'
                          },
                          children: [
                            { type: 'span', props: { style: { fontSize: '28px', color: '#111827', textTransform: 'uppercase', letterSpacing: '6px', fontWeight: 800, marginBottom: '8px' }, children: 'TOTALT PRIS' } },
                            { type: 'span', props: { style: { fontSize: '110px', fontWeight: 900, color: '#111827', lineHeight: 1 }, children: `${economics.totalCurrent.toLocaleString('sv-SE')} kr` } }
                          ]
                        }
                      }
                    ]
                  }
                }
              ]
            }
          } as any,
          { width: 1080, height: 1080, fonts: [{ name: 'Roboto', data: fontBuffer, weight: 700, style: 'normal' }] }
        );

        // Convert SVG to PNG
        const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1080 } });
        const pngData = resvg.render().asPng();

        // Download the raw first destination image
        const firstImageRes = await fetch(imageUrls[0]);
        const firstImageBuffer = await firstImageRes.arrayBuffer();

        // Composite the PNG overlay onto the Background Image
        const composited = await sharp(Buffer.from(firstImageBuffer))
          .resize(1080, 1080, { fit: 'cover' })
          .composite([{ input: pngData, gravity: 'center' }])
          .jpeg({ quality: 90 })
          .toBuffer();

        // Upload to Vercel Blob and replace the URL in the array
        const blob = await put(`stamped-${Date.now()}.jpg`, composited, { access: 'public', contentType: 'image/jpeg' });
        imageUrls[0] = blob.url;
        console.log("Successfully stamped first image:", blob.url);

      } catch (stampErr) {
        console.error("Failed to stamp image, proceeding with original:", stampErr);
      }
    }

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
            published: false,
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
          is_carousel_item: true,
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