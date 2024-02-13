import fetch from 'node-fetch';
import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';

dotenv.config();

/**
 * @param prompt The prompt for generating music
 * @returns The path to the downloaded generated music track
 */
const generateAudio = async (prompt: string): Promise<string | null> => {
  prompt = prompt.slice(0,300)
  const url = `https://api.replicate.com/v1/predictions`;

  const apiKey = process.env.REPLICATE_API_TOKEN;
  if (!apiKey) {
    throw new Error('REPLICATE_API_TOKEN is not defined');
  }

  const headers = {
    "Authorization": `Token ${apiKey}`,
    "Content-Type": "application/json"
  };

  const data = {
    "version": "e8e2ecd4a1dabb58924aa8300b668290cafae166dd36baf65dad9875877de50e",
    "input": {
      "prompt": prompt,
      "variations": 1,
      "model": "facebook/audio-magnet-medium"
    }
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(data),
      headers: headers
    });

    if (!response.ok) {
      console.error("An error occurred (Music generation request)", response.statusText);
      return null;
    }

    const prediction = await response.json();
    const predictionId = prediction.id;
    let outputUrl = null;

    while (!outputUrl) {
      const statusResponse = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
        headers: headers
      });
      const statusJson = await statusResponse.json();
      if (statusJson.output) {
        outputUrl = statusJson.output[0];
        break;
      }
      // Poll every 5 seconds
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // Download the audio file
    const audioResponse = await fetch(outputUrl);
    if (!audioResponse.ok) {
      console.error("Failed to download the audio file", audioResponse.statusText);
      return null;
    }
    const buffer = await audioResponse.buffer();
    const tempDir = os.tmpdir();
    const filePath = path.join(tempDir, `generated_audio_${Date.now()}.wav`);
    fs.writeFileSync(filePath, buffer);

    return filePath;
  } catch (error) {
    console.error("An error occurred (Music generation request)", error);
    return null;
  }
};

(async () => {
  try {
    const prompt = "Generate a soothing music track for meditation.";
    const musicFilePath = await generateAudio(prompt);
    console.log("Generated Music File Path:", musicFilePath);
  } catch (error) {
    console.error("Error generating music:", error);
  }
})();

export { generateAudio };
