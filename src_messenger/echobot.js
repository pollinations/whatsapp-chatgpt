import login from "fb-chat-api-temp";
import dotenv from "dotenv";
import fs from "fs";
import {respondText} from "./replicate.js";
dotenv.config();

login({appState: JSON.parse(fs.readFileSync('appState.json', 'utf8'))}, (err, api) => {
    if(err) return console.error(err);
    console.log("Logged in!");

    api.setOptions({selfListen: true})

    // api.listen((err, message) => {
    //         console.log("err, message", err, message);
    //         // api.sendMessage(message.body, message.threadID);
    // });
    // api.sendMessage("Hello kitty!", "61011625");

    let lastMessageSent = "";
    const stopListening = api.listenMqtt(async (err, event) => {
        if(err) return console.error(err);

        api.markAsRead(event.threadID, (err) => {
            if(err) console.error(err);
        });

        switch(event.type) {
            case "message":
                if(event.body === '/stop') {
                    api.sendMessage("Goodbye…", event.threadID);
                    return stopListening();
                }
                if (event.body.startsWith("")) {
                    // console.log(event)
                    const message = event.body;
                    if (lastMessageSent.trim() === message.trim()) {
                        console.log("same message")
                        break;
                    }
                    console.log("messages are different")
                    console.log(message)
                    console.log("----")
                    console.log(lastMessageSent)
                    const response = await respondText(message);
                    lastMessageSent = response;
                    api.sendMessage(response, event.threadID);
                    // console.log("event.body", event.body);
                    break;
                }
            case "event":
                console.log(event);
                break;
        }
    });
});