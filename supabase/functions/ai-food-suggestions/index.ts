import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { foodItems, existingMealNames } = body;

    // Input validation
    if (!Array.isArray(foodItems)) {
      return new Response(JSON.stringify({ error: "Invalid input: foodItems must be an array" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (foodItems.length > 200) {
      return new Response(JSON.stringify({ error: "Too many food items" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (existingMealNames !== undefined && typeof existingMealNames !== "string") {
      return new Response(JSON.stringify({ error: "Invalid input: existingMealNames must be a string" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    if (foodItems.length === 0) {
      return new Response(JSON.stringify({ suggestions: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ingredientLines = foodItems.map((fi: { name: string; grams?: string | null; is_infinite?: boolean }) => {
      const qty = fi.is_infinite ? "∞" : (fi.grams || "?");
      return `- ${fi.name} (${qty})`;
    }).join("\n");

    const systemPrompt = `Tu es un assistant culinaire. On te donne une liste d'aliments disponibles et une liste de recettes déjà enregistrées.
Propose 8 à 10 recettes simples réalisables avec ces ingrédients (on peut utiliser des basiques de placard : sel, poivre, huile, eau).
IMPORTANT: Ne propose PAS de recettes qui existent déjà dans la liste des recettes enregistrées.
Réponds UNIQUEMENT en JSON valide avec ce format exact :
{
  "suggestions": [
    { "name": "Nom de la recette", "ingredients_used": ["ingrédient1", "ingrédient2"], "difficulty": "facile|moyen|difficile" }
  ]
}`;

    const userPrompt = `Voici mes aliments disponibles :\n${ingredientLines}\n\nRecettes déjà enregistrées (à NE PAS proposer) :\n${existingMealNames || "Aucune"}\n\nPropose des recettes nouvelles.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Trop de requêtes, réessaie dans un moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Crédits IA épuisés." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "Erreur IA" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await response.json();
    const content = aiData.choices?.[0]?.message?.content;
    let suggestions = [];
    try {
      const parsed = JSON.parse(content);
      suggestions = parsed.suggestions || [];
    } catch {
      console.error("Failed to parse AI response:", content);
    }

    return new Response(JSON.stringify({ suggestions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-food-suggestions error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
