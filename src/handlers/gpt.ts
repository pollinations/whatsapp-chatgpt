import os from "os";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { Message, MessageMedia } from "whatsapp-web.js";
import { chatgpt } from "../providers/openai";
import * as cli from "../cli/ui";
import config from "../config";
import ffmpeg from "fluent-ffmpeg";

import { ChatMessage } from "chatgpt";

// TTS
import { ttsRequest as speechTTSRequest } from "../providers/speech";
import { ttsRequest as awsTTSRequest } from "../providers/aws";
import { ttsRequest as elevenlabsTTSRequest } from "../providers/elevenlabs";

import { TTSMode } from "../types/tts-mode";

// Moderation
import { moderateIncomingPrompt } from "./moderation";
import { aiConfig, getConfig } from "./ai-config";
import { generateAudio } from "../providers/musicgen";

// Mapping from number to last conversation id
const conversations = {};
console.log("pre prompt", process.env.PRE_PROMPT)
console.log(process.env.PRE_PROMPT)
// process.exit(0)
const handleMessageGPT = async (message: Message, prompt: string) => {
	console.log("message", message["_data"]);
	try {
		// Get last conversation
		const lastConversationId = conversations[message.from];

		cli.print(`[GPT] Received prompt from ${message.from}: ${prompt}`);

		// Prompt Moderation
		if (config.promptModerationEnabled) {
			try {
				await moderateIncomingPrompt(prompt);
			} catch (error: any) {
				message.reply(error.message);
				return;
			}
		}

		const start = Date.now();

		// Check if we have a conversation with the user
		let response: ChatMessage;
		if (lastConversationId) {
			// Handle message with previous conversation
			// log prompt
			cli.print(`[GPT] Continuing conversation with ${message.from} (ID: ${lastConversationId})`);
			cli.print(`[GPT] Prompt: ${prompt}`);
			response = await chatgpt.sendMessage(prompt, {
				parentMessageId: lastConversationId,
				name: sanitizeName(message["_data"]?.notifyName),
			});
		} else {
			let promptBuilder = "";

			// Pre prompt
			if (config.prePrompt != null && config.prePrompt.trim() != "") {
				promptBuilder += config.prePrompt + "\n\n";
			}
			promptBuilder += prompt + "\n\n";

			// Handle message with new conversation
			// log prompt
			cli.print(`[GPT] Starting new conversation with ${message.from}`);
			cli.print(`[GPT] Prompt: ${prompt}`);
			response = await chatgpt.sendMessage(promptBuilder,{
				name: sanitizeName(message["_data"]?.notifyName),
			});

			cli.print(`[GPT] New conversation for ${message.from} (ID: ${response.id})`);
		}
		
		// Set conversation id
		conversations[message.from] = response.id;

		const end = Date.now() - start;

		cli.print(`[GPT] Answer to ${message.from}: ${response.text}  | OpenAI request took ${end}ms)`);

		// TTS reply (Default: disabled)
		if (getConfig("tts", "enabled")){ // && message.type !== "chat") {
			sendVoiceMessageReply(message, response.text);
			// message.reply(response.text);
			return;
		}

		// Default: Text reply
		message.reply(response.text);
	} catch (error: any) {
		console.error("An error occured", error);
		message.reply("An error occured, please contact the administrator. (" + error.message + ")");
	}
};

const handleDeleteConversation = async (message: Message) => {
	// Delete conversation
	delete conversations[message.from];

	// Reply
	message.reply("Conversation context was resetted!");
};

async function sendVoiceMessageReply(message: Message, gptTextResponse: string) {
	let logTAG = "[TTS]";
	let ttsRequestFunction;

	switch (config.ttsMode) {
		case TTSMode.SpeechAPI:
			logTAG = "[SpeechAPI]";
			ttsRequestFunction = speechTTSRequest;
			break;
		case TTSMode.AWSPolly:
			logTAG = "[AWSPolly]";
			ttsRequestFunction = awsTTSRequest;
			break;
		case TTSMode.ElevenLabs:
			logTAG = "[ElevenLabs]";
			ttsRequestFunction = elevenlabsTTSRequest;
			break;
		default:
			logTAG = "[SpeechAPI]";
			ttsRequestFunction = speechTTSRequest;
			break;
	}

	// Start generating audio and TTS request in parallel
	cli.print(`${logTAG} Generating audio from GPT response "${gptTextResponse}"...`);
	const [audioBuffer, audioFile] = await Promise.all([
		ttsRequestFunction(gptTextResponse),
		generateAudio(gptTextResponse)
	]);

	// Check if audio buffer is valid
	if (audioBuffer == null || audioBuffer.length == 0) {
		message.reply(`${logTAG} couldn't generate audio, please contact the administrator.`);
		return;
	}

	if (!audioFile) {
		throw new Error("could not get generated audio");
	}

	cli.print(`${logTAG} Audio generated!`);

	// Get temp folder and file path
	const tempFolder = os.tmpdir();
	const tempFilePath = path.join(tempFolder, randomUUID() + ".opus");

	// Save buffer to temp file
	fs.writeFileSync(tempFilePath, audioBuffer);
	// Process audio with ffmpeg to add reverb and get new file path
	const reverbFilePath = await addReverb(tempFilePath);
	// Add silence to the beginning and end of the audio after adding reverb
	const withSilenceAtStart = await addSilenceToAudio(reverbFilePath);
	const processedFilePath = await addSilenceToEnd(withSilenceAtStart);
	// Generate mixed audio
	const mixedAudioPath = await mixAndSendAudio(processedFilePath, audioFile);

	if (!mixedAudioPath) {
		throw new Error("could not mix audio");
	}
	// Send mixed audio
	const mixedAudioBuffer = fs.readFileSync(mixedAudioPath);
	const messageMedia = new MessageMedia("audio/ogg; codecs=opus", mixedAudioBuffer.toString("base64"));
	message.reply(messageMedia);

	// Delete mixed audio temp file
	fs.unlinkSync(mixedAudioPath);

	// Delete common temp files
	fs.unlinkSync(tempFilePath);
	fs.unlinkSync(processedFilePath);
}


const addReverb = async (filePath: string): Promise<string> => {
	const outputFilePath = filePath.replace('.opus', '_enhanced.opus');
	return new Promise((resolve, reject) => {
		ffmpeg(filePath)
			.audioFilters('aecho=0.8:0.9:60:0.4')
			.output(outputFilePath)
			.on('end', () => resolve(outputFilePath))
			.on('error', (err) => reject(err))
			.run();
	});
};

const addSilenceToAudio = async (filePath: string): Promise<string> => {
  const outputFilePath = filePath.replace('.opus', '_padded.opus');
  try {
    await new Promise((resolve, reject) => {
      ffmpeg(filePath)
        .inputOptions(['-t', '2', '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000'])
        .complexFilter(['[0:a][1:a]concat=n=2:v=0:a=1'])
        .output(outputFilePath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
    return outputFilePath;
  } catch (err) {
    throw new Error(`Failed to add silence to audio: ${err}`);
  }
};

const addSilenceToEnd = async (filePath: string): Promise<string> => {
  const outputFilePath = filePath.replace('.opus', '_final.opus');
  try {
    await new Promise((resolve, reject) => {
      ffmpeg(filePath)
        .inputOptions(['-t', '2', '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000'])
        .complexFilter(['[1:a][0:a]concat=n=2:v=0:a=1'])
        .output(outputFilePath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
    return outputFilePath;
  } catch (err) {
    throw new Error(`Failed to add silence to the end of audio: ${err}`);
  }
};
// Mix generated audio with TTS audio and send, adjusting mix duration to include 2 seconds of silence before and after TTS, and looping the generated audio to match the TTS duration
const mixAndSendAudio = async (ttsFilePath: string, generatedAudioPath: string): Promise<string> => {
  const mixedAudioPath = ttsFilePath.replace('.opus', '_mixed.opus');
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(ttsFilePath)
      .input(generatedAudioPath)
      .complexFilter([
        '[1:a]aloop=loop=-1:size=2e+09[a1]', // Loop generated audio to match the TTS duration plus silence
        '[a1]volume=0.2[a2]', // Set looped generated audio volume to 0.2
        '[0:a][a2]amix=inputs=2:duration=first[aout]' // Mix audio tracks, using the duration of the first input (TTS + silence before and after)
      ])
      .outputOptions(['-map [aout]'])
      .output(mixedAudioPath)
      .on('end', () => resolve(mixedAudioPath))
      .on('error', (err) => reject(err))
      .run();
  });
};

const sanitizeName = (name: string) => {
	if (!name) return "unknown";
	return name.replace(/[^a-zA-Z0-9]/g, "");
};


export { handleMessageGPT, handleDeleteConversation };
