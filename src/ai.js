'use strict';

const Anthropic = require('@anthropic-ai/sdk');

let client;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

// ─── Expert Questions ─────────────────────────────────────────────────────────

async function generateExpertQuestions(playerList, count = 3) {
  // playerList: [{ id, name, expertise }]
  if (!playerList.length) return {};

  const promptLines = playerList.map(p =>
    `Player "${p.name}" (ID: ${p.id}) claims expertise in: ${p.expertise}`
  ).join('\n');

  const prompt = `You are writing questions for a party drinking game. For EACH player below, generate ${count} multiple-choice question(s) that TEST their specific declared expertise — the question MUST be directly about that exact topic. For example, if someone declares expertise in "math", ask a math question. If they declare "90s hip-hop", ask about 90s hip-hop. The question should be something a genuine expert in THAT SPECIFIC TOPIC would know, but others at the party would likely get wrong. Keep it fun and slightly humiliating to get wrong.

Players:
${promptLines}

Return ONLY a JSON object in this exact format (no markdown, no explanation):
{
  "<player_id>": [
    {
      "question": "...",
      "choices": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "correctIndex": 0
    }
  ]
}

Rules:
- correctIndex is 0-indexed (0=A, 1=B, 2=C, 3=D)
- Each player gets exactly ${count} question(s)
- The question MUST be about the player's declared expertise topic — do not use generic trivia
- Questions should be answerable in 20-30 seconds
- Make wrong answers plausible but clearly wrong to a real expert`;

  try {
    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = response.content[0].text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const result = JSON.parse(raw);

    // Validate structure
    for (const player of playerList) {
      if (!Array.isArray(result[player.id])) {
        throw new Error(`Missing questions for player ${player.id}`);
      }
    }
    return result;
  } catch (err) {
    console.error('AI expert question generation failed, using fallbacks:', err.message);
    return generateFallbackExpertQuestions(playerList, count);
  }
}

// ─── Trivia Questions ─────────────────────────────────────────────────────────

async function generateTriviaQuestions(count = 10, expertiseList = []) {
  const avoidTopics = expertiseList.length
    ? `Avoid these topics (they are players' declared expertise areas): ${expertiseList.join(', ')}.`
    : '';

  const prompt = `Generate ${count} multiple-choice trivia questions for a party drinking game. Mix categories: pop culture, history, science, sports, food & drink, geography, movies, music. Keep them fun and accessible but not trivially easy.

${avoidTopics}

Return ONLY a JSON array in this exact format (no markdown, no explanation):
[
  {
    "question": "...",
    "choices": ["A. ...", "B. ...", "C. ...", "D. ..."],
    "correctIndex": 0,
    "category": "Pop Culture"
  }
]

Rules:
- correctIndex is 0-indexed (0=A, 1=B, 2=C, 3=D)
- Exactly ${count} questions
- Each from a different category when possible
- Fun, engaging, party-appropriate`;

  try {
    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = response.content[0].text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const result = JSON.parse(raw);
    if (!Array.isArray(result) || result.length < count) {
      throw new Error('Invalid trivia response shape');
    }
    return result;
  } catch (err) {
    console.error('AI trivia generation failed, using fallbacks:', err.message);
    return generateFallbackTrivia(count);
  }
}

// ─── Fallbacks ────────────────────────────────────────────────────────────────

function generateFallbackExpertQuestions(playerList, count) {
  const genericQuestions = [
    {
      question: "Which of these is considered the most fundamental skill in any field of expertise?",
      choices: ["A. Memorization", "B. Pattern recognition", "C. Speed", "D. Luck"],
      correctIndex: 1
    },
    {
      question: "What percentage of experts agree that practice is key to mastery?",
      choices: ["A. 50%", "B. 70%", "C. 90%", "D. 100%"],
      correctIndex: 2
    },
    {
      question: "According to research, how many hours does it take to become an expert in a skill?",
      choices: ["A. 100 hours", "B. 1,000 hours", "C. 10,000 hours", "D. 100,000 hours"],
      correctIndex: 2
    },
    {
      question: "Which famous expert said 'The more I practice, the luckier I get'?",
      choices: ["A. Tiger Woods", "B. Gary Player", "C. Jack Nicklaus", "D. Arnold Palmer"],
      correctIndex: 1
    },
    {
      question: "What is the term for the period when a beginner thinks they know everything?",
      choices: ["A. Expert gap", "B. Dunning-Kruger effect", "C. Beginner's luck", "D. Overconfidence bias"],
      correctIndex: 1
    }
  ];

  const result = {};
  for (const player of playerList) {
    result[player.id] = genericQuestions.slice(0, count).map(q => ({ ...q }));
  }
  return result;
}

function generateFallbackTrivia(count) {
  const questions = [
    { question: "What is the capital of Australia?", choices: ["A. Sydney", "B. Melbourne", "C. Canberra", "D. Brisbane"], correctIndex: 2, category: "Geography" },
    { question: "How many strings does a standard guitar have?", choices: ["A. 4", "B. 5", "C. 6", "D. 7"], correctIndex: 2, category: "Music" },
    { question: "What year did the Titanic sink?", choices: ["A. 1908", "B. 1912", "C. 1916", "D. 1920"], correctIndex: 1, category: "History" },
    { question: "Which planet is known as the Red Planet?", choices: ["A. Venus", "B. Jupiter", "C. Saturn", "D. Mars"], correctIndex: 3, category: "Science" },
    { question: "In which sport would you perform a 'slam dunk'?", choices: ["A. Football", "B. Basketball", "C. Volleyball", "D. Tennis"], correctIndex: 1, category: "Sports" },
    { question: "What is the main ingredient in guacamole?", choices: ["A. Tomato", "B. Lime", "C. Avocado", "D. Jalapeño"], correctIndex: 2, category: "Food & Drink" },
    { question: "Who played Iron Man in the MCU?", choices: ["A. Chris Evans", "B. Chris Hemsworth", "C. Robert Downey Jr.", "D. Mark Ruffalo"], correctIndex: 2, category: "Pop Culture" },
    { question: "How many sides does a hexagon have?", choices: ["A. 5", "B. 6", "C. 7", "D. 8"], correctIndex: 1, category: "Math" },
    { question: "Which country invented champagne?", choices: ["A. Italy", "B. Spain", "C. Germany", "D. France"], correctIndex: 3, category: "Food & Drink" },
    { question: "What is the fastest land animal?", choices: ["A. Lion", "B. Cheetah", "C. Jaguar", "D. Leopard"], correctIndex: 1, category: "Science" },
    { question: "Which city hosted the 2012 Summer Olympics?", choices: ["A. Paris", "B. Beijing", "C. London", "D. Rio"], correctIndex: 2, category: "Sports" },
    { question: "What color is the Monopoly 'Go to Jail' space?", choices: ["A. Red", "B. Blue", "C. Yellow", "D. Orange"], correctIndex: 0, category: "Pop Culture" }
  ];

  // Shuffle and return requested count
  const shuffled = [...questions].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

module.exports = { generateExpertQuestions, generateTriviaQuestions };
