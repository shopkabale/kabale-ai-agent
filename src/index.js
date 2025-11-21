import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, where, limit } from "firebase/firestore";
import algoliasearch from "algoliasearch";

export default {
  async fetch(request, env) {
    // 1. CORS HEADERS
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // --- INITIALIZE SERVICES ---
      const firebaseConfig = {
        apiKey: env.FIREBASE_API_KEY,
        authDomain: env.FIREBASE_AUTH_DOMAIN,
        projectId: env.FIREBASE_PROJECT_ID,
        storageBucket: env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
        appId: env.FIREBASE_APP_ID
      };
      
      const app = initializeApp(firebaseConfig);
      const db = getFirestore(app);
      
      const algoliaClient = algoliasearch(env.ALGOLIA_APP_ID, env.ALGOLIA_SEARCH_API_KEY);
      const algoliaIndex = algoliaClient.initIndex("products");

      const url = new URL(request.url);

      // --- ROUTING ---

      // 1. Generate Description
      if (url.pathname === "/generate-description" && request.method === "POST") {
        const { title, price, features } = await request.json();
        
        const systemPrompt = "You are a helpful assistant that outputs ONLY valid JSON. Do not include markdown formatting.";
        const userPrompt = `
          Write a sales listing for KabaleOnline (Uganda).
          Product: ${title} (${price} UGX). Features: ${features}.
          
          Return exactly this JSON structure:
          { 
            "shortDesc": "2 sentences for preview.", 
            "longDesc": "Detailed, professional paragraph.", 
            "seoTitle": "Catchy title with 'Kabale'."
          }
        `;
        
        const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ]
        });
        
        let cleanJson = response.response;
        if (typeof cleanJson === 'string') {
            cleanJson = cleanJson.replace(/```json/g, '').replace(/```/g, '').trim();
            cleanJson = JSON.parse(cleanJson);
        }

        return new Response(JSON.stringify(cleanJson), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // 2. Detect Scam (UPDATED LOGIC)
      if (url.pathname === "/detect-scam" && request.method === "POST") {
        const { title, price, description } = await request.json();
        
        const systemPrompt = "You are a fraud detection expert for an online marketplace. Output ONLY valid JSON. No markdown.";
        
        // IMPROVED PROMPT: Uses general logic instead of strict rules
        const userPrompt = `
          Analyze this product listing for fraud risk in the context of Uganda (Currency: UGX).
          
          Item Name: "${title}"
          Listed Price: ${price} UGX
          Description: "${description}"

          INSTRUCTIONS:
          1. Estimate the approximate market value of this item in Uganda.
          2. Compare the Listed Price to the Market Value.
          3. If the price is unreasonably low (e.g., < 10% of value), flag as HIGH risk.
          4. Look for contradictions (e.g., "New Car" for "50,000 UGX").
          5. Check for suspicious phrases in description (e.g., "pay delivery first").

          Examples of HIGH Risk:
          - "Toyota Corolla" for 500,000 UGX (Real value ~15M+)
          - "iPhone 14" for 150,000 UGX (Real value ~3M+)
          
          Return exactly this JSON structure:
          { 
            "riskScore": (integer 0-100), 
            "riskLevel": "Low" or "Medium" or "High", 
            "reason": "Clear explanation of why based on price analysis." 
          }
        `;
        
        const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ]
        });

        let cleanJson = response.response;
        if (typeof cleanJson === 'string') {
            cleanJson = cleanJson.replace(/```json/g, '').replace(/```/g, '').trim();
            cleanJson = JSON.parse(cleanJson);
        }

        return new Response(JSON.stringify(cleanJson), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // 3. Lookup Product (Algolia)
      if (url.pathname === "/lookup-product" && request.method === "POST") {
        const { query } = await request.json();
        const { hits } = await algoliaIndex.search(query, {
          attributesToRetrieve: ['name', 'price', 'category', 'objectID'],
          hitsPerPage: 5
        });
        return new Response(JSON.stringify({ results: hits }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({ status: "Active", message: "Kabale AI is Online" }), { 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message, stack: error.stack }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};