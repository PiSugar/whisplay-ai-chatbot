import socket
import json
import time
import random
import datetime

def generate_random_data():
    status_options = ["系统运行中", "维护中", "警告", "正常"]
    emoji_options = ["🚀", "🛠️", "⚠️", "✅", "💡", "✨"]
    random_text_length = random.randint(50, 200)
    random_text = "".join(random.choice("这是一段随机生成的内容，包含一些中文和英文的混合。abcdefghijklmnopqrstuvwxyz ") for _ in range(random_text_length))
    scroll_speed_options = [3, 5, 7, 10]

    data = {
        "status": random.choice(status_options),
        "emoji": random.choice(emoji_options),
        "text": f"{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} - {random_text}",
        "scroll_speed": random.choice(scroll_speed_options)
    }
    return data

try:
    while True:
        sock = socket.socket()
        try:
            sock.connect(("127.0.0.1", 12345))
            payload = generate_random_data()
            json_payload = json.dumps(payload).encode("utf-8")
            sock.send(json_payload)
            print(f"发送: {payload}")
            response = sock.recv(1024).decode("utf-8")
            print(f"接收: {response}")
        except ConnectionRefusedError:
            print("连接被拒绝，请确保服务器正在运行。")
        except Exception as e:
            print(f"发生错误: {e}")
        finally:
            if 'sock' in locals():
                sock.close()
        time.sleep(3)
except KeyboardInterrupt:
    print("\n程序已停止")