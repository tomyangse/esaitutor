import { kv } from '@vercel/kv';

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).end();
    }

    const { question } = request.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return response.status(500).json({ error: "API key is not configured." });
    }
    if (!question || typeof question !== 'string' || question.trim() === '') {
        return response.status(400).json({ error: "Question is required." });
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
    
    // 为AI老师设定清晰的人设和指令
    const systemPrompt = `You are a friendly, patient, and highly knowledgeable Spanish language tutor. Your student is a beginner learning Spanish. Your task is to answer their questions about the Spanish language. 
- Respond in clear, easy-to-understand Chinese.
- Keep your answers concise but thorough.
- If the question is a single word, explain its meaning and provide an example sentence.
- If the question is about grammar, explain the rule simply and provide clear examples.
- Be encouraging and maintain a positive tone.`;

    const payload = {
        contents: [{
            parts: [{ text: question }]
        }],
        systemInstruction: {
            parts: [{ text: systemPrompt }]
        }
    };

    try {
        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!geminiResponse.ok) {
            throw new Error(`Gemini API request failed with status ${geminiResponse.status}`);
        }

        const result = await geminiResponse.json();
        const answer = result.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (answer) {
            response.status(200).json({ answer: answer });
        } else {
            throw new Error("Invalid response structure from Gemini API");
        }
    } catch (error) {
        console.error("Error calling Gemini API:", error);
        response.status(500).json({ error: "Failed to get an answer from the AI tutor." });
    }
}
