#!/bin/bash

# 终止所有名为 python3 的进程
echo "正在终止所有 python3 进程..."
pkill -9 python3

if [ $? -eq 0 ]; then
    echo "成功终止 python3 进程。"
else
    echo "没有找到运行的 python3 进程。"
fi

# 重启 chatbot.service
echo "正在重启 chatbot.service..."
systemctl restart chatbot.service

if [ $? -eq 0 ]; then
    echo "chatbot.service 已成功重启。"
else
    echo "重启 chatbot.service 失败，请检查服务是否存在或是否有权限。"
