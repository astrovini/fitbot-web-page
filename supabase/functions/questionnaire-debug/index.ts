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
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { userId } = await req.json()

    // Get latest run for user
    const { data: form, error: formError } = await supabaseClient
      .schema('questionnaire')
      .from('forms')
      .select('id')
      .eq('slug', 'onboarding_v1')
      .single()

    if (formError) throw formError

    const { data: runs, error: runError } = await supabaseClient
      .schema('questionnaire')
      .from('runs')
      .select('*')
      .eq('user_id', userId)
      .eq('form_id', form.id)
      .order('started_at', { ascending: false })
      .limit(1)

    if (runError) throw runError
    if (!runs || runs.length === 0) throw new Error('No questionnaire runs found')

    const run = runs[0]

    // Get answers for this run
    const { data: answers, error: answersError } = await supabaseClient
      .schema('questionnaire')
      .from('answers')
      .select('question_id, text_value, selected_values')
      .eq('run_id', run.id)

    if (answersError) throw answersError

    // Get questions with scoring info
    const questionIds = answers.map(a => a.question_id)
    const { data: questions, error: questionsError } = await supabaseClient
      .schema('questionnaire')
      .from('questions')
      .select('id, key, prompt, scoring_type, points_mapping')
      .in('id', questionIds)

    if (questionsError) throw questionsError

    // Debug scoring calculation
    let riskScore = 0
    let fitnessScore = 0
    const debugInfo = []

    for (const answer of answers) {
      const question = questions.find(q => q.id === answer.question_id)
      if (!question) continue

      const value = answer.selected_values?.[0] || answer.text_value
      const points = question.points_mapping?.[value] || 0
      
      debugInfo.push({
        question: question.prompt,
        key: question.key,
        scoring_type: question.scoring_type,
        answer: value,
        points_mapping: question.points_mapping,
        points_awarded: points
      })

      if (question.scoring_type === 'risk_factor') {
        riskScore += points
      } else if (question.scoring_type === 'fitness_level') {
        fitnessScore += points
      }
    }

    // Calculate levels
    let riskLevel = 'high'
    if (riskScore >= 15) riskLevel = 'low'
    else if (riskScore >= 8) riskLevel = 'moderate'

    let fitnessLevel = 1
    if (fitnessScore >= 28) fitnessLevel = 5
    else if (fitnessScore >= 21) fitnessLevel = 4
    else if (fitnessScore >= 14) fitnessLevel = 3
    else if (fitnessScore >= 7) fitnessLevel = 2

    return new Response(JSON.stringify({
      run_info: run,
      total_answers: answers.length,
      risk_score: riskScore,
      fitness_score: fitnessScore,
      calculated_risk_level: riskLevel,
      calculated_fitness_level: fitnessLevel,
      debug_scoring: debugInfo
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      },
    )
  }
})
