import axios from "axios";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export interface GeneratedQuizOption {
  text: string;
  is_correct: boolean;
}

export interface GeneratedQuizQuestion {
  text: string;
  time_limit: number;
  points: number;
  options: GeneratedQuizOption[];
}

export interface GeneratedQuizData {
  title: string;
  description: string;
  questions: GeneratedQuizQuestion[];
}

export interface AiQuizGenerateResult {
  reply: string;
  quiz: GeneratedQuizData;
  source: "gemini" | "local";
}

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_TIMEOUT_MS = 20000;

function getGeminiConfig(): { apiKey: string; model: string } | null {
  const env = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env;
  const apiKey = env?.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;

  return {
    apiKey,
    model: env?.GEMINI_MODEL?.trim() || "gemini-flash-latest",
  };
}

function buildThinkingConfig(model: string): Record<string, unknown> | null {
  if (/gemini-3/i.test(model)) return { thinkingLevel: "low" };
  if (/gemini-2\.5/i.test(model)) return { thinkingBudget: 0 };
  return null;
}

const QUIZ_JSON_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: {
      type: "STRING",
      description: "A friendly, upbeat 1-2 sentence assistant message summarizing the quiz created.",
    },
    quiz: {
      type: "OBJECT",
      description: "The generated quiz with title, description, and list of multiple-choice questions.",
      properties: {
        title: {
          type: "STRING",
          description: "Creative, catchy 2 to 6 word quiz title with relevant emoji (e.g. '⚡ Fullstack Trivia Blitz', '🎉 Pop Culture Showdown').",
        },
        description: {
          type: "STRING",
          description: "Engaging 1-2 sentence description explaining the quiz topic and inviting attendees to compete.",
        },
        questions: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              text: {
                type: "STRING",
                description: "The question statement. Clear, punchy, and engaging.",
              },
              time_limit: {
                type: "INTEGER",
                description: "Time limit in seconds. Allowed values: 15, 20, 30, 45, 60 (default 20 or 30).",
              },
              points: {
                type: "INTEGER",
                description: "Points rewarded for answering correctly (default 1000).",
              },
              options: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    text: {
                      type: "STRING",
                      description: "The option text (max 200 characters).",
                    },
                    is_correct: {
                      type: "BOOLEAN",
                      description: "True if this option is the correct answer, false otherwise.",
                    },
                  },
                  required: ["text", "is_correct"],
                },
                description: "EXACTLY 4 options, with EXACTLY ONE option having is_correct: true.",
              },
            },
            required: ["text", "options"],
          },
          description: "List of multiple-choice questions (default 3 to 5 questions).",
        },
      },
      required: ["title", "description", "questions"],
    },
  },
  required: ["reply", "quiz"],
};

/** Deterministic local generator for fallback or offline situations */
function generateLocalQuiz(params: {
  prompt: string;
  event: any;
  currentQuiz?: Partial<GeneratedQuizData>;
}): AiQuizGenerateResult {
  const prompt = params.prompt.trim().toLowerCase();
  const eventTitle = params.event?.title || "Community Event";

  // Check prompt keywords
  if (/(tech|code|react|javascript|python|web|program|cloud|ai|dev)/i.test(prompt)) {
    return {
      reply: "Here's a curated Tech & Developer Trivia quiz with 4 challenge questions!",
      quiz: {
        title: "⚡ Tech & Code Sprint Trivia",
        description: "Test your engineering mettle across frontend, algorithms, and web essentials!",
        questions: [
          {
            text: "Which of the following is NOT a JavaScript primitive data type?",
            time_limit: 20,
            points: 1000,
            options: [
              { text: "Object", is_correct: true },
              { text: "Symbol", is_correct: false },
              { text: "Boolean", is_correct: false },
              { text: "BigInt", is_correct: false },
            ],
          },
          {
            text: "What does CSS Flexbox's 'justify-content' property control?",
            time_limit: 20,
            points: 1000,
            options: [
              { text: "Alignment along the main axis", is_correct: true },
              { text: "Alignment along the cross axis", is_correct: false },
              { text: "Line wrapping behavior", is_correct: false },
              { text: "Text baseline alignment", is_correct: false },
            ],
          },
          {
            text: "Which HTTP status code signifies 'Created' for a successful resource write?",
            time_limit: 20,
            points: 1000,
            options: [
              { text: "201", is_correct: true },
              { text: "200", is_correct: false },
              { text: "204", is_correct: false },
              { text: "301", is_correct: false },
            ],
          },
          {
            text: "In React, what hook is used to perform side effects after rendering?",
            time_limit: 20,
            points: 1000,
            options: [
              { text: "useEffect", is_correct: true },
              { text: "useState", is_correct: false },
              { text: "useContext", is_correct: false },
              { text: "useMemo", is_correct: false },
            ],
          },
        ],
      },
      source: "local",
    };
  }

  if (/(movie|cinema|bollywood|hollywood|music|song|actor|film|entertainment)/i.test(prompt)) {
    return {
      reply: "Here is an exciting Entertainment & Cinema Quiz with 4 engaging questions!",
      quiz: {
        title: "🎬 Pop Culture & Cinema Mania",
        description: "A fun-filled trivia round covering movie magic, blockbusters, and iconic music moments!",
        questions: [
          {
            text: "Which movie won the Academy Award for Best Picture in 2024?",
            time_limit: 20,
            points: 1000,
            options: [
              { text: "Oppenheimer", is_correct: true },
              { text: "Barbie", is_correct: false },
              { text: "Killers of the Flower Moon", is_correct: false },
              { text: "Poor Things", is_correct: false },
            ],
          },
          {
            text: "In Bollywood, which movie famously features the line 'Mogambo khush hua'?",
            time_limit: 20,
            points: 1000,
            options: [
              { text: "Mr. India", is_correct: true },
              { text: "Sholay", is_correct: false },
              { text: "Don", is_correct: false },
              { text: "Deewaar", is_correct: false },
            ],
          },
          {
            text: "Which artist released the world record-breaking 'Eras Tour' concert film?",
            time_limit: 20,
            points: 1000,
            options: [
              { text: "Taylor Swift", is_correct: true },
              { text: "Beyoncé", is_correct: false },
              { text: "Billie Eilish", is_correct: false },
              { text: "Adele", is_correct: false },
            ],
          },
          {
            text: "Who played the superhero Iron Man in the Marvel Cinematic Universe?",
            time_limit: 20,
            points: 1000,
            options: [
              { text: "Robert Downey Jr.", is_correct: true },
              { text: "Chris Evans", is_correct: false },
              { text: "Chris Hemsworth", is_correct: false },
              { text: "Mark Ruffalo", is_correct: false },
            ],
          },
        ],
      },
      source: "local",
    };
  }

  // Default General / Event trivia
  const cleanTitle = prompt
    ? prompt
        .replace(/^(create|add|generate|make)\s+(a|an)?\s*/i, "")
        .split(/\s+/)
        .slice(0, 4)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
    : `${eventTitle} Quiz`;

  return {
    reply: `I have prepared a vibrant quiz on "${cleanTitle || eventTitle}" for your event participants!`,
    quiz: {
      title: `🎉 ${cleanTitle || "Community Trivia Blitz"}`,
      description: `Join in the excitement! Compete in this live trivia activity for "${eventTitle}".`,
      questions: [
        {
          text: `What is the primary theme or objective of ${eventTitle}?`,
          time_limit: 25,
          points: 1000,
          options: [
            { text: "Fostering community collaboration & learning", is_correct: true },
            { text: "Solo silent reading", is_correct: false },
            { text: "Watching pre-recorded infomercials", is_correct: false },
            { text: "Strict formal audits", is_correct: false },
          ],
        },
        {
          text: "Which of these is the most effective way to engage with other event attendees?",
          time_limit: 20,
          points: 1000,
          options: [
            { text: "Active participation and networking", is_correct: true },
            { text: "Remaining anonymous and silent", is_correct: false },
            { text: "Leaving immediately after arrival", is_correct: false },
            { text: "Ignoring session activities", is_correct: false },
          ],
        },
        {
          text: "What prize or recognition is typically celebrated at the end of interactive live quizzes?",
          time_limit: 20,
          points: 1000,
          options: [
            { text: "Top spots on the real-time leaderboard", is_correct: true },
            { text: "A chore assignment", is_correct: false },
            { text: "Account deactivation", is_correct: false },
            { text: "Nothing at all", is_correct: false },
          ],
        },
      ],
    },
    source: "local",
  };
}

export class AiQuizService {
  static async generate(params: {
    eventId: number;
    prompt: string;
    currentQuiz?: Partial<GeneratedQuizData>;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  }): Promise<AiQuizGenerateResult> {
    const { eventId, prompt, currentQuiz } = params;

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        type: true,
      },
    });

    if (!event) {
      throw new Error("Event not found");
    }

    const gemini = getGeminiConfig();
    if (!gemini) {
      return generateLocalQuiz({ prompt, event, currentQuiz });
    }

    try {
      const url = `${GEMINI_BASE_URL}/${gemini.model}:generateContent?key=${gemini.apiKey}`;
      const thinkingConfig = buildThinkingConfig(gemini.model);

      const systemInstruction = [
        `You are the Community Connect AI Live Quiz & Gamification Creator.`,
        `The event details are:`,
        `- Event Title: "${event.title}"`,
        `- Event Category: ${event.type?.name || "General"}`,
        `- Event Description: ${event.description || "N/A"}`,
        `- Event Mode: ${event.mode}`,
        ``,
        `YOUR MISSION: Generate an engaging, interactive multiple-choice quiz activity for event attendees (Kahoot-style live gamification) based on the user's prompt or voice transcript.`,
        ``,
        `CRITICAL RULES & FORMATTING:`,
        `1. QUIZ TITLE & DESCRIPTION:`,
        `   - 'title': Creative, catchy, 2 to 6 words with relevant emojis (e.g., '⚡ React & TypeScript Blitz', '🎬 90s Bollywood Rewind', '🚀 AI Innovation Challenge', '🎉 Friday Night Trivia Bash').`,
        `   - 'description': Engaging 1-2 sentence description inviting attendees to play and learn.`,
        `2. QUESTIONS (DEFAULT 3 TO 5 QUESTIONS UNLESS SPECIFIED):`,
        `   - Each question must be clear, well-phrased, and interesting.`,
        `   - 'time_limit': 15, 20, 30, 45, or 60 seconds (default 20 or 30).`,
        `   - 'points': default 1000.`,
        `   - 'options': EXACTLY 4 distinct, plausible options.`,
        `   - CRITICAL ANSWER RULE: EXACTLY ONE option in the options array MUST have 'is_correct: true'. The other 3 MUST have 'is_correct: false'.`,
        `3. REVISIONS & UPDATES:`,
        `   - If the user provides a prompt modifying an existing quiz draft (e.g. "change question 2 to ask about Python", "make the title funnier", "add another question"), adapt the quiz accordingly and preserve good existing questions unless instructed otherwise.`,
        `4. TONE & AUDIENCE:`,
        `   - Tailor the tone and difficulty to the topic and event theme (fun, inspiring, or technical).`,
        `5. 'reply': A friendly, upbeat 1-2 sentence assistant summary detailing the quiz topic and number of questions generated.`,
      ].join("\n");

      const contents = [
        ...(params.history || []).map((h) => ({
          role: h.role === "assistant" ? "model" : "user",
          parts: [{ text: h.content }],
        })),
        {
          role: "user",
          parts: [
            {
              text: [
                `Event Context: "${event.title}" (${event.type?.name || "General"})`,
                currentQuiz && currentQuiz.title
                  ? `Current Quiz Draft:\nTitle: ${currentQuiz.title}\nDescription: ${currentQuiz.description}\nCurrent Questions: ${JSON.stringify(
                      currentQuiz.questions
                    )}`
                  : null,
                `User Prompt: "${prompt}"`,
              ]
                .filter(Boolean)
                .join("\n\n"),
            },
          ],
        },
      ];

      const payload: Record<string, unknown> = {
        system_instruction: {
          parts: [{ text: systemInstruction }],
        },
        contents,
        generationConfig: {
          temperature: 0.7,
          responseMimeType: "application/json",
          responseSchema: QUIZ_JSON_SCHEMA,
          ...(thinkingConfig ? { thinkingConfig } : {}),
        },
      };

      const response = await axios.post(url, payload, {
        timeout: GEMINI_TIMEOUT_MS,
      });

      const candidate = response.data?.candidates?.[0];
      const text = candidate?.content?.parts?.[0]?.text;

      if (!text) {
        throw new Error("Empty response from AI model");
      }

      const parsed = JSON.parse(text);
      const rawQuiz = parsed.quiz || {};

      // Normalize questions to guarantee 4 options with exactly 1 correct answer
      const rawQuestions = Array.isArray(rawQuiz.questions) ? rawQuiz.questions : [];
      const questions: GeneratedQuizQuestion[] = rawQuestions.map(
        (q: any, qIdx: number): GeneratedQuizQuestion => {
          const rawOpts = Array.isArray(q.options) ? q.options : [];
          let opts: GeneratedQuizOption[] = rawOpts.map((o: any) => ({
            text: String(o.text || "").trim(),
            is_correct: Boolean(o.is_correct),
          }));

          // Ensure at least 4 options
          while (opts.length < 4) {
            opts.push({
              text: `Option ${opts.length + 1}`,
              is_correct: false,
            });
          }

          // If more than 4, take first 4
          if (opts.length > 4) {
            opts = opts.slice(0, 4);
          }

          // Ensure exactly one is_correct: true
          const correctCount = opts.filter((o) => o.is_correct).length;
          if (correctCount === 0) {
            opts[0].is_correct = true;
          } else if (correctCount > 1) {
            let firstFound = false;
            opts.forEach((o) => {
              if (o.is_correct) {
                if (!firstFound) firstFound = true;
                else o.is_correct = false;
              }
            });
          }

          return {
            text: String(q.text || `Question ${qIdx + 1}`).trim().slice(0, 500),
            time_limit: [15, 20, 30, 45, 60].includes(Number(q.time_limit))
              ? Number(q.time_limit)
              : 20,
            points: Number(q.points) || 1000,
            options: opts,
          };
        }
      );

      return {
        reply:
          String(parsed.reply || `Generated quiz "${rawQuiz.title || "Quiz"}" with ${questions.length} questions.`).trim(),
        quiz: {
          title: String(rawQuiz.title || "Live Trivia Quiz").trim().slice(0, 150),
          description: String(rawQuiz.description || "").trim(),
          questions: questions.length > 0 ? questions : generateLocalQuiz({ prompt, event }).quiz.questions,
        },
        source: "gemini",
      };
    } catch (err: any) {
      console.warn("Gemini quiz generation failed, using local fallback:", err?.message);
      return generateLocalQuiz({ prompt, event, currentQuiz });
    }
  }
}
