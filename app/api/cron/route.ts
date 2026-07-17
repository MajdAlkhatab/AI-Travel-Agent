import { NextResponse } from 'next/server';
export const maxDuration = 300; 

export async function GET(request: Request) {
  console.log("[CRON] Executing Cron Job at:", new Date().toISOString());
  
  try {
    const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https';
    const host = request.headers.get('host');
    const baseUrl = `${protocol}://${host}`;
    
    const airports = ['ARN', 'GOT', 'CPH'];
    const travelersOptions = [1, 2];
    const preferences = ['beach', 'city'];

    const pick = (arr: any[]) => arr[Math.floor(Math.random() * arr.length)];

    const dep = pick(airports);
    const pax = pick(travelersOptions);
    const pref = pick(preferences);

    const requestUrl = `${baseUrl}/api/generate-trip?departure_id=${dep}&travelers=${pax}&duration=2&home_currency=SEK&user_preference=${pref}`;

    console.log(`[CRON] Calling backend endpoint: ${requestUrl}`);

    // 1. Trigger your AI Agents
    const startTime = Date.now();
    const fetchOptions = {
      headers: {
        'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '',
      }
    };
    
    const aiResponse = await fetch(requestUrl, fetchOptions);
    const timeToFirstByte = Date.now() - startTime;
    
    console.log(`[CRON] Response Status: ${aiResponse.status}, Time to First Byte: ${timeToFirstByte}ms`);

    if (!aiResponse.body) {
       throw new Error("No readable stream");
    }

    // 2. Read the stream using a Buffer ("Waiting Room")
    const reader = aiResponse.body.getReader();
    const decoder = new TextDecoder();
    let finalDeal = null;
    let buffer = ""; 
    console.log("[CRON] Starting stream processing...");
    
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      
      const parts = buffer.split('\n\n');
      
      buffer = parts.pop() || "";
      
      for (const part of parts) {
        const lines = part.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const payloadString = line.substring(6);
              const payload = JSON.parse(payloadString);
              
              if (payload.type === 'complete') {
                console.log("[CRON] COMPLETE payload captured successfully!");
                finalDeal = payload.data;
              } else if (payload.type === 'error' || payload.type === 'empty') {
                console.log(`[CRON] Terminating gracefully. Type: ${payload.type}`);
                return NextResponse.json({ status: payload.type, message: payload.message || "No deals found today." });
              }
            } catch (e) {
               console.error(`[CRON] Failed to parse completed JSON string. Error:`, e);
            }
          }
        }
      }
    }

    if (!finalDeal) {
       throw new Error("Stream finished without generating a deal.");
    }

    // 3. Save to Blob and Push to Meta
    const publishUrl = `${baseUrl}/api/save-and-publish`;
    console.log(`[CRON] Initiating publish sequence...`);
    
    const publishRes = await fetch(publishUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET || ''
      },
      body: JSON.stringify(finalDeal)
    });
    
    const publishResult = await publishRes.json();
    console.log(`[CRON] Publish sequence finished. Success:`, publishResult.success);

    return NextResponse.json({ 
      success: true, 
      destination: finalDeal.destination, 
      published: publishResult 
    });

  } catch (error: any) {
    console.error("[CRON] Execution failed:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}