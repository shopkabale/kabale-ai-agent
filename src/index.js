import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, where, limit } from "firebase/firestore";
import algoliasearch from "algoliasearch";

export default {
  async fetch(request, env) {
    // 1. DEFINE CORS HEADERS FIRST
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // 2. HANDLE PREFLIGHT (Browser Check)
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // --- INITIALIZE SERVICES INSIDE TRY BLOCK ---
      // This ensures if keys are missing, we catch the error instead of crashing
      const firebaseConfig = {
        apiKey: env.FIREBASE_API_KEY,
        authDomain: env.FIREBASE_AUTH_DOMAIN,
        projectId: env.FIREBASE_PROJECT_ID,
        storageBucket: env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
        appId: env.FIREBASE_APP_ID
      };
      
      // Initialize services (Safely)
      const app = initializeApp(firebaseConfig);
      const db = getFirestore(app);
      
      const algoliaClient = algoliasearch(env.ALGOLIA_APP_ID, env.ALGOLIA_SEARCH_API_KEY);
      const algoliaIndex = algoliaClient.initIndex("products");

      const url = new URL(request.url);

      // --- ROUTING ---

      // 1. Generate Description
      if (url.pathname === "/generate-description" && request.method === "POST") {
        const { title, price, features } = await request.json();
        const prompt = `Write a sales listing for KabaleOnline. Product: ${title} (${price} UGX). Features: ${features}. Output JSON.`;
        
        const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" }
        });
        return new Response(JSON.stringify(response), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // 2. Detect Scam
      if (url.pathname === "/detect-scam" && request.method === "POST") {
        const { title, price, description } = await request.json();
        const prompt = `Analyze fraud risk. Item: ${title}, Price: ${price}. Output JSON with riskScore.`;
        
        const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" }
        });
        return new Response(JSON.stringify(response), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // 3. Lookup Product
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
      // --- THE MAGIC FIX ---
      // If ANYTHING fails, we return the error WITH CORS HEADERS
      // This lets you see the actual error message in your tester
      return new Response(JSON.stringify({ error: error.message, stack: error.stack }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};