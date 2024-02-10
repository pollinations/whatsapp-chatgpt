import os from "os";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { Message, MessageMedia } from "whatsapp-web.js";
import { chatgpt } from "../providers/openai";
import * as cli from "../cli/ui";
import config from "../config";

import { ChatMessage } from "chatgpt";

// TTS
import { ttsRequest as speechTTSRequest } from "../providers/speech";
import { ttsRequest as awsTTSRequest } from "../providers/aws";
import { ttsRequest as elevenlabsTTSRequest } from "../providers/elevenlabs";

import { TTSMode } from "../types/tts-mode";

// Moderation
import { moderateIncomingPrompt } from "./moderation";
import { aiConfig, getConfig } from "./ai-config";

// Mapping from number to last conversation id
// Removed global state for conversations
console.log("pre prompt", process.env.PRE_PROMPT)
console.log(process.env.PRE_PROMPT)
// process.exit(0)
const buildPrompt = (configPrePrompt: string, prompt: string): string => {
    let promptBuilder = "";
    if (configPrePrompt != null && configPrePrompt.trim() != "") {
        promptBuilder += configPrePrompt + "\n\n";
    }
    promptBuilder += prompt + "\n\n";
    return promptBuilder;
};

const getTTSRequestFunction = (ttsMode: TTSMode): (() => Promise<Buffer | null>) => {
    switch (ttsMode) {
        case TTSMode.SpeechAPI:
            return speechTTSRequest;
        case TTSMode.AWSPolly:
            return awsTTSRequest;
        case TTSMode.ElevenLabs:
            return elevenlabsTTSRequest;
        default:
            return speechTTSRequest;
    }
};

const generateAudioFilePath = (): string => {
    const tempFolder = os.tmpdir();
    return path.join(tempFolder, randomUUID() + ".opus");
};

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
			const promptBuilder = buildPrompt(config.prePrompt, prompt);

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
	var logTAG = "[TTS]";
	const ttsRequest = getTTSRequestFunction(config.ttsMode);

	// Get audio buffer
	cli.print(`${logTAG} Generating audio from GPT response "${gptTextResponse}"...`);
	// console.log("message", message)
	const audioBuffer = await ttsRequest();

	// Check if audio buffer is valid
	if (audioBuffer == null || audioBuffer.length == 0) {
		message.reply(`${logTAG} couldn't generate audio, please contact the administrator.`);
		return;
	}

	cli.print(`${logTAG} Audio generated!`);

	const tempFilePath = generateAudioFilePath();

	// Save buffer to temp file
	fs.writeFileSync(tempFilePath, audioBuffer);

	// Send audio
	const messageMedia = new MessageMedia("audio/ogg; codecs=opus", audioBuffer.toString("base64"));
	message.reply(messageMedia);

	// Delete temp file
	fs.unlinkSync(tempFilePath);
}


// remove all non alphanumeric characters
// also remove spaces
const sanitizeName = (name: string) => {
	return name.replace(/[^a-zA-Z0-9]/g, "");
};

export { handleMessageGPT, handleDeleteConversation };
