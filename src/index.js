import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, where, limit } from "firebase/firestore";
import algoliasearch from "algoliasearch";

export default {
  async fetch(request, env) {
    // 1. DEFINE CORS HEADERS
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
        
        // FIX: We added a SYSTEM message to force JSON, and removed response_format
        const systemPrompt = "You are a helpful assistant that outputs ONLY valid JSON. Do not include markdown formatting like ```json.";
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
        
        // Parse the string response back to object to ensure it's valid
        let cleanJson = response.response;
        if (typeof cleanJson === 'string') {
            // Sometimes AI wraps it in markdown, strip it
            cleanJson = cleanJson.replace(/```json/g, '').replace(/```/g, '').trim();
            cleanJson = JSON.parse(cleanJson);
        }

        return new Response(JSON.stringify(cleanJson), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // 2. Detect Scam
      if (url.pathname === "/detect-scam" && request.method === "POST") {
        const { title, price, description } = await request.json();
        
        const systemPrompt = "You are a fraud detection AI. Output ONLY valid JSON. No markdown.";
        const userPrompt = `
          Analyze fraud risk in Uganda.
          Item: ${title}, Price: ${price} UGX, Desc: ${description}.
          Rules: Electronics below 50% market value are HIGH risk.
          
          Return exactly this JSON structure:
          { "riskScore": 0-100, "riskLevel": "Low/Medium/High", "reason": "Short explanation" }
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

      // Root Check
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