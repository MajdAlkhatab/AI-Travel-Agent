import { NextResponse } from 'next/server';

// CRITICAL: AI takes time. Allow this function to run for up to 5 minutes.
// (Note: Vercel Hobby plan limits this to 10-60 seconds. You may need a Pro plan for LLM tasks).
export const maxDuration = 300; 

export async function GET(request: Request) {
  console.log("[CRON] Executing Cron Job at:", new Date().toISOString());
  
  try {
    const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https';
    const host = request.headers.get('host');
    const baseUrl = `${protocol}://${host}`;
    
    const requestUrl = `${baseUrl}/api/generate-trip?departure_id=ARN&travelers=2&duration=2&home_currency=SEK&user_preference=beach`;
    console.log(`[CRON] Calling backend endpoint: ${requestUrl}`);

    // 1. Trigger your AI Agents (using default parameters)
    const startTime = Date.now();
    const fetchOptions = {
      headers: {
        'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '',
      }
    };
    const aiResponse = await fetch(requestUrl);
    const timeToFirstByte = Date.now() - startTime;
    
    console.log(`[CRON] Response received. Status: ${aiResponse.status}, Time to First Byte: ${timeToFirstByte}ms`);
    console.log(`[CRON] Response Headers:`, Object.fromEntries(aiResponse.headers.entries()));

    if (!aiResponse.body) {
       console.log("[CRON] ERROR: No readable stream in response body");
       throw new Error("No readable stream");
    }

    // 2. Read the stream until we get the final deal
    console.log("[CRON] Body exists. Initializing reader...");
    const reader = aiResponse.body.getReader();
    const decoder = new TextDecoder();
    let finalDeal = null;
    let chunksProcessed = 0;

    console.log("[CRON] Starting while loop to read stream...");
    while (true) {
      console.log(`[CRON] Reading chunk ${chunksProcessed}...`);
      const { done, value } = await reader.read();
      
      if (done) {
         console.log(`[CRON] Stream is done. Total chunks processed: ${chunksProcessed}`);
         break;
      }
      
      chunksProcessed++;
      const chunk = decoder.decode(value, { stream: true });
      console.log(`[CRON] Chunk ${chunksProcessed} decoded. Length: ${chunk.length} chars. Preview: ${chunk.substring(0, 50).replace(/\n/g, '\\n')}...`);
      
      const lines = chunk.split('\n\n');
      console.log(`[CRON] Chunk ${chunksProcessed} contains ${lines.length} lines.`);
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const payloadString = line.substring(6);
            console.log(`[CRON] Parsing payload: ${payloadString.substring(0, 50)}...`);
            const payload = JSON.parse(payloadString);
            
            console.log(`[CRON] Payload type received: ${payload.type}`);
            
            if (payload.type === 'complete') {
              console.log("[CRON] COMPLETE payload received. Capturing deal data.");
              finalDeal = payload.data;
            } else if (payload.type === 'error' || payload.type === 'empty') {
              console.log(`[CRON] Terminating payload received (${payload.type}). Message: ${payload.message || "No deals found today."}`);
              return NextResponse.json({ status: payload.type, message: payload.message || "No deals found today." });
            }
          } catch (e) {
             console.log(`[CRON] Failed to parse line starting with 'data: ' : ${line.substring(0, 50)}... Error:`, e);
          }
        } else if (line.trim() !== '') {
           console.log(`[CRON] Ignored line (does not start with 'data: '): ${line.substring(0, 50).replace(/\n/g, '\\n')}`);
        }
      }
    }

    console.log("[CRON] Stream processing finished.");

    if (!finalDeal) {
       console.log("[CRON] ERROR: Stream finished without generating a deal.");
       throw new Error("Stream finished without generating a deal.");
    }
    
    console.log(`[CRON] Deal captured successfully. Destination: ${finalDeal.destination}`);

    // 3. Save to Blob and Push to Meta
    const publishUrl = `${baseUrl}/api/save-and-publish`;
    console.log(`[CRON] Initiating publish sequence to: ${publishUrl}`);
    
    const publishRes = await fetch(publishUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(finalDeal)
    });
    
    console.log(`[CRON] Publish response status: ${publishRes.status}`);
    const publishResult = await publishRes.json();
    console.log(`[CRON] Publish result:`, publishResult);

    console.log("[CRON] Cron Job completed successfully.");
    return NextResponse.json({ 
      success: true, 
      destination: finalDeal.destination, 
      published: publishResult 
    });

  } catch (error: any) {
    console.error("[CRON] Cron execution failed:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}