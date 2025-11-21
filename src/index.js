import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, limit } from "firebase/firestore";
import algoliasearch from "algoliasearch";

export default {
  async fetch(request, env) {
    // ============================================================
    // 1. CORS & CONFIGURATION
    // ============================================================
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Initialize Firebase (Safely)
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
      
      // Initialize Algolia
      const algoliaClient = algoliasearch(env.ALGOLIA_APP_ID, env.ALGOLIA_SEARCH_API_KEY);
      const algoliaIndex = algoliaClient.initIndex("products");

      const url = new URL(request.url);

      // Helper to clean AI JSON output (Removes Markdown backticks)
      const cleanJSON = (str) => {
        try {
            return JSON.parse(str.replace(/```json/g, '').replace(/```/g, '').trim());
        } catch (e) {
            return { error: "AI output parsing failed", raw: str };
        }
      };

      // ============================================================
      // 2. SELLER TOOLS (Upload & Optimization)
      // ============================================================

      // --- ROUTE: AUTO-FILL OPTIMIZER (Desc + Category) ---
      if (url.pathname === "/optimize-listing" && request.method === "POST") {
        const { title, price, features } = await request.json();
        
        const descPrompt = `
          You are a professional Ugandan copywriter. 
          Product: "${title}" (${price} UGX). Features: "${features}".
          
          Task: Write a sales listing.
          - Short Description: 2 sentences for preview.
          - Long Description: Professional, persuasive, mentions "Available in Kabale".
          
          Output ONLY valid JSON: { "shortDesc": "...", "longDesc": "..." }
        `;

        const catPrompt = `
          Classify this product: "${title}".
          Allowed Categories: Electronics, Clothing & Apparel, Home & Furniture, Health & Beauty, Vehicles, Property, Textbooks, Services, Other.
          
          Output ONLY valid JSON: { "category": "Exact Category Name" }
        `;

        const [descResponse, catResponse] = await Promise.all([
          env.AI.run("@cf/meta/llama-3.1-8b-instruct", { messages: [{ role: "system", content: "Output JSON only." }, { role: "user", content: descPrompt }] }),
          env.AI.run("@cf/meta/llama-3.1-8b-instruct", { messages: [{ role: "system", content: "Output JSON only." }, { role: "user", content: catPrompt }] })
        ]);

        const descData = cleanJSON(descResponse.response);
        const catData = cleanJSON(catResponse.response);

        return new Response(JSON.stringify({ ...descData, ...catData }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // --- ROUTE: SCAM DETECTOR ---
      if (url.pathname === "/detect-scam" && request.method === "POST") {
        const { title, price, description } = await request.json();
        
        const userPrompt = `
          Analyze fraud risk for Uganda (Currency: UGX).
          Item: "${title}", Listed Price: ${price} UGX, Desc: "${description}".

          INSTRUCTIONS:
          1. Estimate approximate market value in Uganda.
          2. If listed price is unreasonably low (< 10% of value), flag as HIGH risk.
          3. Look for contradictions (e.g. "New Car" for "50,000 UGX").
          
          Output JSON: { "riskScore": 0-100, "riskLevel": "Low/Medium/High", "reason": "..." }
        `;
        
        const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
          messages: [{ role: "system", content: "Output JSON only." }, { role: "user", content: userPrompt }]
        });

        return new Response(JSON.stringify(cleanJSON(response.response)), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // --- ROUTE: DESC ONLY (Legacy) ---
      if (url.pathname === "/generate-description" && request.method === "POST") {
        const { title, price, features } = await request.json();
        const userPrompt = `Write sales listing for "${title}" (${price} UGX). Features: ${features}. Output JSON: { "shortDesc": "...", "longDesc": "...", "seoTitle": "..." }`;
        const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", { messages: [{ role: "system", content: "Output JSON only." }, { role: "user", content: userPrompt }] });
        return new Response(JSON.stringify(cleanJSON(response.response)), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // ============================================================
      // 3. BUYER TOOLS (Interactive Features)
      // ============================================================

      // --- ROUTE: ASK AMARA (Q&A) ---
      if (url.pathname === "/ask-amara" && request.method === "POST") {
        const { product, question } = await request.json();
        const systemPrompt = "You are Amara, a helpful shopping assistant for KabaleOnline. Answer strictly based on the product details provided. Keep it brief and friendly.";
        const userPrompt = `
          Product: "${product.name}"
          Price: ${product.price} UGX
          Description: "${product.description}"
          User Question: "${question}"
          If answer is not in description, suggest contacting seller.
          Output JSON: { "answer": "..." }
        `;
        const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", { messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }] });
        return new Response(JSON.stringify(cleanJSON(response.response)), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // --- ROUTE: NEGOTIATION COACH ---
      if (url.pathname === "/negotiation-coach" && request.method === "POST") {
        const { product } = await request.json();
        const userPrompt = `
          Write a polite, persuasive WhatsApp message to bargain for a lower price.
          Product: "${product.name}" (Listed: ${product.price} UGX).
          Context: Buyer is a student in Kabale.
          Output JSON: { "message": "Hi [Seller]..." }
        `;
        const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", { messages: [{ role: "system", content: "Output JSON only." }, { role: "user", content: userPrompt }] });
        return new Response(JSON.stringify(cleanJSON(response.response)), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // --- ROUTE: WHATSAPP STATUS ---
      if (url.pathname === "/generate-status" && request.method === "POST") {
        const { product } = await request.json();
        const userPrompt = `
          Write a catchy WhatsApp Status text to sell this fast.
          Product: "${product.name}" - ${product.price} UGX.
          Use emojis. Create urgency.
          Output JSON: { "statusText": "..." }
        `;
        const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", { messages: [{ role: "system", content: "Output JSON only." }, { role: "user", content: userPrompt }] });
        return new Response(JSON.stringify(cleanJSON(response.response)), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // ============================================================
      // 4. SYSTEM TOOLS (Search & Sync)
      // ============================================================

      // --- ROUTE: PRODUCT LOOKUP ---
      if (url.pathname === "/lookup-product" && request.method === "POST") {
        const { query } = await request.json();
        try {
            const { hits } = await algoliaIndex.search(query, { attributesToRetrieve: ['name', 'price', 'category', 'objectID'], hitsPerPage: 5 });
            return new Response(JSON.stringify({ results: hits }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        } catch (e) {
            return new Response(JSON.stringify({ error: "Search failed", details: e.message, results: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      // --- ROUTE: SYNC DB ---
      if (url.pathname === "/sync-products" && request.method === "POST") {
        const q = query(collection(db, "products"), limit(500));
        const snapshot = await getDocs(q);
        const records = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                objectID: doc.id,
                name: data.name, price: data.price, category: data.category, description: data.description, imageUrls: data.imageUrls,
                createdAt: data.createdAt ? data.createdAt.seconds : Date.now() / 1000
            };
        });
        if (records.length > 0) await algoliaIndex.saveObjects(records);
        return new Response(JSON.stringify({ status: "Success", count: records.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // --- ROOT ---
      return new Response(JSON.stringify({ status: "Kabale AI Agent Active", version: "2.0" }), { 
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