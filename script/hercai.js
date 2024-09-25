const axios = require('axios');

module.exports.config = {
  name: 'ai',
  version: '1.0.0',
  hasPermission: 0,
  usePrefix: false,
  aliases: ['gpt', 'openai'],
  description: "An AI command powered by GPT-4",
  usages: "ai [prompt]",
  credits: 'LorexAi',
  cooldowns: 3,
  dependencies: {
    "axios": ""
  }
};

module.exports.run = async function({ api, event, args }) {
  const input = args.join(' ');


  if (!input) {
    return api.sendMessage(
      "Hello there!\n\nI am 𝗟𝗼𝗿𝗲𝘅 𝗔𝗶, your Educational Ai Bot. How can I assist you today?\n\nUsage: ai [text]",
      event.threadID,
      event.messageID
    );
  }

  api.sendMessage("🔄 Generating...", event.threadID, event.messageID);
  try {
    
    const { data } = await axios.get('https://gpt4-api-zl5u.onrender.com/api/gpt4o', {
      params: {
        prompt: input,
        uid: event.senderID
      }
    });


    if (data && data.response) {
      const responseMessage = `𝗟𝗢𝗥𝗘𝗫 𝗔𝗜 𝗔𝗦𝗦𝗜𝗦𝗧𝗔𝗡𝗧\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n${data.response}\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n🚫 Please do not sell this bot. It is intended for personal and educational use only.`;
      return api.sendMessage(responseMessage, event.threadID, (err) => {
        if (err) {
          console.error("Error sending message:", err);
        }
      }, event.messageID);
    } else {
      return api.sendMessage("Unexpected response format from the API.", event.threadID, event.messageID);
    }

  } catch (error) {

    console.error("Error processing request:", error.message || error);
    api.sendMessage("An error occurred while processing your request. Please try again", event.threadID, event.messageID);
  }
};