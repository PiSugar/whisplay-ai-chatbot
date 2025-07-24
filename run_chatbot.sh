#!/bin/bash
# 设置工作目录
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
# amixer -c 1 set Speaker 120 > /dev/null
echo "启动Node.js应用..."
cd /home/pi/whisplay-ai-chatbot
yarn start
# 记录结束状态
echo "===== 服务结束: $(date) ====="
