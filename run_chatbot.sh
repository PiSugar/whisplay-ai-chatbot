#!/bin/bash
# 设置工作目录
cd /home/pi/whisplay-ai-chatbot/python || exit 1
export NVM_DIR="/home/pi/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
# 输出当前环境信息（用于调试）
echo "===== 启动时间: $(date) =====" 
echo "当前用户: $(whoami)" 
echo "工作目录: $(pwd)" 
echo "PATH: $PATH" 
echo "Python版本: $(python3 --version)" 
echo "Node版本: $(node --version)"
# 调节音量
amixer -c 1 set Speaker 120 > /dev/null
# 启动Python聊天机器人UI
# echo "等待10秒..."
# sleep 10
echo "启动Python聊天机器人..." 
python3 /home/pi/whisplay-ai-chatbot/python/chatbot-ui.py &
# 等待30秒
sleep 30
cd ..
# 启动Node.js应用
echo "启动Node.js应用..."
cd /home/pi/whisplay-ai-chatbot
yarn start
# 记录结束状态
echo "===== 服务结束: $(date) ====="
