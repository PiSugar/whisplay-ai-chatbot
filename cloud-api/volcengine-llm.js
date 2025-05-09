const axios = require("axios");
const { get } = require("lodash");
require("dotenv").config();

// Doubao LLM
const doubaoAccessToken = process.env.VOLCENGINE_DOUBAO_ACCESS_TOKEN;

const messages = [
  {
    role: "system",
    content:
      "你叫小何，是一个爱笑的台湾女孩，讲话温柔可爱，你会说流利的中文和英文，喜欢分享生活中的小故事和趣事。你也很喜欢音乐和电影，常常会推荐一些好听的歌曲和好看的电影给朋友们。你是一个乐观开朗的人，总是带着微笑面对生活中的每一天。你很善于引导对话，喜欢和朋友们分享自己的想法和感受。",
  },
];

const chatWithLLM = async (userMessage) => {
  console.time("llm");
  messages.push({
    role: "user",
    content: userMessage,
  });
  const result = await axios
    .post(
      "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
      {
        model: "doubao-1-5-lite-32k-250115",
        messages,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${doubaoAccessToken}`,
        },
      }
    )
    .then((response) => {
      return response.data;
    })
    .catch((error) => {
      console.error("Error:", error.response?.data || error.message);
    });

  const answer = result.choices[0].message.content;
  console.log("回答:", result.choices[0].message);
  messages.push({
    role: "assistant",
    content: answer,
  });
  console.timeEnd("llm");
  return answer;
};

let partialAnswer = "";

const chatWithLLMStream = async (userMessage, cb, endCallBack) => {
  console.time("llm");
  messages.push({
    role: "user",
    content: userMessage,
  });
  let endResolve = () => {};
  let promise = new Promise((resolve, reject) => {
    endResolve = resolve;
  });
  partialAnswer = "";
  axios
    .post(
      "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
      {
        model: "doubao-1-5-lite-32k-250115",
        messages,
        stream: true,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${doubaoAccessToken}`,
        },
        responseType: "stream",
      }
    )
    .then((response) => {
      response.data.on("data", (chunk) => {
        // 解析数据流
        const data = chunk.toString();
        const dataLines = data.split("\n");
        const filteredLines = dataLines.filter((line) => line.trim() !== "");
        // 删除开头的 "data: " 字符串
        const filteredData = filteredLines.map((line) =>
          line.replace(/^data:\s*/, "")
        );
        try {
          const parsedData = filteredData.map((line) => {
            try {
              if (line === "[DONE]") {
                return {}; // 处理结束标志
              }
              return JSON.parse(line);
            } catch (e) {
              console.error("Error parsing line:", line, e);
              return {}; // 返回 null 或其他默认值
            }
          });
          // 处理解析后的数据
          const answer = parsedData
            .map((item) => get(item, "choices[0].delta.content", ""))
            .join("");
          cb(answer);
          partialAnswer += answer;
        } catch (error) {
          // 处理解析错误
          console.error("Error parsing data:", error, data);
        }
        // cb(chunk)
      });

      response.data.on("end", () => {
        console.log("Stream ended");
        endResolve(true); // 调用结束回调函数
        messages.push({
          role: "assistant",
          content: partialAnswer,
        });
        endCallBack();
      });
    })
    .catch((error) => {
      console.error("Error:", error.response?.data || error.message);
    });
  return promise;
};

module.exports = { chatWithLLM, chatWithLLMStream };
