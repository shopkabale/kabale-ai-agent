import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, limit } from "firebase/firestore";
import algoliasearch from "algoliasearch";

export default {
  async fetch(request, env) {
    // 1. CORS HEADERS (Allow your site to talk to this agent)
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle Browser Pre-checks
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // 2. INITIALIZE SERVICES (Safely inside try block)
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

      // --- ROUTE 1: AUTO-FILL OPTIMIZER (Description + Category) ---
      if (url.pathname === "/optimize-listing" && request.method === "POST") {
        const { title, price, features } = await request.json();
        
        // Prompt 1: Description
        const descPrompt = `
          You are a professional Ugandan copywriter. 
          Product: "${title}" (${price} UGX). Features: "${features}".
          
          Task: Write a sales listing.
          - Short Description: 2 sentences for preview.
          - Long Description: Professional, persuasive, mentions "Available in Kabale".
          
          Output ONLY valid JSON: { "shortDesc": "...", "longDesc": "..." }
        `;

        // Prompt 2: Category
        const catPrompt = `
          Classify this product: "${title}".
          Allowed Categories: Electronics, Clothing & Apparel, Home & Furniture, Health & Beauty, Vehicles, Property, Textbooks, Other.
          
          Output ONLY valid JSON: { "category": "Exact Category Name" }
        `;

        // Run both in parallel for speed
        const [descResponse, catResponse] = await Promise.all([
          env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
            messages: [{ role: "system", content: "Output JSON only. No markdown." }, { role: "user", content: descPrompt }]
          }),
          env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
            messages: [{ role: "system", content: "Output JSON only. No markdown." }, { role: "user", content: catPrompt }]
          })
        ]);

        // Helper to clean AI output
        const cleanJSON = (str) => {
            try { return JSON.parse(str.replace(/```json/g, '').replace(/```/g, '').trim()); }
            catch (e) { return {}; }
        };

        const descData = cleanJSON(descResponse.response);
        const catData = cleanJSON(catResponse.response);

        return new Response(JSON.stringify({ ...descData, ...catData }), { 
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }

      // --- ROUTE 2: SCAM DETECTOR (Smart Market Logic) ---
      if (url.pathname === "/detect-scam" && request.method === "POST") {
        const { title, price, description } = await request.json();
        
        const systemPrompt = "You are a fraud detection expert. Output ONLY valid JSON. No markdown.";
        const userPrompt = `
          Analyze fraud risk for Uganda (Currency: UGX).
          Item: "${title}", Listed Price: ${price} UGX, Desc: "${description}".

          INSTRUCTIONS:
          1. Estimate approximate market value in Uganda.
          2. If listed price is unreasonably low (< 10% of value), flag as HIGH risk.
          3. Look for contradictions (e.g. "New iPhone 14" for "200,000 UGX").
          
          Output JSON: { "riskScore": 0-100, "riskLevel": "Low/Medium/High", "reason": "..." }
        `;
        
        const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }]
        });

        let cleanJson = response.response;
        if (typeof cleanJson === 'string') {
            cleanJson = JSON.parse(cleanJson.replace(/```json/g, '').replace(/```/g, '').trim());
        }

        return new Response(JSON.stringify(cleanJson), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // --- ROUTE 3: PRODUCT LOOKUP (Algolia) ---
      if (url.pathname === "/lookup-product" && request.method === "POST") {
        const { query } = await request.json();
        const { hits } = await algoliaIndex.search(query, {
          attributesToRetrieve: ['name', 'price', 'category', 'objectID'],
          hitsPerPage: 5
        });
        return new Response(JSON.stringify({ results: hits }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // --- ROUTE 4: SYNC (Admin Tool) ---
      if (url.pathname === "/sync-products" && request.method === "POST") {
        const q = query(collection(db, "products"), limit(500));
        const snapshot = await getDocs(q);
        
        const records = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                objectID: doc.id,
                name: data.name,
                price: data.price,
                category: data.category,
                description: data.description,
                imageUrls: data.imageUrls,
                createdAt: data.createdAt ? data.createdAt.seconds : Date.now() / 1000
            };
        });

        if (records.length > 0) await algoliaIndex.saveObjects(records);

        return new Response(JSON.stringify({ status: "Success", count: records.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // ROOT CHECK
      return new Response(JSON.stringify({ status: "Kabale AI Agent Active" }), { 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });

    } catch (error) {
      // Return error details for debugging instead of generic "Failed to fetch"
      return new Response(JSON.stringify({ error: error.message, stack: error.stack }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};