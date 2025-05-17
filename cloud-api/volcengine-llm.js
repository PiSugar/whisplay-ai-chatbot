const axios = require("axios");
const { get, isEmpty, isArray } = require("lodash");
const { systemPrompt } = require("../config/llm-config");
const { combineFunction } = require("../utils");
const { llmTools, llmFuncMap } = require("../config/llm-config");
require("dotenv").config();

// Doubao LLM
const doubaoAccessToken = process.env.VOLCENGINE_DOUBAO_ACCESS_TOKEN;

const messages = [
  {
    role: "system",
    content: systemPrompt,
  },
];

const resetChatHistory = () => {
  messages.length = 0;
  messages.push({
    role: "system",
    content: systemPrompt,
  });
}

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
  return answer;
};



const chatWithLLMStream = async (inputMessages = [], partialCallback, endCallBack) => {
  messages.push(...inputMessages);
  let endResolve = () => { };
  let promise = new Promise((resolve, reject) => {
    endResolve = resolve;
  });
  let partialAnswer = "";
  let functionCallsPackages = [];
  axios
    .post(
      "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
      {
        model: "doubao-1-5-lite-32k-250115",
        messages,
        stream: true,
        tools: llmTools,
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
          const toolCalls = parsedData
            .map((item) => get(item, "choices[0].delta.tool_calls", []))
            .filter(arr => !isEmpty(arr));

          if (toolCalls.length) {
            functionCallsPackages.push(...toolCalls);
          }
          if (answer) {
            partialCallback(answer);
            partialAnswer += answer;
          }
        } catch (error) {
          // 处理解析错误
          console.error("Error parsing data:", error, data);
        }
        // cb(chunk)
      });

      response.data.on("end", () => {
        console.log("Stream ended");
        const functionCalls = combineFunction(functionCallsPackages)
        console.log('functionCalls: ', JSON.stringify(functionCalls));
        messages.push({
          role: "assistant",
          content: partialAnswer,
          tool_calls: functionCalls,
        });

        if (!isEmpty(functionCalls)) {
          Promise.all(functionCalls.map(call => {
            const { function: { arguments: argString, name }, id } = call;
            let arguments = {};
            try {
              arguments = JSON.parse(argString || {});
            } catch {
              console.error(`Error parsing arguments for function ${name}:`, argString);
            }
            const func = llmFuncMap[name];
            if (func) {
              return Promise.all([Promise.resolve(id), func(arguments)]);
            } else {
              console.error(`Function ${name} not found`);
              return Promise.all([Promise.resolve(id), Promise.resolve(`Function ${name} not found`)]);
            }
          })).then((results) => {
            console.log("call results: ", results);
            const newMessage = []
            results.forEach(([id, result]) => {
              newMessage.push({
                role: "tool",
                content: result,
                tool_call_id: id,
              });
            })
            chatWithLLMStream(
              newMessage,
              partialCallback,
              () => {
                endResolve(true); // 调用结束回调函数
                endCallBack();
              },
            );
          })
          // 在函数调用完成之前先不回答
          return;
        }

        if (partialAnswer) {
          endResolve(true); // 调用结束回调函数
          endCallBack();
        }
      });
    })
    .catch((error) => {
      console.error("Error:", error.message);
    });
  return promise;
};

module.exports = { chatWithLLM, chatWithLLMStream, resetChatHistory };
