/**
 * Vercel Serverless Function to securely proxy requests to the Gemini API.
 * This file MUST be saved as 'api/generate.js' in your repository root.
 * It accesses the GEMINI_API_KEY environment variable securely on the server.
 */
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = 'gemini-2.5-flash-preview-05-20';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent`;

// Helper to implement exponential backoff for retries
const fetchWithRetry = async (url, options, retries = 3) => {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.status !== 429) { // Not a rate limit error, proceed
                return response;
            }
            // Rate limit hit (429), wait before retrying
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
        } catch (error) {
            // Non-429 error, wait before trying again
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
        }
    }
    throw new Error('API request failed after multiple retries.');
};

module.exports = async (req, res) => {
    // 1. Check for API Key
    if (!API_KEY) {
        // This error will confirm if the key is missing in Vercel's env variables
        res.status(500).json({ error: 'GEMINI_API_KEY environment variable is not set on the Vercel server.' });
        return;
    }

    // 2. Parse Request Body (from the frontend)
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
        return;
    }

    const { prompt } = req.body;

    if (!prompt) {
        res.status(400).json({ error: 'Missing "prompt" in request body.' });
        return;
    }

    // 3. Construct Gemini API Payload
    const payload = {
        contents: [{ parts: [{ text: prompt }] }],
    };

    // 4. Call the Google API securely
    try {
        const fetchOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        };
        
        // Use the API Key in the query string
        const response = await fetchWithRetry(`${API_URL}?key=${API_KEY}`, fetchOptions);

        const result = await response.json();

        // Check for common API errors in the response body
        if (result.error) {
            // Forward the API error back to the client
            res.status(result.error.code || 500).json({ error: result.error.message });
            return;
        }

        const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "Generation failed to return text.";

        // 5. Send successful response back to the client
        res.status(200).json({ text: text });

    } catch (error) {
        console.error('Error during Gemini API call:', error.message);
        res.status(500).json({ error: `Internal Server Error: ${error.message}` });
    }
};

