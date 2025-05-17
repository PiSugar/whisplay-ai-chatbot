const { noop } = require("lodash")
const { onButtonPressed, onButtonReleased, display, extractEmojis } = require("../device/display")
const { recordAudioManually, StreamResponser } = require("../device/audio")
const { recognizeAudio, chatWithLLMStream, ttsProcessor } = require("../cloud-api/server")

class ChatFlow {

  currentFlowName = ''
  dataDir = ''
  currentRecordFilePath = ''
  asrText = ''

  constructor({
    dataDir
  }) {
    this.dataDir = dataDir
    this.setCurrentFlow('sleep')
  }


  setCurrentFlow = (flowName) => {
    console.log("切换到流程:", flowName)
    switch (flowName) {
      case 'sleep':
        this.currentFlowName = 'sleep'
        onButtonPressed(() => {
          this.setCurrentFlow('listening')
        })
        onButtonReleased(noop)
        display({
          status: "idle",
          emoji: "😴",
          RGB: "#000055",
          text: "Press the button to start",
        });
        break;
      case 'listening':
        // 只需要处理按钮释放的操作
        this.currentFlowName = 'listening'
        this.currentRecordFilePath = `${this.dataDir}/user-${Date.now()}.mp3`
        onButtonPressed(noop)
        // onButtonReleased(noop)
        const { result, stop } = recordAudioManually(this.currentRecordFilePath)
        onButtonReleased(() => {
          stop()
        })
        result.then((text) => {
          this.setCurrentFlow('asr')
        })
        display({
          status: "listening",
          emoji: "😐",
          RGB: "#00ff00",
          text: "Listening...",
        });
        break;
      case 'asr':
        this.currentFlowName = 'asr'
        display({
          status: "recognizing",
        })
        Promise.race([
          recognizeAudio(this.currentRecordFilePath),
          new Promise((resolve) => {
            onButtonPressed(() => {
              resolve("[UserPress]")
            })
            onButtonReleased(noop)
          })
        ]).then((result) => {
          if (result === "[UserPress]") {
            this.setCurrentFlow('listening')
          } else {
            if (result) {
              console.log("识别结果:", result)
              this.setCurrentFlow('answer')
              this.asrText = result
              display({ status: "recognizing", text: result })
            } else {
              this.setCurrentFlow('sleep')
            }
          }
        })
        break
      case 'answer':
        this.currentFlowName = 'answer'
        onButtonPressed(() => {
          this.setCurrentFlow('listening')
        })
        onButtonReleased(noop)
        const {
          partial,
          endPartial,
          getPlayEndPromise,
          stop: stopPlaying,
        } = new StreamResponser(
          ttsProcessor,
          (sentences) => {
            if (this.currentFlowName !== 'answer') return
            const fullText = sentences.join("");
            display({
              status: "answering",
              emoji: extractEmojis(fullText) || "😊",
              text: fullText,
              RGB: "#0000ff",
            });
          },
          (text) => {
            if (this.currentFlowName !== 'answer') return
            display({
              text,
            });
          }
        );
        chatWithLLMStream([{
          role: 'user',
          content: this.asrText,
        }], partial, endPartial)
        getPlayEndPromise().then(() => {
          if (this.currentFlowName === 'answer') {
            this.setCurrentFlow('sleep')
          }
        })
        onButtonPressed(() => {
          stopPlaying()
          this.setCurrentFlow('listening')
        })
        onButtonReleased(noop)
        break
      default:
        console.error("Unknown flow name:", flowName);
        break;
    }
  }
}

module.exports = ChatFlow