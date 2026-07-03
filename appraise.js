const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PROMPT = `You are an expert secondhand-clothing appraiser and reseller who has flipped thousands of garments across Poshmark, eBay, Depop, ThredUp, The RealReal, Grailed, and Facebook Marketplace.

Do this in order:
1. Identify the garment from the photo: type, brand (only if actually visible on a tag/logo), apparent size or material clues, and condition.
2. Use web search to find REAL current listings for this exact item or the closest comparable items you can find on Depop, eBay, Poshmark, ThredUp, The RealReal, Grailed, or Facebook Marketplace. Search using the brand + item type + distinguishing details. Do at least 3-4 separate searches covering different platforms before pricing anything (e.g. "site:depop.com [brand] [item]", "[brand] [item] ebay sold", "[brand] [item] poshmark").
3. From those searches, pull out the actual individual listings you found — real titles, real prices, real platforms, real URLs — so a person can click through and see them for themselves.
4. Base every price figure on what you actually found in step 2-3 — not on a general assumption of what this "type" of item is worth. If you can't find close comps for a given platform, price it conservatively and say so in pricing_basis rather than inventing a number.

After searching, respond with ONLY raw JSON (no markdown fences, no commentary, no leading/trailing text, no text before or after the JSON object) matching exactly this schema:

{
  "item_type": "short garment name e.g. 'Denim jacket'",
  "brand_guess": "brand if visibly identifiable from logos/tags, else 'Not visible / unbranded'",
  "condition": "one of: New with tags, Excellent, Good, Fair, Worn",
  "condition_notes": "max 12 words on visible wear, flaws, or missing details",
  "value_low": integer USD,
  "value_high": integer USD,
  "recommended_list_price": integer USD,
  "pricing_basis": "one sentence on what real listings you actually found and searched, under 25 words",
  "confidence": "High, Medium, or Low, based on how many close comps you actually found",
  "comps": [
    {"platform": "site name e.g. eBay", "title": "the actual listing title you found, under 12 words", "price": integer USD, "url": "the real URL from your search results", "status": "one of: Active listing, Sold"}
  ],
  "marketplaces": [
    {"name": "one of the platforms listed above", "fit_reason": "max 8 words", "estimated_sale_price": integer USD (grounded in what you found for THIS platform, not a guess), "typical_fee_pct": integer, "estimated_net": integer USD (estimated_sale_price minus platform fee and, if relevant, typical shipping cost passed to seller)},
    {"name": "...", "fit_reason": "...", "estimated_sale_price": integer, "typical_fee_pct": integer, "estimated_net": integer},
    {"name": "...", "fit_reason": "...", "estimated_sale_price": integer, "typical_fee_pct": integer, "estimated_net": integer}
  ],
  "best_platform": "name of the platform from the list above with the highest estimated_net",
  "risks": ["max 5 short risk/authenticity/condition flags to check, each under 10 words"],
  "deal_comparison": {
    "instant_offer_estimate": integer USD (typical instant buyback offer, roughly 20-35% of resale value),
    "marketplace_net_estimate": integer USD (should equal the highest estimated_net among the marketplaces array),
    "verdict": "one sentence, under 20 words, on which option nets more for THIS item"
  }
}

Include 3 to 6 entries in "comps", covering at least 2 different platforms where possible, using only listings you genuinely found in search results — never invent a URL or a listing that wasn't in your search results. If you found real sold/completed listings, prefer including those over active asks and mark status "Sold". If the item is generic fast-fashion with no resale market to speak of, say so plainly in pricing_basis, keep comps to whatever generic comparables you found (or leave it a shorter list), and keep value_low/value_high low and honest rather than inflating it. Respond with the JSON object only, after you have finished searching.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. Verify the user's session token (sent from the browser after Supabase login)
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Please sign in to appraise an item.' });
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData || !userData.user) {
      return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
    }
    const userId = userData.user.id;

    // 2. Check the user's scan balance in the database
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('scan_balance')
      .eq('id', userId)
      .single();

    if (profileErr || !profile) {
      return res.status(400).json({ error: 'Could not load your account. Please try again.' });
    }

    if (profile.scan_balance !== -1 && profile.scan_balance <= 0) {
      return res.status(402).json({ error: 'No scans left. Please buy a pack or start a plan.' });
    }

    // 3. Validate the uploaded image
    const { base64, mediaType } = req.body || {};
    if (!base64 || !mediaType) {
      return res.status(400).json({ error: 'Missing image data.' });
    }

    // 4. Call Anthropic server-side, using the secret key (never exposed to the browser)
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: PROMPT }
          ]
        }]
      })
    });

    const data = await anthropicRes.json();

    if (data.error) {
      console.error('Anthropic API error:', data.error);
      return res.status(502).json({ error: "Couldn't complete the appraisal right now. Please try again." });
    }

    const textBlock = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text || '')
      .join('');

    const jsonMatch = textBlock.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(502).json({ error: "Couldn't read this photo clearly. Try a well-lit, single-item shot and retry." });
    }

    const parsed = JSON.parse(jsonMatch[0].replace(/```json|```/g, '').trim());

    // 5. Deduct one scan (unless unlimited plan) and persist the new balance
    let newBalance = profile.scan_balance;
    if (newBalance !== -1) {
      newBalance = newBalance - 1;
      await supabaseAdmin
        .from('profiles')
        .update({ scan_balance: newBalance })
        .eq('id', userId);
    }

    return res.status(200).json({ result: parsed, scan_balance: newBalance });

  } catch (err) {
    console.error('Appraise handler error:', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
