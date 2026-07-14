import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper function to keep code clean when stamping multiple images
async function stampImage(originalUrl: string, satoriElement: any, fontBuffer: ArrayBuffer) {
  const svg = await satori(satoriElement, { width: 1080, height: 1080, fonts: [{ name: 'Roboto', data: fontBuffer, weight: 700, style: 'normal' }] });
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1080 } });
  const pngData = resvg.render().asPng();
  
  const imgRes = await fetch(originalUrl);
  const imgBuf = await imgRes.arrayBuffer();
  
  const composited = await sharp(Buffer.from(imgBuf))
    .resize(1080, 1080, { fit: 'cover', kernel: 'lanczos3' })
    .composite([{ input: pngData, gravity: 'center' }])
    .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
    .toBuffer();
    
  const blob = await put(`stamped-${Date.now()}-${Math.floor(Math.random()*1000)}.jpg`, composited, { access: 'public', contentType: 'image/jpeg' });
  return blob.url;
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  const API_SECRET = process.env.API_SECRET_KEY;

  if (!API_SECRET || authHeader !== `Bearer ${API_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized access' }, { status: 401 });
  }

  const ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
  const FB_PAGE_ID = process.env.FACEBOOK_PAGE_ID;
  const IG_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || process.env.INSTAGRAM_ACCOUNT_ID; 

  if (!ACCESS_TOKEN || !IG_ACCOUNT_ID || !FB_PAGE_ID) {
    return NextResponse.json({ error: 'Missing Meta environment variables in Vercel settings' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { imageUrls, caption, economics, tripDetails } = body;

    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0 || !caption) {
      return NextResponse.json({ error: 'Missing imageUrls array or caption in request body' }, { status: 400 });
    }

    console.log(`Starting Social Media Publish Sequence for ${imageUrls.length} images...`);

    // Load Font once
    const fontRes = await fetch('https://fonts.gstatic.com/s/roboto/v30/KFOlCnqEu92Fr1MmWUlvAx05IsDqlA.ttf');
    const fontBuffer = await fontRes.arrayBuffer();

    // --- STAMP IMAGE 1: PRICING BADGE ---
    if (economics && economics.totalCurrent != null) {
      try {
        console.log("Stamping first image with pricing badge...");
        const locationMatch = caption.match(/🔥 Nytt supererbjudande:\s*(.*?)\s*!/);
        const locationText = locationMatch ? locationMatch[1].toUpperCase() : '';
        const hasSavings = economics.totalSavingsPercent > 0;

        imageUrls[0] = await stampImage(imageUrls[0], {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', width: '100%', height: '100%', paddingTop: '160px', fontFamily: 'Roboto' },
            children: [
              {
                type: 'div',
                props: {
                  style: { display: 'flex', position: 'relative', flexDirection: 'column' }, 
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: { 
                          display: 'flex', flexDirection: 'column', alignItems: 'center', backgroundColor: 'rgba(240, 243, 245, 0.95)', padding: '48px 64px', borderRadius: '32px', 
                          border: '3px solid rgba(255, 255, 255, 0.8)', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)', marginTop: hasSavings ? '32px' : '0' 
                        },
                        children: [
                          { type: 'span', props: { style: { fontSize: '32px', color: '#1f2937', textTransform: 'uppercase', letterSpacing: '6px', fontWeight: 800, marginBottom: '16px' }, children: 'TOTALT PRIS' } },
                          { type: 'span', props: { style: { fontSize: '120px', fontWeight: 900, color: '#111827', lineHeight: 1, marginBottom: hasSavings ? '32px' : '0' }, children: `${economics.totalCurrent.toLocaleString('sv-SE')} kr` } },
                          hasSavings ? { 
                            type: 'div', 
                            props: { 
                              style: { display: 'flex', backgroundColor: 'rgba(52, 211, 153, 0.4)', border: '2px solid rgba(110, 231, 183, 0.6)', padding: '16px 36px', borderRadius: '16px' }, 
                              children: { type: 'span', props: { style: { fontSize: '36px', fontWeight: 800, color: '#022c22' }, children: `Du sparar ${economics.totalSavings.toLocaleString('sv-SE')} kr` } } 
                            } 
                          } : null
                        ].filter(Boolean)
                      }
                    },
                    hasSavings ? {
                      type: 'div',
                      props: {
                        style: { 
                          position: 'absolute', top: 0, right: '40px', display: 'flex', backgroundColor: '#d9534f', color: 'white', 
                          fontSize: '36px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '4px', padding: '16px 40px', borderRadius: '24px 24px 0 24px', 
                          border: '2px solid rgba(255, 255, 255, 0.2)', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.4)'
                        },
                        children: `${economics.totalSavingsPercent}% RABATT`
                      }
                    } : null
                  ].filter(Boolean)
                }
              },
              locationText ? {
                type: 'div',
                props: {
                  style: { marginTop: '40px', color: 'white', fontSize: '52px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '2px', textShadow: '0px 4px 16px rgba(0,0,0,0.9), 0px 2px 4px rgba(0,0,0,1)' },
                  children: locationText
                }
              } : null
            ].filter(Boolean)
          }
        } as any, fontBuffer);
      } catch (e) { console.error("Failed to stamp Image 1:", e); }
    }

    // --- STAMP IMAGE 2: TRAVELERS & FLIGHT ROUTE ---
    if (imageUrls.length > 1 && tripDetails) {
      try {
        console.log("Stamping second image with travel details...");
        imageUrls[1] = await stampImage(imageUrls[1], {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', width: '100%', height: '100%', paddingBottom: '120px', fontFamily: 'Roboto' },
            children: [
              {
                type: 'div',
                props: {
                  style: { display: 'flex', flexDirection: 'column', alignItems: 'center', backgroundColor: 'rgba(240, 243, 245, 0.95)', padding: '40px 60px', borderRadius: '32px', border: '3px solid rgba(255, 255, 255, 0.8)', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' },
                  children: [
                    { type: 'span', props: { style: { fontSize: '48px', fontWeight: 900, color: '#111827', marginBottom: '16px' }, children: `${tripDetails.travelers} Resenärer • ${tripDetails.nights} Nätter` } },
                    { type: 'span', props: { style: { fontSize: '40px', fontWeight: 700, color: '#4b5563' }, children: `Från ${tripDetails.depAirport} till ${tripDetails.arrAirport}` } }
                  ]
                }
              }
            ]
          }
        } as any, fontBuffer);
      } catch (e) { console.error("Failed to stamp Image 2:", e); }
    }

    // --- STAMP IMAGE 3: TEMPERATURE & ROUND TRIP ---
    if (imageUrls.length > 2 && tripDetails) {
      try {
        console.log("Stamping third image with temp and dates...");
        imageUrls[2] = await stampImage(imageUrls[2], {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', width: '100%', height: '100%', paddingBottom: '120px', fontFamily: 'Roboto' },
            children: [
              {
                type: 'div',
                props: {
                  style: { display: 'flex', flexDirection: 'column', alignItems: 'center', backgroundColor: 'rgba(240, 243, 245, 0.95)', padding: '40px 60px', borderRadius: '32px', border: '3px solid rgba(255, 255, 255, 0.8)', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' },
                  children: [
                    { type: 'span', props: { style: { fontSize: '80px', fontWeight: 900, color: '#111827', marginBottom: '16px' }, children: `🌡️ ${tripDetails.temperature}` } },
                    { type: 'span', props: { style: { fontSize: '40px', fontWeight: 700, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '2px' }, children: `TUR OCH RETUR` } }
                  ]
                }
              }
            ]
          }
        } as any, fontBuffer);
      } catch (e) { console.error("Failed to stamp Image 3:", e); }
    }

    // --- STEP A: POST TO FACEBOOK PAGE (MULTI-PHOTO) ---
    let fbPostId = null;
    try {
      const fbPhotoIds = [];
      for (const url of imageUrls) {
        const fbPhotoRes = await fetch(`https://graph.facebook.com/v25.0/${FB_PAGE_ID}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url, published: false, access_token: ACCESS_TOKEN })
        });
        const fbPhotoData = await fbPhotoRes.json();
        if (fbPhotoData.id) { fbPhotoIds.push({ media_fbid: fbPhotoData.id }); }
      }

      if (fbPhotoIds.length > 0) {
        const fbFeedRes = await fetch(`https://graph.facebook.com/v25.0/${FB_PAGE_ID}/feed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: caption, attached_media: fbPhotoIds, access_token: ACCESS_TOKEN })
        });
        const fbFeedData = await fbFeedRes.json();
        
        if (!fbFeedData.error) {
          fbPostId = fbFeedData.id;
          console.log(`Facebook Multi-Photo Post created successfully. ID: ${fbPostId}`);
        }
      }
    } catch (fbErr) { console.error("Facebook Process Error:", fbErr); }

    // --- STEP B: CREATE INSTAGRAM CAROUSEL ITEMS ---
    const igItemIds = [];
    for (const url of imageUrls) {
      const igItemRes = await fetch(`https://graph.facebook.com/v25.0/${IG_ACCOUNT_ID}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: url, is_carousel_item: true, access_token: ACCESS_TOKEN })
      });
      const igItemData = await igItemRes.json();
      if (igItemData.id) { igItemIds.push(igItemData.id); }
    }

    if (igItemIds.length === 0) { throw new Error("Failed to create any Instagram carousel items."); }

    // --- STEP C: CREATE INSTAGRAM CAROUSEL CONTAINER ---
    const igContainerRes = await fetch(`https://graph.facebook.com/v25.0/${IG_ACCOUNT_ID}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_type: 'CAROUSEL', caption: caption, children: igItemIds.join(','), access_token: ACCESS_TOKEN })
    });
    const igContainerData = await igContainerRes.json();
    if (igContainerData.error) { throw new Error(`IG Container Error: ${igContainerData.error.message}`); }

    const creationId = igContainerData.id;

    // --- STEP D: SAFETY DELAY ---
    await delay(5000); 

    // --- STEP E: PUBLISH INSTAGRAM CAROUSEL ---
    const igPublishRes = await fetch(`https://graph.facebook.com/v25.0/${IG_ACCOUNT_ID}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: creationId, access_token: ACCESS_TOKEN })
    });
    const igPublishData = await igPublishRes.json();
    if (igPublishData.error) { throw new Error(`IG Publish Error: ${igPublishData.error.message}`); }

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