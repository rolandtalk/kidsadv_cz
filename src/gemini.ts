export interface StoryConfig {
  theme: string;
  protagonistName: string;
  protagonistDescription: string;
  companionName?: string;
  companionDescription?: string;
  specialTool?: string;
  pagesCount: number;
  tone: string;
  ageGroup: string;
  illustrationStyle?: 'fairy' | 'simple_strokes';
}

export interface StoryPage {
  pageNumber: number;
  storyText: string;
  illustrationPrompt: string;
}

export interface GeneratedBook {
  title: string;
  pages: StoryPage[];
}

type GeminiPart = {
  inlineData?: {
    mimeType: string;
    data: string;
  };
};

async function getGeminiErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return response.statusText || 'Unknown error';

  try {
    const data = JSON.parse(text);
    return data.error?.message || data.error || text;
  } catch (error) {
    console.warn('Failed to parse Gemini error response:', error);
    return text;
  }
}

export async function generateStory(apiKey: string, config: StoryConfig, model: string = 'gemini-2.5-flash'): Promise<GeneratedBook> {
  const url = `/api/generate-story`;

  const companionSection = config.companionName 
    ? `- Companion Name: ${config.companionName}\n- Companion Description: ${config.companionDescription || 'N/A'}`
    : '';

  const toolSection = config.specialTool 
    ? `- Special Tool/Item: ${config.specialTool}`
    : '';

  const stylePromptPart = config.illustrationStyle === 'simple_strokes'
    ? "minimalist simple black ink outline sketch on a clean solid white background, cute childlike marker doodle style, simple strokes, black ink on white paper, no color, no background detail"
    : "whimsical watercolor illustration or children's book art";

  const promptText = `
Write an illustrated children's adventure book with the following details:
- Theme/Genre: ${config.theme}
- Tone: ${config.tone}
- Target Age Group: ${config.ageGroup}
- Number of Pages: ${config.pagesCount}
- Protagonist Name: ${config.protagonistName}
- Protagonist Description: ${config.protagonistDescription}
${companionSection}
${toolSection}

Guidelines:
1. Break the story down into exactly ${config.pagesCount} sequential pages.
2. For each page, write 2-4 sentences of storytelling text suitable for the target age group.
3. For each page, provide a detailed image generation prompt for the illustration. The image prompt MUST include the protagonist's physical description: "${config.protagonistDescription}" (and companion if applicable) to ensure visual consistency. Specify a style aligned with: ${stylePromptPart}.
4. Output the result in JSON format matching the schema.
  `.trim();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['x-gemini-api-key'] = apiKey;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      payload: {
        contents: [
          {
            parts: [
              {
                text: promptText,
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              title: { type: 'STRING' },
              pages: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    pageNumber: { type: 'INTEGER' },
                    storyText: { type: 'STRING' },
                    illustrationPrompt: { type: 'STRING' },
                  },
                  required: ['pageNumber', 'storyText', 'illustrationPrompt'],
                },
              },
            },
            required: ['title', 'pages'],
          },
        },
      }
    }),
  });

  if (!response.ok) {
    const errorText = await getGeminiErrorMessage(response);
    throw new Error(`Gemini API Error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  try {
    const jsonText = data.candidates[0].content.parts[0].text;
    return JSON.parse(jsonText) as GeneratedBook;
  } catch (e) {
    console.error('Failed to parse Gemini response text:', data);
    throw new Error('Failed to parse story JSON from Gemini API response.', { cause: e });
  }
}

export async function generateImage(apiKey: string, prompt: string, model: string = 'gemini-3-pro-image'): Promise<string> {
  const url = `/api/generate-image`;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (apiKey) {
    headers['x-gemini-api-key'] = apiKey;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      payload: {
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ]
      }
    })
  });

  if (!response.ok) {
    const errorText = await getGeminiErrorMessage(response);
    throw new Error(`Gemini Image Error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts as GeminiPart[] | undefined;
  const inlineData = parts?.find((part) => part.inlineData)?.inlineData;
  
  if (!inlineData || !inlineData.data) {
    throw new Error("No image data returned from Gemini");
  }

  return `data:${inlineData.mimeType};base64,${inlineData.data}`;
}

export async function searchLexicaImage(prompt: string): Promise<string> {
  // Use a shorter version of the prompt if it's too long, focusing on key elements
  const cleanPrompt = prompt.split(',')[0].slice(0, 100);
  const url = `/api/search-lexica?q=${encodeURIComponent(cleanPrompt)}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`Lexica API returned status ${response.status}. Falling back to Pollinations AI.`);
      return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=800&height=600&nologo=true&seed=${Math.floor(Math.random() * 1000000)}`;
    }

    const data = await response.json();
    if (data.images && data.images.length > 0) {
      // Select one of the top 3 images for some variety
      const randomIndex = Math.min(Math.floor(Math.random() * 3), data.images.length - 1);
      return data.images[randomIndex].src;
    }
    throw new Error("No images found matching prompt on Lexica");
  } catch (e) {
    console.warn("Lexica search failed. Falling back to Pollinations AI:", e);
    return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=800&height=600&nologo=true&seed=${Math.floor(Math.random() * 1000000)}`;
  }
}
