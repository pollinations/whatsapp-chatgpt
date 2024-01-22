import fetch from 'node-fetch';

/**
 * @param text The sentence to be converted to speech
 * @returns Audio buffer
 */
async function ttsRequest(text: string): Promise<Buffer | null> {
	const url = `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}`;

	const apiKey = process.env.ELEVENLABS_API_KEY;
	if (!apiKey) {
		throw new Error('ELEVENLABS_API_KEY is not defined');
	}

	const headers = {
		"Accept": "audio/mpeg",
		"Content-Type": "application/json",
		"xi-api-key": apiKey
	};

	const data = {
		"text": text,
		"model_id": "eleven_multilingual_v2",
		"voice_settings": {
			"stability": 0.5,
			"similarity_boost": 0.7
		}
	};

	try {
		const response = await fetch(url, {
			method: 'POST',
			body: JSON.stringify(data),
			headers: headers
		});

		if (!response.ok) {
			console.error("An error occured (TTS request)", response.statusText);
			return null;
		}

		const buffer = await response.buffer();
		return buffer;
	} catch (error) {
		console.error("An error occured (TTS request)", error);
		return null;
	}
}

export { ttsRequest };
