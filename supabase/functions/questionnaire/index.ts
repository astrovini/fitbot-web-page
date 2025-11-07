import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function calculateRiskLevel(score) {
  if (score >= 15) return 'low'
  if (score >= 8) return 'moderate'
  return 'high'
}

function calculateFitnessLevel(score) {
  if (score >= 28) return 5
  if (score >= 21) return 4
  if (score >= 14) return 3
  if (score >= 7) return 2
  return 1
}

async function calculateScores(supabaseClient, runId) {
  // Get answers for this run
  const { data: answers, error } = await supabaseClient
    .schema('questionnaire')
    .from('answers')
    .select('question_id, text_value, selected_values')
    .eq('run_id', runId)

  if (error) throw error

  // Get question keys and scoring info
  const questionIds = answers.map(a => a.question_id)
  const { data: questions, error: qError } = await supabaseClient
    .schema('questionnaire')
    .from('questions')
    .select('id, key, scoring_type, points_mapping')
    .in('id', questionIds)

  if (qError) throw qError

  let riskScore = 0
  let fitnessScore = 0

  // Calculate scores based on answers and database points_mapping
  for (const answer of answers) {
    const question = questions.find(q => q.id === answer.question_id)
    if (!question || !question.points_mapping) continue

    const value = answer.selected_values?.[0] || answer.text_value
    const points = question.points_mapping[value] || 0
    
    if (question.scoring_type === 'risk_factor') {
      riskScore += points
    } else if (question.scoring_type === 'fitness_level') {
      fitnessScore += points
    }
  }

  return {
    riskScore,
    fitnessScore,
    riskLevel: calculateRiskLevel(riskScore),
    fitnessLevel: calculateFitnessLevel(fitnessScore)
  }
}

async function updateUserMetrics(supabaseClient, runId, scores) {
  // Get user ID from run
  const { data: run, error: runError } = await supabaseClient
    .schema('questionnaire')
    .from('runs')
    .select('user_id')
    .eq('id', runId)
    .single()

  if (runError) throw runError

  // Update user's fitness level and risk factor
  const now = new Date().toISOString()
  await supabaseClient
    .from('Users')
    .update({
      fitness_level: scores.fitnessLevel,
      fitness_level_updated_at: now,
      risk_factor: scores.riskLevel,
      risk_factor_updated_at: now
    })
    .eq('id', run.user_id)

  // Add to fitness history
  await supabaseClient
    .from('fitness_history')
    .insert({
      user_id: run.user_id,
      fitness_level: scores.fitnessLevel,
      risk_factor: scores.riskLevel,
      fitness_level_score: scores.fitnessScore,
      risk_factor_score: scores.riskScore,
      questionnaire_run_id: runId
    })
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

    const { action, userId, answers, runId, status } = await req.json()

    if (action === 'getStatus') {
      // Check user's questionnaire status
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
        .select('id, status, started_at, submitted_at')
        .eq('user_id', userId)
        .eq('form_id', form.id)
        .order('started_at', { ascending: false })
        .limit(1)

      if (runError) throw runError

      if (!runs || runs.length === 0) {
        return new Response(JSON.stringify({ status: 'not_started' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const run = runs[0]
      return new Response(JSON.stringify({ 
        status: run.status === 'submitted' ? 'completed' : 'in_progress',
        run: run
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (action === 'getExistingRun') {
      // Get existing run with answers
      const { data: form, error: formError } = await supabaseClient
        .schema('questionnaire')
        .from('forms')
        .select('id')
        .eq('slug', 'onboarding_v1')
        .single()

      if (formError) throw formError

      const { data: run, error: runError } = await supabaseClient
        .schema('questionnaire')
        .from('runs')
        .select('id, status, started_at, submitted_at')
        .eq('user_id', userId)
        .eq('form_id', form.id)
        .order('started_at', { ascending: false })
        .limit(1)
        .single()

      if (runError) throw runError

      // Get existing answers
      const { data: answers, error: answersError } = await supabaseClient
        .schema('questionnaire')
        .from('answers')
        .select('question_id, text_value, selected_values')
        .eq('run_id', run.id)

      if (answersError) throw answersError

      return new Response(JSON.stringify({ run: run, answers: answers }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (action === 'getForm') {
      // Get complete form structure
      const { data: form, error: formError } = await supabaseClient
        .schema('questionnaire')
        .from('forms')
        .select('id, title')
        .eq('slug', 'onboarding_v1')
        .single()

      if (formError) throw formError

      const { data: sections, error: sectionsError } = await supabaseClient
        .schema('questionnaire')
        .from('sections')
        .select('id, title, sort_order')
        .eq('form_id', form.id)
        .order('sort_order')

      if (sectionsError) throw sectionsError

      const { data: questions, error: questionsError } = await supabaseClient
        .schema('questionnaire')
        .from('questions')
        .select('id, section_id, key, prompt, type, required, options, sort_order')
        .in('section_id', sections.map(s => s.id))
        .order('sort_order')

      if (questionsError) throw questionsError

      // Group questions by section
      const formWithSections = {
        ...form,
        sections: sections.map(section => ({
          ...section,
          questions: questions.filter(q => q.section_id === section.id)
        }))
      }

      return new Response(JSON.stringify({ form: formWithSections }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (action === 'startRun') {
      console.log('startRun called with userId:', userId);
      
      // Get form ID using questionnaire schema
      const { data: form, error: formError } = await supabaseClient
        .schema('questionnaire')
        .from('forms')
        .select('id')
        .eq('slug', 'onboarding_v1')
        .single()

      console.log('Form query result:', { form, formError });

      if (formError || !form) {
        throw new Error(`Form not found: ${formError?.message || 'No form returned'}`);
      }

      // Check existing run
      const { data: existingRuns, error: runError } = await supabaseClient
        .schema('questionnaire')
        .from('runs')
        .select('id, status')
        .eq('user_id', userId)
        .eq('form_id', form.id)
        .order('started_at', { ascending: false })
        .limit(1)

      console.log('Existing runs query:', { existingRuns, runError });

      if (existingRuns && existingRuns.length > 0) {
        return new Response(JSON.stringify({ run: existingRuns[0] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Create new run
      const { data: newRun, error: createError } = await supabaseClient
        .schema('questionnaire')
        .from('runs')
        .insert([{ user_id: userId, form_id: form.id }])
        .select()
        .single()

      console.log('Create run result:', { newRun, createError });

      if (createError) throw createError

      return new Response(JSON.stringify({ run: newRun }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (action === 'saveAnswers') {
      console.log('saveAnswers called with runId:', runId, 'answers:', answers, 'status:', status);
      
      // Delete existing answers for this run
      await supabaseClient
        .schema('questionnaire')
        .from('answers')
        .delete()
        .eq('run_id', runId)

      // Insert new answers
      if (answers && answers.length > 0) {
        const { error } = await supabaseClient
          .schema('questionnaire')
          .from('answers')
          .insert(answers)

        if (error) throw error
      }

      // Update run status
      const updateData = { status: status || 'in_progress' }
      if (status === 'submitted') {
        updateData.submitted_at = new Date().toISOString()
        
        // Calculate scores if questionnaire is submitted
        const scores = await calculateScores(supabaseClient, runId)
        updateData.risk_factor_score = scores.riskScore
        updateData.fitness_level_score = scores.fitnessScore
        updateData.calculated_risk_level = scores.riskLevel
        updateData.calculated_fitness_level = scores.fitnessLevel
        
        // Update user's fitness level and risk factor
        await updateUserMetrics(supabaseClient, runId, scores)
      }

      await supabaseClient
        .schema('questionnaire')
        .from('runs')
        .update(updateData)
        .eq('id', runId)

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    throw new Error('Invalid action')

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
