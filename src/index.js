import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, where, limit } from "firebase/firestore";
import algoliasearch from "algoliasearch";

export default {
  async fetch(request, env) {
    // 1. SETUP FIREBASE 
    // We use the specific names you have, and standard ones for the rest
    const firebaseConfig = {
      apiKey: env.FIREBASE_API_KEY, // You need to add this to Cloudflare
      authDomain: env.FIREBASE_AUTH_DOMAIN, // You need to add this
      projectId: env.FIREBASE_PROJECT_ID, // MATCHES YOUR SCREENSHOT
      storageBucket: env.FIREBASE_STORAGE_BUCKET, // You need to add this
      messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID, // You need to add this
      appId: env.FIREBASE_APP_ID // You need to add this
    };
    
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    // 2. SETUP ALGOLIA
    // MATCHES YOUR SCREENSHOT EXACTLY
    const algoliaClient = algoliasearch(env.ALGOLIA_APP_ID, env.ALGOLIA_SEARCH_API_KEY);
    const algoliaIndex = algoliaClient.initIndex("products"); 

    const url = new URL(request.url);
    
    // CORS Headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // --- ROUTING ---
    
    // 1. AI Description Generator
    if (url.pathname === "/generate-description" && request.method === "POST") {
      const { title, price, features } = await request.json();
      const prompt = `
        Write a sales listing for KabaleOnline (Uganda).
        Product: ${title} (${price} UGX). Features: ${features}.
        Output JSON: { "shortDesc": "...", "longDesc": "...", "seoTitle": "..." }
      `;
      const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" }
      });
      return new Response(JSON.stringify(response), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2. AI Scam Detector
    if (url.pathname === "/detect-scam" && request.method === "POST") {
      const { title, price, description } = await request.json();
      const prompt = `
        Analyze fraud risk in Uganda.
        Item: ${title}, Price: ${price} UGX, Desc: ${description}.
        Output JSON: { "riskScore": 0-100, "riskLevel": "Low/Medium/High", "reason": "..." }
      `;
      const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" }
      });
      return new Response(JSON.stringify(response), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3. Algolia Lookup
    if (url.pathname === "/lookup-product" && request.method === "POST") {
      const { query } = await request.json();
      try {
        const { hits } = await algoliaIndex.search(query, {
          attributesToRetrieve: ['name', 'price', 'category', 'objectID'],
          hitsPerPage: 5
        });
        return new Response(JSON.stringify({ results: hits }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
      }
    }

    return new Response("Kabale AI Agent Active", { headers: corsHeaders });
  }
};