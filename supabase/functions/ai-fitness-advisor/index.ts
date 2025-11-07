import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not found in environment')
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )

    const { userId, testMode = false, testPrompt } = await req.json()

    let prompt = ''
    let user = null

    if (testMode) {
      // Test mode - use provided prompt or default
      prompt = testPrompt || 'Say hello world'
      user = { name: 'Test', surname: 'User' }
    } else {
      // Production mode - get user data and create fitness prompt
      if (!userId) {
        throw new Error('userId is required for production mode')
      }

      const { data: userData, error } = await supabaseClient
        .from('Users')
        .select('name, surname, height, weight, age, fitness_level, risk_factor')
        .eq('id', userId)
        .single()

      if (error) throw error
      user = userData

      // Calculate BMI
      const heightInMeters = user.height / 100
      const bmi = user.weight / (heightInMeters * heightInMeters)
      
      let category = ''
      if (bmi < 18.5) category = 'Underweight'
      else if (bmi < 25) category = 'Normal weight'
      else if (bmi < 30) category = 'Overweight'
      else category = 'Obese'

      // Create comprehensive fitness prompt
      prompt = `Create a personalized fitness plan for:
- Name: ${user.name} ${user.surname}
- Age: ${user.age}
- BMI: ${bmi.toFixed(1)} (${category})
- Fitness Level: ${user.fitness_level}/5 (1=Beginner, 5=Advanced)
- Risk Factor: ${user.risk_factor} risk
- Height: ${user.height}cm, Weight: ${user.weight}kg

Please provide:
1. Weekly workout schedule
2. Exercise recommendations based on fitness level
3. Safety considerations based on risk factor
4. Progression plan
5. Nutrition tips

Keep it practical and actionable.`
    }

    // Call OpenAI API
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: prompt
        }],
        max_tokens: testMode ? 50 : 1500,
        temperature: 0.7
      })
    })

    const aiData = await openaiResponse.json()

    // Handle API errors
    if (!openaiResponse.ok || !aiData.choices || !aiData.choices[0]) {
      return new Response(
        JSON.stringify({
          error: "OpenAI API error",
          status: openaiResponse.status,
          details: aiData,
          success: false
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        },
      )
    }

    const response = {
      success: true,
      user: `${user.name} ${user.surname}`,
      aiRecommendations: aiData.choices[0].message.content,
      testMode,
      ...(testMode && {
        fullResponse: aiData,
        prompt: prompt,
        usage: aiData.usage
      })
    }

    return new Response(
      JSON.stringify(response),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: error.message,
        success: false 
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      },
    )
  }
})
