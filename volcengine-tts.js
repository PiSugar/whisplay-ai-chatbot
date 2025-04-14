const axios = require("axios");

// ByteDance TTS
const byteDanceAppId = process.env.BYTE_DANCE_APP_ID;
const byteDanceAccessToken = process.env.BYTE_DANCE_ACCESS_TOKEN;

const volcengineTTS = async (text) => {
  console.time("合成语音");
  // https://openspeech.bytedance.com/api/v1/tts
  const payload = {
    app: {
      appid: byteDanceAppId,
      token: byteDanceAccessToken,
      cluster: "volcano_tts",
    },
    user: {
      uid: "01",
    },
    audio: {
      voice_type: "zh_female_wanwanxiaohe_moon_bigtts",
      encoding: "mp3",
      speed_ratio: 1,
      volume_ratio: 1.0,
    },
    request: {
      reqid: `req_${Date.now()}`,
      text,
      operation: "query",
    },
  };

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer;${byteDanceAccessToken}`,
  };

  try {
    const res = await axios.post(
      `https://openspeech.bytedance.com/api/v1/tts`,
      payload,
      { headers }
    );
    // console.log('res.data', res.data)
    console.timeEnd("合成语音");
    return { data: res.data.data, duration: res.data.addition.duration };
  } catch (err) {
    console.error("合成语音失败：", err.response?.data || err.message);
  }
};

module.exports = volcengineTTS;
